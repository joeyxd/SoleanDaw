import {describe, expect, it} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {
    AudioUnitBox, InstrumentCompositeBox, InstrumentCompositeCellBox, NoteEventBox, NoteEventCollectionBox,
    NoteRegionBox, PulseGridBox, PulseGridLaneDeviceBox, TrackBox
} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {TrackType} from "../timeline/TrackType"
import {PulseGridDevice} from "./PulseGridDevice"
import {PulseGridDocs} from "./PulseGridDocs"
import {PulseGridOps} from "./PulseGridOps"
import {PulseGridSongRegions} from "./PulseGridSong"
import {PulseGridText} from "./PulseGridText"
import {PulseGridNote, PulseGridOp, PulseGridSongEntryInput, PulseGridVariation} from "./PulseGridTypes"

const cycle = 16 * 240 // one cycle of the default length of 16 steps, in pulses
const note = (step: number, pitch = 60): PulseGridNote => ({step, pitch, ...PulseGridNote.Defaults})

// A PulseGrid of three lanes (kick, hat, marimba) on an audio unit, as the other op tests build one.
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
    cells.forEach((cell, index) => PulseGridLaneDeviceBox.create(graph, UUID.generate(), box => {
        box.host.refer(cell.midiEffects)
        box.grid.refer(head)
        box.index.setValue(0)
        box.label.setValue(["kick", "hat", "marimba"][index])
        box.kind.setValue(index === 2 ? 1 : 0)
    }))
    graph.endTransaction()
    const device = () => PulseGridDevice.find(composite).unwrap()
    const read = () => PulseGridDocs.read(device())
    const apply = (...ops: ReadonlyArray<PulseGridOp>) => {
        graph.beginTransaction()
        try {return PulseGridOps.apply(composite, ops)} finally {graph.endTransaction()}
    }
    const ok = (...ops: ReadonlyArray<PulseGridOp>) => {
        const results = apply(...ops)
        expect(results.filter(result => !result.ok)).toEqual([])
        expect(results.length).toBe(ops.length)
        return results
    }
    // a pattern of the kick lane
    const seed = (scene: number, steps: ReadonlyArray<number>, variation: PulseGridVariation = "A", lane = 1) =>
        ok({op: "setPattern", lane, scene, variation, notes: steps.map(step => note(step))})
    const steps = (scene: number, variation = "A", lane = 0) =>
        read().lanes[lane].patterns.find(p => p.scene === scene && p.variation === variation)?.notes.map(n => n.step)
    const scenes = (count: number) => {for (let scene = 1; scene < count; scene++) {ok({op: "newScene"})}}
    const song = (entries: ReadonlyArray<PulseGridSongEntryInput>, extra: {on?: boolean, from?: number} = {}) =>
        ok({op: "setSong", entries, ...extra})
    // the scene regions as the boxes hold them
    const regions = () => PulseGridSongRegions.sceneRegions(device()).map(({region, collection}) => ({
        position: region.position.getValue(), duration: region.duration.getValue(),
        loopOffset: region.loopOffset.getValue(), loopDuration: region.loopDuration.getValue(),
        label: region.label.getValue(),
        notes: collection.events.pointerHub.incoming().map(({box}) => box as NoteEventBox)
            .map(box => ({position: box.position.getValue(), duration: box.duration.getValue(), pitch: box.pitch.getValue()}))
            .sort((a, b) => a.position - b.position)
    }))
    const count = (type: Function) => graph.boxes().filter(box => box instanceof type).length
    const tracks = () => unit.tracks.pointerHub.incoming().map(({box}) => box as TrackBox)
    const edit = (change: () => void) => {
        graph.beginTransaction()
        try {change()} finally {graph.endTransaction()}
    }
    return {graph, unit, composite, device, read, apply, ok, seed, steps, scenes, song, regions, count, tracks, edit}
}
const refused = (f: ReturnType<typeof fixture>, op: PulseGridOp) => {
    const before = f.read(), boxes = f.graph.boxes().length
    const result = f.apply(op)[0]
    expect(result.ok).toBe(false)
    expect(f.read()).toEqual(before)
    expect(f.graph.boxes().length).toBe(boxes)
    return result.ok ? "" : result.error
}

