// Renders a project to a 48 kHz stereo 16-bit WAV, in node, with the real engine and its devices: the agent's ears
// (Nitro's project.render, daw/pulsegrid/AGENT_WIRE.md section 9). It always plays from the song's start, so a reverb
// or delay that began before `from_bar` sounds as in the song, and keeps the slice from_bar..to_bar plus a tail.
// The file is the mix, or one top-level track's post-fader stem; the numbers always cover the mix and every track.
// No file system and no zip here: the caller hands over the project bytes, the engine directory and the samples.
// Not part of the browser build: it lives outside src/.

import {StringField} from "@opendaw/lib-box"
import {AudioData, PPQN, RenderQuantum, WavFile} from "@opendaw/lib-dsp"
import {UUID} from "@opendaw/lib-std"
import {BoxAdapters, BoxAdaptersContext, ProjectSkeleton, PulseGridDrums, TimelineBoxAdapter, VaryingTempoMap} from "@opendaw/studio-adapters"
import {AudioFileBox, AudioRegionBox, AudioUnitBox, NoteRegionBox, ValueRegionBox} from "@opendaw/studio-boxes"
import {LoudnessMeter} from "../src/analysis-dsp"
import {connectSyncToEngine} from "./connect-sync"
import {loadEngine} from "./load-engine"

export const SampleRate = 48000
export const MaxSeconds = 360
const BuiltInRate = 44100 // Matches OpenSampleAPI's built-in drum source rate.
const StereoQuantum = 2 * RenderQuantum

// The caller's fault (an option, a track name, a length, a project that cannot render): Nitro answers it with a 422.
export class RenderError extends Error {}

type MaybePromise<T> = T | Promise<T>
// WAV bytes by sample uuid. `bundle` is the project's own samples, `library` the team library; the built-in
// drums sit between them.
export type SampleSources = {
    bundle(uuid: string): MaybePromise<Uint8Array | undefined>
    library(uuid: string): MaybePromise<Uint8Array | undefined>
}
export type RenderOptions = {
    track: string | null   // a top-level track's name as project.score gives it; its stem is the file
    fromBar: number        // 1-based
    toBar: number | null   // inclusive; null = the last bar that holds a region
    tail: number           // seconds added after the end
    seconds?: number       // test aid: the first N seconds instead of the bars, no tail
}
export type RenderInput = {
    engineDir: string
    project: ArrayBuffer
    options: RenderOptions
    samples: SampleSources
}
export type RenderReport = {
    seconds: number
    sample_rate: number
    from_bar: number
    to_bar: number
    tail: number
    wall_seconds: number
    realtime_factor: number
    mix: {peak_dbfs: number | null, true_peak_dbfs: number | null, lufs: number | null, lra: number | null, clipped_samples: number}
    tracks: Array<{name: string, peak_dbfs: number | null, lufs: number | null}>
    samples: {
        resolved: number, total: number, by_source: {bundle: number, builtin: number, library: number}, unresolved: Array<string>
    }
    file: {track: string | null}
    warnings: Array<string>
}

const round = (value: number): number => Math.round(value * 100) / 100
const dbfs = (peak: number): number | null => peak === 0 ? null : round(20 * Math.log10(peak))
// The meter answers -120 for "nothing above its gate"; the report says null.
const lufs = (value: number): number | null => value <= -119 ? null : round(value)

// Seconds at a position, through the tempo map the studio uses (tempo automation included).
const tempoConverter = ({boxGraph, mandatoryBoxes: {timelineBox}}: ProjectSkeleton) => {
    if (!timelineBox.tempoTrack.enabled.getValue()) {
        const bpm = timelineBox.bpm.getValue()
        return {toSeconds: (pulses: number) => PPQN.pulsesToSeconds(pulses, bpm), terminate: () => {}}
    }
    // Only timeline and event adapters are needed for the studio's tempo conversion.
    const context = {boxGraph, get boxAdapters(): BoxAdapters {return adapters}} as BoxAdaptersContext
    const adapters = new BoxAdapters(context)
    const tempo = new VaryingTempoMap(adapters.adapterFor(timelineBox, TimelineBoxAdapter))
    return {
        toSeconds: (pulses: number) => tempo.ppqnToSeconds(pulses),
        terminate: () => {tempo.terminate(); adapters.terminate()}
    }
}

