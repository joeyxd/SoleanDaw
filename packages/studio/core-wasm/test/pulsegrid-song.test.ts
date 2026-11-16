// Song mode on the real engine: a Notes track on the unit holds scene notes (pitch below 64 = the pattern slot).
// Both lanes of one PulseGrid play the slot a scene note names while it sounds, rest where none does, and the
// scene notes never reach an instrument.
import {describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {
    ApparatDeviceBox, AudioUnitBox, InstrumentCompositeBox, InstrumentCompositeCellBox,
    NoteEventBox, NoteEventCollectionBox, NoteRegionBox, PulseGridBox, PulseGridLaneDeviceBox, TrackBox
} from "@opendaw/studio-boxes"
import {ProjectSkeleton, ScriptCompiler, TrackType} from "@opendaw/studio-adapters"
import {loadFullEngine} from "./helpers/load-full-engine"
import {connectSyncToEngine} from "./helpers/connect-sync"

const SAMPLE_RATE = 48000
const SAMPLES_PER_PULSE = SAMPLE_RATE / (120 / 60 * 960)
const STEP = 240
const BAR = 16 * STEP
const SCENE_2_A = 4 // scene 2 (index 1), variation A: slot = scene * 4 + variation
const SCENE_1_A = 0
const SCENE_2_LEFT = [0, 2, 7, 11, 15]
const SCENE_2_RIGHT = [0, 6, 10, 14]
const SCENE_1_LEFT = [1, 3, 5, 9, 13]
const SCENE_1_RIGHT = [1, 4, 8, 12]

// step, signed offset, length in quarter-steps, pitch, velocity, chance, flags, repeats.
const record = (step: number): number[] => [step, 0, 4, 60, 100, 100, 0, 0]
const notes = (steps: ReadonlyArray<number>): Int8Array => new Int8Array(steps.flatMap(record))

const code = (left: number, right: number) => `class Processor {
    voices = []
    noteOn(pitch, velocity, cent, id) { this.voices.push(id) }
    noteOff(id) { this.voices = this.voices.filter(voice => voice !== id) }
    process(output, block) {
        const [l, r] = output
        if (this.voices.length > 0) {
            for (let i = block.s0; i < block.s1; i++) { l[i] += ${left}; r[i] += ${right} }
        }
    }
}`

describe("PulseGrid Song mode", () => {
    it("scene notes choose the slot of both lanes, a bar without one rests, and no scene note sounds", async () => {
        const {boxGraph: source, mandatoryBoxes: {rootBox, primaryAudioBusBox}} =
            ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
        source.beginTransaction()
        const unit = AudioUnitBox.create(source, UUID.generate(), box => {
            box.collection.refer(rootBox.audioUnits)
            box.output.refer(primaryAudioBusBox.input)
            box.index.setValue(1)
        })
        const composite = InstrumentCompositeBox.create(source, UUID.generate(), box => box.host.refer(unit.input))
        const grid = PulseGridBox.create(source, UUID.generate(), box => {
            box.label.setValue("Song grid")
            box.length.setValue(16)
            box.song.setValue(true)
        })
        const patterns = [
            {scene1: SCENE_1_LEFT, scene2: SCENE_2_LEFT},
            {scene1: SCENE_1_RIGHT, scene2: SCENE_2_RIGHT}
        ]
        const cells = [code(0.3, 0), code(0, 0.3)].map((script, index) => {
            const cell = InstrumentCompositeCellBox.create(source, UUID.generate(), box => {
                box.composite.refer(composite.cells)
                box.index.setValue(index)
            })
            const apparat = ApparatDeviceBox.create(source, UUID.generate(), box => {
                box.host.refer(cell.instrument)
                box.code.setValue("// @apparat js 1 1\n" + script)
            })
            new Function(ScriptCompiler.wrap(
                {headerTag: "apparat", registryName: "apparatProcessors", functionName: "apparat"},
                UUID.toString(apparat.address.uuid), 1, script))()
            return cell
        })
        cells.forEach((cell, index) => PulseGridLaneDeviceBox.create(source, UUID.generate(), box => {
            box.host.refer(cell.midiEffects)
            box.grid.refer(grid)
            box.index.setValue(0)
            box.seed.setValue(index + 1)
            box.armed.setValue(false)
            box.patterns.getField(SCENE_1_A).notes.setValue(notes(patterns[index].scene1))
            box.patterns.getField(SCENE_2_A).notes.setValue(notes(patterns[index].scene2))
        }))
        const track = TrackBox.create(source, UUID.generate(), box => {
            box.type.setValue(TrackType.Notes)
            box.enabled.setValue(true)
            box.index.setValue(0)
            box.target.refer(unit)
            box.tracks.refer(unit.tracks)
        })
        const events = NoteEventCollectionBox.create(source, UUID.generate())
        for (let step = 0; step < 16; step++) {
            NoteEventBox.create(source, UUID.generate(), box => {
                box.events.refer(events.events)
                box.position.setValue(step * STEP)
                box.duration.setValue(STEP)
                box.pitch.setValue(SCENE_2_A)
                box.velocity.setValue(0.8)
                box.cent.setValue(0)
            })
        }
        NoteRegionBox.create(source, UUID.generate(), box => {
            box.regions.refer(track.regions)
            box.events.refer(events.owners)
            box.position.setValue(0)
            box.duration.setValue(BAR)
            box.loopDuration.setValue(BAR)
        })
        source.endTransaction()

        const {engine, memory} = await loadFullEngine(SAMPLE_RATE)
        const sync = connectSyncToEngine(engine, memory, source)
        try {
            await sync.settle(); engine.bind(); await sync.settle()
            engine.set_metronome_enabled(0)
            const half = (engine.output_len() >>> 0) >>> 1
            const render = (pulses: number): [Float32Array, Float32Array] => {
                const quanta = Math.ceil(pulses * SAMPLES_PER_PULSE / half)
                const channels: [Float32Array, Float32Array] = [new Float32Array(quanta * half), new Float32Array(quanta * half)]
                for (let quantum = 0; quantum < quanta; quantum++) {
                    engine.render()
                    const pointer = engine.output_ptr()
                    channels[0].set(new Float32Array(memory.buffer, pointer, half), quantum * half)
                    channels[1].set(new Float32Array(memory.buffer, pointer + half * 4, half), quantum * half)
                }
                return channels
            }
            // Three interior samples per step catch a missing start, a note that never ends and a stray note.
            const checkSteps = (channel: Float32Array, steps: ReadonlyArray<number>, message: string): void => {
                for (let step = 0; step < 16; step++) {
                    for (const fraction of [0.25, 0.5, 0.75]) {
                        const sample = Math.round((step + fraction) * STEP * SAMPLES_PER_PULSE)
                        expect(channel[sample], `${message}: step ${step}, fraction ${fraction}`)
                            .toBeCloseTo(steps.includes(step) ? 0.3 : 0, 5)
                    }
                }
            }
            engine.stop(); engine.play()
            const firstBar = render(BAR)
            checkSteps(firstBar[0], SCENE_2_LEFT, "bar 1: left lane plays scene 2")
            checkSteps(firstBar[1], SCENE_2_RIGHT, "bar 1: right lane plays scene 2")
            const secondBar = render(BAR)
            checkSteps(secondBar[0], [], "bar 2: left lane rests without a scene note")
            checkSteps(secondBar[1], [], "bar 2: right lane rests without a scene note")
            secondBar.forEach((channel, index) => {
                const peak = channel.reduce((max, value) => Math.max(max, Math.abs(value)), 0)
                expect(peak, `bar 2: channel ${index} is silent`).toBeLessThan(1e-6)
            })
        } finally {
            sync.close()
        }
    }, 60000)
})
