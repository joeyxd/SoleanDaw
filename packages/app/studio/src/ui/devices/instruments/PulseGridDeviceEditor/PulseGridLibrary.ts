import {isDefined, Procedure, Terminable} from "@opendaw/lib-std"
import type {PulseGridCatalogItem, PulseGridKit, PulseGridRole, PulseGridSample} from "@opendaw/studio-adapters"

// The team's kit packs, as Nitro keeps them for everyone (Nitro's daw/pulsegrid/AGENT_WIRE.md, section 8). This
// module holds no DOM and no network of its own: the Nitro session hands it a `Link` (NitroBridge.install), so
// outside Nitro there is no link and nothing here fetches.

export type PulseGridPackRole = PulseGridRole | "Open Hat"
export type PulseGridPackSound = {
    uuid: string, name: string, folder: string, role: PulseGridPackRole | null, seconds: number
}
export type PulseGridPackKit = {name: string, sounds: Readonly<Record<PulseGridRole, string>>}
export type PulseGridPack = {
    id: string, name: string, source: string, sounds: ReadonlyArray<PulseGridPackSound>,
    kits: ReadonlyArray<PulseGridPackKit>
}

export type PulseGridLibraryResult = {ok: true} | {ok: false, message: string}

// What the Nitro session can do for the library. `index` is undefined when Nitro did not answer.
export type PulseGridLibraryLink = {
    sampleUrl(uuid: string): string
    index(): Promise<ReadonlyArray<unknown> | undefined>
    putSample(uuid: string, wav: ArrayBuffer): Promise<PulseGridLibraryResult>
    putPack(pack: PulseGridPack): Promise<PulseGridLibraryResult>
    removePack(id: string): Promise<PulseGridLibraryResult>
}

export type PulseGridLibrarySound = {sound: PulseGridPackSound, url: string}

const Roles: ReadonlyArray<PulseGridRole> = ["Kick", "Snare", "Clap", "Hat", "Perc"]
const PackRoles: ReadonlyArray<string> = [...Roles, "Open Hat"]
export const PulseGridTeamFolder = "Team packs"

const text = (value: unknown): value is string => typeof value === "string"

const parseSound = (value: unknown): PulseGridPackSound | undefined => {
    if (typeof value !== "object" || value === null) {return undefined}
    const {uuid, name, folder, role, seconds} = value as Record<string, unknown>
    if (!text(uuid) || !text(name) || typeof seconds !== "number" || !(seconds > 0)) {return undefined}
    return {
        uuid, name, folder: text(folder) ? folder : "",
        role: text(role) && PackRoles.includes(role) ? role as PulseGridPackRole : null, seconds
    }
}

const parseKit = (value: unknown): PulseGridPackKit | undefined => {
    if (typeof value !== "object" || value === null) {return undefined}
    const {name, sounds} = value as Record<string, unknown>
    if (!text(name) || typeof sounds !== "object" || sounds === null) {return undefined}
    const held = sounds as Record<string, unknown>
    if (!Roles.every(role => text(held[role]))) {return undefined}
    return {name, sounds: Object.fromEntries(Roles.map(role => [role, held[role] as string])) as Record<PulseGridRole, string>}
}

// The packs Nitro answered; whatever is malformed is left out.
const parsePacks = (items: ReadonlyArray<unknown>): ReadonlyArray<PulseGridPack> => items.flatMap(item => {
    if (typeof item !== "object" || item === null) {return []}
    const {id, name, source, sounds, kits} = item as Record<string, unknown>
    if (!text(id) || !text(name) || !Array.isArray(sounds)) {return []}
    return [{
        id, name, source: text(source) ? source : "",
        sounds: sounds.flatMap(sound => parseSound(sound) ?? []),
        kits: (Array.isArray(kits) ? kits : []).flatMap(kit => parseKit(kit) ?? [])
    }]
})

export namespace PulseGridLibrary {
    let link: PulseGridLibraryLink | undefined
    let loading: Promise<ReadonlyArray<PulseGridPack>> | undefined
    let current: ReadonlyArray<PulseGridPack> = []
    let known = new Map<string, PulseGridPackSound>()
    const listeners = new Set<Procedure<void>>()

    // When the index was last asked for. A failed answer is not kept: the next need asks again, at most every
    // RetryMillis, so a blip does not leave the tab without its packs for good.
    const RetryMillis = 5000
    let askedAt = 0

    // The Nitro session of this tab, or undefined (also forgets what was loaded).
    export const connect = (next: PulseGridLibraryLink | undefined): void => {
        link = next
        loading = undefined
        askedAt = 0
        current = []
        known = new Map()
    }

    export const active = (): boolean => link !== undefined

    const fetchIndex = (): Promise<ReadonlyArray<PulseGridPack>> => {
        const asked = link
        if (asked === undefined) {return Promise.resolve([])}
        askedAt = Date.now()
        const promise: Promise<ReadonlyArray<PulseGridPack>> = asked.index()
            .then(items => items === undefined ? undefined : parsePacks(items), () => undefined)
            .then(packs => {
                if (link !== asked) {return packs ?? []}
                if (packs === undefined) {
                    if (loading === promise) {loading = undefined}
                    return current
                }
                current = packs
                known = new Map(packs.flatMap(pack => pack.sounds).map(sound => [sound.uuid, sound]))
                Array.from(listeners).forEach(listener => listener())
                return packs
            })
        loading = promise
        return promise
    }

