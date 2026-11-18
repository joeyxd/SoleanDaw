import {Procedure, Terminable} from "@opendaw/lib-std"
import {MenuItem} from "@opendaw/studio-core"
import {PulseGridCartridge, PulseGridCatalog, PulseGridCatalogItem, PulseGridSample} from "@opendaw/studio-adapters"
import {OpenSampleAPI} from "@/opendaw-api"
import {TubularCartridges} from "../TubularDeviceEditor/TubularCartridges"
import {PulseGridLaneLogic, PulseGridSoundFolder} from "./PulseGridLaneLogic"

type Library =
    | {status: "idle"}
    | {status: "loading"}
    | {status: "ready", folder: PulseGridSoundFolder}
    | {status: "failed"}

type Voices =
    | {status: "idle"}
    | {status: "loading"}
    | {status: "ready", cartridges: ReadonlyArray<PulseGridCartridge>}
    | {status: "failed"}

// What the browser can list now: loading until one source has arrived, failed when none could be had.
export type PulseGridSoundBook =
    | {status: "loading" | "failed"}
    | {status: "ready", items: ReadonlyArray<PulseGridCatalogItem>}

// The sounds of the window, fetched once: the drum one-shots of the openDAW library and the Tubular DX7 cartridges.
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
                    library = folder === undefined ? {status: "failed"} : {status: "ready", folder}
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
        if (folder === undefined && cartridges === undefined) {
            return {status: library.status === "failed" && voiceBook.status === "failed" ? "failed" : "loading"}
        }
        book = {status: "ready", items: PulseGridCatalog.items(folder, cartridges)}
        return book
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
