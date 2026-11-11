import {describe, expect, it} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {
    AudioUnitBox, InstrumentCompositeBox, InstrumentCompositeCellBox, PulseGridBox, PulseGridLaneDeviceBox
} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {PulseGridRequests} from "./PulseGridRequests"

const fixture = () => {
    const {boxGraph: graph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} =
        ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    const editing = new BoxEditing(graph)
    const grid = (name: string, lanes: ReadonlyArray<string>, index: number) => {
        const unit = AudioUnitBox.create(graph, UUID.generate(), box => {
            box.collection.refer(rootBox.audioUnits)
            box.output.refer(primaryAudioBusBox.input)
            box.index.setValue(index)
        })
        const composite = InstrumentCompositeBox.create(graph, UUID.generate(), box => {
            box.host.refer(unit.input)
            box.label.setValue(name)
        })
        const head = PulseGridBox.create(graph, UUID.generate())
        lanes.forEach((label, cellIndex) => {
            const cell = InstrumentCompositeCellBox.create(graph, UUID.generate(), box => {
                box.composite.refer(composite.cells)
                box.index.setValue(cellIndex)
            })
            PulseGridLaneDeviceBox.create(graph, UUID.generate(), box => {
                box.host.refer(cell.midiEffects)
                box.grid.refer(head)
                box.index.setValue(0)
                box.label.setValue(label)
            })
        })
        return {id: UUID.toString(unit.address.uuid), composite}
    }
    graph.beginTransaction()
    const drums = grid("Drums", ["kick", "hat"], 1)
    // a composite without lane devices is not a PulseGrid
    const plainUnit = AudioUnitBox.create(graph, UUID.generate(), box => {
        box.collection.refer(rootBox.audioUnits)
        box.output.refer(primaryAudioBusBox.input)
        box.index.setValue(2)
    })
    InstrumentCompositeBox.create(graph, UUID.generate(), box => box.host.refer(plainUnit.input))
    graph.endTransaction()
    const handle = (request: unknown) => PulseGridRequests.handle(graph, editing, request)
    const read = () => {
        const answer = handle({read: true})
        if (!answer.ok || !("text" in answer)) {throw new Error(JSON.stringify(answer))}
        return answer.text
    }
    const addGrid = (name: string) => {
        graph.beginTransaction()
        const added = grid(name, ["kick"], 3)
        graph.endTransaction()
        return added
    }
    return {graph, editing, drums, handle, read, addGrid}
}

describe("PulseGridRequests", () => {
    it("finds the PulseGrids that sit on a track, with the track's id and name", () => {
        const f = fixture()
        expect(PulseGridRequests.tracks(f.graph).map(({id, name}) => ({id, name})))
            .toEqual([{id: f.drums.id, name: "Drums"}])
    })

    it("reads the whole PulseGrid as text", () => {
        const f = fixture()
        const answer = f.handle({read: true})
        expect(answer).toMatchObject({ok: true, track: {id: f.drums.id, name: "Drums"}})
        expect("text" in answer && answer.text).toContain("kick")
        expect("text" in answer && answer.text).toContain("playing scene 1 A")
    })

    it("applies ops as one undo step and answers each op's new lines", () => {
        const f = fixture()
        const before = f.read()
        const answer = f.handle({ops: [
            {op: "setPatternText", lane: "kick", text: "|x--- x--- x--- x---|"},
            {op: "setSetting", key: "swing", value: 56}
        ]})
        expect(answer).toMatchObject({ok: true, track: {name: "Drums"}})
        expect("results" in answer && answer.results).toEqual([
            {ok: true, op: "setPatternText", lines: ["kick |x--- x--- x--- x---|"]},
            {ok: true, op: "setSetting", lines: [expect.stringContaining("swing 56")]}
        ])
        expect(f.editing.undo()).toBe(true)
        expect(f.read()).toEqual(before)
        expect(f.editing.canUndo()).toBe(false)
    })

    it("changes nothing and makes no undo step when any op is refused, and names that op", () => {
        const f = fixture()
        const before = f.read()
        const answer = f.handle({ops: [
            {op: "setStep", lane: "kick", step: 1},
            {op: "setStep", lane: "kick", step: 99}
        ]})
        expect(answer).toMatchObject({ok: false, op: 2, track: {name: "Drums"}})
        expect(!answer.ok && answer.error).toContain("99")
        expect(f.read()).toEqual(before)
        expect(f.editing.canUndo()).toBe(false)
    })

    it("applies text under a scene heading, and refuses text that does not parse with its line number", () => {
        const f = fixture()
        const answer = f.handle({text: "swing 60\nscene 1 B\n  hat |x-x- x-x- x-x- x-x-|"})
        expect(answer.ok).toBe(true)
        expect(f.read()).toContain("swing 60")
        expect(f.read()).toContain("scene 1 B")
        const bad = f.handle({text: "hat |x-x-|"})
        expect(bad).toMatchObject({ok: false})
        expect(!bad.ok && bad.error).toContain("line 1")
    })

    it.each([
        ["no kind", {}, "exactly one of read, ops or text"],
        ["two kinds", {read: true, text: "swing 60"}, "exactly one"],
        ["an unknown field", {read: true, author: "Max"}, "field author is not allowed"],
        ["empty ops", {ops: []}, "1 to 64"],
        ["too many ops", {ops: Array.from({length: 65}, () => ({op: "setStep", lane: 1, step: 1}))}, "1 to 64"],
        ["read false", {read: false}, "read is true"],
        ["a non-object", "read", "a request is an object"],
        ["an empty track", {track: "", read: true}, "track is a name or an id"]
    ])("refuses %s", (_, request, message) => {
        const answer = fixture().handle(request)
        expect(answer.ok).toBe(false)
        expect(!answer.ok && answer.error).toContain(message)
    })

    it("picks a PulseGrid by name in any case or by id, and asks for one when there are two", () => {
        const f = fixture()
        const bass = f.addGrid("Bass Grid")
        const ambiguous = f.handle({read: true})
        expect(!ambiguous.ok && ambiguous.error).toContain("name one with track")
        expect(f.handle({track: "bass grid", read: true})).toMatchObject({ok: true, track: {id: bass.id}})
        expect(f.handle({track: f.drums.id.toUpperCase(), read: true})).toMatchObject({ok: true, track: {name: "Drums"}})
        const unknown = f.handle({track: "Keys", read: true})
        expect(!unknown.ok && unknown.error).toContain("\"Drums\"")
    })
})
