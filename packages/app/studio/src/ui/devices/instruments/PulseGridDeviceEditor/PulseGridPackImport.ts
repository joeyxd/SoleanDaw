import {PulseGridKits, PulseGridRole} from "@opendaw/studio-adapters"
import type {PulseGridPackKit, PulseGridPackRole, PulseGridPackSound} from "./PulseGridLibrary"

// What turns a downloaded pack into kits, with no DOM and no audio (Nitro's daw/pulsegrid/AGENT_WIRE.md, section 8.5;
// SPEC.md, section 13): which files count, the pack's name and id, a sound's id, its role, and the kits.

export type PulseGridPackLayout = {
    name: string
    id: string
    // each kept file: the path it came in, its folders below the pack's root, and all the folders it came in
    files: ReadonlyArray<{path: string, name: string, dirs: ReadonlyArray<string>, parents: ReadonlyArray<string>}>
}

export namespace PulseGridPackImport {
    export const Extensions = /\.(wav|mp3|ogg|flac|m4a|aif|aiff)$/i
    export const NotInNitro = "Open this project from Nitro to import packs"
    export const MaxSeconds = 600
    export const MaxWavBytes = 16 * 1024 * 1024
    export const MaxSounds = 2000
    export const MaxKits = 200
    export const Concurrency = 4

    const Hat = PulseGridKits.Roles.find(({role}) => role === "Hat")!.match
    const OpenHat = /\bo\.?hh?\b/i
    const ClosedHat = /\bc\.?hh?\b/i
    const Others = PulseGridKits.Roles.filter(({role}) => role !== "Hat")
    const natural = new Intl.Collator("en", {numeric: true, sensitivity: "base"})

    export const parts = (path: string): Array<string> => path.replace(/\\/g, "/").split("/").filter(part => part !== "")

    // An audio file the browser may read: not under __MACOSX, no name that starts with a dot.
    export const keep = (path: string): boolean => {
        const names = parts(path)
        return names.length > 0 && !names.some(name => name === "__MACOSX" || name.startsWith("."))
            && Extensions.test(names[names.length - 1])
    }

    const clean = (name: string, limit: number): string =>
        // eslint-disable-next-line no-control-regex
        name.replace(/[\u0000-\u001f\u007f\\/]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit).trim()

    // A sound's shown name: the file's name without its extension.
    export const soundName = (fileName: string): string => clean(withoutExtension(fileName), 120) || "Sound"

    export const withoutExtension = (name: string): string => name.replace(/\.[^./\\]+$/, "")

