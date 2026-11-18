import {Box, Field} from "@opendaw/lib-box"
import {int, Optional, UUID} from "@opendaw/lib-std"
import {
    DeviceBoxUtils, Devices, PulseGridDevice, PulseGridDocs, PulseGridLane, PulseGridParamDoc, PulseGridParamField
} from "@opendaw/studio-adapters"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridMapping, PulseGridPanelLogic} from "./PulseGridPanelLogic"

// Where the instrument panel finds SoleanDaw's own parameter adapters, for the mapping from a knob to a value and
// the text it prints (the same ones the device editors use). Reading only: the panel writes through ops.
export namespace PulseGridPanelParams {
    export const laneOf = (context: PulseGridContext, id: string): Optional<PulseGridLane> =>
        PulseGridDevice.find(context.composite).unwrapOrNull()?.lanes
            .find(({device}) => UUID.toString(device.address.uuid) === id)

    // the box of the lane's instrument (`effect` left out) or of its effect `effect` (from 1, in chain order)
    export const boxOf = (lane: PulseGridLane, effect: Optional<int>): Optional<Box> => {
        if (effect === undefined) {return lane.instrument.unwrapOrNull() ?? undefined}
        return lane.cell.audioEffects.pointerHub.incoming().map(({box}) => box)
            .sort((a, b) => DeviceBoxUtils.lookupIndexField(a).getValue() - DeviceBoxUtils.lookupIndexField(b).getValue())[effect - 1]
    }

    // The mapping of one parameter. An adapter exists once something has asked for its device's adapter, so the
    // panel asks; the parameter registers itself with the project when the adapter is made.
    export const mappingOf = (context: PulseGridContext, laneId: string, effect: Optional<int>,
                              param: PulseGridParamDoc): PulseGridMapping => {
        const box = (() => {
            const lane = laneOf(context, laneId)
            return lane === undefined ? undefined : boxOf(lane, effect)
        })()
        const field: Optional<Field> = box === undefined ? undefined : Reflect.get(box, param.name)
        if (box === undefined || field === undefined || !("address" in field)) {return PulseGridPanelLogic.fallback(param)}
        const {boxAdapters, parameterFieldAdapters} = context.service.project
        boxAdapters.adapterFor(box, Devices.isAny)
        const scale = PulseGridDocs.percentScale(field as PulseGridParamField)
        return PulseGridPanelLogic.mapping(param, parameterFieldAdapters.opt(field.address).unwrapOrNull() ?? undefined, scale)
    }
}
