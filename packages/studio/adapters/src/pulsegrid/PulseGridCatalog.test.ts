import {describe, expect, it} from "vitest"
import {readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {Dx7Sysex} from "../devices/instruments/Tubular/Dx7Sysex"
import {PulseGridCatalog, PulseGridCatalogItem, PulseGridSampleFolder} from "./PulseGridCatalog"
import {PulseGridCartridge} from "./PulseGridTypes"

// The cartridges the app ships, read from disk the way the app's loader decodes them.
const root = fileURLToPath(new URL("../../../../app/studio/public/tubular/", import.meta.url))
const realCartridges = (): ReadonlyArray<PulseGridCartridge> =>
    (JSON.parse(readFileSync(`${root}index.json`, "utf8")) as {cartridges: Array<{name: string, file: string}>})
        .cartridges.map(({name, file}) => ({name, voices: Dx7Sysex.decode(new Uint8Array(readFileSync(`${root}cartridges/${file}`)))}))

const voiceOf = (name: string, seed: number = 1) => ({name, data: new Uint8Array(155).fill(seed)})
const cartridge = (name: string, ...voices: Array<string>): PulseGridCartridge =>
    ({name, voices: voices.map((voice, index) => voiceOf(voice, index + 1))})
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const sample = (n: number, name: string) => ({uuid: uuid(n), name, duration: 1})
const names = (items: ReadonlyArray<PulseGridCatalogItem>) => items.map(item => item.name)

describe("PulseGridCatalog items", () => {
    it("lists the real cartridges: every Named row once, over a thousand voices, unique ids", () => {
        const items = PulseGridCatalog.items(undefined, realCartridges())
        for (const row of PulseGridCatalog.Named) {
            const rows = items.filter(item => item.name === row.name && item.category === row.category)
            expect(rows.length, row.name).toBe(1)
            expect(rows[0].source).toMatchObject({type: "voice", voice: row.voice, cartridge: row.cartridge})
            expect(rows[0].folder).toEqual([])
        }
        expect(items.filter(item => item.source.type === "voice").length).toBeGreaterThan(1000)
        expect(new Set(items.map(item => item.id)).size).toBe(items.length)
        for (const name of ["Marimba", "Vibraphone", "Xylophone", "Glockenspiel"]) {
            const item = items.find(item => item.name === name)!
            expect([item.category, item.folder, item.kind]).toEqual(["mallets", [], "melodic"])
        }
        expect(items.find(item => item.name === "FM Bass Drum")!.kind).toBe("drum")
        expect(items.find(item => item.name === "Rhodes")!.folder).toEqual([])
        expect(items.find(item => item.name === "Dingl 19.1".toUpperCase())!.folder)
            .toEqual(["More FM voices", "SynprezFM 09"])
    })

    it("orders the categories, then Named rows before the cartridge's order, then the folders", () => {
        const items = PulseGridCatalog.items(undefined, [
            cartridge("Tubular Classics", "Rhodes", "Vibes", "Marimba", "Solid Bass", "Soft Rhds"),
            cartridge("Other", "Zed", "Alpha")])
        expect(items.map(item => `${item.category}:${item.name}`)).toEqual([
            "bass:Solid Bass", "synths:Soft Rhodes", "synths:Rhodes", "synths:Zed", "synths:Alpha",
            "mallets:Marimba", "mallets:Vibraphone"])
        expect(items[3].id).toBe("voice:Other/Zed")
        expect(items[3].folder).toEqual(["More FM voices", "Other"])
    })

    it("leaves out empty names, keeps the first of equal ids, trims stored names, takes nothing for a missing voice", () => {
        const items = PulseGridCatalog.items(undefined, [
            {name: "A", voices: [voiceOf("  Pad  ", 1), voiceOf("", 2), voiceOf("   ", 3), voiceOf("Pad", 4)]}])
        expect(items.length).toBe(1)
        expect(items[0].id).toBe("voice:A/Pad")
        expect((items[0].source as {data: Uint8Array}).data[0]).toBe(1)
        expect(PulseGridCatalog.items(undefined, undefined)).toEqual([])
        expect(names(PulseGridCatalog.items(undefined, [cartridge("Tubular Classics", "Marimba")]))).toEqual(["Marimba"])
    })

    it("lists samples as drums, with the folders below the root and the folder's name cut off the name", () => {
        const tree: PulseGridSampleFolder = {
            name: "One Shots", samples: [sample(1, "Rim")],
            folders: [
                {name: "TR-808", samples: [sample(2, "TR-808 Bass Drum"), sample(3, "Odd Sound"), sample(4, "TR-8080 Kick")]},
                {name: "Kits", folders: [{name: "Linn", samples: [sample(5, "Linn Snare")]}]}]
        }
        const items = PulseGridCatalog.items(tree, undefined)
        expect(items.map(item => [item.id, item.name, item.folder, item.category, item.kind])).toEqual([
            [`sample:${uuid(1)}`, "Rim", [], "drums", "drum"],
            [`sample:${uuid(2)}`, "Bass Drum", ["TR-808"], "drums", "drum"],
            [`sample:${uuid(3)}`, "Odd Sound", ["TR-808"], "drums", "drum"],
            [`sample:${uuid(4)}`, "TR-8080 Kick", ["TR-808"], "drums", "drum"],
            [`sample:${uuid(5)}`, "Snare", ["Kits", "Linn"], "drums", "drum"]])
        expect(items[1].source).toEqual({type: "sample", sample: sample(2, "TR-808 Bass Drum")})
    })
})

describe("PulseGridCatalog find", () => {
    const items = PulseGridCatalog.items(
        {name: "One Shots", folders: [{name: "TR-808", samples: [sample(1, "TR-808 Bass Drum"), sample(2, "TR-808 Snare")]}]},
        [cartridge("Tubular Classics", "Marimba", "Solid Bass", "Rhodes", "Bass Drum"), cartridge("Other", "Bass Pad")])

    it("filters by the four tabs; synths holds bass and synths", () => {
        const tab = (tab: "all" | "drums" | "synths" | "mallets") => names(PulseGridCatalog.find(items, {tab, query: ""}))
        expect(tab("all")).toEqual(names(items))
        expect(tab("drums")).toEqual(["FM Bass Drum", "Bass Drum", "Snare"])
        expect(tab("synths")).toEqual(["Solid Bass", "Rhodes", "Bass Pad"])
        expect(tab("mallets")).toEqual(["Marimba"])
    })

    it("needs every word of the query in the name or a folder name, in any case, and keeps the order", () => {
        const find = (query: string, tab: "all" | "drums" = "all") => names(PulseGridCatalog.find(items, {tab, query}))
        expect(find("tr-808 bass")).toEqual(["Bass Drum"])
        expect(find("  BASS   drum ")).toEqual(["FM Bass Drum", "Bass Drum"])
        expect(find("more fm")).toEqual(["Bass Pad"])
        expect(find("bass", "drums")).toEqual(["FM Bass Drum", "Bass Drum"])
        expect(find("bass nothing")).toEqual([])
        expect(find("")).toEqual(names(items))
        expect(find("   ")).toEqual(names(items))
    })
})

describe("PulseGridCatalog voice", () => {
    const book = [
        cartridge("Tubular Classics", "Vibes", "Rhodes", "Bass Drum", "Shared"),
        cartridge("SynprezFM 24", "Xylophone3", "Shared", "Vibes"),
        cartridge("Zeta", "Only Here")]
    const stored = (item: PulseGridCatalogItem | undefined) =>
        item === undefined ? undefined : `${item.name}|${(item.source as {cartridge: string, voice: string}).cartridge}`

    it("with a cartridge: in that cartridge only, by stored name, then by the shown name of a Named row", () => {
        expect(stored(PulseGridCatalog.voice(book, "Xylophone3", "SynprezFM 24"))).toBe("Xylophone|SynprezFM 24")
        expect(stored(PulseGridCatalog.voice(book, "xylophone", "synprezfm 24"))).toBe("Xylophone|SynprezFM 24")
        expect(stored(PulseGridCatalog.voice(book, "Vibraphone", "Tubular Classics"))).toBe("Vibraphone|Tubular Classics")
        expect(stored(PulseGridCatalog.voice(book, "Vibes", "SynprezFM 24"))).toBe("Vibes|SynprezFM 24")
        expect(stored(PulseGridCatalog.voice(book, "Vibraphone", "SynprezFM 24"))).toBeUndefined()
        expect(stored(PulseGridCatalog.voice(book, "Only Here", "Tubular Classics"))).toBeUndefined()
        expect(stored(PulseGridCatalog.voice(book, "Vibes", "Missing"))).toBeUndefined()
    })

    it("without a cartridge: Named shown name, Named stored name, Tubular Classics, then the first cartridge", () => {
        expect(stored(PulseGridCatalog.voice(book, "Vibraphone"))).toBe("Vibraphone|Tubular Classics")
        expect(stored(PulseGridCatalog.voice(book, "Vibes"))).toBe("Vibraphone|Tubular Classics")
        expect(stored(PulseGridCatalog.voice(book, "Bass Drum"))).toBe("FM Bass Drum|Tubular Classics")
        expect(stored(PulseGridCatalog.voice(book, "Xylophone3"))).toBe("Xylophone|SynprezFM 24")
        expect(stored(PulseGridCatalog.voice(book, "Rhodes"))).toBe("Rhodes|Tubular Classics")
        expect(stored(PulseGridCatalog.voice(book, "Shared"))).toBe("Shared|Tubular Classics")
        expect(stored(PulseGridCatalog.voice([book[2], book[1]], "Shared"))).toBe("Shared|SynprezFM 24")
        expect(stored(PulseGridCatalog.voice(book, "Only Here"))).toBe("Only Here|Zeta")
        expect(stored(PulseGridCatalog.voice(book, "Nothing"))).toBeUndefined()
    })

    it("does not care about case or the spaces around a name, and finds the same item the list holds", () => {
        const item = PulseGridCatalog.voice(book, "  vIbRaPhOnE  ")!
        expect(item).toEqual(PulseGridCatalog.items(undefined, book).find(other => other.id === item.id))
    })

    it("names up to five voices that hold a word of an unknown name", () => {
        const many = cartridge("Tubular Classics", "Bass A", "Bass B", "Bass C", "Bass D", "Bass E", "Bass F", "Pad")
        expect(PulseGridCatalog.similar([many], "Big Bass")).toEqual(["Bass A", "Bass B", "Bass C", "Bass D", "Bass E"])
        expect(PulseGridCatalog.similar([many], "Nothing")).toEqual([])
    })
})
