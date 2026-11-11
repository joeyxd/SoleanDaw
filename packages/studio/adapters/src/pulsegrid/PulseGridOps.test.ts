import {describe, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {
    AudioUnitBox, InstrumentCompositeBox, InstrumentCompositeCellBox, PulseGridBox, PulseGridLaneDeviceBox
} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {PulseGridDevice} from "./PulseGridDevice"
import {PulseGridDocs} from "./PulseGridDocs"
import {PulseGridFactory} from "./PulseGridFactory"
import {PulseGridNotes} from "./PulseGridNotes"
import {PulseGridOps} from "./PulseGridOps"
import {PulseGridText} from "./PulseGridText"
import {PulseGridScales} from "./PulseGridScales"
import {PulseGridError, PulseGridNote, PulseGridOp} from "./PulseGridTypes"

const note = (step: number, pitch = 60): PulseGridNote => ({step, pitch, ...PulseGridNote.Defaults})
const fixture = () => {
    const {boxGraph: graph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} =
        ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    graph.beginTransaction()
    const unit = AudioUnitBox.create(graph, UUID.generate(), box => {
        box.collection.refer(rootBox.audioUnits)
        box.output.refer(primaryAudioBusBox.input)
        box.index.setValue(1)
    })
    const composite = InstrumentCompositeBox.create(graph, UUID.generate(), box => box.host.refer(unit.input))
    const head = PulseGridBox.create(graph, UUID.generate())
    const cells = [0, 1, 2].map(index => InstrumentCompositeCellBox.create(graph, UUID.generate(), box => {
        box.composite.refer(composite.cells)
        box.index.setValue(index)
    }))
    const lanes = cells.map((cell, index) => PulseGridLaneDeviceBox.create(graph, UUID.generate(), box => {
        box.host.refer(cell.midiEffects)
        box.grid.refer(head)
        box.index.setValue(0)
        box.label.setValue(["kick", "hat", "marimba"][index])
        box.kind.setValue(index === 2 ? 1 : 0)
    }))
    graph.endTransaction()
    const device = PulseGridDevice.find(composite).unwrap()
    const read = () => PulseGridDocs.read(device)
    const apply = (...ops: ReadonlyArray<PulseGridOp>) => {
        graph.beginTransaction()
        try {return PulseGridOps.apply(composite, ops)} finally {graph.endTransaction()}
    }
    const pattern = (lane = 0, scene = 1, variation = "A") =>
        read().lanes[lane].patterns.find(p => p.scene === scene && p.variation === variation)
    const seed = (lane: number, steps: ReadonlyArray<number>, length = 0) => {
        expect(apply({op: "setPattern", lane: lane + 1, notes: steps.map(step => note(step)), length})[0].ok).toBe(true)
    }
    return {graph, composite, head, cells, lanes, read, apply, pattern, seed}
}
const success = (op: PulseGridOp["op"], ...lines: Array<string>) => ({ok: true, op, lines})
const settings = "length 16  swing 50  groove 0  probability 100  humanize 0  accent 50  key C  scale major"

describe("PulseGridOps", () => {
    it.each(["natural-minor", "Minor", "Natural Minor", "1", 1])("stores scale %s by its index", value => {
        const f = fixture()
        expect(f.apply({op: "setSetting", key: "scale", value})[0].ok).toBe(true)
        expect(f.read().settings.scale).toBe(1)
    })

    it.each(["F#", "f#", 6])("stores key %s by its pitch class", value => {
        const f = fixture()
        expect(f.apply({op: "setSetting", key: "root", value})[0].ok).toBe(true)
        expect(f.read().settings.root).toBe(6)
    })

    it.each([12, "H", "Bb", -1, 1.5])("refuses root %s without writes", value => {
        const f = fixture(), before = f.read()
        const result = f.apply({op: "setSetting", key: "root", value})[0]
        expect(result.ok).toBe(false)
        if (!result.ok) {expect(result.error).toContain(String(value))}
        expect(f.read()).toEqual(before)
    })

    it.each(["unknown", 15, -1, 1.5, NaN])("lists the scale ids when refusing %s", value => {
        const f = fixture(), before = f.read()
        const result = f.apply({op: "setSetting", key: "scale", value})[0]
        expect(result.ok).toBe(false)
        if (!result.ok) {
            expect(result.error).toContain(String(value))
            for (const scale of PulseGridScales.All) {expect(result.error).toContain(scale.id)}
        }
        expect(f.read()).toEqual(before)
    })

    it("transposes one melodic lane by semitones and answers its new line", () => {
        const f = fixture()
        f.seed(0, [1])
        f.apply({op: "setPattern", lane: 3, notes: [note(1), {...note(5, 64), length: 8, chance: 40, accent: true}]})
        expect(f.apply({op: "transpose", lane: "marimba", semitones: 2})).toEqual([
            success("transpose", "marimba: 1:D3 5:F#3%40l8!")])
        expect(f.pattern(2)?.notes).toEqual([note(1, 62), {...note(5, 66), length: 8, chance: 40, accent: true}])
        expect(f.pattern()?.notes).toEqual([note(1)])
    })

    it.each([
        [0, 0, [60, 64, 61], [62, 65, 62]],
        [2, 1, [62, 64, 65], [64, 65, 67]],
        [0, 0, [60, 61], [59, 60]]
    ])("transposes by degrees in root %s scale %s", (root, scale, pitches, expected) => {
        const f = fixture()
        f.apply({op: "setSetting", key: "root", value: root}, {op: "setSetting", key: "scale", value: scale},
            {op: "setPattern", lane: 3, notes: pitches.map((pitch, i) => note(i + 1, pitch))})
        expect(f.apply({op: "transpose", lane: 3, degrees: expected[0] < pitches[0] ? -1 : 1})[0].ok).toBe(true)
        expect(f.pattern(2)?.notes.map(note => note.pitch)).toEqual(expected)
    })

    it.each([
        {semitones: 1, degrees: 1}, {}, {semitones: 0}, {degrees: 0}, {semitones: 1.5}, {degrees: -0.5}
    ])("refuses invalid transpose %j without writes", amount => {
        const f = fixture()
        f.seed(2, [1])
        const before = f.read()
        const result = f.apply({op: "transpose", lane: 3, ...amount})[0]
        expect(result.ok).toBe(false)
        if (!result.ok) {expect(result.error).toMatch(/integer/)}
        expect(f.read()).toEqual(before)
    })

    it.each([{semitones: 1}, {degrees: 1}, {semitones: -128}, {degrees: -100}])(
        "refuses an out-of-range transpose %j atomically across lanes", amount => {
            const f = fixture()
            f.apply({op: "setLane", lane: 2, kind: "melodic"}, {op: "setNote", lane: 2, note: note(1)},
                {op: "setNote", lane: 3, note: note(1, 127)})
            const before = f.read()
            const result = f.apply({op: "transpose", ...amount})[0]
            expect(result.ok).toBe(false)
            if (!result.ok) {expect(result.error).toContain("0..127")}
            expect(f.read()).toEqual(before)
        })

    it.each(["transpose", "toScale"] as const)("%s rejects a named drum and explains tuning", op => {
        const f = fixture(), before = f.read()
        const result = f.apply(op === "transpose" ? {op, lane: "kick", semitones: 12} : {op, lane: "kick"})[0]
        expect(result.ok).toBe(false)
        if (!result.ok) {expect(result.error).toMatch(/kick.*melodic.*setLane/)}
        expect(f.read()).toEqual(before)
    })

    it.each(["transpose", "toScale"] as const)("%s without a lane changes every melody and preserves drums and hidden notes", op => {
        const f = fixture()
        f.apply({op: "setLane", lane: 2, kind: "melodic"})
        for (const lane of [1, 2, 3]) {
            f.apply({op: "setPattern", lane, notes: [note(1, 61), note(12, 127)]},
                {op: "setPatternLength", lane, length: 8})
        }
        const drum = f.pattern()
        const result = f.apply(op === "transpose" ? {op, semitones: 1} : {op})[0]
        expect(result.ok).toBe(true)
        if (result.ok) {expect(result.lines).toEqual([
            `hat/8: 1:${op === "transpose" ? "D3" : "C3"}`,
            `marimba/8: 1:${op === "transpose" ? "D3" : "C3"}`])}
        expect(f.pattern()).toEqual(drum)
        for (const lane of [1, 2]) {
            expect(f.pattern(lane)?.notes).toEqual([note(1, op === "transpose" ? 62 : 60), note(12, 127)])
        }
    })

    it.each(["transpose", "toScale"] as const)("%s resolves a scene and variation and prefixes its answer", op => {
        const f = fixture()
        f.seed(2, [1])
        f.apply({op: "setNote", lane: 3, scene: 2, variation: "C", note: note(2, 61)})
        expect(f.apply(op === "transpose" ? {op, lane: 3, scene: 2, variation: "C", semitones: 1}
            : {op, lane: 3, scene: 2, variation: "C"})).toEqual([
            success(op, `scene 2 C marimba: 2:${op === "transpose" ? "D3" : "C3"}`)])
        expect(f.pattern(2)?.notes).toEqual([note(1)])
    })

    it.each([70, 120])("fits C#3 down to C3 and keeps the louder collision (%s)", velocity => {
        const f = fixture()
        const shifted = {...note(1, 61), velocity, length: 8, offset: -5}
        f.apply({op: "setPattern", lane: 3, notes: [note(1), shifted, note(2, 64)]})
        expect(f.apply({op: "toScale", lane: 3})[0].ok).toBe(true)
        expect(f.pattern(2)?.notes).toEqual([velocity > 100 ? {...shifted, pitch: 60} : note(1), note(2, 64)])
    })

    it("round trips a whole PulseGrid with named settings through text and real operations", () => {
        const f = fixture()
        f.apply({op: "setSetting", key: "root", value: "F#"}, {op: "setSetting", key: "scale", value: "Minor"},
            {op: "nameScene", scene: 2, name: "Melody"}, {op: "setPlaying", scene: 2, variation: "B"},
            {op: "setPattern", lane: 3, length: 8, notes: [note(1, 61), {...note(5, 66), velocity: 90, length: 8}]})
        const before = f.read(), text = PulseGridText.toText(before)
        const parsed = PulseGridText.parseText(text)
        expect(parsed.errors).toEqual([])
        f.apply({op: "clear"}, {op: "setSetting", key: "root", value: 0}, {op: "setSetting", key: "scale", value: 0})
        expect(f.apply(...parsed.ops).every(result => result.ok)).toBe(true)
        expect(f.read()).toEqual(before)
        expect(PulseGridText.toText(f.read())).toBe(text)
    })

    it("writes head settings, playing and scene names and answers their new text", () => {
        const f = fixture()
        expect(f.apply({op: "setSetting", key: "name", value: "Night drive"})).toEqual([success("setSetting", settings)])
        expect(f.read().name).toBe("Night drive")
        const values = {length: 32, swing: 54, groove: 40, probability: 80, humanize: 10, accentAmount: 60, root: 7, scale: 2}
        for (const [key, value] of Object.entries(values)) {
            expect(f.apply({op: "setSetting", key: key as keyof typeof values, value})[0].ok).toBe(true)
        }
        expect(f.read().settings).toEqual(values)
        expect(f.head.groove.getValue()).toBeCloseTo(0.4)
        expect(f.apply({op: "setSetting", key: "scale", value: 2})).toEqual([success("setSetting",
            "length 32  swing 54  groove 40  probability 80  humanize 10  accent 60  key G  scale harmonic-minor")])
        expect(f.apply({op: "setPlaying", scene: 2, variation: "B"})).toEqual([success("setPlaying", "playing scene 2 B")])
        expect(f.read()).toMatchObject({scene: 2, variation: "B"})
        expect(f.apply({op: "nameScene", scene: 2, name: "Drop"})).toEqual([success("nameScene", 'scenes 2 "Drop"')])
        expect(f.read().scenes).toEqual([{scene: 2, name: "Drop", used: true}])
        expect(f.apply({op: "setPlaying", variation: "C"})).toEqual([success("setPlaying", "playing scene 2 C")])
    })

    it("writes every lane field and mix in human units", () => {
        const f = fixture()
        f.seed(0, [1])
        const bytes = f.lanes[0].patterns.getField(0).notes.getValue().slice()
        expect(f.apply({op: "setLane", lane: "KICK", name: "bass", kind: "melodic", pitch: 36,
            probability: 80, humanize: 20, accent: false, group: 1, hue: 359, armed: true, enabled: false}))
            .toEqual([success("setLane", "1 bass  melodic  C1  none  gain 0  pan 0  chance 80  humanize 20  no-accent  armed  off")])
        expect(f.read().lanes[0]).toMatchObject({name: "bass", kind: "melodic", pitch: 36, probability: 80,
            humanize: 20, accent: false, group: 1, hue: 359, armed: true, enabled: false})
        expect(f.lanes[0].probability.getValue()).toBeCloseTo(0.8)
        expect(f.lanes[0].patterns.getField(0).notes.getValue()).toEqual(bytes)
        expect(f.apply({op: "setLaneMix", lane: f.read().lanes[0].id, gain: -3, pan: -50, mute: true, solo: true}))
            .toEqual([success("setLaneMix", "1 bass  melodic  C1  none  gain -3  pan -50  mute  solo  chance 80  humanize 20  no-accent  armed  off")])
        expect(f.read().lanes[0].mix).toEqual({gain: -3, pan: -50, mute: true, solo: true})
        expect(f.cells[0].pan.getValue()).toBeCloseTo(-0.5)
    })

    it("replaces text patterns, ignores names, and resolves explicit and current slots", () => {
        const f = fixture()
        expect(f.apply({op: "setPatternText", lane: "kick", text: "ignored |x--- x--- x--- x---|"}))
            .toEqual([success("setPatternText", "kick |x--- x--- x--- x---|")])
        expect(f.pattern()?.notes.map(n => n.step)).toEqual([1, 5, 9, 13])
        expect(f.apply({op: "setNote", lane: 1, scene: 2, variation: "B", note: {step: 1}}))
            .toEqual([success("setNote", "scene 2 B kick |x--- ---- ---- ----|")])
        expect(PulseGridNotes.decode(f.lanes[0].patterns.getField(5).notes.getValue())).toEqual([note(1)])
        expect(f.pattern(0, 2, "B")?.notes).toEqual([note(1)])
        f.apply({op: "setPlaying", scene: 2, variation: "B"})
        expect(f.apply({op: "setStep", lane: 1, step: 5})).toEqual([success("setStep", "kick |x--- x--- ---- ----|")])
        expect(f.pattern(0, 2, "B")?.notes.map(n => n.step)).toEqual([1, 5])
        expect(f.apply({op: "setPatternText", lane: 2, text: "any/8 |x--- x---|"}))
            .toEqual([success("setPatternText", "hat/8 |x--- x---|")])
        expect(f.pattern(1, 2, "B")).toMatchObject({length: 8, notes: [note(1), note(5)]})
    })

    it("normalizes drum notes, preserves partial values, and removes steps and notes", () => {
        const f = fixture()
        f.apply({op: "setLane", lane: 1, pitch: 36})
        expect(f.apply({op: "setPattern", lane: 1, notes: [{step: 1, pitch: 64},
            {step: 1, pitch: 67, velocity: 90, length: 8, chance: 40, offset: -2, repeats: 2, accent: true}]}))
            .toEqual([success("setPattern", "kick |x--- ---- ---- ----| 1:v90%40l8o-2r2!")])
        expect(f.pattern()?.notes).toEqual([{...note(1, 36), velocity: 90, length: 8, chance: 40,
            offset: -2, repeats: 2, accent: true}])
        expect(f.apply({op: "setStep", lane: 1, step: 1, velocity: 100}))
            .toEqual([success("setStep", "kick |X--- ---- ---- ----| 1:%40l8o-2r2")])
        expect(f.pattern()?.notes[0]).toEqual({...note(1, 36), length: 8, chance: 40, offset: -2, repeats: 2, accent: true})
        f.apply({op: "setNote", lane: 1, note: {step: 1, pitch: 70, chance: 60}})
        expect(f.pattern()?.notes).toHaveLength(1)
        expect(f.pattern()?.notes[0]).toMatchObject({pitch: 36, chance: 60, length: 8})
        expect(f.apply({op: "setStep", lane: 1, step: 1, on: false})).toEqual([success("setStep", "kick |---- ---- ---- ----|")])
        expect(f.pattern()).toBeUndefined()
        f.apply({op: "setPattern", lane: 3, notes: [{step: 1}, {step: 1, pitch: 64}]})
        expect(f.pattern(2)?.notes).toEqual([note(1), note(1, 64)])
        expect(f.apply({op: "setStep", lane: 3, step: 1, velocity: 90}))
            .toEqual([success("setStep", "marimba: 1:C3v90 1:E3v90")])
        expect(f.pattern(2)?.notes).toEqual([{...note(1), velocity: 90}, {...note(1, 64), velocity: 90}])
        expect(f.apply({op: "removeNote", lane: 3, step: 1, pitch: 64})).toEqual([success("removeNote", "marimba: 1:C3v90")])
        expect(f.pattern(2)?.notes).toEqual([{...note(1), velocity: 90}])
        expect(f.apply({op: "removeNote", lane: 3, step: 1})).toEqual([success("removeNote", "marimba:")])
        expect(f.pattern(2)).toBeUndefined()
    })

    it("length changes hide notes, rotation preserves hidden notes, and zero restores them", () => {
        const f = fixture()
        f.seed(0, [1, 9, 16])
        expect(f.apply({op: "setPatternLength", lane: 1, length: 8})).toEqual([success("setPatternLength", "kick/8 |x--- ----|")])
        expect(f.pattern()?.notes.map(n => n.step)).toEqual([1, 9, 16])
        expect(f.apply({op: "rotate", lane: 1, steps: -1})).toEqual([success("rotate", "kick/8 |---- ---x|")])
        expect(f.pattern()?.notes.map(n => n.step)).toEqual([8, 9, 16])
        expect(f.apply({op: "setPatternLength", lane: 1, length: 0}))
            .toEqual([success("setPatternLength", "kick |---- ---x x--- ---x|")])
        expect(f.pattern()).toMatchObject({length: 0, notes: [note(8), note(9), note(16)]})
    })

    it("doubles into the stored second half, halves without deleting, and clears all storage", () => {
        const f = fixture()
        f.seed(0, [1, 8, 10, 20], 32)
        f.apply({op: "setPatternLength", lane: 1, length: 8})
        expect(f.apply({op: "double", lane: 1})).toEqual([success("double", "kick/16 |x--- ---x x--- ---x|")])
        expect(f.pattern()).toMatchObject({length: 16, notes: [note(1), note(8), note(9), note(16), note(20)]})
        expect(f.apply({op: "halve", lane: 1})).toEqual([success("halve", "kick/8 |x--- ---x|")])
        expect(f.pattern()?.notes.map(n => n.step)).toEqual([1, 8, 9, 16, 20])
        expect(f.apply({op: "clear", lane: 1})).toEqual([success("clear", "kick |---- ---- ---- ----|")])
        expect(f.pattern()).toBeUndefined()
        expect(f.lanes[0].patterns.getField(0).length.getValue()).toBe(0)
        expect(f.lanes[0].patterns.getField(0).notes.getValue().length).toBe(0)
    })

    it("euclid sets its own length and preserves notes beyond its working range", () => {
        const f = fixture()
        f.seed(0, [2, 12])
        expect(f.apply({op: "euclid", lane: 1, hits: 3, steps: 8})).toEqual([success("euclid", "kick/8 |x--x --x-|")])
        expect(f.pattern()).toMatchObject({length: 8, notes: [note(1), note(4), note(7), note(12)]})
        expect(f.apply({op: "euclid", lane: 1, hits: 3, rotate: 1, velocity: 70}))
            .toEqual([success("euclid", "kick/8 |-5-- 5--5|")])
        expect(f.pattern()?.notes).toEqual([...[2, 5, 8].map(step => ({...note(step), velocity: 70})), note(12)])
    })

    it("pattern and text replacements preserve hidden notes, including melodic text output", () => {
        const f = fixture()
        f.seed(0, [1, 12])
        f.apply({op: "setPattern", lane: 1, length: 8, notes: [{step: 2}]})
        expect(f.pattern()?.notes).toEqual([note(2), note(12)])
        f.apply({op: "setPatternText", lane: 1, text: "|---x ----|"})
        expect(f.pattern()?.notes).toEqual([note(4), note(12)])
        f.seed(2, [1, 12])
        expect(f.apply({op: "setPatternLength", lane: 3, length: 8})).toEqual([success("setPatternLength", "marimba/8: 1:C3")])
        expect(f.pattern(2)?.notes).toEqual([note(1), note(12)])
        f.apply({op: "setPatternText", lane: 1, text: "ignored: 1:C3 1:E3v70"})
        expect(f.pattern()?.notes).toEqual([{...note(1), velocity: 70}, note(12)])
    })

    it("copies whole variations and selected lanes, in lane order, with independent slots", () => {
        const f = fixture()
        f.seed(0, [1, 12])
        f.seed(1, [2])
        f.seed(2, [3])
        f.apply({op: "setPatternLength", lane: 1, length: 8})
        expect(f.apply({op: "copyVariation", from: {variation: "A"}, to: {variation: "B"}})).toEqual([success("copyVariation",
            "scene 1 B kick/8 |x--- ----|", "scene 1 B hat |-x-- ---- ---- ----|", "scene 1 B marimba: 3:C3")])
        for (let lane = 0; lane < 3; lane++) {
            expect(f.pattern(lane, 1, "B")).toEqual({...f.pattern(lane), variation: "B"})
        }
        expect(f.apply({op: "copyVariation", from: {variation: "A"}, to: {scene: 2, variation: "C"}, lanes: [3, 1]}))
            .toEqual([success("copyVariation", "scene 2 C kick/8 |x--- ----|", "scene 2 C marimba: 3:C3")])
        expect(f.pattern(0, 2, "C")?.notes).toEqual([note(1), note(12)])
        expect(f.pattern(1, 2, "C")).toBeUndefined()
        expect(f.pattern(2, 2, "C")?.notes).toEqual([note(3)])
        f.apply({op: "clear", lane: 1, variation: "B"})
        expect(f.pattern()?.notes).toEqual([note(1), note(12)])
    })

    it("moves every lane atomically and only answers lanes with stored contents afterwards", () => {
        const f = fixture()
        f.seed(0, [1])
        f.seed(1, [2])
        f.seed(2, [3])
        expect(f.apply({op: "rotate", steps: 1})).toEqual([success("rotate",
            "kick |-x-- ---- ---- ----|", "hat |--x- ---- ---- ----|", "marimba: 4:C3")])
        expect(f.read().lanes.map(l => l.patterns[0].notes[0].step)).toEqual([2, 3, 4])
        f.apply({op: "setPatternLength", lane: 2, length: 40})
        const before = f.read()
        expect(f.apply({op: "double"})).toEqual([{ok: false, op: "double", error: "cannot double length 40; allowed 1..32"}])
        expect(f.read()).toEqual(before)
        f.apply({op: "setPatternLength", lane: 2, length: 0})
        expect(f.apply({op: "double"})[0].ok).toBe(true)
        expect(f.read().lanes.map(l => l.patterns[0].length)).toEqual([32, 32, 32])
        expect(f.apply({op: "halve"})[0].ok).toBe(true)
        expect(f.read().lanes.map(l => l.patterns[0].length)).toEqual([16, 16, 16])
        expect(f.apply({op: "clear"})).toEqual([success("clear")])
        expect(f.read().lanes.every(l => l.patterns.length === 0)).toBe(true)
        expect(f.apply({op: "rotate", steps: 2})).toEqual([success("rotate")])
    })

    const invalid: ReadonlyArray<[PulseGridOp, string]> = [
        [{op: "setStep", lane: "missing", step: 1}, "missing"],
        [{op: "setStep", lane: 1, step: 0}, "0"],
        [{op: "setStep", lane: 1, step: 17}, "17"],
        [{op: "setStep", lane: 1, step: 1, velocity: 128}, "128"],
        [{op: "setNote", lane: 1, scene: 17, note: {step: 1}}, "17"],
        [{op: "setNote", lane: 1, variation: "E", note: {step: 1}} as unknown as PulseGridOp, "E"],
        [{op: "setSetting", key: "swing", value: 80}, "80"],
        [{op: "setSetting", key: "length", value: "eight"}, "eight"],
        [{op: "setStep", lane: null, step: 1} as unknown as PulseGridOp, "null"],
        [{op: "setPattern", lane: 1, notes: "wrong"} as unknown as PulseGridOp, "wrong"],
        [{op: "setNote", lane: 1, note: null} as unknown as PulseGridOp, "null"],
        [{op: "setPattern", lane: 1, notes: [null]} as unknown as PulseGridOp, "null"],
        [{op: "setLane", lane: 1, name: "changed", armed: "yes"} as unknown as PulseGridOp, "yes"],
        [{op: "setStep", lane: 1, step: 1, accent: "yes"} as unknown as PulseGridOp, "yes"],
        [{op: "setSetting", key: "length", value: NaN}, "NaN"],
        [{op: "setLaneMix", lane: 1, gain: Infinity}, "Infinity"],
        [{op: "setPattern", lane: 1, length: "8", notes: []} as unknown as PulseGridOp, "8"],
        [{op: "setPattern", lane: 1, length: 8, notes: [{step: 9}]}, "9"],
        [{op: "setLane", lane: 1, name: "changed", probability: 101}, "101"],
        [{op: "setLaneMix", lane: 1, gain: -3, pan: -101}, "-101"],
        [{op: "setPlaying", scene: 2, variation: "E"} as unknown as PulseGridOp, "E"],
        [{op: "nameScene", scene: 17, name: "invalid"}, "17"],
        [{op: "setStep", lane: 1, step: 1, on: false, chance: 101}, "101"],
        [{op: "setNote", lane: 1, note: {step: 1, pitch: 128}}, "128"],
        [{op: "setPatternText", lane: 1, text: "|x---|"}, "4"],
        [{op: "rotate", steps: 1.5}, "1.5"],
        [{op: "euclid", lane: 1, hits: 9, steps: 8}, "9"],
        [{op: "euclid", lane: 1, hits: 3, steps: 8, velocity: 128}, "128"],
        [{op: "copyVariation", from: {variation: "A"}, to: {variation: "B"}, lanes: [1, "missing"]}, "missing"]
    ]
    it.each(invalid)("rejects %j with no writes", (op, given) => {
        const f = fixture()
        f.seed(0, [1, 16])
        const before = f.read()
        const result = f.apply(op)[0]
        expect(result.ok).toBe(false)
        if (!result.ok) {expect(result.error).toContain(given)}
        expect(f.read()).toEqual(before)
    })

    it("counts hidden notes toward 128, rejects a 129th, and validates all lanes before double", () => {
        const f = fixture()
        const notes = Array.from({length: 128}, (_, pitch) => note(16, pitch))
        f.apply({op: "setPattern", lane: 3, notes}, {op: "setPatternLength", lane: 3, length: 8})
        expect(f.pattern(2)?.notes).toHaveLength(128)
        const before = f.read()
        const result = f.apply({op: "setNote", lane: 3, note: {step: 1}})[0]
        expect(result.ok).toBe(false)
        if (!result.ok) {expect(result.error).toContain("129")}
        expect(f.read()).toEqual(before)
        f.apply({op: "setPatternLength", lane: 3, length: 0})
        const full = f.read()
        expect(f.apply({op: "double"})[0].ok).toBe(false)
        expect(f.read()).toEqual(full)
    })

    it("rejects double above 32 and halve at 1 without changing the document", () => {
        const f = fixture()
        for (const [length, op] of [[33, "double"], [1, "halve"]] as const) {
            f.apply({op: "setPatternLength", lane: 1, length})
            const before = f.read()
            const result = f.apply({op, lane: 1})[0]
            expect(result.ok).toBe(false)
            if (!result.ok) {expect(result.error).toContain(String(length))}
            expect(f.read()).toEqual(before)
        }
    })

    it("retunes drums without rewriting stored pitches and applies the new pitch on note edits", () => {
        const f = fixture()
        f.seed(0, [1])
        f.apply({op: "setLane", lane: 1, pitch: 36})
        expect(f.pattern()?.notes).toEqual([note(1)])
        expect(f.apply({op: "setNote", lane: 1, note: {step: 1, pitch: 64, velocity: 70}}))
            .toEqual([success("setNote", "kick |5--- ---- ---- ----|")])
        expect(f.pattern()?.notes).toEqual([{...note(1, 36), velocity: 70}])
    })

    it("stops a batch at its first failure and returns only the operations that ran", () => {
        const f = fixture()
        const results = f.apply({op: "setStep", lane: 1, step: 1}, {op: "setStep", lane: 1, step: 0},
            {op: "setStep", lane: 2, step: 2})
        expect(results).toHaveLength(2)
        expect(results[0]).toEqual(success("setStep", "kick |x--- ---- ---- ----|"))
        expect(results[1].ok).toBe(false)
        expect(f.pattern()?.notes).toEqual([note(1)])
        expect(f.pattern(1)).toBeUndefined()
    })

    it("throws PulseGridError for a non-PulseGrid, and lets unexpected exceptions travel", () => {
        const f = fixture()
        f.graph.beginTransaction()
        f.lanes.forEach(lane => lane.delete())
        f.graph.endTransaction()
        expect(() => PulseGridOps.apply(f.composite, [])).toThrow(PulseGridError)
        const other = fixture()
        const unexpected = new Error("unexpected")
        const spy = vi.spyOn(PulseGridDocs, "read").mockImplementation(() => {throw unexpected})
        try {expect(() => other.apply({op: "setStep", lane: 1, step: 1})).toThrow(unexpected)}
        finally {spy.mockRestore()}
    })

    it("run makes a two-op batch one undo step", () => {
        const f = fixture()
        const editing = new BoxEditing(f.graph)
        const before = f.read()
        expect(PulseGridOps.run(editing, f.composite, [{op: "setStep", lane: 1, step: 1},
            {op: "setSetting", key: "groove", value: 40}])).toEqual([
            success("setStep", "kick |x--- ---- ---- ----|"), success("setSetting", settings.replace("groove 0", "groove 40"))
        ])
        expect(f.read().settings.groove).toBe(40)
        expect(f.pattern()?.notes).toEqual([note(1)])
        expect(editing.undo()).toBe(true)
        expect(f.read()).toEqual(before)
        expect(editing.canUndo()).toBe(false)
    })

    it.each([
        ["an unknown op", {op: "bogus"}, "bogus"],
        ["a null op", null, "null"],
        ["an unknown setting", {op: "setSetting", key: "bogus", value: 5}, "bogus"],
        ["a setting without a key", {op: "setSetting", value: 5}, "undefined"],
        ["a gain above the cell's range", {op: "setLaneMix", lane: 1, gain: 1e300}, "1e+300"],
        ["a gain below the cell's range", {op: "setLaneMix", lane: 1, gain: -73}, "-73"],
        ["euclid without a lane", {op: "euclid", hits: 2}, "lane undefined"],
        ["a rotate beyond an int", {op: "rotate", lane: 1, steps: 2 ** 40}, String(2 ** 40)],
        ["a pitch on setStep", {op: "setStep", lane: 3, step: 1, pitch: 64}, "pitch"]
    ])("answers ok false for %s and changes nothing", (_, op, message) => {
        const f = fixture()
        f.seed(2, [1])
        const before = f.read()
        const results = f.apply(op as PulseGridOp)
        expect(results).toHaveLength(1)
        expect(results[0].ok).toBe(false)
        expect(results[0].ok === false && results[0].error).toContain(message)
        expect(f.read()).toEqual(before)
    })

    it("keeps the earlier results of a batch when a later op is not known", () => {
        const f = fixture()
        const results = f.apply({op: "setStep", lane: 1, step: 1}, {op: "bogus"} as unknown as PulseGridOp)
        expect(results.map(result => result.ok)).toEqual([true, false])
        expect(f.pattern()?.notes).toEqual([note(1)])
    })

    it("adds and edits a new lane in one batch and answers all four structural operations", () => {
        const f = fixture()
        const read = () => PulseGridDocs.read(PulseGridDevice.find(f.composite).unwrap())
        const sound = PulseGridFactory.DefaultKit[0].sound
        const results = f.apply({op: "addLane", name: "Tom", kind: "drum", sound},
            {op: "setPatternText", lane: "Tom", text: "|x--- ---- x--- ----|"})
        expect(results).toEqual([success("addLane", PulseGridText.formatLane(read().lanes[3])),
            success("setPatternText", "Tom |x--- ---- x--- ----|")])
        expect(read().lanes[3].patterns[0].notes.map(note => note.step)).toEqual([1, 9])
        expect(f.apply({op: "moveLane", lane: "Tom", to: 1}))
            .toEqual([success("moveLane", PulseGridText.formatLane(read().lanes[0]))])
        expect(read().lanes[0].name).toBe("Tom")
        expect(f.apply({op: "setLaneSound", lane: "Tom", sound: {instrument: "Tubular", label: "New FM"}}))
            .toEqual([success("setLaneSound", PulseGridText.formatLane(read().lanes[0]))])
        expect(read().lanes[0].sound).toEqual({instrument: "Tubular", label: "New FM"})
        expect(f.apply({op: "removeLane", lane: "Tom"}, {op: "setStep", lane: 1, step: 2}))
            .toEqual([success("removeLane"), success("setStep", "kick |-x-- ---- ---- ----|")])
        expect(read().lanes.map(lane => lane.name)).toEqual(["kick", "hat", "marimba"])
    })

    it.each([
        {instrument: "Nano", sample: {uuid: "bad", name: "Bad", duration: 1}},
        {instrument: "Nano", sample: {uuid: "b50f6f4f-d933-400c-a63a-83b3c2f6c8b2", name: "Bad", duration: 0}},
        {instrument: "Tubular", voice: {name: "Bad", patch: [128]}}
    ] as const)("answers false without writes for invalid lane sound %j", sound => {
        const f = fixture()
        const before = f.read()
        const boxes = f.graph.boxes()
        for (const op of [{op: "addLane", name: "Bad", kind: "drum", sound},
            {op: "setLaneSound", lane: 1, sound}] as ReadonlyArray<PulseGridOp>) {
            expect(f.apply(op)[0].ok).toBe(false)
            expect(f.read()).toEqual(before)
            expect(f.graph.boxes()).toEqual(boxes)
        }
    })
})

