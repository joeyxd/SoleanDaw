import {Procedure} from "@opendaw/lib-std"
import {MenuItem} from "@opendaw/studio-core"
import {PulseGridSample} from "@opendaw/studio-adapters"
import {OpenSampleAPI} from "@/opendaw-api"
import {PulseGridLaneLogic, PulseGridSoundFolder} from "./PulseGridLaneLogic"

type Library =
    | {status: "idle"}
    | {status: "loading"}
    | {status: "ready", folder: PulseGridSoundFolder}
    | {status: "failed"}

// The drum one-shots of the openDAW library, fetched once. Both menus that offer a sound read from here.
export namespace PulseGridSounds {
    let library: Library = {status: "idle"}

    export const load = (): void => {
        if (library.status !== "idle") {return}
        library = {status: "loading"}
        OpenSampleAPI.get().tree().then(index => {
            const folder = PulseGridLaneLogic.oneShots(index.folders)
            library = folder === undefined ? {status: "failed"} : {status: "ready", folder}
        }, () => {library = {status: "failed"}})
    }

    const entries = (folder: PulseGridSoundFolder, pick: Procedure<PulseGridSample>): Array<MenuItem> => [
        ...(folder.folders ?? []).map(sub => MenuItem.default({label: sub.name})
            .addMenuItem(...entries(sub, pick))),
        ...(folder.samples ?? []).map(({uuid, name, duration}) => MenuItem.default({label: name})
            .setTriggerProcedure(() => pick({uuid, name, duration})))
    ]

    // The folders of the library with their samples as menu items, or one disabled line saying why not.
    export const menuItems = (pick: Procedure<PulseGridSample>): Array<MenuItem> => {
        load()
        if (library.status === "ready") {return entries(library.folder, pick)}
        return [MenuItem.default({
            label: library.status === "failed" ? "Sounds are not available" : "Loading sounds…",
            selectable: false
        })]
    }
}
