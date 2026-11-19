import {describe, expect, it} from "vitest"
import type {PulseGridPackSound} from "./PulseGridLibrary"
import {PulseGridPackImport as Import} from "./PulseGridPackImport"

const today = new Date(2026, 10, 19)

// The sounds of a pack the way the import makes them: layout, then each file's folder and role (the uuid is its path).
const pack = (zip: string | undefined, paths: ReadonlyArray<string>) => {
    const {name, id, files} = Import.layout(zip, paths, today)
    const sounds: Array<PulseGridPackSound> = files.map(file => ({
        uuid: file.path, name: Import.soundName(file.name), folder: Import.folderOf(name, file.dirs),
        role: Import.roleOf(file.name, file.parents), seconds: 0.5
    }))
    return {name, id, sounds, kits: Import.kits(name, sounds)}
}

describe("PulseGridPackImport ids", () => {
    it("the five bytes `nitro` have the id the contract gives (section 8.1)", async () => {
        expect(await Import.uuidOf(new TextEncoder().encode("nitro"))).toBe("7b0aaacd-69a8-483a-87fe-186dbef1c704")
    })
    it("sets the version digit and the variant digit", () => {
        expect(Import.uuidOfHash("00000000000000000000000000000000")).toBe("00000000-0000-4000-8000-000000000000")
        expect(Import.uuidOfHash("ffffffffffffffffffffffffffffffff")).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff")
    })
})

describe("PulseGridPackImport.keep", () => {
    it("takes audio files by extension, any case, and nothing else", () => {
        ["a.wav", "Kicks/a.MP3", "x.ogg", "x.flac", "x.m4a", "x.aif", "x.aiff"]
            .forEach(path => expect(Import.keep(path)).toBe(true))
        ;["a.txt", "a.zip", "a.wav.asd", "readme", "Kicks/"].forEach(path => expect(Import.keep(path)).toBe(false))
    })
    it("ignores __MACOSX and names that start with a dot, in any folder", () => {
        expect(Import.keep("__MACOSX/Kicks/a.wav")).toBe(false)
        expect(Import.keep("Kicks/._a.wav")).toBe(false)
        expect(Import.keep(".hidden/a.wav")).toBe(false)
        expect(Import.keep("Pack\\Kicks\\a.wav")).toBe(true)
    })
})

describe("PulseGridPackImport pack name and id", () => {
    it("the zip's name without extension", () => {
        expect(Import.layout("808 Heat.zip", ["808 Heat/Kicks/a.wav", "808 Heat/Snares/b.wav"], today).name).toBe("808 Heat")
        expect(Import.layout("Other Name.zip", ["Heat/a.wav"], today).name).toBe("Other Name")
    })
    it("a dropped folder's name, the folder every file is in", () => {
        expect(Import.layout(undefined, ["Trap Kit/Kicks/a.wav", "Trap Kit/b.wav"], today).name).toBe("Trap Kit")
    })
    it("loose files: the first file's folder, else Pack <date>", () => {
        expect(Import.layout(undefined, ["Drums/a.wav", "Other/b.wav"], today).name).toBe("Drums")
        expect(Import.layout(undefined, ["a.wav", "b.wav"], today).name).toBe("Pack 2026-11-19")
    })
    it("the id is the name lowercased, runs of other characters as one dash, at most 60", () => {
        expect(Import.slug("808 Heat")).toBe("808-heat")
        expect(Import.slug("  --Dark & Dirty!! (Vol. 2)  ")).toBe("dark-dirty-vol-2")
        expect(Import.slug("x".repeat(80))).toBe("x".repeat(60))
        expect(Import.slug("a".repeat(59) + "!b")).toBe("a".repeat(59))
        expect(Import.slug("***")).toBe("pack")
        expect(Import.slug("Kick 01").match(/^[a-z0-9][a-z0-9-]{0,59}$/)).not.toBeNull()
    })
})

describe("PulseGridPackImport.roleOf", () => {
    const role = (name: string, ...dirs: Array<string>) => Import.roleOf(name, dirs)
    it("the five rules, from the file name", () => {
        expect(role("Kick 01.wav")).toBe("Kick")
        expect(role("BD 02.wav")).toBe("Kick")
        expect(role("Snare 03.wav")).toBe("Snare")
        expect(role("Clap.wav")).toBe("Clap")
        expect(role("Closed Hat.wav")).toBe("Hat")
        expect(role("HH 4.wav")).toBe("Hat")
        expect(role("Rimshot.wav")).toBe("Perc")
        expect(role("Shaker 2.wav")).toBe("Perc")
        expect(role("Bass 1.wav")).toBeNull()
    })
    it("plain names: underscores, dashes, dots and digits glued to letters", () => {
        expect(Import.plain("BD_01")).toBe("BD 01")
        expect(Import.plain("SD02-tight")).toBe("SD 02 tight")
        expect(role("BD_01.wav")).toBe("Kick")
        expect(role("SD02.wav")).toBe("Snare")
        expect(role("hh_closed_3.wav")).toBe("Hat")
        expect(role("CH Heat.wav")).toBe("Hat")
        expect(role("CHH-01.wav")).toBe("Hat")
        expect(role("OH Heat.wav")).toBe("Open Hat")
        expect(role("OHH_2.wav")).toBe("Open Hat")
        expect(role("Chant.wav")).toBeNull()
    })
    it("Open Hat: OH, OHH, or an open word together with the Hat rule", () => {
        expect(role("Open Hat 01.wav")).toBe("Open Hat")
        expect(role("OH hat.wav")).toBe("Open Hat")
        expect(role("Hat open.wav")).toBe("Open Hat")
        expect(role("Hat 01.wav")).toBe("Hat")
        expect(role("Open Kick.wav")).toBe("Kick")
    })
    it("falls back to each folder from the deepest up", () => {
        expect(role("01.wav", "Kicks")).toBe("Kick")
        expect(role("01.wav", "Drums", "Snares")).toBe("Snare")
        expect(role("01.wav", "Kicks", "Misc")).toBe("Kick")
        expect(role("01.wav", "Open Hats")).toBe("Open Hat")
        expect(role("Clap 1.wav", "Kicks")).toBe("Clap")
        expect(role("01.wav", "Stuff")).toBeNull()
    })
})