    export const slug = (name: string): string => {
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "")
        return id === "" ? "pack" : id
    }

    export const dateName = (today: Date): string => {
        const two = (value: number): string => String(value).padStart(2, "0")
        return `Pack ${today.getFullYear()}-${two(today.getMonth() + 1)}-${two(today.getDate())}`
    }

    // The first folder that every path is in, when there is one.
    const wrapper = (all: ReadonlyArray<ReadonlyArray<string>>): string | undefined => {
        const first = all[0]?.[0]
        return all.length > 0 && all.every(names => names.length > 1 && names[0] === first) ? first : undefined
    }

    // The pack's name: the zip's name without extension; a dropped folder's name (the folder every file is in); for
    // loose files the first file's folder, or `Pack <yyyy-mm-dd>`.
    export const layout = (zip: string | undefined, paths: ReadonlyArray<string>, today: Date): PulseGridPackLayout => {
        const all = paths.map(parts)
        const top = wrapper(all)
        const folderOfFirst = all.length > 0 && all[0].length > 1 ? all[0][all[0].length - 2] : undefined
        const name = [zip === undefined ? undefined : withoutExtension(zip), top, folderOfFirst]
            .map(candidate => candidate === undefined ? "" : clean(candidate, 80)).find(candidate => candidate !== "")
            ?? dateName(today)
        return {
            name, id: slug(name),
            files: all.map((names, index) => ({
                path: paths[index], name: names[names.length - 1],
                dirs: names.slice(top === undefined ? 0 : 1, -1), parents: names.slice(0, -1)
            }))
        }
    }

    // `Pack/Kicks/Kick 01.wav`: the pack's name, then the folders inside it.
    export const folderOf = (name: string, dirs: ReadonlyArray<string>): string => [name, ...dirs].join("/").slice(0, 200)

    // A name made plain for the role rules: runs of `_ - .` become one space, letters and digits are split, so
    // `BD_01` and `BD01` both read `BD 01` (`_` is a word character, so `\bbd\b` would miss it).
    export const plain = (name: string): string => name.replace(/[_\-.]+/g, " ")
        .replace(/([a-z])(\d)/gi, "$1 $2").replace(/(\d)([a-z])/gi, "$1 $2")

    // From the file's name first, then each folder from the deepest up: Open Hat (OH, OHH, or the open words with the
    // Hat rule), Hat (CH, CHH, or the Hat rule), then Kick, Snare, Clap, Perc, else null.
    export const roleOf = (fileName: string, dirs: ReadonlyArray<string>): PulseGridPackRole | null => {
        for (const text of [withoutExtension(fileName), ...[...dirs].reverse()].map(plain)) {
            if (OpenHat.test(text) || (/open/i.test(text) && Hat.test(text))) {return "Open Hat"}
            if (ClosedHat.test(text) || Hat.test(text)) {return "Hat"}
            const found = Others.find(({match}) => match.test(text))
            if (found !== undefined) {return found.role}
        }
        return null
    }

    // Whether a decoded sound may go up: it has frames, lasts at most MaxSeconds, and its 32-bit float WAV is at most
    // MaxWavBytes.
    export const fits = (frames: number, channels: number, sampleRate: number): boolean =>
        frames > 0 && channels > 0 && sampleRate > 0 && frames / sampleRate <= MaxSeconds
        && 44 + frames * channels * 4 <= MaxWavBytes

    // Nitro's id of a WAV (section 8.1): the first 32 hex digits of its sha256, as a version 4 style uuid.
    export const uuidOfHash = (hex: string): string => {
        const digits = hex.slice(0, 32).toLowerCase().split("")
        digits[12] = "4"
        digits[16] = ((parseInt(digits[16], 16) & 3) | 8).toString(16)
        const joined = digits.join("")
        return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`
    }

    export const uuidOf = async (bytes: ArrayBuffer | Uint8Array): Promise<string> => {
        const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource))
        return uuidOfHash(Array.from(hash.slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join(""))
    }

    const byName = (a: PulseGridPackSound, b: PulseGridPackSound): number =>
        natural.compare(a.name, b.name) || (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0)

    // One folder's kit, or undefined when the folder holds no Kick, no Hat, or neither a Snare nor a Clap.
    const kitOf = (name: string, held: ReadonlyArray<PulseGridPackSound>): PulseGridPackKit | undefined => {
        const sorted = [...held].sort(byName)
        const first = (...roles: Array<PulseGridPackRole | null>): PulseGridPackSound | undefined =>
            sorted.find(sound => roles.includes(sound.role))
        const kick = first("Kick")
        const hat = first("Hat")
        const snare = first("Snare")
        const clap = first("Clap")
        if (kick === undefined || hat === undefined || (snare === undefined && clap === undefined)) {return undefined}
        const perc = first("Perc") ?? first("Open Hat", null) ?? hat
        const pick = (role: PulseGridRole, sound: PulseGridPackSound): [PulseGridRole, string] => [role, sound.uuid]
        return {
            name, sounds: Object.fromEntries([
                pick("Kick", kick), pick("Snare", (snare ?? clap)!), pick("Clap", (clap ?? snare)!),
                pick("Hat", hat), pick("Perc", perc)
            ]) as Record<PulseGridRole, string>
        }
    }

    // ` 2`, ` 3` for a name the pack already has.
    const unique = (kits: ReadonlyArray<PulseGridPackKit>): Array<PulseGridPackKit> => {
        const taken = new Set<string>()
        return kits.map(kit => {
            let name = kit.name
            for (let count = 2; taken.has(name); count++) {name = `${kit.name.slice(0, 76)} ${count}`}
            taken.add(name)
            return {...kit, name}
        })
    }

    // The kits of a pack: each folder that is a kit, named after the folder (the pack's name for its root); when no
    // folder is one, the whole pack tried as a single folder named after the pack.
    export const kits = (packName: string, sounds: ReadonlyArray<PulseGridPackSound>): Array<PulseGridPackKit> => {
        const folders = new Map<string, Array<PulseGridPackSound>>()
        sounds.forEach(sound => {
            const held = folders.get(sound.folder)
            if (held === undefined) {folders.set(sound.folder, [sound])} else {held.push(sound)}
        })
        const found = Array.from(folders, ([folder, held]) => kitOf((parts(folder).pop() ?? packName).slice(0, 80), held))
            .filter((kit): kit is PulseGridPackKit => kit !== undefined)
        const whole = found.length > 0 ? undefined : kitOf(packName, sounds)
        return unique(whole === undefined ? found : [whole]).slice(0, MaxKits)
    }
}
