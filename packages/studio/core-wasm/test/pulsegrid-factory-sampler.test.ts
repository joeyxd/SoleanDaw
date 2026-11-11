// Production factory, graph sync and real Nano DSP; sample PCM is supplied locally, with no track notes.
import {describe, expect, it} from "vitest"
import {int, UUID} from "@opendaw/lib-std"
import {AudioUnitBox, NanoDeviceBox, TrackBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton, PulseGridDevice, PulseGridFactory, PulseGridOps, TrackType} from "@opendaw/studio-adapters"
import {loadFullEngine} from "./helpers/load-full-engine"
import {connectSyncToEngine} from "./helpers/connect-sync"

const SAMPLE_RATE = 48000
const STEP_FRAMES = 6000 // 120 bpm, sixteenth notes
const BAR_FRAMES = STEP_FRAMES * 16
const LEFT = [0, 4, 8, 12]
const RIGHT = [2, 6, 10, 14]
const EDITED = [1, 5, 9, 13]
const gridText = (steps: ReadonlyArray<int>): string =>
    `|${Array.from({length: 16}, (_, step) => steps.includes(step) ? "x" : "-").join("")}|`

const project = (count: int) => {
    const {boxGraph: source, mandatoryBoxes: {rootBox, primaryAudioBusBox}} =
        ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
    source.beginTransaction()
    const unit = AudioUnitBox.create(source, UUID.generate(), box => {
        box.collection.refer(rootBox.audioUnits)
        box.output.refer(primaryAudioBusBox.input)
        box.index.setValue(1)
    })
    const composite = PulseGridFactory.create(source, unit.input, "Sampler proof",
        Array.from({length: count}, (_, index) => ({...PulseGridFactory.DefaultKit[0], name: `Lane ${index + 1}`})))
    const device = PulseGridDevice.find(composite).unwrap()
    device.lanes.forEach((lane, index) => {
        lane.cell.pan.setValue(index % 2 === 0 ? -1 : 1)
        // A short sample ends well before note-off, so silence between triggers is unambiguous.
        const nano = lane.instrument.unwrap() as NanoDeviceBox
        nano.attack.setValue(0)
        nano.release.setValue(0.001)
        PulseGridOps.apply(composite, [{op: "setPatternText", lane: index + 1,
            text: gridText(index % 2 === 0 ? LEFT : RIGHT)}])
    })
    const track = TrackBox.create(source, UUID.generate(), box => {
        box.type.setValue(TrackType.Notes)
        box.enabled.setValue(true)
        box.index.setValue(0)
        box.target.refer(unit)
        box.tracks.refer(unit.tracks)
    })
    source.endTransaction()
    return {source, composite, track}
}

const ready = async (source: ReturnType<typeof project>["source"]) => {
    const {engine, memory} = await loadFullEngine(SAMPLE_RATE)
    const start = performance.now()
    const sync = connectSyncToEngine(engine, memory, source)
    try {
        await sync.settle()
        engine.bind()
        await sync.settle()
        const settleMs = performance.now() - start
        engine.set_metronome_enabled(0)
        // The existing sample handshake, with a 35 ms tapered sine burst instead of a fetched file.
        let loaded = 0
        for (;;) {
            const request = engine.input_reserve(16)
            const handle = engine.sample_take_request(request)
            if (handle < 0) {break}
            const frames = Math.round(SAMPLE_RATE * 0.035)
            const pointer = engine.sample_allocate(handle, frames * Float32Array.BYTES_PER_ELEMENT)
            const pcm = new Float32Array(memory.buffer, pointer, frames)
            for (let frame = 0; frame < frames; frame++) {
                pcm[frame] = 0.5 * Math.sin(2 * Math.PI * 440 * frame / SAMPLE_RATE) * Math.sin(Math.PI * frame / frames)
            }
            engine.sample_set_ready(handle, frames, 1, SAMPLE_RATE)
            loaded++
        }
        expect(loaded).toBe(1) // Every lane shares the one library sample box.
        const half = (engine.output_len() >>> 0) >>> 1
        const render = (frames: int): [Float32Array, Float32Array] => {
            expect(frames % half).toBe(0) // Preserve exact bar boundaries between calls.
            const channels: [Float32Array, Float32Array] = [new Float32Array(frames), new Float32Array(frames)]
            for (let at = 0; at < frames; at += half) {
                engine.render()
                const pointer = engine.output_ptr()
                channels[0].set(new Float32Array(memory.buffer, pointer, half), at)
                channels[1].set(new Float32Array(memory.buffer, pointer + half * 4, half), at)
            }
            return channels
        }
        return {engine, sync, render, settleMs}
    } catch (error) {
        sync.close()
        throw error
    }
}

const rms = (channel: Float32Array, from: int, to: int): number => {
    let energy = 0
    for (let frame = from; frame < to; frame++) {energy += channel[frame] ** 2}
    return Math.sqrt(energy / (to - from))
}
const checkSteps = (channel: Float32Array, steps: ReadonlyArray<int>, message: string): void => {
    for (let step = 0; step < 16; step++) {
        const start = step * STEP_FRAMES
        const burst = rms(channel, start + 240, start + 1440)
        if (steps.includes(step)) {
            expect(burst, `${message}: audible step ${step + 1}`).toBeGreaterThan(0.02)
        } else {
            expect(rms(channel, start + 128, start + STEP_FRAMES - 128),
                `${message}: silent step ${step + 1}`).toBeLessThan(1e-6)
        }
        expect(rms(channel, start + 2400, start + STEP_FRAMES - 128),
            `${message}: burst ends in step ${step + 1}`).toBeLessThan(1e-6)
    }
}

describe("PulseGridFactory with real Nano samplers", () => {
    it("sounds exactly each lane's steps with no input notes and hears an ops edit from the next bar", async () => {
        const {source, composite, track} = project(2)
        expect(track.regions.pointerHub.isEmpty()).toBe(true)
        expect(source.boxes().filter(box => box.name === "NoteEventBox")).toHaveLength(0)
        expect(PulseGridDevice.find(composite).unwrap().lanes.every(lane => !lane.device.armed.getValue())).toBe(true)
        const {engine, sync, render} = await ready(source)
        try {
            engine.stop()
            engine.play()
            const first = render(BAR_FRAMES)
            checkSteps(first[0], LEFT, "left, first bar")
            checkSteps(first[1], RIGHT, "right, first bar")
            render(BAR_FRAMES / 2)
            // Change mid-bar via the same public ops as the editor/agent, without stopping or rebinding.
            source.beginTransaction()
            const result = PulseGridOps.apply(composite, [{op: "setPatternText", lane: 1, text: gridText(EDITED)}])
            source.endTransaction()
            expect(result[0].ok).toBe(true)
            await sync.settle()
            render(BAR_FRAMES / 2)
            const next = render(BAR_FRAMES)
            checkSteps(next[0], EDITED, "left, next bar after ops edit")
            checkSteps(next[1], RIGHT, "right remains independent")
        } finally {sync.close()}
    }, 60000)

    it("prints sync settlement and one-bar render costs for sixteen sampler lanes", async () => {
        const {source} = project(16)
        const {engine, sync, render, settleMs} = await ready(source)
        try {
            engine.stop()
            engine.play()
            const start = performance.now()
            render(BAR_FRAMES)
            console.log(`PulseGrid 16 lanes: sync settle ${settleMs.toFixed(3)} ms; render one bar ${(performance.now() - start).toFixed(3)} ms`)
        } finally {sync.close()}
    }, 60000)
})
