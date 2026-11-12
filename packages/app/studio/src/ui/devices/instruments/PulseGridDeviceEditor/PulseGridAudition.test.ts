import {describe, expect, it, vi} from "vitest"
import {DefaultObservableValue, UUID} from "@opendaw/lib-std"
import {AudioUnitBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton, PulseGridDevice, PulseGridDocs, PulseGridFactory, PulseGridOps} from "@opendaw/studio-adapters"
import {PulseGridAudition} from "./PulseGridAudition"
import {PulseGridContext} from "./PulseGridContext"

const setup = () => {
    const {boxGraph: graph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} = ProjectSkeleton.empty({createDefaultUser: false})
    graph.beginTransaction()
    const unit = AudioUnitBox.create(graph, UUID.generate(), box => {
        box.collection.refer(rootBox.audioUnits)
        box.output.refer(primaryAudioBusBox.input)
    })
    const composite = PulseGridFactory.create(graph, unit.input, "Listen", [
        PulseGridFactory.DefaultKit[0], PulseGridFactory.DefaultKit[5]
    ])
    PulseGridOps.apply(composite, [
        {op: "setLane", lane: 1, pitch: 36},
        {op: "setNote", lane: 2, note: {step: 1, pitch: 60, velocity: 80}},
        {op: "setNote", lane: 2, note: {step: 1, pitch: 64, velocity: 90}}
    ])
    graph.endTransaction()
    const device = PulseGridDevice.find(composite).unwrap()
    const engine = {assertWorklet: vi.fn(), noteSignal: vi.fn()}
    const send = vi.fn()
    const context = {composite, service: {engine}, send,
        doc: new DefaultObservableValue(PulseGridDocs.read(device))} as unknown as PulseGridContext
    return {graph, device, context, engine, send}
}

describe("PulseGridAudition", () => {
    it("uses the cell address, lane tuning for drums, unit velocity and optional duration without edits", () => {
        const {graph, device, context, engine, send} = setup()
        const before = graph.boxes().map(box => Array.from(new Uint8Array(box.serialize())))
        const [drum, melody] = context.doc.getValue().lanes
        expect(PulseGridAudition.available(context)).toBe(true)
        PulseGridAudition.listen(context, drum.id, 72)
        PulseGridAudition.listen(context, melody.id, 72, 127, 480)
        expect(engine.noteSignal.mock.calls.map(([signal]) => signal)).toEqual([
            {type: "note-audition", uuid: device.lanes[0].cell.address.uuid, pitch: 36, velocity: 100 / 127, duration: 240},
            {type: "note-audition", uuid: device.lanes[1].cell.address.uuid, pitch: 72, velocity: 1, duration: 480}
        ])
        expect(send).not.toHaveBeenCalled()
        expect(graph.boxes().map(box => Array.from(new Uint8Array(box.serialize())))).toEqual(before)
    })

    it("plays every note of a step and uses the row only when the roll step is empty", () => {
        const {context, engine, send} = setup()
        const melody = context.doc.getValue().lanes[1]
        PulseGridAudition.step(context, melody.id, 1, 70)
        expect(engine.noteSignal.mock.calls.map(([signal]) => signal.pitch)).toEqual([60, 64])
        engine.noteSignal.mockClear()
        PulseGridAudition.step(context, melody.id, 2)
        expect(engine.noteSignal).not.toHaveBeenCalled()
        PulseGridAudition.step(context, melody.id, 2, 70)
        expect(engine.noteSignal).toHaveBeenCalledOnce()
        expect(engine.noteSignal.mock.calls[0][0].pitch).toBe(70)
        expect(send).not.toHaveBeenCalled()
    })

    it("is unavailable without a worklet and ignores removed lanes", () => {
        const {context, engine} = setup()
        PulseGridAudition.listen(context, "removed", 60)
        expect(engine.noteSignal).not.toHaveBeenCalled()
        engine.assertWorklet.mockImplementation(() => {throw new Error("No worklet")})
        expect(PulseGridAudition.available(context)).toBe(false)
        PulseGridAudition.listen(context, context.doc.getValue().lanes[0].id, 60)
        expect(engine.noteSignal).not.toHaveBeenCalled()
    })
})