describe("PulseGridPackImport.fits", () => {
    it("at most 600 seconds and 16 MiB as a 32-bit float WAV", () => {
        expect(Import.fits(44100, 2, 44100)).toBe(true)
        expect(Import.fits(0, 2, 44100)).toBe(false)
        expect(Import.fits(601 * 8000, 1, 8000)).toBe(false)
        expect(Import.fits(2_000_000, 2, 44100)).toBe(true)
        expect(Import.fits(2_100_000, 2, 44100)).toBe(false)
    })
})

describe("PulseGridPackImport.kits", () => {
    it("a folder for each kit: two folders make two kits, named after them", () => {
        const {kits} = pack("Drum Kits.zip", [
            "Kit A/Kick.wav", "Kit A/Snare.wav", "Kit A/Hat.wav", "Kit A/Perc 1.wav",
            "Kit B/Kick.wav", "Kit B/Clap.wav", "Kit B/Hat.wav"
        ])
        expect(kits.map(kit => kit.name)).toEqual(["Kit A", "Kit B"])
        expect(kits[0].sounds).toEqual({
            Kick: "Kit A/Kick.wav", Snare: "Kit A/Snare.wav", Clap: "Kit A/Snare.wav", Hat: "Kit A/Hat.wav", Perc: "Kit A/Perc 1.wav"
        })
        expect(kits[1].sounds.Snare).toBe("Kit B/Clap.wav")
    })
    it("a pack sorted by type is one kit named after the pack", () => {
        const {kits, name} = pack("808 Heat.zip", [
            "Kicks/Kick 01.wav", "Kicks/Kick 02.wav", "Snares/Snare 01.wav", "Hats/Hat 01.wav", "Hats/Open Hat 01.wav", "Claps/Clap 1.wav"
        ])
        expect(name).toBe("808 Heat")
        expect(kits).toEqual([{
            name: "808 Heat", sounds: {
                Kick: "Kicks/Kick 01.wav", Snare: "Snares/Snare 01.wav", Clap: "Claps/Clap 1.wav",
                Hat: "Hats/Hat 01.wav", Perc: "Hats/Open Hat 01.wav"
            }
        }])
    })
    it("a root folder that is a kit is named after the pack", () => {
        const {kits} = pack("Mine.zip", ["Kick.wav", "Snare.wav", "Hat.wav"])
        expect(kits.map(kit => kit.name)).toEqual(["Mine"])
    })
    it("a missing Clap takes the Snare, a missing Snare the Clap", () => {
        expect(pack("P.zip", ["k/Kick.wav", "k/Hat.wav", "k/Snare.wav"]).kits[0].sounds)
            .toMatchObject({Snare: "k/Snare.wav", Clap: "k/Snare.wav"})
        expect(pack("P.zip", ["k/Kick.wav", "k/Hat.wav", "k/Clap.wav"]).kits[0].sounds)
            .toMatchObject({Snare: "k/Clap.wav", Clap: "k/Clap.wav"})
    })
    it("a missing Perc takes the first Open Hat or unnamed sound of the folder, else the Hat", () => {
        const files = ["k/Kick.wav", "k/Snare.wav", "k/Hat.wav"]
        expect(pack("P.zip", [...files, "k/Zzz.wav", "k/Open Hat.wav"]).kits[0].sounds.Perc).toBe("k/Open Hat.wav")
        expect(pack("P.zip", [...files, "k/Texture.wav"]).kits[0].sounds.Perc).toBe("k/Texture.wav")
        expect(pack("P.zip", files).kits[0].sounds.Perc).toBe("k/Hat.wav")
    })
    it("each role takes the first sound in natural name order", () => {
        const {kits} = pack("P.zip", ["k/Kick 10.wav", "k/Kick 2.wav", "k/Snare.wav", "k/Hat.wav"])
        expect(kits[0].sounds.Kick).toBe("k/Kick 2.wav")
    })
    it("a folder without a Kick, a Hat, or a Snare or Clap is no kit, and no kit at all gives none", () => {
        expect(pack("P.zip", ["Kick.wav", "Snare.wav"]).kits).toEqual([])
        expect(pack("P.zip", ["Kick.wav", "Hat.wav"]).kits).toEqual([])
        expect(pack("P.zip", ["Snare.wav", "Hat.wav"]).kits).toEqual([])
    })
    it("repeated kit names get 2, 3", () => {
        const kit = (folder: string) => [`${folder}/Kick.wav`, `${folder}/Snare.wav`, `${folder}/Hat.wav`]
        const {kits} = pack("P.zip", [...kit("A/Drums"), ...kit("B/Drums"), ...kit("C/Drums"), ...kit("D/Other")])
        expect(kits.map(item => item.name)).toEqual(["Drums", "Drums 2", "Drums 3", "Other"])
    })
})
