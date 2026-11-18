import {Optional} from "@opendaw/lib-std"
import {PulseGridKits, PulseGridSample} from "./PulseGridKits"
import {PulseGridCartridge, PulseGridSoundInput} from "./PulseGridTypes"

// The sounds a lane can take, as one list of named sounds: the same names for the screen's browser and for agents
// (SPEC.md, section 11). Pure: the host hands in the sample folder and the cartridges it holds, nothing is fetched.

export type PulseGridCatalogCategory = "drums" | "bass" | "synths" | "mallets"
export type PulseGridCatalogTab = "all" | "drums" | "synths" | "mallets"
// The "One Shots" folder of the sample index.
export type PulseGridSampleFolder = {
    readonly name: string
    readonly folders?: ReadonlyArray<PulseGridSampleFolder>
    readonly samples?: ReadonlyArray<PulseGridSample>
}
export type PulseGridCatalogSource =
    | {type: "sample", sample: PulseGridSample}
    | {type: "voice", cartridge: string, voice: string, data: Uint8Array}
export type PulseGridCatalogItem = {
    id: string // "sample:<uuid>" or "voice:<cartridge>/<voice name as stored, trimmed>"
    name: string // the shown name
    category: PulseGridCatalogCategory
    folder: ReadonlyArray<string> // folder names from the category down, empty when directly in the category
    kind: "drum" | "melodic"
    source: PulseGridCatalogSource
}
// A voice's named row: the stored name in a cartridge, and how the catalogue shows it.
export type PulseGridNamedVoice = {
    voice: string, name: string, category: PulseGridCatalogCategory, cartridge: string
}

const Classics = "Tubular Classics"
const MoreVoices = "More FM voices"
const Categories: ReadonlyArray<PulseGridCatalogCategory> = ["drums", "bass", "synths", "mallets"]
const named = (voice: string, name: string, category: PulseGridCatalogCategory,
               cartridge: string = Classics): PulseGridNamedVoice => ({voice, name, category, cartridge})
// Case and the spaces around a name never matter when names are compared.
const key = (text: string): string => text.trim().toLowerCase()
const words = (text: string): Array<string> => key(text).split(/\s+/).filter(word => word !== "")
const isVoice = (item: PulseGridCatalogItem): item is PulseGridCatalogItem & {
    source: Extract<PulseGridCatalogSource, {type: "voice"}>
} => item.source.type === "voice"

export namespace PulseGridCatalog {
    export const Named: ReadonlyArray<PulseGridNamedVoice> = [
        named("Marimba", "Marimba", "mallets"),
        named("Vibes", "Vibraphone", "mallets"),
        named("Xylophone3", "Xylophone", "mallets", "SynprezFM 24"),
        named("Glockensp", "Glockenspiel", "mallets", "SynprezFM 09"),
        named("Celesta", "Celesta", "mallets"),
        named("Glass Bell", "Glass Bell", "mallets"),
        named("Tubular", "Tubular Bells", "mallets"),
        named("Steel Drum", "Steel Drum", "mallets"),
        named("Timpani", "Timpani", "mallets"),
        named("Kalimba.3", "Kalimba", "mallets", "SynprezFM 11"),
        named("Slap Bass", "Slap Bass", "bass"),
        named("Solid Bass", "Solid Bass", "bass"),
        named("Synth Bass", "Synth Bass", "bass"),
        named("Fretless", "Fretless Bass", "bass"),
        named("Bass Drum", "FM Bass Drum", "drums"),
        named("Snare", "FM Snare", "drums"),
        named("Soft Rhds", "Soft Rhodes", "synths"),
        named("Brite Rhds", "Bright Rhodes", "synths"),
        named("Brass Sect", "Brass Section", "synths"),
        named("Harpsichrd", "Harpsichord", "synths"),
        named("Nylon Gtr", "Nylon Guitar", "synths"),
        named("Square Ld", "Square Lead", "synths"),
        named("Bright Ld", "Bright Lead", "synths")
    ]

    // "TR-808 Bass Drum" in the folder TR-808 is "Bass Drum". The folder name must stand as a word of its own, so a
    // sample "TR-8080 Kick" is left as it is.
    const withoutFolder = (name: string, folder: Optional<string>): string => {
        if (folder === undefined || !name.startsWith(folder)) {return name}
        const rest = name.slice(folder.length)
        return /^\s/.test(rest) && rest.trim() !== "" ? rest.trim() : name
    }

    const sampleItems = (folder: PulseGridSampleFolder, path: ReadonlyArray<string>,
                         out: Array<PulseGridCatalogItem>): void => {
        for (const sample of folder.samples ?? []) {
            out.push({
                id: `sample:${sample.uuid}`, name: withoutFolder(sample.name, path[path.length - 1]),
                category: "drums", folder: path, kind: "drum", source: {type: "sample", sample}
            })
        }
        for (const child of folder.folders ?? []) {sampleItems(child, [...path, child.name], out)}
    }