describe("PulseGrid scenes", () => {
    it.each<[string, (f: ReturnType<typeof fixture>) => void, number]>([
        ["scene 1 alone", () => {}, 1],
        ["the scene that plays", f => f.ok({op: "setPlaying", scene: 3}), 3],
        ["a used flag", f => f.ok({op: "nameScene", scene: 5, name: "Five"}), 5],
        ["a lane's notes in any variation", f => f.seed(7, [1], "D"), 7],
        ["a lane's own length", f => f.ok({op: "setPatternLength", lane: 2, scene: 9, variation: "B", length: 8}), 9]
    ])("counts %s", (_name, make, expected) => {
        const f = fixture()
        make(f)
        expect(f.read().sceneCount).toBe(expected)
    })

    it("stops counting the playing scene once it plays another", () => {
        const f = fixture()
        f.ok({op: "setPlaying", scene: 4}, {op: "setPlaying", scene: 1})
        expect(f.read().sceneCount).toBe(1)
    })

    it("counts a hole between scenes", () => {
        const f = fixture()
        f.seed(4, [1])
        expect(f.read().sceneCount).toBe(4)
    })

    it("makes an empty scene that plays nothing new", () => {
        const f = fixture()
        const [result] = f.ok({op: "newScene"})
        expect(result).toEqual({ok: true, op: "newScene", lines: ["scenes 2 \"\"", "playing scene 1 A"]})
        const doc = f.read()
        expect(doc.sceneCount).toBe(2)
        expect(doc.scenes).toEqual([{scene: 2, name: "", used: true}])
        expect(doc.scene).toBe(1)
    })

    it("names a new scene", () => {
        const f = fixture()
        f.ok({op: "newScene", name: "Drop"})
        expect(f.read().scenes).toEqual([{scene: 2, name: "Drop", used: true}])
    })

    it("copies the four variations of every lane with copyOf, and only those", () => {
        const f = fixture()
        f.seed(1, [1, 5])
        f.seed(1, [9], "C", 2)
        f.ok({op: "setPatternLength", lane: 3, variation: "B", length: 8}, {op: "nameScene", scene: 1, name: "Intro"})
        const before = f.read()
        f.ok({op: "newScene", copyOf: 1})
        const doc = f.read()
        const copied = (lane: number) => doc.lanes[lane].patterns.filter(p => p.scene === 2).map(p => ({...p, scene: 1}))
        for (let lane = 0; lane < 3; lane++) {
            expect(copied(lane)).toEqual(before.lanes[lane].patterns.filter(p => p.scene === 1))
        }
        expect(doc.lanes[2].patterns.find(p => p.scene === 2)).toEqual({scene: 2, variation: "B", length: 8, notes: []})
        expect(doc.lanes.map((lane, index) => lane.patterns.filter(p => p.scene === 1)).flat())
            .toEqual(before.lanes.map(lane => lane.patterns.filter(p => p.scene === 1)).flat())
        expect(doc.scenes).toEqual([{scene: 1, name: "Intro", used: true}, {scene: 2, name: "", used: true}])
        expect(doc.scene).toBe(1)
    })

    it("refuses a 17th scene and a copy of a scene that does not exist, writing nothing", () => {
        const f = fixture()
        f.scenes(15)
        expect(refused(f, {op: "newScene", copyOf: 16})).toMatch(/copyOf 16 .*1\.\.15/)
        f.ok({op: "newScene"})
        expect(f.read().sceneCount).toBe(16)
        expect(refused(f, {op: "newScene"})).toContain("16")
        const g = fixture()
        expect(refused(g, {op: "newScene", copyOf: 2})).toMatch(/copyOf 2 .*1\.\.1/)
        expect(refused(g, {op: "newScene", copyOf: 0})).toContain("copyOf 0")
    })

    describe("removeScene", () => {
        const three = () => {
            const f = fixture()
            f.seed(1, [1]); f.seed(2, [2]); f.seed(3, [3]); f.seed(3, [4], "B")
            f.seed(2, [7], "A", 2)
            f.ok({op: "nameScene", scene: 2, name: "Two"}, {op: "nameScene", scene: 3, name: "Three"},
                {op: "newScene"})
            return f
        }

        it("moves patterns, names and used flags down", () => {
            const f = three()
            expect(f.read().sceneCount).toBe(4)
            const [result] = f.ok({op: "removeScene", scene: 2})
            expect(result).toEqual({ok: true, op: "removeScene", lines: ["scenes 2 \"Three\"  3 \"\"", "playing scene 1 A"]})
            const doc = f.read()
            expect(doc.sceneCount).toBe(3)
            expect(f.steps(1)).toEqual([1])
            expect(f.steps(2)).toEqual([3])
            expect(f.steps(2, "B")).toEqual([4])
            expect(f.steps(3)).toBeUndefined()
            expect(doc.lanes[1].patterns).toEqual([])
            expect(doc.scenes).toEqual([{scene: 2, name: "Three", used: true}, {scene: 3, name: "", used: true}])
        })

        it("lets the playing number follow its scene", () => {
            const f = three()
            f.ok({op: "setPlaying", scene: 3, variation: "B"})
            f.ok({op: "removeScene", scene: 1})
            expect(f.read()).toMatchObject({scene: 2, variation: "B"})
            f.ok({op: "removeScene", scene: 3})
            expect(f.read()).toMatchObject({scene: 2, variation: "B"})
        })

        it("plays the scene that takes the number of the removed one, with A when its variation is empty there", () => {
            const f = three()
            f.ok({op: "setPlaying", scene: 2, variation: "B"})
            f.ok({op: "removeScene", scene: 2})
            // scene 3 held B, so B stays
            expect(f.read()).toMatchObject({scene: 2, variation: "B"})
            const g = three()
            g.ok({op: "setPlaying", scene: 2, variation: "C"})
            g.ok({op: "removeScene", scene: 2})
            expect(g.read()).toMatchObject({scene: 2, variation: "A"})
        })

        it("plays the last scene when the last scene that played is removed", () => {
            const f = three()
            f.ok({op: "setPlaying", scene: 4})
            f.ok({op: "removeScene", scene: 4})
            expect(f.read()).toMatchObject({scene: 3, variation: "A", sceneCount: 3})
        })

        it("refuses the only scene and a scene that does not exist, writing nothing", () => {
            const f = fixture()
            expect(refused(f, {op: "removeScene", scene: 1})).toContain("only scene")
            f.ok({op: "newScene"})
            expect(refused(f, {op: "removeScene", scene: 3})).toMatch(/scene 3 .*1\.\.2/)
        })
    })

    describe("moveScene", () => {
        const three = () => {
            const f = fixture()
            f.seed(1, [1]); f.seed(1, [9], "B"); f.seed(2, [2]); f.seed(3, [3])
            f.ok({op: "nameScene", scene: 1, name: "One"}, {op: "nameScene", scene: 2, name: "Two"},
                {op: "nameScene", scene: 3, name: ""})
            return f
        }

        it("moves a scene down the list with its four slots, name and flag, and the scenes between shift up", () => {
            const f = three()
            f.ok({op: "setPlaying", scene: 2})
            const [result] = f.ok({op: "moveScene", scene: 1, to: 3})
            expect(result).toEqual({ok: true, op: "moveScene",
                lines: ["scenes 1 \"Two\"  2 \"\"  3 \"One\"", "playing scene 1 A"]})
            expect([f.steps(1), f.steps(2), f.steps(3), f.steps(3, "B")]).toEqual([[2], [3], [1], [9]])
            expect(f.read().scenes.map(scene => [scene.scene, scene.name, scene.used]))
                .toEqual([[1, "Two", true], [2, "", true], [3, "One", true]])
        })

        it("moves a scene up the list and lets the playing number follow", () => {
            const f = three()
            f.ok({op: "setPlaying", scene: 2})
            f.ok({op: "moveScene", scene: 3, to: 1})
            expect([f.steps(1), f.steps(2), f.steps(3)]).toEqual([[3], [1], [2]])
            expect(f.read().scene).toBe(3)
            f.ok({op: "moveScene", scene: 3, to: 2})
            expect(f.read().scene).toBe(2)
            f.ok({op: "setPlaying", scene: 1})
            f.ok({op: "moveScene", scene: 1, to: 1})
            expect(f.read().scene).toBe(1)
        })

        it("refuses a scene or target outside 1 to sceneCount, writing nothing", () => {
            const f = three()
            expect(refused(f, {op: "moveScene", scene: 4, to: 1})).toMatch(/scene 4 .*1\.\.3/)
            expect(refused(f, {op: "moveScene", scene: 1, to: 0})).toMatch(/to 0 .*1\.\.3/)
        })
    })

    describe("setPlaying", () => {
        it("falls back to A when the variation that plays holds nothing in the scene", () => {
            const f = fixture()
            f.seed(2, [1])
            f.ok({op: "setPlaying", variation: "B"})
            f.ok({op: "setPlaying", scene: 2})
            expect(f.read()).toMatchObject({scene: 2, variation: "A"})
        })

        it("keeps the variation where the scene holds something in it, and takes a named one as given", () => {
            const f = fixture()
            f.seed(2, [1], "B")
            f.ok({op: "setPlaying", variation: "B"})
            f.ok({op: "setPlaying", scene: 2})
            expect(f.read()).toMatchObject({scene: 2, variation: "B"})
            f.ok({op: "setPlaying", scene: 3, variation: "C"})
            expect(f.read()).toMatchObject({scene: 3, variation: "C"})
            f.ok({op: "setPlaying", scene: 1})
            expect(f.read()).toMatchObject({scene: 1, variation: "A"})
        })
    })
})

