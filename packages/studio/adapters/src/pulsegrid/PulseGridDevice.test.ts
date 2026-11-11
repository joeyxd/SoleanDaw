import {describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {
    AudioUnitBox, InstrumentCompositeBox, InstrumentCompositeCellBox, PulseGridBox,
    PulseGridLaneDeviceBox, TubularDeviceBox, VelocityDeviceBox
} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {BoxAdapters} from "../BoxAdapters"
import {BoxAdaptersContext} from "../BoxAdaptersContext"
import {PulseGridLaneDeviceBoxAdapter} from "../devices/midi-effects/PulseGridLaneDeviceBoxAdapter"
import {PulseGridBoxAdapter} from "./PulseGridBoxAdapter"
import {PulseGridDevice} from "./PulseGridDevice"
import {PulseGridError} from "./PulseGridTypes"

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
    const addCell = (index: number) => InstrumentCompositeCellBox.create(graph, UUID.generate(), box => {
        box.composite.refer(composite.cells)
        box.index.setValue(index)
    })
    const addLane = (cell: InstrumentCompositeCellBox, name: string, grid = head) =>
        PulseGridLaneDeviceBox.create(graph, UUID.generate(), box => {
            box.host.refer(cell.midiEffects)
            box.index.setValue(0)
            box.grid.refer(grid)
            box.label.setValue(name)
        })
    return {graph, composite, head, addCell, addLane}
}

describe("PulseGridDevice", () => {
    it("orders cells by index, takes the first cell's head and excludes unrelated cells", () => {
        const {graph, composite, head, addCell, addLane} = fixture()
        const last = addCell(8)
        const first = addCell(2)
        const unrelated = addCell(4)
        const noLane = addCell(0)
        const instrument = TubularDeviceBox.create(graph, UUID.generate(), box => box.host.refer(first.instrument))
        TubularDeviceBox.create(graph, UUID.generate(), box => box.host.refer(noLane.instrument))
        VelocityDeviceBox.create(graph, UUID.generate(), box => {
            box.host.refer(first.midiEffects)
            box.index.setValue(1)
        })
        const later = addLane(last, "Hat")
        const earlier = addLane(first, "Kick")
        const otherHead = PulseGridBox.create(graph, UUID.generate())
        addLane(unrelated, "Other", otherHead)
        graph.endTransaction()
        const found = PulseGridDevice.find(composite).unwrap()
        expect(found.head).toBe(head)
        expect(found.composite).toBe(composite)
        expect(found.lanes.map(lane => lane.device)).toEqual([earlier, later])
        expect(found.lanes.map(lane => lane.cell)).toEqual([first, last])
        expect(found.lanes[0].instrument.unwrap()).toBe(instrument)
        expect(found.lanes[1].instrument.isEmpty()).toBe(true)
    })

    it("returns None for a composite without a lane device", () => {
        const {graph, composite, head, addCell} = fixture()
        const cell = addCell(0)
        TubularDeviceBox.create(graph, UUID.generate(), box => box.host.refer(cell.instrument))
        head.delete()
        graph.endTransaction()
        expect(PulseGridDevice.find(composite).isEmpty()).toBe(true)
    })

    it("resolves positions, case-insensitive names and ids; reports unknown and duplicate names", () => {
        const {graph, composite, addCell, addLane} = fixture()
        const kick = addLane(addCell(0), "Kick")
        const hat = addLane(addCell(1), "Hat")
        graph.endTransaction()
        const device = PulseGridDevice.find(composite).unwrap()
        expect(PulseGridDevice.lane(device, 1).device).toBe(kick)
        expect(PulseGridDevice.lane(device, "hAT").device).toBe(hat)
        expect(PulseGridDevice.lane(device, UUID.toString(kick.address.uuid)).device).toBe(kick)
        expect(() => PulseGridDevice.lane(device, "missing")).toThrow(PulseGridError)
        expect(() => PulseGridDevice.lane(device, "missing")).toThrow(/Kick, Hat/)
        for (const ref of [0, 3, 1.5]) {expect(() => PulseGridDevice.lane(device, ref)).toThrow(PulseGridError)}
        graph.beginTransaction()
        hat.label.setValue("KICK")
        graph.endTransaction()
        expect(() => PulseGridDevice.lane(device, "kick")).toThrow(PulseGridError)
        expect(() => PulseGridDevice.lane(device, "kick")).toThrow(/use the position/)
        expect(PulseGridDevice.lane(device, 2).device).toBe(hat)
        graph.beginTransaction()
        hat.label.setValue(UUID.toString(kick.address.uuid))
        graph.endTransaction()
        expect(PulseGridDevice.lane(device, UUID.toString(kick.address.uuid)).device).toBe(kick)
    })

    it("registers both adapters and observes shared-head pointer changes", () => {
        const {graph, head, addCell, addLane} = fixture()
        const lane = addLane(addCell(0), "Kick")
        graph.endTransaction()
        const context = {boxGraph: graph} as BoxAdaptersContext
        const adapters = new BoxAdapters(context)
        Object.assign(context, {boxAdapters: adapters})
        const adapter = adapters.adapterFor(lane, PulseGridLaneDeviceBoxAdapter)
        const headAdapter = adapters.adapterFor(head, PulseGridBoxAdapter.checkType)
        expect(adapters.adapterFor(head, PulseGridBoxAdapter)).toBe(headAdapter)
        expect(adapter.grid()).toBe(headAdapter)
        expect(adapter.box).toBe(lane)
        expect(adapter.address).toBe(lane.address)
        expect(adapter.uuid).toBe(lane.address.uuid)
        expect(headAdapter.address).toBe(head.address)
        expect(headAdapter.uuid).toBe(head.address.uuid)
        expect(adapter.indexField).toBe(lane.index)
        expect(adapter.labelField).toBe(lane.label)
        expect(adapter.enabledField).toBe(lane.enabled)
        expect(adapter.minimizedField).toBe(lane.minimized)
        expect(adapter.host).toBe(lane.host)
        const observed: Array<PulseGridBoxAdapter> = []
        const subscription = adapter.catchupAndSubscribeGrid(grid => observed.push(grid))
        expect(observed).toEqual([headAdapter])
        graph.beginTransaction()
        const next = PulseGridBox.create(graph, UUID.generate())
        lane.grid.refer(next)
        head.delete()
        graph.endTransaction()
        expect(observed.map(grid => grid.box)).toEqual([head, next])
        expect(adapter.grid().box).toBe(next)
        subscription.terminate()
        adapters.terminate()
    })
})
