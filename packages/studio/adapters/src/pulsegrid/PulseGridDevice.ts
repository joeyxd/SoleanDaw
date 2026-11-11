import {Box} from "@opendaw/lib-box"
import {Option, UUID} from "@opendaw/lib-std"
import {InstrumentCompositeBox, InstrumentCompositeCellBox, PulseGridBox, PulseGridLaneDeviceBox} from "@opendaw/studio-boxes"
import {PulseGridError, PulseGridLaneRef} from "./PulseGridTypes"

export type PulseGridLane = {
    cell: InstrumentCompositeCellBox
    device: PulseGridLaneDeviceBox
    instrument: Option<Box>
}

export type PulseGridDevice = {
    composite: InstrumentCompositeBox
    head: PulseGridBox
    lanes: ReadonlyArray<PulseGridLane>
}

export namespace PulseGridDevice {
    export const find = (composite: InstrumentCompositeBox): Option<PulseGridDevice> => {
        const cells = composite.cells.pointerHub.incoming().map(({box}) => box)
            .filter((box): box is InstrumentCompositeCellBox => box instanceof InstrumentCompositeCellBox)
            .sort((a, b) => a.index.getValue() - b.index.getValue())
        const candidates: Array<PulseGridLane> = cells.flatMap(cell => {
            const device = cell.midiEffects.pointerHub.incoming().map(({box}) => box)
                .filter((box): box is PulseGridLaneDeviceBox => box instanceof PulseGridLaneDeviceBox)
                .sort((a, b) => a.index.getValue() - b.index.getValue())[0]
            return device === undefined ? [] : [{
                cell, device, instrument: Option.wrap(cell.instrument.pointerHub.incoming().at(0)?.box)
            }]
        })
        const head = candidates[0]?.device.grid.targetVertex.unwrapOrUndefined()?.box
        if (!(head instanceof PulseGridBox)) {return Option.None}
        const lanes = candidates.filter(({device}) => device.grid.targetVertex.contains(head))
        return Option.wrap({composite, head, lanes})
    }

    export const lane = (device: PulseGridDevice, ref: PulseGridLaneRef): PulseGridLane => {
        if (typeof ref === "number") {
            if (Number.isInteger(ref) && ref >= 1 && ref <= device.lanes.length) {return device.lanes[ref - 1]}
        } else {
            const byId = device.lanes.find(({device}) => UUID.toString(device.address.uuid) === ref)
            if (byId !== undefined) {return byId}
            const byName = device.lanes.filter(({device}) => device.label.getValue().toLowerCase() === ref.toLowerCase())
            if (byName.length === 1) {return byName[0]}
            if (byName.length > 1) {
                throw new PulseGridError(`Two or more lanes have the name "${ref}"; use the position (1..${device.lanes.length})`)
            }
        }
        const names = device.lanes.map(({device}) => device.label.getValue()).join(", ")
        throw new PulseGridError(`No such lane "${ref}"; allowed lanes (1..${device.lanes.length}): ${names}`)
    }
}
