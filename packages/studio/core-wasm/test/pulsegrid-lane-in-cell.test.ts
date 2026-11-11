// Real engine + production plugin table + graph sync: no sequenced or live input notes.
import {describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {
    ApparatDeviceBox, AudioUnitBox, InstrumentCompositeBox, InstrumentCompositeCellBox,
    PulseGridBox, PulseGridLaneDeviceBox, TrackBox
} from "@opendaw/studio-boxes"
import {ProjectSkeleton, ScriptCompiler, TrackType} from "@opendaw/studio-adapters"
import {loadFullEngine} from "./helpers/load-full-engine"
import {connectSyncToEngine} from "./helpers/connect-sync"

const SAMPLE_RATE = 48000
const SAMPLES_PER_PULSE = SAMPLE_RATE / (120 / 60 * 960)
const STEP = 240
const BAR = 16 * STEP
const A = [0, 4, 8, 12]
const B = [2, 6, 10, 14]
const EDITED = [1, 5]
const VARIATION_A = [0, 2, 7, 11, 15]
const VARIATION_B = [0, 6, 10, 14]

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

describe("PulseGrid lanes first in instrument composite cell MIDI chains", () => {
    it("a-e: empty track, independent steps, nested bytes edit, shared-head variation, stopped silence", async () => {
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
            box.label.setValue("Shared grid")
            box.length.setValue(16)
        })
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
        const lanes = cells.map((cell, index) => PulseGridLaneDeviceBox.create(source, UUID.generate(), box => {
            box.host.refer(cell.midiEffects)
            box.grid.refer(grid)
            box.index.setValue(0)
            box.seed.setValue(index + 1)
            box.armed.setValue(false)
            box.patterns.getField(0).notes.setValue(notes(index === 0 ? A : B))
            box.patterns.getField(1).notes.setValue(notes(index === 0 ? VARIATION_A : VARIATION_B))
        }))
        const track = TrackBox.create(source, UUID.generate(), box => {
            box.type.setValue(TrackType.Notes)
            box.enabled.setValue(true)
            box.index.setValue(0)
            box.target.refer(unit)
            box.tracks.refer(unit.tracks)
        })
        source.endTransaction()

        // a. These assertions rule out any upstream source of the rendered notes.
        expect(track.regions.pointerHub.isEmpty(), "a: the notes track has no region").toBe(true)
        expect(source.boxes().filter(box => box.name === "NoteEventBox"), "a: no note exists anywhere").toHaveLength(0)
        expect(cells.every(cell => cell.midiEffects.pointerHub.incoming().length === 1), "a: one MIDI effect per cell").toBe(true)
        expect(lanes.every(lane => lane.index.getValue() === 0 && !lane.armed.getValue()), "a: lanes first and unarmed").toBe(true)

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
            const checkSteps = (channel: Float32Array, steps: ReadonlyArray<number>, message: string,
                                first: number = 0, count: number = 16): void => {
                for (let step = first; step < first + count; step++) {
                    // Multiple interior samples catch both missing starts and notes that fail to end.
                    for (const fraction of [0.25, 0.5, 0.75]) {
                        const sample = Math.round((step - first + fraction) * STEP * SAMPLES_PER_PULSE)
                        expect(channel[sample], `${message}: step ${step}, fraction ${fraction}`)
                            .toBeCloseTo(steps.includes(step) ? 0.3 : 0, 5)
                    }
                }
            }
            const silence = (channels: [Float32Array, Float32Array], message: string): void => {
                channels.forEach((channel, index) => {
                    const peak = channel.reduce((max, value) => Math.max(max, Math.abs(value)), 0)
                    expect(peak, `${message}: channel ${index}`).toBeLessThan(1e-6)
                })
            }

            // b. One uninterrupted bar from position zero: different steps on each output channel.
            engine.stop(); engine.play()
            const firstBar = render(BAR)
            checkSteps(firstBar[0], A, "b: left generates lane A with no input notes")
            checkSteps(firstBar[1], B, "b: right generates lane B with no input notes")

            // c. Edit [30, 0, 2] while still playing, without rebinding or restarting the engine.
            source.beginTransaction()
            lanes[0].patterns.getField(0).notes.setValue(notes(EDITED))
            source.endTransaction()
            await sync.settle()
            const editedBar = render(BAR)
            checkSteps(editedBar[0], EDITED, "c: nested bytes edit reaches running lane A")
            checkSteps(editedBar[1], B, "c: lane B remains independent")

            // d. Switch THROUGH the shared pointer mid-bar; the old pattern finishes before slot 1.
            const beforeSwitch = render(BAR / 2)
            checkSteps(beforeSwitch[0], EDITED, "d: old variation before edit", 0, 8)
            source.beginTransaction()
            grid.variation.setValue(1)
            source.endTransaction()
            await sync.settle()
            const pending = render(BAR / 2)
            checkSteps(pending[0], EDITED, "d: variation waits for next bar boundary", 8, 8)
            checkSteps(pending[1], B, "d: shared-head switch waits in lane B too", 8, 8)
            const variedBar = render(BAR)
            checkSteps(variedBar[0], VARIATION_A, "d: head variation selects lane A slot 1")
            checkSteps(variedBar[1], VARIATION_B, "d: head variation selects lane B slot 1")

            // e. Freeze with BOTH voices held. pause preserves plugin state, so silence needs releases;
            // also check stop (rewind/reset) and a further full stopped bar for stuck/retriggered voices.
            const held = render(STEP / 2)
            expect(held[0].at(-1), "e: left voice held before stopping").toBeGreaterThan(0.1)
            expect(held[1].at(-1), "e: right voice held before stopping").toBeGreaterThan(0.1)
            engine.pause()
            silence(render(BAR), "e: frozen transport releases both voices and stays silent")
            engine.stop()
            silence(render(BAR), "e: stopped transport stays silent")
        } finally {
            sync.close()
        }
    }, 60000)
})
