import {describe, expect, it} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {AudioFileBox, AudioUnitBox, DelayDeviceBox, NanoDeviceBox, PulseGridBox, TubularDeviceBox} from "@opendaw/studio-boxes"
import {IconSymbol} from "@opendaw/studio-enums"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {TubularPreset} from "../devices/instruments/Tubular/TubularPreset"
import {PulseGridDevice} from "./PulseGridDevice"
import {PulseGridDocs} from "./PulseGridDocs"
import {PulseGridFactory, PulseGridLaneSpec} from "./PulseGridFactory"
import {PulseGridNotes} from "./PulseGridNotes"
import {PulseGridOps} from "./PulseGridOps"
import {PulseGridError, PulseGridNote, PulseGridOp, PulseGridSoundInput} from "./PulseGridTypes"

const kit = PulseGridFactory.DefaultKit
const fixture = (specs: ReadonlyArray<PulseGridLaneSpec> = kit, instrument = false) => {
    const {boxGraph: graph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} =
        ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    graph.beginTransaction()
    const unit = AudioUnitBox.create(graph, UUID.generate(), box => {
        box.collection.refer(rootBox.audioUnits)
        box.output.refer(primaryAudioBusBox.input)
        box.index.setValue(1)
    })
    const composite = instrument
        ? PulseGridFactory.Instrument.create(graph, unit.input, "PulseGrid", IconSymbol.Stack)
        : PulseGridFactory.create(graph, unit.input, "Test grid", specs)
    graph.endTransaction()
    const device = () => PulseGridDevice.find(composite).unwrap()
    const read = () => PulseGridDocs.read(device())
    const change = <T>(write: () => T): T => {
        graph.beginTransaction()
        try {return write()} finally {graph.endTransaction()}
    }
    const order = (...names: Array<string>) => {
        expect(read().lanes.map(lane => lane.name)).toEqual(names)
        expect(device().lanes.map(lane => lane.cell.index.getValue())).toEqual(names.map((_, index) => index))
    }
    return {graph, unit, composite, device, read, change, order}
}

