import {describe, expect, it} from "vitest"
import {Option, UUID} from "@opendaw/lib-std"
import {
    AudioUnitBox, CaptureMidiBox, InstrumentCompositeBox, InstrumentCompositeCellBox, NanoDeviceBox, PulseGridBox,
    PulseGridLaneDeviceBox
} from "@opendaw/studio-boxes"
import {AudioUnitType, IconSymbol} from "@opendaw/studio-enums"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {AudioUnitFactory} from "../factories/AudioUnitFactory"
import {InstrumentFactories} from "../factories/InstrumentFactories"
import {TransferAudioUnits} from "../transfer"
import {PulseGridDevice} from "../pulsegrid/PulseGridDevice"
import {PulseGridDocs} from "../pulsegrid/PulseGridDocs"
import {PulseGridOps} from "../pulsegrid/PulseGridOps"
import {PulseGridNote, PulseGridOp} from "../pulsegrid/PulseGridTypes"
import {PresetEncoder} from "./PresetEncoder"
import {PresetDecoder} from "./PresetDecoder"

// A PulseGrid is an Instrument Composite whose lanes all point at ONE head box that no cell hosts. A preset, a
// replaced unit and a duplicated unit must carry that head along, give every copy a head of its own, and leave
// no head behind when a PulseGrid is replaced.
const note = (step: number, pitch = 60): PulseGridNote => ({step, pitch, ...PulseGridNote.Defaults})
const BEAT: ReadonlyArray<PulseGridOp> = [
    {op: "setSetting", key: "swing", value: 62},
    {op: "setSetting", key: "name", value: "My grid"},
    {op: "setPattern", lane: "Kick", notes: [1, 5, 9, 13].map(step => note(step))},
    {op: "setPattern", lane: "Hat", variation: "B", notes: [3, 7, 11, 15].map(step => note(step))},
    {op: "setPattern", lane: "Synth", notes: [note(1, 62), note(5, 67)]},
    {op: "newScene", name: "Drop"},
    {op: "setPattern", lane: "Kick", scene: 2, notes: [1, 9].map(step => note(step))},
    {op: "setLaneMix", lane: "Snare", gain: -6, pan: 25},
    {op: "setSong", entries: [{scene: 1, cycles: 2}, {scene: 2}]}
]

