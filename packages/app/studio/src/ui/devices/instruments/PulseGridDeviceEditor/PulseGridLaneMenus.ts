import {int} from "@opendaw/lib-std"
import {MenuItem} from "@opendaw/studio-core"
import {PulseGridActions, PulseGridLaneDoc, PulseGridStep} from "@opendaw/studio-adapters"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridSounds} from "./PulseGridSounds"

const Velocities: ReadonlyArray<readonly [string, int]> = [["Soft", 45], ["Medium", 80], ["Full", 100], ["Hard", 127]]
const Chances: ReadonlyArray<int> = [100, 75, 50, 25]

export namespace PulseGridLaneMenus {
    // The right-click menu of a lit step: groups of items, a separator between groups.
    export const step = (context: PulseGridContext, lane: PulseGridLaneDoc, step: int,
                         value: PulseGridStep): ReadonlyArray<ReadonlyArray<MenuItem>> => [[
        MenuItem.default({label: "Accent", checked: value.accent})
            .setTriggerProcedure(() => context.send(
                PulseGridActions.setStepValues(lane.id, step, {accent: !value.accent}))),
        MenuItem.default({label: "Velocity"}).addMenuItem(...Velocities.map(([label, velocity]) =>
            MenuItem.default({label: `${label} ${velocity}`, checked: value.velocity === velocity})
                .setTriggerProcedure(() => context.send(PulseGridActions.setStepValues(lane.id, step, {velocity}))))),
        MenuItem.default({label: "Chance"}).addMenuItem(...Chances.map(chance =>
            MenuItem.default({label: `${chance}`, checked: value.chance === chance})
                .setTriggerProcedure(() => context.send(PulseGridActions.setStepValues(lane.id, step, {chance}))))),
    ], [
        MenuItem.default({label: "Remove"})
            .setTriggerProcedure(() => context.send(PulseGridActions.setStep(lane.id, step, false)))
    ]]

    // The right-click menu of a lane head. `rename` asks for the new name where the pointer is.
    export const lane = (context: PulseGridContext, lane: PulseGridLaneDoc,
                         rename: () => void): ReadonlyArray<ReadonlyArray<MenuItem>> => [[
        MenuItem.default({label: "Rename"}).setTriggerProcedure(rename),
        ...(lane.sound?.instrument === "Nano" ? [
            MenuItem.default({label: "Change sound"}).setRuntimeChildrenProcedure(parent => parent
                .addMenuItem(...PulseGridSounds.menuItems(sample =>
                    context.send(PulseGridActions.setLaneSound(lane.id, sample)))))
        ] : [])
    ], [
        MenuItem.default({label: "Clear pattern"})
            .setTriggerProcedure(() => context.send(PulseGridActions.clearLane(lane.id))),
        MenuItem.default({label: "Shift left"})
            .setTriggerProcedure(() => context.send(PulseGridActions.shiftLane(lane.id, -1))),
        MenuItem.default({label: "Shift right"})
            .setTriggerProcedure(() => context.send(PulseGridActions.shiftLane(lane.id, 1)))
    ], [
        MenuItem.default({label: "Remove lane", selectable: context.doc.getValue().lanes.length > 1})
            .setTriggerProcedure(() => context.send(PulseGridActions.removeLane(lane.id)))
    ]]
}
