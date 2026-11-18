import {describe, expect, it} from "vitest"
import {PulseGridCatalogItem} from "@opendaw/studio-adapters"
import {PulseGridBrowserLogic as Logic, PulseGridBrowserRow, PulseGridBrowserStore} from "./PulseGridBrowserLogic"

const sound = (category: PulseGridCatalogItem["category"], name: string, folder: Array<string> = []): PulseGridCatalogItem => ({
    id: `x:${category}/${folder.join("/")}/${name}`, name, category, folder, kind: category === "drums" ? "drum" : "melodic",
    source: {type: "sample", sample: {uuid: name, name, duration: 1}}
})

const items = [
    sound("drums", "Kick"), sound("drums", "Snare"),
    sound("drums", "Bass Drum", ["TR-808"]), sound("drums", "Clap", ["TR-808"]), sound("drums", "Kick", ["TR-909"]),
    sound("bass", "Slap Bass"),
    sound("synths", "Soft Rhodes"), sound("synths", "Brass", ["More FM voices", "ROM1A"]),
    sound("synths", "Flute", ["More FM voices", "ROM1B"]),
    sound("mallets", "Marimba"), sound("mallets", "Vibraphone")
]
const none: ReadonlySet<string> = new Set()
const names = (rows: ReadonlyArray<PulseGridBrowserRow>): Array<string> =>
    rows.map(row => row.type === "item" ? row.item.name : `[${row.name}]`)

describe("PulseGridBrowserLogic.view without a query", () => {
    it("makes one group per category with its sounds first, then its folders closed", () => {
        const {sections, more} = Logic.view(items, "all", "", none, none)
        expect(sections.map(section => section.key)).toEqual(["drums", "bass", "synths", "mallets"])
        expect(names(sections[0].rows)).toEqual(["Kick", "Snare", "[TR-808]", "[TR-909]"])
        expect(names(sections[2].rows)).toEqual(["Soft Rhodes", "[More FM voices]"])
        expect(more).toBe(0)
    })
    it("opens a folder in place and nests the folders inside it", () => {
        const open = new Set([Logic.folderKey("drums", ["TR-808"]), Logic.folderKey("synths", ["More FM voices"])])
        const {sections} = Logic.view(items, "all", "", none, open)
        expect(names(sections[0].rows)).toEqual(["Kick", "Snare", "[TR-808]", "Bass Drum", "Clap", "[TR-909]"])
        expect(names(sections[2].rows)).toEqual(["Soft Rhodes", "[More FM voices]", "[ROM1A]", "[ROM1B]"])
        const inner = sections[2].rows[2]
        expect(inner.type === "folder" && inner.path).toBe("More FM voices/ROM1A")
        expect(inner.type === "folder" && inner.depth).toBe(1)
        const opened = sections[2].rows[1]
        expect(opened.type === "folder" && opened.open).toBe(true)
    })
    it("shows the folder's sounds at a deeper level only when the whole path is open", () => {
        const open = new Set([Logic.folderKey("synths", ["More FM voices"]), Logic.folderKey("synths", ["More FM voices", "ROM1A"])])
        const rows = Logic.view(items, "synths", "", none, open).sections[1].rows
        expect(names(rows)).toEqual(["Soft Rhodes", "[More FM voices]", "[ROM1A]", "Brass", "[ROM1B]"])
        const brass = rows[3]
        expect(brass.type === "item" && brass.depth).toBe(2)
    })
    it("holds Bass and Synths in the Synths tab, and only the Mallets in theirs", () => {
        expect(Logic.view(items, "synths", "", none, none).sections.map(section => section.key)).toEqual(["bass", "synths"])
        expect(Logic.view(items, "mallets", "", none, none).sections.map(section => section.key)).toEqual(["mallets"])
        expect(Logic.view(items, "drums", "", none, none).sections.map(section => section.key)).toEqual(["drums"])
    })
    it("puts the favourites first, and leaves the group out when none pass the tab", () => {
        const favourites = new Set([items[9].id, items[0].id])
        const all = Logic.view(items, "all", "", favourites, none).sections
        expect(all[0].key).toBe("favourites")
        expect(names(all[0].rows)).toEqual(["Kick", "Marimba"])
        expect(all.slice(1).map(section => section.key)).toEqual(["drums", "bass", "synths", "mallets"])
        const synths = Logic.view(items, "synths", "", favourites, none).sections
        expect(synths.map(section => section.key)).toEqual(["bass", "synths"])
        const mallets = Logic.view(items, "mallets", "", favourites, none).sections
        expect(names(mallets[0].rows)).toEqual(["Marimba"])
    })
    it("tells a favourite's folder in its hint", () => {
        const favourites = new Set([items[2].id])
        const row = Logic.view(items, "all", "", favourites, none).sections[0].rows[0]
        expect(row.type === "item" && row.hint).toBe("TR-808")
    })
})