export const renderProject = async ({engineDir, project: bytes, options, samples: sources}: RenderInput) => {
    const start = performance.now()
    const warnings: Array<string> = []
    let project: ProjectSkeleton
    try {project = ProjectSkeleton.decode(bytes)} catch {
        throw new RenderError("project.od is not a readable openDAW project")
    }
    const {boxGraph, mandatoryBoxes: {primaryAudioUnitBox, timelineBox}} = project

    // Where the slice sits, in bars and then in seconds.
    const {nominator, denominator} = timelineBox.signature
    const barPulses = PPQN.fromSignature(nominator.getValue(), denominator.getValue())
    let regionEnd = 0
    for (const box of boxGraph.boxes()) {
        if (box instanceof AudioRegionBox || box instanceof NoteRegionBox || box instanceof ValueRegionBox) {
            regionEnd = Math.max(regionEnd, box.position.getValue() + box.duration.getValue())
        }
    }
    if (options.toBar === null && options.seconds === undefined && regionEnd === 0) {
        throw new RenderError("the project holds no region to render")
    }
    const lastBar = options.toBar ?? Math.max(1, Math.ceil(regionEnd / barPulses))
    if (options.fromBar > lastBar) {
        throw new RenderError(options.toBar === null
            ? `from_bar ${options.fromBar} is past the last bar that holds a region (${lastBar})`
            : `from_bar ${options.fromBar} is after to_bar ${lastBar}`)
    }
    const tempo = tempoConverter(project)
    let startSeconds: number, endSeconds: number
    try {
        startSeconds = options.seconds === undefined ? tempo.toSeconds((options.fromBar - 1) * barPulses) : 0
        endSeconds = options.seconds ?? tempo.toSeconds(lastBar * barPulses)
    } finally {tempo.terminate()}
    const tail = options.seconds === undefined ? options.tail : 0
    const startFrame = Math.round(startSeconds * SampleRate)
    const endFrame = Math.round((endSeconds + tail) * SampleRate)
    const frameCount = endFrame - startFrame
    if (!Number.isSafeInteger(frameCount) || frameCount <= 0) {throw new RenderError(`there is nothing to render (${frameCount / SampleRate} s)`)}
    if (frameCount / SampleRate > MaxSeconds) {
        throw new RenderError("the render is longer than 6 minutes; give from_bar and to_bar")
    }

    // The top-level units, named the way project.score names them (the label of the unit's instrument).
    const units = boxGraph.boxes().filter((box): box is AudioUnitBox => box instanceof AudioUnitBox && box !== primaryAudioUnitBox)
        .sort((a, b) => a.index.getValue() - b.index.getValue())
    const tracks = units.map(unit => {
        const input = unit.input.pointerHub.incoming().at(0)?.box
        const name = input !== undefined && "label" in input && input.label instanceof StringField ? input.label.getValue() : ""
        return {name, peak: 0, meter: new LoudnessMeter(SampleRate), loudness: new Float32Array(5)}
    })
    let fileTrack = -1
    if (options.track !== null) {
        const matches = tracks.flatMap(({name}, index) => name === options.track ? [index] : [])
        if (matches.length === 0) {throw new RenderError(`unknown track ${options.track}; see project.score`)}
        if (matches.length > 1) {
            throw new RenderError(`${matches.length} tracks are named ${options.track}; rename one of them (see project.score)`)
        }
        fileTrack = matches[0]
    }

    // The arrangement renders straight through, even when the editor's loop is enabled.
    if (timelineBox.loopArea.enabled.getValue()) {
        boxGraph.beginTransaction()
        timelineBox.loopArea.enabled.setValue(false)
        boxGraph.endTransaction()
    }

    // Samples: the project's own, then the built-in drums, then the team library; otherwise silence, never a tone.
    const audio = new Map<string, AudioData>()
    const unresolved: Array<string> = []
    const by_source = {bundle: 0, builtin: 0, library: 0}
    const files = boxGraph.boxes().filter(box => box instanceof AudioFileBox)
    const decode = (wav: Uint8Array, uuid: string): AudioData | undefined => {
        try {return WavFile.decodeFloats(Uint8Array.from(wav).buffer)} catch {
            warnings.push(`sample ${uuid} could not be decoded (only WAV files are read)`)
            return undefined
        }
    }
    for (const file of files) {
        const uuid = UUID.toString(file.address.uuid)
        const own = await sources.bundle(uuid)
        const ownAudio = own === undefined ? undefined : decode(own, uuid)
        if (ownAudio !== undefined) {audio.set(uuid, ownAudio); by_source.bundle++; continue}
        const drum = PulseGridDrums.render(uuid, BuiltInRate)
        if (drum !== undefined) {audio.set(uuid, drum); by_source.builtin++; continue}
        const shared = await sources.library(uuid)
        const sharedAudio = shared === undefined ? undefined : decode(shared, uuid)
        if (sharedAudio !== undefined) {audio.set(uuid, sharedAudio); by_source.library++} else {unresolved.push(uuid)}
    }
    if (unresolved.length > 0) {
        warnings.push(`${unresolved.length} sample(s) were not found and play as silence (see samples.unresolved)`)
    }

    const output = AudioData.create(SampleRate, frameCount, 2)
    const [left, right] = output.frames
    const meter = new LoudnessMeter(SampleRate)
    let peak = 0
    let clipped = 0
    const {engine, memory, drainSamples} = await loadEngine({engineDir, sampleRate: SampleRate})
    const sync = connectSyncToEngine(engine, memory, boxGraph)
    try {
        await sync.settle()
        if (units.length > 0) {
            const pointer = engine.input_reserve(units.length * 20)
            const view = new DataView(memory.buffer, pointer, units.length * 20)
            units.forEach((unit, index) => {
                new Uint8Array(memory.buffer, pointer + index * 20, 16).set(unit.address.uuid)
                view.setUint32(index * 20 + 16, 1 | 2, true) // Include audio effects and sends, tap post-fader.
            })
            engine.set_stem_export(units.length, 0)
        }
        if (engine.bind() !== 0) {throw new Error("Engine could not bind the project")}
        await sync.settle()
        drainSamples(uuid => audio.get(uuid))
        await sync.settle()
        // Soundfonts are not loaded here: say which devices stay silent.
        for (; ;) {
            const requestPtr = engine.input_reserve(16)
            if (engine.soundfont_take_request(requestPtr) < 0) {break}
            const uuid = UUID.toString(new Uint8Array(memory.buffer.slice(requestPtr, requestPtr + 16)) as UUID.Bytes)
            warnings.push(`soundfont ${uuid} is not loaded; the notes that use it are silent`)
        }
        engine.set_metronome_enabled(0)
        engine.stop()
        engine.play()

        for (let offset = 0; offset < endFrame; offset += RenderQuantum) {
            engine.render()
            const from = Math.max(0, startFrame - offset) // the part of this quantum inside the slice
            const to = Math.min(RenderQuantum, endFrame - offset)
            if (from >= to) {continue}
            const at = offset + from - startFrame
            const mix = new Float32Array(memory.buffer, engine.output_ptr(), StereoQuantum)
            const mixLeft = mix.subarray(from, to)
            const mixRight = mix.subarray(RenderQuantum + from, RenderQuantum + to)
            meter.process(mixLeft, mixRight)
            for (let frame = 0; frame < to - from; frame++) {
                const l = Math.abs(mixLeft[frame])
                const r = Math.abs(mixRight[frame])
                peak = Math.max(peak, l, r)
                clipped += Number(l >= 1) + Number(r >= 1)
            }
            if (fileTrack < 0) {
                left.set(mixLeft, at)
                right.set(mixRight, at)
            }
            if (tracks.length === 0) {continue}
            const stems = new Float32Array(memory.buffer, engine.stem_output_ptr(), tracks.length * StereoQuantum)
            tracks.forEach((track, index) => {
                const base = index * StereoQuantum
                const stemLeft = stems.subarray(base + from, base + to)
                const stemRight = stems.subarray(base + RenderQuantum + from, base + RenderQuantum + to)
                track.meter.process(stemLeft, stemRight)
                for (let frame = 0; frame < to - from; frame++) {
                    track.peak = Math.max(track.peak, Math.abs(stemLeft[frame]), Math.abs(stemRight[frame]))
                }
                if (index === fileTrack) {
                    left.set(stemLeft, at)
                    right.set(stemRight, at)
                }
            })
        }
    } finally {
        sync.close()
    }
    if (!Number.isFinite(peak) || tracks.some(track => !Number.isFinite(track.peak))) {
        throw new Error("Engine rendered non-finite audio")
    }

    const mixLoudness = new Float32Array(5)
    meter.fill(mixLoudness)
    const silent = peak === 0
    const wavSeconds = frameCount / SampleRate
    const wallSeconds = (performance.now() - start) / 1000
    const report: RenderReport = {
        seconds: wavSeconds,
        sample_rate: SampleRate,
        from_bar: options.fromBar,
        to_bar: lastBar,
        tail,
        wall_seconds: round(wallSeconds),
        realtime_factor: round(endFrame / SampleRate / wallSeconds),
        mix: {
            peak_dbfs: dbfs(peak),
            true_peak_dbfs: silent ? null : round(mixLoudness[4]),
            lufs: silent ? null : lufs(mixLoudness[2]),
            lra: silent ? null : round(mixLoudness[3]),
            clipped_samples: clipped
        },
        tracks: tracks.map(track => {
            track.meter.fill(track.loudness)
            return {name: track.name, peak_dbfs: dbfs(track.peak), lufs: track.peak === 0 ? null : lufs(track.loudness[2])}
        }),
        samples: {resolved: audio.size, total: files.length, by_source, unresolved},
        file: {track: options.track},
        warnings
    }
    // 16-bit PCM: the encoder clamps to full scale after `clipped_samples` has been counted.
    return {wav: new Uint8Array(WavFile.encodeInts16(output)), report}
}