describe("PresetEncoder / PresetDecoder (PulseGrid)", () => {
    const empty = () => ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    const createUnit = (skeleton: ProjectSkeleton): AudioUnitBox =>
        AudioUnitFactory.create(skeleton, AudioUnitType.Instrument,
            Option.wrap(CaptureMidiBox.create(skeleton.boxGraph, UUID.generate())))
    const addGrid = (skeleton: ProjectSkeleton, ops: ReadonlyArray<PulseGridOp>): AudioUnitBox => {
        const unit = createUnit(skeleton)
        const composite = InstrumentFactories.PulseGrid.create(skeleton.boxGraph, unit.input, "PulseGrid", IconSymbol.DrumSet)
        expect(PulseGridOps.apply(composite, ops).filter(result => !result.ok)).toEqual([])
        return unit
    }
    const source = (ops: ReadonlyArray<PulseGridOp> = BEAT) => {
        const skeleton = empty()
        skeleton.boxGraph.beginTransaction()
        const unit = addGrid(skeleton, ops)
        skeleton.boxGraph.endTransaction()
        return {skeleton, unit}
    }
    const gridOf = (unit: AudioUnitBox): PulseGridDevice => {
        const inputs = unit.input.pointerHub.incoming().map(({box}) => box)
        expect(inputs.map(box => box.name)).toEqual(["InstrumentCompositeBox"])
        return PulseGridDevice.find(inputs[0] as InstrumentCompositeBox).unwrap("no PulseGrid on the unit")
    }
    // what a PulseGrid holds, without the ids that every copy must change
    const content = (unit: AudioUnitBox) => {
        const {id: _head, lanes, ...rest} = PulseGridDocs.read(gridOf(unit))
        return {...rest, lanes: lanes.map(({id: _lane, ...lane}) => lane)}
    }
    const heads = (skeleton: ProjectSkeleton) => skeleton.boxGraph.boxes().filter(box => box instanceof PulseGridBox)
    const count = (skeleton: ProjectSkeleton, type: Function) =>
        skeleton.boxGraph.boxes().filter(box => box instanceof type).length
    // every lane device of the graph plays one of these grids, and each grid has all its lanes
    const expectWhole = (skeleton: ProjectSkeleton, ...units: ReadonlyArray<AudioUnitBox>) => {
        const grids = units.map(gridOf)
        expect(new Set(grids.map(grid => grid.head)).size, "one head per PulseGrid").toBe(units.length)
        expect(heads(skeleton).toSorted()).toEqual(grids.map(grid => grid.head).toSorted())
        grids.forEach(grid => expect(grid.lanes.length).toBe(7))
        expect(count(skeleton, PulseGridLaneDeviceBox)).toBe(7 * units.length)
        expect(count(skeleton, InstrumentCompositeCellBox)).toBe(7 * units.length)
        grids.forEach(grid => grid.lanes.forEach(lane =>
            expect(lane.cell.midiEffects.pointerHub.incoming().map(({box}) => box), "the lane leads its cell")
                .toEqual([lane.device])))
    }

    it("saves and loads the patterns, scenes, settings, mix and sounds; the song only with the timeline", () => {
        const {unit} = source()
        const saved = content(unit)
        expect(saved.song.entries).toEqual([{scene: 1, variation: "A", cycles: 2}, {scene: 2, variation: "A", cycles: 1}])
        expect(saved.sceneCount).toBe(2)
        // with the timeline: everything
        const whole = empty()
        whole.boxGraph.beginTransaction()
        const [loaded] = PresetDecoder.decode(PresetEncoder.encode(unit, {includeTimeline: true}), whole)
        whole.boxGraph.endTransaction()
        expect(content(loaded)).toEqual(saved)
        expectWhole(whole, loaded)
        // without it: the scene regions stay behind, the rest is the same. The switch is the head's, so it comes
        // along: a PulseGrid saved in Song loads in Song with an empty song, and rests until it is switched back.
        // The window says so for as long as it lasts and offers the switch (PulseGridWindow, the empty-song line).
        expect(saved.song.on).toBe(true)
        const plain = empty()
        plain.boxGraph.beginTransaction()
        const [bare] = PresetDecoder.decode(PresetEncoder.encode(unit), plain)
        plain.boxGraph.endTransaction()
        expect(content(bare)).toEqual({...saved, song: {...saved.song, entries: []}})
        expectWhole(plain, bare)
    })

    it("loads the same preset twice as two PulseGrids, each with its own head", () => {
        const {unit} = source()
        const bytes = PresetEncoder.encode(unit)
        const target = empty()
        target.boxGraph.beginTransaction()
        const [first] = PresetDecoder.decode(bytes, target)
        const [second] = PresetDecoder.decode(bytes, target)
        target.boxGraph.endTransaction()
        expectWhole(target, first, second)
        // a change to one is not heard in the other
        target.boxGraph.beginTransaction()
        expect(PulseGridOps.apply(gridOf(first).composite, [{op: "setPattern", lane: "Kick", notes: [note(2)]}])[0].ok).toBe(true)
        target.boxGraph.endTransaction()
        const kick = (unit: AudioUnitBox) => content(unit).lanes[0].patterns[0].notes.map(n => n.step)
        expect([kick(first), kick(second)]).toEqual([[2], [1, 5, 9, 13]])
        // both kicks share the one sample file
        const files = [first, second].map(unit =>
            (gridOf(unit).lanes[0].instrument.unwrap() as NanoDeviceBox).file.targetVertex.unwrap().box)
        expect(files[0]).toBe(files[1])
    })

    it("replaces a plain unit's instrument with the PulseGrid", () => {
        const {unit} = source()
        const saved = content(unit)
        const target = empty()
        target.boxGraph.beginTransaction()
        const plain = createUnit(target)
        InstrumentFactories.Nano.create(target.boxGraph, plain.input, "Old", IconSymbol.Piano)
        const attempt = PresetDecoder.replaceAudioUnit(PresetEncoder.encode(unit) as ArrayBuffer, plain)
        target.boxGraph.endTransaction()
        expect(attempt.isSuccess(), attempt.isFailure() ? String(attempt.failureReason()) : "").toBe(true)
        expect(content(plain)).toEqual({...saved, song: {...saved.song, entries: []}})
        expectWhole(target, plain)
    })

    it("replaces one PulseGrid with another and leaves no head, lane or pattern of the old one", () => {
        const {unit} = source()
        const saved = content(unit)
        const target = empty()
        target.boxGraph.beginTransaction()
        const old = addGrid(target, [
            {op: "setSetting", key: "name", value: "Old grid"},
            {op: "setPattern", lane: "Clap", notes: [note(5), note(13)]},
            {op: "newScene"}, {op: "newScene"}
        ])
        target.boxGraph.endTransaction()
        const grid = gridOf(old)
        const oldBoxes = [grid.composite, grid.head, ...grid.lanes.flatMap(lane => [lane.cell, lane.device, lane.instrument.unwrap()])]
        expect(oldBoxes.length).toBe(2 + 7 * 3)
        target.boxGraph.beginTransaction()
        const attempt = PresetDecoder.replaceAudioUnit(PresetEncoder.encode(unit) as ArrayBuffer, old)
        target.boxGraph.endTransaction()
        expect(attempt.isSuccess(), attempt.isFailure() ? String(attempt.failureReason()) : "").toBe(true)
        expect(content(old)).toEqual({...saved, song: {...saved.song, entries: []}})
        expectWhole(target, old)
        expect(oldBoxes.filter(box => box.isAttached()).map(box => box.name), "nothing of the old grid is left")
            .toEqual([])
    })

    it("duplicates the unit as a second PulseGrid with its own head and its own song", () => {
        const {skeleton, unit} = source()
        const saved = content(unit)
        skeleton.boxGraph.beginTransaction()
        const [copy] = TransferAudioUnits.transfer([unit], skeleton)
        skeleton.boxGraph.endTransaction()
        expect(content(copy)).toEqual(saved)
        expect(content(unit)).toEqual(saved)
        expectWhole(skeleton, unit, copy)
        skeleton.boxGraph.beginTransaction()
        expect(PulseGridOps.apply(gridOf(copy).composite, [{op: "setSong", entries: [{scene: 2, cycles: 4}]}])[0].ok).toBe(true)
        skeleton.boxGraph.endTransaction()
        expect(content(copy).song.entries).toEqual([{scene: 2, variation: "A", cycles: 4}])
        expect(content(unit).song.entries).toEqual(saved.song.entries)
    })
})
