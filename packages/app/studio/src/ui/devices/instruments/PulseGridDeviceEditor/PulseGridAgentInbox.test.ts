import {describe, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {
    AudioUnitBox, InstrumentCompositeBox, InstrumentCompositeCellBox, PulseGridBox, PulseGridLaneDeviceBox
} from "@opendaw/studio-boxes"
import {PulseGridDevice, PulseGridDocs, PulseGridRequests, ProjectSkeleton} from "@opendaw/studio-adapters"
import {PulseGridAgentInbox} from "./PulseGridAgentInbox"

const fixture = () => {
    const {boxGraph: graph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} =
        ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    const editing = new BoxEditing(graph)
    graph.beginTransaction()
    const unit = AudioUnitBox.create(graph, UUID.generate(), box => {
        box.collection.refer(rootBox.audioUnits)
        box.output.refer(primaryAudioBusBox.input)
        box.index.setValue(1)
    })
    const composite = InstrumentCompositeBox.create(graph, UUID.generate(), box => {
        box.host.refer(unit.input)
        box.label.setValue("Drums")
    })
    const head = PulseGridBox.create(graph, UUID.generate())
    ;["kick", "hat"].forEach((label, index) => {
        const cell = InstrumentCompositeCellBox.create(graph, UUID.generate(), box => {
            box.composite.refer(composite.cells)
            box.index.setValue(index)
        })
        PulseGridLaneDeviceBox.create(graph, UUID.generate(), box => {
            box.host.refer(cell.midiEffects)
            box.grid.refer(head)
            box.index.setValue(0)
            box.label.setValue(label)
        })
    })
    graph.endTransaction()
    const docs = () => PulseGridDocs.read(PulseGridDevice.find(composite).unwrap())
    const laneId = (name: string) => docs().lanes.find(lane => lane.name === name)?.id
    return {graph, editing, composite, docs, laneId}
}

describe("PulseGridAgentInbox.attempt", () => {
    it("answers ok for a change and reports exactly the lanes that changed", () => {
        const f = fixture()
        const hat = f.docs().lanes.find(lane => lane.name === "hat")
        const result = PulseGridAgentInbox.attempt(f.graph, f.editing,
            {ops: [{op: "setPatternText", lane: "hat", text: "|x-x- x-x- x-x- x-x-|"}]})
        expect(result.answer).toMatchObject({ok: true, track: {name: "Drums"}})
        expect(result.composite).toBe(f.composite)
        expect(result.changed).toEqual([hat?.id])
        expect(f.laneId("kick")).not.toBe(hat?.id)
    })

    it("changes nothing and answers ok false when the request is refused", () => {
        const f = fixture()
        const before = JSON.stringify(f.docs())
        const result = PulseGridAgentInbox.attempt(f.graph, f.editing, {ops: [{op: "setStep", lane: "kick", step: 99}]})
        expect(result.answer).toMatchObject({ok: false, track: {name: "Drums"}})
        expect(result.changed).toEqual([])
        expect(JSON.stringify(f.docs())).toBe(before)
        expect(f.editing.canUndo()).toBe(false)
    })

    it("changes nothing and flashes nothing on a read", () => {
        const f = fixture()
        const before = JSON.stringify(f.docs())
        const result = PulseGridAgentInbox.attempt(f.graph, f.editing, {read: true})
        expect(result.answer).toMatchObject({ok: true, text: expect.stringContaining("kick")})
        expect(result.changed).toEqual([])
        expect(JSON.stringify(f.docs())).toBe(before)
        expect(PulseGridRequests.tracks(f.graph)).toHaveLength(1)
    })

    it("turns an unexpected error into an answer that says the editor failed", () => {
        const f = fixture()
        const broken = {modify: () => {throw new Error("boom")}} as unknown as BoxEditing
        const log = vi.spyOn(console, "error").mockImplementation(() => {})
        const result = PulseGridAgentInbox.attempt(f.graph, broken, {ops: [{op: "setStep", lane: "kick", step: 1}]})
        expect(result.answer).toEqual({ok: false, error: "the editor failed: boom"})
        expect(result.changed).toEqual([])
        expect(log).toHaveBeenCalled()
        log.mockRestore()
    })
})