describe("PulseGridBrowserLogic.view with a query", () => {
    it("gives one flat list of the matches with their folders, folders closed or not", () => {
        const {sections, more} = Logic.view(items, "all", "kick", none, none)
        expect(sections.map(section => section.key)).toEqual(["matches"])
        expect(names(sections[0].rows)).toEqual(["Kick", "Kick"])
        const second = sections[0].rows[1]
        expect(second.type === "item" && second.hint).toBe("TR-909")
        expect(more).toBe(0)
    })
    it("matches a folder name too, and keeps the favourites first", () => {
        const view = Logic.view(items, "all", "tr-808", new Set([items[3].id]), none)
        expect(view.sections.map(section => section.key)).toEqual(["favourites", "matches"])
        expect(names(view.sections[0].rows)).toEqual(["Clap"])
        expect(names(view.sections[1].rows)).toEqual(["Bass Drum", "Clap"])
    })
    it("applies the tab to the matches", () => {
        expect(names(Logic.view(items, "mallets", "a", none, none).sections[0].rows)).toEqual(["Marimba", "Vibraphone"])
    })
    it("cuts at 200 rows and counts the rest", () => {
        const many = Array.from({length: 230}, (_, index) => sound("drums", `Hit ${index}`, ["Pack"]))
        const {sections, more} = Logic.view(many, "all", "hit", none, none)
        expect(sections[0].rows.length).toBe(Logic.MaxRows)
        expect(more).toBe(30)
        expect(Logic.more(more)).toBe("30 more. Type more letters.")
    })
    it("has no rows and no more-line when nothing matches", () => {
        const view = Logic.view(items, "all", "zzz", none, none)
        expect(view.sections).toEqual([])
        expect(view.more).toBe(0)
        expect(Logic.noMatch("  zzz ")).toBe('No sound matches "zzz".')
    })
    it("treats a query of spaces as no query", () => {
        expect(Logic.hasQuery("   ")).toBe(false)
        expect(Logic.view(items, "all", "  ", none, none).sections[0].key).toBe("drums")
    })
})

describe("PulseGridBrowserLogic favourites", () => {
    const memory = (start?: string): PulseGridBrowserStore & {text: () => string | null} => {
        let text: string | null = start ?? null
        const store = {getItem: (_: string) => text, setItem: (_: string, value: string) => {text = value}}
        return Object.assign(() => store, {text: () => text})
    }
    const blocked: PulseGridBrowserStore = () => {throw new Error("SecurityError")}
    const refusing: PulseGridBrowserStore = () => ({
        getItem: () => null, setItem: () => {throw new Error("QuotaExceededError")}
    })

    it("reads the ids under pulsegrid.favourites", () => {
        expect(Logic.StorageKey).toBe("pulsegrid.favourites")
        expect(Logic.readFavourites(memory('["a","b"]'))).toEqual(["a", "b"])
    })
    it("reads nothing from an empty, broken or odd value", () => {
        expect(Logic.readFavourites(memory())).toEqual([])
        expect(Logic.readFavourites(memory("{not json"))).toEqual([])
        expect(Logic.readFavourites(memory('{"a": 1}'))).toEqual([])
        expect(Logic.readFavourites(memory('["a", 3, null, "b"]'))).toEqual(["a", "b"])
    })
    it("reads and writes nothing, without throwing, when the storage is blocked", () => {
        expect(Logic.readFavourites(blocked)).toEqual([])
        expect(Logic.writeFavourites(blocked, ["a"])).toBe(false)
        expect(Logic.writeFavourites(refusing, ["a"])).toBe(false)
    })
    it("writes a JSON array that reads back", () => {
        const store = memory()
        expect(Logic.writeFavourites(store, ["a", "b"])).toBe(true)
        expect(store.text()).toBe('["a","b"]')
        expect(Logic.readFavourites(store)).toEqual(["a", "b"])
    })
    it("toggles an id in and out", () => {
        expect(Logic.toggleFavourite(["a"], "b")).toEqual(["a", "b"])
        expect(Logic.toggleFavourite(["a", "b"], "a")).toEqual(["b"])
    })
})

describe("PulseGridBrowserLogic.dropTarget", () => {
    const lanes = {left: 200, top: 100, right: 900, bottom: 500}
    const rows = [
        {id: "kick", left: 210, top: 150, right: 890, bottom: 184},
        {id: "snare", left: 210, top: 188, right: 890, bottom: 222},
        {id: "lead", left: 210, top: 480, right: 890, bottom: 560}
    ]
    it("is the lane row under the point", () => {
        expect(Logic.dropTarget(400, 160, lanes, rows)).toEqual({type: "lane", id: "kick"})
        expect(Logic.dropTarget(400, 200, lanes, rows)).toEqual({type: "lane", id: "snare"})
    })
    it("is a new lane between rows and in the lanes' margin", () => {
        expect(Logic.dropTarget(400, 186, lanes, rows)).toEqual({type: "new"})
        expect(Logic.dropTarget(205, 160, lanes, rows)).toEqual({type: "new"})
        expect(Logic.dropTarget(400, 300, lanes, rows)).toEqual({type: "new"})
    })
    it("is nothing outside the lanes, even over a row that was scrolled out of them", () => {
        expect(Logic.dropTarget(50, 160, lanes, rows)).toEqual({type: "none"})
        expect(Logic.dropTarget(400, 520, lanes, rows)).toEqual({type: "none"})
        expect(Logic.dropTarget(400, 90, lanes, rows)).toEqual({type: "none"})
    })
    it("tells a click from a drag at 4 px", () => {
        expect(Logic.moved(3, 0)).toBe(false)
        expect(Logic.moved(2, 2)).toBe(false)
        expect(Logic.moved(0, -4)).toBe(true)
    })
})