describe("PulseGrid song", () => {
    it("writes one region per entry, its own notes, and turns the switch on", () => {
        const f = fixture()
        f.scenes(2)
        f.ok({op: "nameScene", scene: 1, name: "Intro"})
        expect(f.tracks()).toEqual([])
        const [result] = f.song([{scene: 1, cycles: 4}, {scene: 2, variation: "B", cycles: 1.5}, {rest: true, cycles: 2},
            {scene: 1, variation: "C"}])
        expect(result).toEqual({ok: true, op: "setSong",
            lines: ["song on  from 1  1A x4  2B x1.5  rest x2  1C x1"]})
        const steps = Array.from({length: 16}, (_, step) => ({position: step * 240, duration: 240}))
        expect(f.regions()).toEqual([
            {position: 0, duration: 4 * cycle, loopOffset: 0, loopDuration: cycle, label: "Intro A",
                notes: steps.map(step => ({...step, pitch: 0}))},
            {position: 4 * cycle, duration: 1.5 * cycle, loopOffset: 0, loopDuration: cycle, label: "Scene 2 B",
                notes: steps.map(step => ({...step, pitch: 5}))},
            {position: 7.5 * cycle, duration: cycle, loopOffset: 0, loopDuration: cycle, label: "Intro C",
                notes: steps.map(step => ({...step, pitch: 2}))}
        ])
        expect(f.read().song).toEqual({on: true, from: 1, entries: [
            {scene: 1, variation: "A", cycles: 4}, {scene: 2, variation: "B", cycles: 1.5}, {rest: true, cycles: 2},
            {scene: 1, variation: "C", cycles: 1}]})
        expect(f.count(NoteEventCollectionBox)).toBe(3)
        expect(f.count(NoteEventBox)).toBe(48)
    })

    it("starts the first entry at the song step from", () => {
        const f = fixture()
        f.song([{scene: 1, cycles: 2}], {from: 3})
        expect(f.regions()[0].position).toBe(2 * 240)
        expect(f.read().song).toEqual({on: true, from: 3, entries: [{scene: 1, variation: "A", cycles: 2}]})
    })

    it("makes the Notes track after the unit's existing tracks when it has none", () => {
        const f = fixture()
        f.edit(() => TrackBox.create(f.graph, UUID.generate(), box => {
            box.type.setValue(TrackType.Audio)
            box.index.setValue(0)
            box.target.refer(f.unit)
            box.tracks.refer(f.unit.tracks)
        }))
        f.song([{scene: 1}])
        const made = f.tracks().filter(track => track.type.getValue() === TrackType.Notes)
        expect(made.length).toBe(1)
        expect(made[0].index.getValue()).toBe(1)
        expect(made[0].target.targetVertex.unwrap().box).toBe(f.unit)
        f.song([{scene: 1, cycles: 2}])
        expect(f.tracks().length).toBe(2)
        expect(f.regions().length).toBe(1)
    })

    it("writes to the first Notes track, the one with the lowest index", () => {
        const f = fixture()
        f.edit(() => [3, 2].forEach(index => TrackBox.create(f.graph, UUID.generate(), box => {
            box.type.setValue(TrackType.Notes)
            box.index.setValue(index)
            box.target.refer(f.unit)
            box.tracks.refer(f.unit.tracks)
        })))
        f.song([{scene: 1}])
        const owner = f.tracks().filter(track => track.regions.pointerHub.incoming().length > 0)
        expect(owner.map(track => track.index.getValue())).toEqual([2])
    })

    it("lets fractions of a cycle meet on the same pulse, so no gap reads back as a rest", () => {
        const f = fixture()
        f.song(Array.from({length: 4}, () => ({scene: 1, cycles: 0.33})))
        const regions = f.regions()
        regions.slice(1).forEach((region, index) =>
            expect(region.position).toBe(regions[index].position + regions[index].duration))
        const entries = f.read().song.entries
        expect(entries.map(entry => "rest" in entry)).toEqual([false, false, false, false])
        entries.forEach(entry => expect(entry.cycles).toBeCloseTo(0.33, 3))
    })

    it("replaces the old scene regions and leaves no orphan collection or note", () => {
        const f = fixture()
        f.scenes(2)
        f.song([{scene: 1}, {scene: 2}, {scene: 1, variation: "B"}])
        expect(f.count(NoteRegionBox)).toBe(3)
        f.song([{scene: 2, cycles: 2}])
        expect(f.count(NoteRegionBox)).toBe(1)
        expect(f.count(NoteEventCollectionBox)).toBe(1)
        expect(f.count(NoteEventBox)).toBe(16)
        f.song([])
        expect(f.count(NoteRegionBox)).toBe(0)
        expect(f.count(NoteEventCollectionBox)).toBe(0)
        expect(f.count(NoteEventBox)).toBe(0)
        expect(f.read().song).toEqual({on: true, from: 1, entries: []})
    })

    it("leaves a region that is not a scene region alone", () => {
        const f = fixture()
        f.song([{scene: 1}])
        const track = f.tracks()[0]
        f.edit(() => {
            const collection = NoteEventCollectionBox.create(f.graph, UUID.generate())
            NoteEventBox.create(f.graph, UUID.generate(), box => {
                box.events.refer(collection.events)
                box.pitch.setValue(70) // not a scene note
            })
            NoteRegionBox.create(f.graph, UUID.generate(), box => {
                box.position.setValue(100_000)
                box.duration.setValue(960)
                box.loopDuration.setValue(960)
                box.regions.refer(track.regions)
                box.events.refer(collection.owners)
            })
            // a region whose collection has no note at all
            const empty = NoteEventCollectionBox.create(f.graph, UUID.generate())
            NoteRegionBox.create(f.graph, UUID.generate(), box => {
                box.position.setValue(200_000)
                box.duration.setValue(960)
                box.loopDuration.setValue(960)
                box.regions.refer(track.regions)
                box.events.refer(empty.owners)
            })
        })
        expect(f.regions().length).toBe(1)
        f.song([{scene: 1, cycles: 3}])
        f.ok({op: "setSong", entries: []})
        expect(f.count(NoteRegionBox)).toBe(2)
        expect(f.count(NoteEventCollectionBox)).toBe(2)
        expect(f.count(NoteEventBox)).toBe(1)
    })

    describe("the on rules", () => {
        it("sets only the switch with on alone", () => {
            const f = fixture()
            f.song([{scene: 1}], {on: false})
            expect(f.read().song.on).toBe(false)
            f.ok({op: "setSong", on: true})
            expect(f.read().song).toEqual({on: true, from: 1, entries: [{scene: 1, variation: "A", cycles: 1}]})
            expect(f.ok({op: "setSong", on: false})[0]).toEqual({ok: true, op: "setSong",
                lines: ["song off  from 1  1A x1"]})
            expect(f.count(NoteRegionBox)).toBe(1)
        })

        it("keeps the switch off when on: false comes with entries, and leaves it as it is without entries", () => {
            const f = fixture()
            f.song([{scene: 1}, {scene: 1}], {on: false})
            expect(f.read().song.on).toBe(false)
            f.ok({op: "setSong", entries: []})
            expect(f.read().song.on).toBe(false)
            f.ok({op: "setSong", on: true})
            f.ok({op: "setSong", entries: []})
            expect(f.read().song).toEqual({on: true, from: 1, entries: []})
        })

        it("turns the switch on for entries without on, also when they are only rests", () => {
            const f = fixture()
            f.ok({op: "setSong", entries: [{rest: true}]})
            expect(f.read().song).toEqual({on: true, from: 1, entries: []})
            expect(f.count(NoteRegionBox)).toBe(0)
        })

        it("refuses neither on nor entries", () => {
            const f = fixture()
            expect(refused(f, {op: "setSong"})).toContain("neither on nor entries")
        })
    })

    describe("refusing entries", () => {
        it.each<[string, PulseGridSongEntryInput, RegExp]>([
            ["a scene that does not exist", {scene: 2}, /entry 2: scene 2 .*1\.\.1/],
            ["no cycles", {scene: 1, cycles: 0}, /entry 2: cycles 0 .*above 0 up to 4096/],
            ["too many cycles", {scene: 1, cycles: 4097}, /cycles 4097/],
            ["a variation that is not A to D", {scene: 1, variation: "E" as PulseGridVariation}, /variation E .*A, B, C or D/],
            ["a rest with a scene", {rest: true, scene: 1} as PulseGridSongEntryInput, /rest true .*no scene/]
        ])("writes nothing for %s", (_name, entry, error) => {
            const f = fixture()
            f.song([{scene: 1}])
            expect(refused(f, {op: "setSong", entries: [{scene: 1}, entry]})).toMatch(error)
        })

        it("refuses more than 256 entries and a song beyond the 32 bit pulses", () => {
            const f = fixture()
            expect(refused(f, {op: "setSong", entries: Array.from({length: 257}, () => ({scene: 1}))}))
                .toMatch(/entries 257 .*0 to 256/)
            expect(refused(f, {op: "setSong", entries: Array.from({length: 256}, () => ({scene: 1, cycles: 4096}))}))
                .toMatch(/pulse \d+ .*2147483647/)
            expect(refused(f, {op: "setSong", entries: [{scene: 1}], from: 0})).toMatch(/from 0 /)
        })
    })

    describe("addToSong", () => {
        it("appends after the last scene region and leaves the switch", () => {
            const f = fixture()
            f.scenes(2)
            f.song([{scene: 1, cycles: 2}, {scene: 1, variation: "B", cycles: 0.5}], {on: false})
            const [result] = f.ok({op: "addToSong", scene: 2, variation: "C", cycles: 3})
            expect(result).toEqual({ok: true, op: "addToSong", lines: ["song off  from 1  1A x2  1B x0.5  2C x3"]})
            expect(f.regions()[2]).toMatchObject({position: 2.5 * cycle, duration: 3 * cycle, label: "Scene 2 C"})
            expect(f.regions()[2].notes.every(n => n.pitch === 6)).toBe(true)
            f.ok({op: "setSong", on: true})
            f.ok({op: "addToSong", scene: 1})
            expect(f.read().song.on).toBe(true)
            expect(f.read().song.entries.length).toBe(4)
        })

        it("starts at step 1 and makes the track when there is no scene region", () => {
            const f = fixture()
            f.ok({op: "addToSong", scene: 1})
            expect(f.tracks().length).toBe(1)
            expect(f.regions()[0]).toMatchObject({position: 0, duration: cycle, label: "Scene 1 A"})
            expect(f.read().song).toEqual({on: false, from: 1, entries: [{scene: 1, variation: "A", cycles: 1}]})
        })

        it("refuses a scene that does not exist and a rest, writing nothing", () => {
            const f = fixture()
            expect(refused(f, {op: "addToSong", scene: 3})).toMatch(/scene 3 .*1\.\.1/)
            expect(refused(f, {op: "addToSong", scene: 1, cycles: -1})).toContain("cycles -1")
        })
    })

    describe("reading what was moved or stretched by hand", () => {
        const handmade = () => {
            const f = fixture()
            f.scenes(2)
            f.song([{scene: 1, cycles: 2}, {scene: 2, variation: "B", cycles: 1}])
            const [first, second] = PulseGridSongRegions.sceneRegions(f.device())
            return {f, first: first.region, second: second.region}
        }

        it("reads a gap as a rest and a stretched region as more cycles", () => {
            const {f, first, second} = handmade()
            f.edit(() => {
                second.position.setValue(2 * cycle + 2 * cycle) // two cycles later
                first.duration.setValue(1.5 * cycle)
            })
            expect(f.read().song.entries).toEqual([{scene: 1, variation: "A", cycles: 1.5},
                {rest: true, cycles: 2.5}, {scene: 2, variation: "B", cycles: 1}])
        })

        it("reads fractional cycles rounded to four decimals", () => {
            const {f, first} = handmade()
            f.edit(() => first.duration.setValue(Math.round(cycle * 1.33333)))
            expect(f.read().song.entries[0]).toEqual({scene: 1, variation: "A", cycles: 1.3333})
        })

        it("ends the earlier entry where the next region starts, and reads from", () => {
            const {f, first, second} = handmade()
            f.edit(() => {
                first.position.setValue(2 * 240)
                second.position.setValue(cycle + 2 * 240)
            })
            expect(f.read().song).toEqual({on: true, from: 3, entries: [{scene: 1, variation: "A", cycles: 1},
                {scene: 2, variation: "B", cycles: 1}]})
        })

        it("reads a region cut short as a shorter entry", () => {
            const {f, second} = handmade()
            f.edit(() => second.duration.setValue(cycle / 2))
            expect(f.read().song.entries[1]).toEqual({scene: 2, variation: "B", cycles: 0.5})
        })
    })

    describe("with scene ops", () => {
        const three = () => {
            const f = fixture()
            f.scenes(3)
            f.ok({op: "nameScene", scene: 1, name: "One"}, {op: "nameScene", scene: 3, name: "Three"})
            f.song([{scene: 1}, {scene: 2, variation: "B"}, {scene: 3}])
            return f
        }
        const picture = (f: ReturnType<typeof fixture>) => f.regions().map(r => [r.label, r.notes[0].pitch, r.notes[15].pitch])

        it("renumbers the scene notes and relabels the regions when a scene moves", () => {
            const f = three()
            const [result] = f.ok({op: "moveScene", scene: 1, to: 3})
            expect(result).toMatchObject({lines: [expect.any(String), "playing scene 3 A", "song on  from 1  3A x1  1B x1  2A x1"]})
            expect(picture(f)).toEqual([["One A", 8, 8], ["Scene 1 B", 1, 1], ["Three A", 4, 4]])
            expect(f.count(NoteEventCollectionBox)).toBe(3)
        })

        it("renumbers the scene notes when a scene is removed, and drops that scene's regions", () => {
            const f = three()
            f.ok({op: "removeScene", scene: 2})
            expect(picture(f)).toEqual([["One A", 0, 0], ["Three A", 4, 4]])
            expect(f.read().song.entries).toEqual([{scene: 1, variation: "A", cycles: 1}, {rest: true, cycles: 1},
                {scene: 2, variation: "A", cycles: 1}])
            expect(f.count(NoteRegionBox)).toBe(2)
            expect(f.count(NoteEventCollectionBox)).toBe(2)
            expect(f.count(NoteEventBox)).toBe(32)
            f.ok({op: "removeScene", scene: 1})
            expect(picture(f)).toEqual([["Three A", 0, 0]])
        })

        it("renumbers a collection two regions share once", () => {
            const f = fixture()
            f.scenes(2)
            f.song([{scene: 2}])
            const [only] = PulseGridSongRegions.sceneRegions(f.device())
            f.edit(() => NoteRegionBox.create(f.graph, UUID.generate(), box => {
                box.position.setValue(10 * cycle)
                box.duration.setValue(cycle)
                box.loopDuration.setValue(cycle)
                box.regions.refer(f.tracks()[0].regions)
                box.events.refer(only.collection.owners)
            }))
            expect(f.count(NoteEventCollectionBox)).toBe(1)
            f.ok({op: "moveScene", scene: 2, to: 1})
            expect(f.regions().map(r => r.notes.map(n => n.pitch))).toEqual([Array(16).fill(0), Array(16).fill(0)])
        })

        it("relabels the regions of a scene that is named", () => {
            const f = three()
            f.ok({op: "nameScene", scene: 2, name: "Drop"})
            expect(f.regions().map(r => r.label)).toEqual(["One A", "Drop B", "Three A"])
            f.ok({op: "nameScene", scene: 2, name: ""})
            expect(f.regions().map(r => r.label)).toEqual(["One A", "Scene 2 B", "Three A"])
        })
    })

    describe("in text", () => {
        const text = "song on  from 1  1A x4  2A x4  rest x2  2B x1.5"

        it("writes the song line after the scenes line, only when on or with entries", () => {
            const f = fixture()
            f.scenes(2)
            f.ok({op: "nameScene", scene: 2, name: "Drop"})
            expect(PulseGridText.toText(f.read())).not.toContain("song")
            f.song([{scene: 1, cycles: 4}, {scene: 2, cycles: 4}, {rest: true, cycles: 2}, {scene: 2, variation: "B", cycles: 1.5}])
            const lines = PulseGridText.toText(f.read()).split("\n")
            expect(lines[3]).toMatch(/^scenes /)
            expect(lines[4]).toBe(text)
            f.ok({op: "setSong", on: false})
            expect(PulseGridText.toText(f.read()).split("\n")[4]).toBe(text.replace("song on", "song off"))
            f.ok({op: "setSong", entries: []})
            expect(PulseGridText.toText(f.read())).not.toContain("song")
            f.ok({op: "setSong", on: true})
            expect(PulseGridText.toText(f.read()).split("\n")[4]).toBe("song on")
        })

        it("reads back to the same song", () => {
            const f = fixture()
            f.scenes(2)
            f.ok({op: "nameScene", scene: 1, name: "Intro"}, {op: "nameScene", scene: 2, name: "Drop"})
            f.seed(1, [1, 5]); f.seed(2, [3])
            f.song([{scene: 1, cycles: 4}, {scene: 2, cycles: 4}, {rest: true, cycles: 2}, {scene: 2, variation: "B", cycles: 1.5}],
                {from: 2})
            const written = PulseGridText.toText(f.read())
            const parsed = PulseGridText.parseText(written)
            expect(parsed.errors).toEqual([])
            expect(parsed.ops.at(-1)).toEqual({op: "setSong", on: true, from: 2, entries: [
                {scene: 1, variation: "A", cycles: 4}, {scene: 2, variation: "A", cycles: 4}, {rest: true, cycles: 2},
                {scene: 2, variation: "B", cycles: 1.5}]})
            // a PulseGrid with none of it: the song line comes last, so its scenes exist by then
            const g = fixture()
            g.ok(...parsed.ops)
            expect(g.read().song).toEqual(f.read().song)
            expect(PulseGridText.toText(g.read())).toBe(written)
            expect(g.regions()).toEqual(f.regions())
        })

        it("reads song on and song off alone as the switch only", () => {
            expect(PulseGridText.parseText("song off")).toEqual({ops: [{op: "setSong", on: false}], errors: []})
            expect(PulseGridText.parseText("song on")).toEqual({ops: [{op: "setSong", on: true}], errors: []})
            const f = fixture()
            f.song([{scene: 1, cycles: 2}])
            f.ok(...PulseGridText.parseText("song off").ops)
            expect(f.read().song).toEqual({on: false, from: 1, entries: [{scene: 1, variation: "A", cycles: 2}]})
        })

        it("refuses a song line it cannot read, with its line number", () => {
            expect(PulseGridText.parseText("song on  1A").errors[0]).toMatch(/^line 1: song entries 1A /)
            expect(PulseGridText.parseText("song on  1A y2").errors[0]).toMatch(/^line 1: cycles y2 /)
            expect(PulseGridText.parseText("song on  from x").errors[0]).toMatch(/^line 1: from x /)
            expect(PulseGridText.parseText("song on  9Z x1").errors[0]).toMatch(/^line 1: song entry 9Z /)
        })

        it("still reads a lane called song on as a pattern line under a scene heading", () => {
            const parsed = PulseGridText.parseText("scene 1 A\n  song on |x--- x--- x--- x---|")
            expect(parsed.errors).toEqual([])
            expect(parsed.ops).toEqual([expect.objectContaining({op: "setPatternText", lane: "song on"})])
        })
    })

    it("is one undo step for a batch that holds setSong, and undo restores the regions", () => {
        const f = fixture()
        const editing = new BoxEditing(f.graph)
        f.scenes(2)
        expect(PulseGridOps.run(editing, f.composite, [{op: "setSong", entries: [{scene: 1, cycles: 2}, {scene: 2}]}])
            .every(result => result.ok)).toBe(true)
        const before = f.read()
        const regions = f.regions()
        const boxes = f.graph.boxes().length
        const results = PulseGridOps.run(editing, f.composite, [
            {op: "nameScene", scene: 1, name: "Intro"},
            {op: "setSong", entries: [{scene: 2, cycles: 4}]},
            {op: "addToSong", scene: 1}
        ])
        expect(results.every(result => result.ok)).toBe(true)
        expect(f.regions().length).toBe(2)
        expect(editing.undo()).toBe(true)
        expect(f.read()).toEqual(before)
        expect(f.regions()).toEqual(regions)
        expect(f.graph.boxes().length).toBe(boxes)
        expect(editing.redo()).toBe(true)
        expect(f.regions().length).toBe(2)
    })
})