describe("PulseGridFactory", () => {
    it.each([
        {op: "removeLane", lane: 2},
        {op: "moveLane", lane: 1, to: 7},
        {op: "setLaneSound", lane: 1, sound: {instrument: "Tubular"}},
        {op: "addLane", name: "Tom", kind: "drum", sound: {instrument: "Tubular"}, at: 1}
    ] as ReadonlyArray<PulseGridOp>)("undoes and redoes $op as one step", op => {
        const f = fixture()
        const editing = new BoxEditing(f.graph)
        const before = f.read()
        const boxes = f.graph.boxes().length
        expect(PulseGridOps.run(editing, f.composite, [op])[0].ok).toBe(true)
        expect(editing.undo()).toBe(true)
        expect(f.read()).toEqual(before)
        expect(f.graph.boxes().length).toBe(boxes)
        expect(editing.redo()).toBe(true)
        expect(editing.undo()).toBe(true)
        expect(f.read()).toEqual(before)
    })

    it("creates the default kit, one shared head, first-in-chain lanes and exact embedded voices", () => {
        const f = fixture()
        const device = f.device()
        const doc = f.read()
        expect(doc.name).toBe("Test grid")
        expect(doc.lanes).toHaveLength(7)
        expect(f.graph.boxes().filter(box => box instanceof PulseGridBox)).toEqual([device.head])
        expect(new Set(doc.lanes.map(lane => lane.seed)).size).toBe(7)
        expect(doc.lanes.every(lane => lane.seed !== 0)).toBe(true)
        for (const [index, spec] of kit.entries()) {
            const lane = device.lanes[index]
            expect(doc.lanes[index]).toMatchObject({name: spec.name, kind: spec.kind, hue: spec.hue,
                group: spec.kind === "drum" ? 0 : 1, pitch: 60, sound: {instrument: spec.sound.instrument}})
            expect(lane.cell.index.getValue()).toBe(index)
            expect(lane.cell.midiEffects.pointerHub.incoming().map(({box}) => box)).toEqual([lane.device])
            expect(lane.device.index.getValue()).toBe(0)
            expect(lane.device.grid.targetVertex.unwrap().box).toBe(device.head)
            if (spec.sound.instrument === "Nano") {
                expect(doc.lanes[index].sound).toEqual({instrument: "Nano", label: spec.sound.sample.name,
                    sample: {uuid: spec.sound.sample.uuid, name: spec.sound.sample.name}})
                const nano = lane.instrument.unwrap() as NanoDeviceBox
                expect(nano.rootKey.getValue()).toBe(60)
                expect((nano.file.targetVertex.unwrap().box as AudioFileBox).endInSeconds.getValue())
                    .toBe(spec.sound.sample.duration)
            } else {
                expect(TubularPreset.read(lane.instrument.unwrap() as TubularDeviceBox))
                    .toEqual(new Uint8Array(spec.sound.voice!.patch))
            }
        }
    })

    it("provides an InstrumentFactory with the default attachment and reuses sample identity", () => {
        const defaults = fixture(kit, true)
        defaults.order("Kick", "Snare", "Clap", "Hat", "Perc", "Synth", "Marimba")
        expect(PulseGridFactory.Instrument.defaultName).toBe("PulseGrid")
        const f = fixture([kit[0], {...kit[0], name: "Second kick"}])
        expect(f.graph.boxes().filter(box => box instanceof AudioFileBox)).toHaveLength(1)
        const files = f.device().lanes.map(lane => (lane.instrument.unwrap() as NanoDeviceBox).file.targetVertex.unwrap().box)
        expect(files[0]).toBe(files[1])
        f.change(() => PulseGridFactory.removeLane(f.device(), f.device().lanes[0]))
        expect(files[0].isAttached()).toBe(true)
        expect(f.read().lanes[0].sound?.sample?.uuid).toBe(UUID.toString(files[0].address.uuid))
    })

    it("adds, moves and removes with contiguous indices and deletes the cell's dependencies", () => {
        const f = fixture([kit[0], kit[1]])
        const stale = f.device()
        f.change(() => PulseGridFactory.addLane(stale, kit[2]))
        f.order("Kick", "Snare", "Clap")
        f.change(() => PulseGridFactory.addLane(stale, kit[3], 1))
        f.order("Hat", "Kick", "Snare", "Clap")
        f.change(() => PulseGridFactory.moveLane(stale, f.device().lanes[0], 4))
        f.order("Kick", "Snare", "Clap", "Hat")
        f.change(() => PulseGridFactory.moveLane(stale, f.device().lanes[3], 1))
        f.order("Hat", "Kick", "Snare", "Clap")
        const doomed = f.device().lanes[1]
        const sample = (doomed.instrument.unwrap() as NanoDeviceBox).file.targetVertex.unwrap().box
        const effect = f.change(() => DelayDeviceBox.create(f.graph, UUID.generate(), box => box.host.refer(doomed.cell.audioEffects)))
        f.change(() => PulseGridFactory.removeLane(stale, doomed))
        f.order("Hat", "Snare", "Clap")
        for (const box of [doomed.cell, doomed.device, doomed.instrument.unwrap(), effect]) {
            expect(f.graph.findBox(box.address.uuid).isEmpty()).toBe(true)
            expect(box.isAttached()).toBe(false)
        }
        // Box.delete also collects the sampler's AudioFileBox when it loses its last reference.
        expect(f.graph.findBox(sample.address.uuid).isEmpty()).toBe(true)
        expect(f.graph.boxes().some(box => box.outgoingEdges().some(([, address]) =>
            UUID.toString(address.uuid) === UUID.toString(doomed.cell.address.uuid)))).toBe(false)
    })

    it("rejects removing the last lane and out-of-range positions without writing", () => {
        const f = fixture([kit[0]])
        const before = f.read()
        const boxes = f.graph.boxes()
        for (const write of [
            () => PulseGridFactory.removeLane(f.device(), f.device().lanes[0]),
            () => PulseGridFactory.addLane(f.device(), kit[1], 0),
            () => PulseGridFactory.addLane(f.device(), kit[1], 3),
            () => PulseGridFactory.moveLane(f.device(), f.device().lanes[0], 2),
            () => PulseGridFactory.moveLane(f.device(), f.device().lanes[0], 1.5),
            () => PulseGridFactory.create(f.graph, f.unit.input, "Empty"),
            () => PulseGridFactory.create(f.graph, f.unit.input, "Empty", []),
            () => PulseGridFactory.create(f.graph, f.unit.input, "Bad", [kit[0], {...kit[0], hue: 360}])
        ]) {
            expect(() => f.change(write)).toThrow(PulseGridError)
            expect(f.read()).toEqual(before)
            expect(f.graph.boxes()).toEqual(boxes)
        }
    })

    it("replaces just the instrument, preserving all lane data, effects and mix both ways", () => {
        const f = fixture([kit[0]])
        const lane = f.device().lanes[0]
        const original = lane.instrument.unwrap()
        const effect = f.change(() => {
            lane.cell.gain.setValue(-6)
            lane.cell.pan.setValue(0.5)
            lane.cell.mute.setValue(true)
            lane.cell.solo.setValue(true)
            lane.device.patterns.getField(5).length.setValue(32)
            lane.device.patterns.getField(5).notes.setValue(PulseGridNotes.encode([{step: 5, pitch: 60, ...PulseGridNote.Defaults}]))
            return DelayDeviceBox.create(f.graph, UUID.generate(), box => box.host.refer(lane.cell.audioEffects))
        })
        const {sound: _, ...before} = f.read().lanes[0]
        for (const sound of [kit[6].sound, kit[0].sound]) {
            f.change(() => PulseGridFactory.setLaneSound(f.device(), lane, sound))
            const {sound: afterSound, ...after} = f.read().lanes[0]
            expect(after).toEqual(before)
            expect(afterSound?.instrument).toBe(sound.instrument)
            expect(lane.device.isAttached()).toBe(true)
            expect(effect.isAttached()).toBe(true)
            expect(lane.cell.instrument.pointerHub.incoming()).toHaveLength(1)
        }
        expect(original.isAttached()).toBe(false)
    })

    it.each([
        {instrument: "Nano", sample: {uuid: "bad", name: "Bad", duration: 1}},
        {instrument: "Nano", sample: {uuid: "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz", name: "Bad", duration: 1}},
        ...[0, -1, NaN, Infinity].map(duration => ({instrument: "Nano", sample: {
            uuid: "b50f6f4f-d933-400c-a63a-83b3c2f6c8b2", name: "Bad", duration}})),
        ...[[], new Array(155), Array(155).fill(128), Array(155).fill(0.5)].map(patch =>
            ({instrument: "Tubular", voice: {name: "Bad", patch}})),
        null, {}, {instrument: "Nano"}, {instrument: "Tubular", voice: null}
    ])("rejects invalid sound %j before any graph mutation", sound => {
        const f = fixture([kit[0]])
        const before = f.read()
        const boxes = f.graph.boxes()
        expect(() => f.change(() => PulseGridFactory.setLaneSound(f.device(), f.device().lanes[0],
            sound as PulseGridSoundInput))).toThrow(PulseGridError)
        expect(f.read()).toEqual(before)
        expect(f.graph.boxes()).toEqual(boxes)
    })
})
