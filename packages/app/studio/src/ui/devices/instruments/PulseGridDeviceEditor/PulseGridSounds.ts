import {Procedure, Terminable} from "@opendaw/lib-std"
import {MenuItem} from "@opendaw/studio-core"
import {
    PulseGridCartridge, PulseGridCatalog, PulseGridCatalogItem, PulseGridDrums, PulseGridKit, PulseGridKits, PulseGridSample
} from "@opendaw/studio-adapters"
import {OpenSampleAPI} from "@/opendaw-api"
import {TubularCartridges} from "../TubularDeviceEditor/TubularCartridges"
import {PulseGridLaneLogic, PulseGridSoundFolder} from "./PulseGridLaneLogic"

type Library =
    | {status: "idle"}
    | {status: "loading"}
    | {status: "ready", folder: PulseGridSoundFolder}
    | {status: "blocked"} // the library's server is up but does not let this site read it
    | {status: "failed"}

type Voices =
    | {status: "idle"}
    | {status: "loading"}
    | {status: "ready", cartridges: ReadonlyArray<PulseGridCartridge>}
    | {status: "failed"}

// What the browser can list now: the built-in drums always, then what has arrived. `blocked`: openDAW's sample
// library cannot be used on this site, so it will not come.
export type PulseGridSoundBook = {items: ReadonlyArray<PulseGridCatalogItem>, blocked: boolean}

// The sounds of the window: the built-in drums (always there), and, fetched once, the drum one-shots of the openDAW
// library and the Tubular DX7 cartridges.
// The Kit menu, the panel's "Change sound" menu and the sound browser read from here, and the ops the window and
// the agent inbox run ask it for the Tubular voices by name.
export namespace PulseGridSounds {
    let library: Library = {status: "idle"}
    let voiceBook: Voices = {status: "idle"}
    let book: PulseGridSoundBook | undefined
    const listeners = new Set<Procedure<void>>()

    const arrived = (): void => {
        book = undefined
        Array.from(listeners).forEach(listener => listener())
    }

    export const load = (): void => {
        if (library.status === "idle") {
            library = {status: "loading"}
            try {
                OpenSampleAPI.get().tree().then(index => {
                    const folder = PulseGridLaneLogic.oneShots(index.folders)
                    library = OpenSampleAPI.get().notAllowed ? {status: "blocked"}
                        : folder === undefined ? {status: "failed"} : {status: "ready", folder}
                    arrived()
                }, () => {
                    library = {status: "failed"}
                    arrived()
                })
            } catch {
                library = {status: "failed"}
            }
        }
        if (voiceBook.status === "idle") {
            voiceBook = {status: "loading"}
            try {
                TubularCartridges.get().load().then(cartridges => {
                    voiceBook = {status: "ready", cartridges}
                    arrived()
                }, () => {
                    voiceBook = {status: "failed"}
                    arrived()
                })
            } catch {
                voiceBook = {status: "failed"}
            }
        }
    }

    // True when openDAW's sample library cannot be used on this site (known once the index attempt has ended).
    export const blocked = (): boolean => library.status === "blocked"

    // The kits to offer: the built-in ones always, the cloud kits only once the library has loaded in this tab.
    export const kits = (): ReadonlyArray<PulseGridKit> => {
        load()
        return PulseGridKits.All.filter(kit => kit.builtin === true || library.status === "ready")
    }

    // The Tubular cartridges for `PulseGridOpsEnv.voices`: empty until they have been fetched (or when they failed).
    export const voices = (): ReadonlyArray<PulseGridCartridge> =>
        voiceBook.status === "ready" ? voiceBook.cartridges : []

    // Told each time a source has arrived or failed.
    export const subscribe = (listener: Procedure<void>): Terminable => {
        listeners.add(listener)
        return {terminate: () => {listeners.delete(listener)}}
    }

    // The catalogue of what has arrived (the same list every time until the next source arrives).
    export const catalogue = (): PulseGridSoundBook => {
        load()
        if (book !== undefined) {return book}
        const folder = library.status === "ready" ? library.folder : undefined
        const cartridges = voiceBook.status === "ready" ? voiceBook.cartridges : undefined
        book = {items: PulseGridCatalog.items(folder, cartridges, true), blocked: library.status === "blocked"}
        return book
    }

    const entries = (folder: PulseGridSoundFolder, pick: Procedure<PulseGridSample>): Array<MenuItem> => [
        ...(folder.folders ?? []).map(sub => MenuItem.default({label: sub.name})
            .addMenuItem(...entries(sub, pick))),
        ...(folder.samples ?? []).map(({uuid, name, duration}) => MenuItem.default({label: name})
            .setTriggerProcedure(() => pick({uuid, name, duration})))
    ]

    // The built-in drums, a submenu for each kit.
    const builtIn = (pick: Procedure<PulseGridSample>): MenuItem => MenuItem.default({label: "PulseGrid drums"})
        .addMenuItem(...PulseGridDrums.Kits.map(kit => MenuItem.default({label: kit}).addMenuItem(
            ...PulseGridDrums.All.filter(drum => drum.kit === kit).map(({uuid, name, duration}) =>
                MenuItem.default({label: name}).setTriggerProcedure(() => pick({uuid, name, duration}))))))

    // The built-in drums, then the folders of the library with their samples as menu items, or one disabled line
    // saying why not (nothing when the library cannot be used on this site).
    export const menuItems = (pick: Procedure<PulseGridSample>): Array<MenuItem> => {
        load()
        if (library.status === "ready") {return [builtIn(pick), ...entries(library.folder, pick)]}
        if (library.status === "blocked") {return [builtIn(pick)]}
        return [builtIn(pick), MenuItem.default({
            label: library.status === "failed" ? "Sounds are not available" : "Loading sounds…",
            selectable: false
        })]
    }
}