    // Fetched once per tab; resolves with the packs (none outside Nitro; the last good list when Nitro did not answer).
    export const ready = (): Promise<ReadonlyArray<PulseGridPack>> => {
        if (link === undefined) {return Promise.resolve([])}
        return loading ?? (Date.now() - askedAt < RetryMillis ? Promise.resolve(current) : fetchIndex())
    }

    export const load = (): void => {ready().finally()}

    // Fetches again (after an import or a removal).
    export const refresh = (): Promise<ReadonlyArray<PulseGridPack>> => fetchIndex()

    // What has arrived so far.
    export const packs = (): ReadonlyArray<PulseGridPack> => current

    export const has = (uuid: string): boolean => known.has(uuid)

    export const subscribe = (listener: Procedure<void>): Terminable => {
        listeners.add(listener)
        return {terminate: () => {listeners.delete(listener)}}
    }

    // A sample of the team library and where its bytes are. Waits while the index is loading; undefined for any
    // other uuid and outside Nitro (no request is made then).
    export const find = async (uuid: string): Promise<PulseGridLibrarySound | undefined> => {
        const asked = link
        if (asked === undefined) {return undefined}
        await ready()
        // a pack imported in another tab or on another PC after this tab read the index: ask once more
        if (!known.has(uuid) && link === asked && Date.now() - askedAt >= RetryMillis) {await (loading ?? fetchIndex())}
        const sound = known.get(uuid)
        return isDefined(sound) && link === asked ? {sound, url: asked.sampleUrl(uuid)} : undefined
    }

    export const upload = async (uuid: string, wav: ArrayBuffer): Promise<PulseGridLibraryResult> =>
        link === undefined ? {ok: false, message: "Open this project from Nitro to import packs"}
            : link.putSample(uuid, wav)

    export const savePack = async (pack: PulseGridPack): Promise<PulseGridLibraryResult> => {
        if (link === undefined) {return {ok: false, message: "Open this project from Nitro to import packs"}}
        const result = await link.putPack(pack)
        if (result.ok) {await refresh()}
        return result
    }

    export const removePack = async (id: string): Promise<PulseGridLibraryResult> => {
        if (link === undefined) {return {ok: false, message: "Open this project from Nitro to import packs"}}
        const result = await link.removePack(id)
        if (result.ok) {await refresh()}
        return result
    }

    const sampleOf = (pack: PulseGridPack, uuid: string): PulseGridSample | undefined => {
        const sound = pack.sounds.find(sound => sound.uuid === uuid)
        return sound === undefined ? undefined : {uuid, name: sound.name, duration: sound.seconds}
    }

    // The kits of a pack as the window's own kit type (a kit whose sound is not in the pack is left out).
    export const kitsOf = (pack: PulseGridPack): ReadonlyArray<PulseGridKit> => pack.kits.flatMap(kit => {
        const samples = Roles.map(role => sampleOf(pack, kit.sounds[role]))
        if (samples.some(sample => sample === undefined)) {return []}
        const [Kick, Snare, Clap, Hat, Perc] = samples as Array<PulseGridSample>
        return [{id: `lib:${pack.id}/${kit.name}`, name: kit.name, sounds: {Kick, Snare, Clap, Hat, Perc}}]
    })

    // Every sound of the packs as a browser item in the drums: a folder "Team packs", a folder for each pack, then
    // the sound's own folders. A sound that two packs share shows once, in the first.
    export const items = (all: ReadonlyArray<PulseGridPack>): ReadonlyArray<PulseGridCatalogItem> => {
        const seen = new Set<string>()
        return all.flatMap(pack => pack.sounds.flatMap((sound): Array<PulseGridCatalogItem> => {
            if (seen.has(sound.uuid)) {return []}
            seen.add(sound.uuid)
            const inside = sound.folder.split("/").filter(part => part !== "")
            const folder = [PulseGridTeamFolder, ...(inside[0] === pack.name ? inside : [pack.name, ...inside])]
            return [{
                id: `sample:${sound.uuid}`, name: sound.name, category: "drums", folder, kind: "drum",
                source: {type: "sample", sample: {uuid: sound.uuid, name: sound.name, duration: sound.seconds}}
            }]
        }))
    }

    // `base` with the team's sounds put in front of openDAW's own folders (right after the built-in drums).
    export const withTeam = (base: ReadonlyArray<PulseGridCatalogItem>,
                             all: ReadonlyArray<PulseGridPack>): ReadonlyArray<PulseGridCatalogItem> => {
        const team = items(all)
        if (team.length === 0) {return base}
        let at = base.findIndex(item => item.category === "drums" && item.folder.length > 0
            && item.folder[0] !== "PulseGrid drums")
        if (at < 0) {
            at = base.reduce((last, item, index) => item.category === "drums" ? index + 1 : last, 0)
        }
        return [...base.slice(0, at), ...team, ...base.slice(at)]
    }
}
