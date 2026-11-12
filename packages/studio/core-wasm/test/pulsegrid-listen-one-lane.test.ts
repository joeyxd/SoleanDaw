import {describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {
    ApparatDeviceBox, ArpeggioDeviceBox, AudioUnitBox, InstrumentCompositeBox, InstrumentCompositeCellBox,
    PulseGridBox, PulseGridLaneDeviceBox
} from "@opendaw/studio-boxes"
import {ProjectSkeleton, ScriptCompiler} from "@opendaw/studio-adapters"
import {loadFullEngine} from "./helpers/load-full-engine"
import {connectSyncToEngine} from "./helpers/connect-sync"

describe("PulseGrid Listen addresses one cell after MIDI", () => {
    it("auditions stopped without edits, gates mute and solo, and releases held and removed voices", async () => {
        const {boxGraph: source, mandatoryBoxes: {rootBox, primaryAudioBusBox}} =
            ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
        source.beginTransaction()
        const unit = AudioUnitBox.create(source, UUID.generate(), box => {
            box.collection.refer(rootBox.audioUnits)
            box.output.refer(primaryAudioBusBox.input)
            box.index.setValue(1)
        })
        const composite = InstrumentCompositeBox.create(source, UUID.generate(), box => box.host.refer(unit.input))
        const grid = PulseGridBox.create(source, UUID.generate())
        const instruments: ApparatDeviceBox[] = []
        const cells = [0, 1].map(index => {
            const cell = InstrumentCompositeCellBox.create(source, UUID.generate(), box => {
                box.composite.refer(composite.cells)
                box.index.setValue(index)
            })
            const script = `class Processor {
                voices = []
                noteOn(pitch, velocity, cent, id) { this.voices.push(id) }
                noteOff(id) { this.voices = this.voices.filter(voice => voice !== id) }
                process(output, block) {
                    for (let i = block.s0; i < block.s1; i++) {
                        output[${index}][i] = this.voices.length > 0 ? 0.3 : 0
                    }
                }
            }`
            const instrument = ApparatDeviceBox.create(source, UUID.generate(), box => {
                box.host.refer(cell.instrument)
                box.code.setValue("// @apparat js 1 1\n" + script)
            })
            new Function(ScriptCompiler.wrap(
                {headerTag: "apparat", registryName: "apparatProcessors", functionName: "apparat"},
                UUID.toString(instrument.address.uuid), 1, script))()
            instruments.push(instrument)
            return cell
        })
        const lanes = cells.map(cell => PulseGridLaneDeviceBox.create(source, UUID.generate(), box => {
            box.host.refer(cell.midiEffects)
            box.grid.refer(grid)
            box.index.setValue(0)
            box.armed.setValue(false)
        }))
        ArpeggioDeviceBox.create(source, UUID.generate(), box => box.host.refer(unit.midiEffects))
        source.endTransaction()
        const snapshot = () => source.boxes().map(box => ({
            uuid: UUID.toString(box.address.uuid), bytes: Array.from(new Uint8Array(box.serialize()))
        }))
        const before = snapshot()
        const {engine, memory} = await loadFullEngine(48000)
        const sync = connectSyncToEngine(engine, memory, source)
        try {
            await sync.settle(); engine.bind(); await sync.settle()
            engine.set_metronome_enabled(0)
            engine.stop()
            const half = (engine.output_len() >>> 0) >>> 1
            const render = (frames: number): [Float32Array, Float32Array] => {
                const length = Math.ceil(frames / half) * half
                const channels: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)]
                for (let at = 0; at < length; at += half) {
                    engine.render()
                    const pointer = engine.output_ptr()
                    channels.forEach((channel, index) => channel.set(
                        new Float32Array(memory.buffer, pointer + index * half * 4, half), at))
                }
                return channels
            }
            const address = (uuid: UUID.Bytes) =>
                new Uint8Array(memory.buffer, engine.input_reserve(16), 16).set(uuid)
            const audition = (index: number, duration = 240) => {
                address(cells[index].address.uuid)
                engine.note_signal_audition(60, duration, 0.8)
            }
            const held = (index: number) => {
                address(cells[index].address.uuid)
                engine.note_signal_on(62, 0.8)
            }
            const silent = (channels: [Float32Array, Float32Array]) =>
                channels.forEach(channel => expect(channel.every(value => Math.abs(value) < 1e-6)).toBe(true))
            render(128)
            audition(0)
            const heard = render(12000)
            expect(heard[0][3000]).toBeCloseTo(0.3, 5)
            expect(heard[0][9000]).toBeCloseTo(0, 5)
            expect(heard[1].every(value => value === 0)).toBe(true)
            expect(snapshot()).toEqual(before)
            expect(lanes.every(lane => !lane.armed.getValue())).toBe(true)
            engine.play()
            audition(0)
            const playing = render(12000)
            expect(playing[0][3000]).toBeCloseTo(0.3, 5)
            expect(playing[0][9000]).toBeCloseTo(0, 5)
            engine.stop()

            // The original unit address still enters MIDI and is dropped by both unarmed lanes.
            address(unit.address.uuid)
            engine.note_signal_audition(60, 240, 0.8)
            silent(render(12000))
            source.beginTransaction(); cells[0].mute.setValue(true); source.endTransaction()
            await sync.settle()
            audition(0)
            silent(render(12000))
            source.beginTransaction(); cells[0].mute.setValue(false); cells[1].solo.setValue(true); source.endTransaction()
            await sync.settle()
            audition(0)
            silent(render(12000))
            audition(1)
            expect(render(128)[1][64]).toBeCloseTo(0.3, 5)
            render(12000)
            source.beginTransaction(); cells[1].solo.setValue(false); source.endTransaction()
            await sync.settle()
            held(0)
            expect(render(1024)[0][512]).toBeCloseTo(0.3, 5)
            address(cells[0].address.uuid); engine.note_signal_off(62)
            silent(render(128))
            held(0); render(128)
            engine.stop()
            silent(render(12000))
            held(0); render(128)
            const previousCode = instruments[0].code.getValue()
            source.beginTransaction(); instruments[0].delete(); source.endTransaction()
            await sync.settle()
            silent(render(12000))
            audition(0)
            silent(render(12000))
            source.beginTransaction()
            const replacement = ApparatDeviceBox.create(source, UUID.generate(), box => {
                box.host.refer(cells[0].instrument)
                box.code.setValue(previousCode)
            })
            new Function(ScriptCompiler.wrap(
                {headerTag: "apparat", registryName: "apparatProcessors", functionName: "apparat"},
                UUID.toString(replacement.address.uuid), 1, previousCode.replace("// @apparat js 1 1\n", "")))()
            source.endTransaction()
            await sync.settle()
            silent(render(12000))
            audition(0)
            expect(render(128)[0][64]).toBeCloseTo(0.3, 5)
            render(12000)
            held(1); render(128)
            source.beginTransaction(); cells[1].delete(); source.endTransaction()
            await sync.settle()
            silent(render(12000))
        } finally {
            sync.close()
        }
    }, 60000)
})