    // Rows of `Named` first, in table order, then every other voice in the order given. Each row takes the first
    // voice that has its stored name, so a row gives exactly one item.
    const voiceItems = (cartridges: ReadonlyArray<PulseGridCartridge>): Array<PulseGridCatalogItem> => {
        const seen = new Set<string>()
        const rows = new Map<PulseGridNamedVoice, PulseGridCatalogItem>()
        const others: Array<PulseGridCatalogItem> = []
        for (const cartridge of cartridges) {
            for (const {name, data} of cartridge.voices) {
                const voice = name.trim()
                const id = `voice:${cartridge.name}/${voice}`
                if (voice === "" || seen.has(id)) {continue}
                seen.add(id)
                const source = {type: "voice", cartridge: cartridge.name, voice, data} as const
                const row = Named.find(row => !rows.has(row) && key(row.cartridge) === key(cartridge.name)
                    && key(row.voice) === key(voice))
                if (row !== undefined) {
                    rows.set(row, {
                        id, name: row.name, category: row.category, folder: [],
                        kind: row.category === "drums" ? "drum" : "melodic", source
                    })
                } else {
                    others.push({
                        id, name: voice, category: "synths", kind: "melodic", source,
                        folder: key(cartridge.name) === key(Classics) ? [] : [MoreVoices, cartridge.name]
                    })
                }
            }
        }
        return [...Named.flatMap(row => rows.has(row) ? [rows.get(row)!] : []), ...others]
    }

    export const items = (samples: Optional<PulseGridSampleFolder>,
                          cartridges: Optional<ReadonlyArray<PulseGridCartridge>>): ReadonlyArray<PulseGridCatalogItem> => {
        const found = voiceItems(cartridges ?? [])
        if (samples !== undefined) {sampleItems(samples, [], found)}
        const ids = new Set<string>()
        const unique = found.filter(item => !ids.has(item.id) && ids.add(item.id) !== undefined)
        return Categories.flatMap(category => {
            const inside = unique.filter(item => item.category === category)
            return [...inside.filter(item => item.folder.length === 0), ...inside.filter(item => item.folder.length > 0)]
        })
    }

    // The rule of Nitro's catalogue: every word of the query is in the name or in one of the folder names.
    export const find = (items: ReadonlyArray<PulseGridCatalogItem>,
                         {tab, query}: {tab: PulseGridCatalogTab, query: string}): ReadonlyArray<PulseGridCatalogItem> => {
        const wanted = words(query)
        return items.filter(item => {
            if (tab !== "all" && item.category !== tab && !(tab === "synths" && item.category === "bass")) {return false}
            const texts = [item.name, ...item.folder].map(key)
            return wanted.every(word => texts.some(text => text.includes(word)))
        })
    }

    export const sound = (item: PulseGridCatalogItem): PulseGridSoundInput => {
        const {source} = item
        if (source.type === "sample") {
            const {uuid, name, duration} = source.sample
            return PulseGridKits.sound({uuid, name, duration})
        }
        return {instrument: "Tubular", voice: {name: source.voice, patch: Array.from(source.data)}, label: item.name}
    }

    // The voice an agent means by `name` (SPEC.md, section 11, "Voices by name"), or undefined.
    export const voice = (cartridges: ReadonlyArray<PulseGridCartridge>, name: string,
                          cartridge?: string): Optional<PulseGridCatalogItem> => {
        const all = voiceItems(cartridges).filter(isVoice)
        const wanted = key(name)
        const stored = (item: typeof all[number]) => key(item.source.voice) === wanted
        const rowItem = (row: PulseGridNamedVoice) => all.find(item => key(item.source.cartridge) === key(row.cartridge)
            && key(item.source.voice) === key(row.voice) && item.name === row.name)
        const inCartridge = (row: PulseGridNamedVoice) => cartridge === undefined || key(row.cartridge) === key(cartridge)
        if (cartridge !== undefined) {
            return all.find(item => key(item.source.cartridge) === key(cartridge) && stored(item))
                ?? Named.filter(row => inCartridge(row) && key(row.name) === wanted).map(rowItem).find(item => item !== undefined)
        }
        return Named.filter(row => key(row.name) === wanted).map(rowItem).find(item => item !== undefined)
            ?? Named.filter(row => key(row.voice) === wanted).map(rowItem).find(item => item !== undefined)
            ?? all.find(item => key(item.source.cartridge) === key(Classics) && stored(item))
            ?? all.find(stored)
    }

    // Up to five shown names that hold a word of `name`, in the order of the list, to help a name that is not known.
    export const similar = (cartridges: ReadonlyArray<PulseGridCartridge>, name: string): ReadonlyArray<string> => {
        const wanted = words(name)
        const shown = voiceItems(cartridges).filter(isVoice)
            .filter(item => wanted.some(word => key(item.name).includes(word) || key(item.source.voice).includes(word)))
            .map(item => item.name)
        return Array.from(new Set(shown)).slice(0, 5)
    }
}
