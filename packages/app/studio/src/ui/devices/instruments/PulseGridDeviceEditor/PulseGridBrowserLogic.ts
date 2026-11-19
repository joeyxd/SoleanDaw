import {int} from "@opendaw/lib-std"
import {PulseGridCatalog, PulseGridCatalogItem, PulseGridCatalogTab, PulseGridSoundInput} from "@opendaw/studio-adapters"

type Category = PulseGridCatalogItem["category"]

// One row of the sound list: a sound, or the header of a folder (closed folders have no rows under them).
export type PulseGridBrowserRow =
    | {type: "item", item: PulseGridCatalogItem, depth: int, hint: string}
    | {type: "folder", key: string, path: string, name: string, depth: int, open: boolean}

// A group of the list. "matches" is the one flat list of a search and has no title.
export type PulseGridBrowserSection = {key: string, title: string, rows: ReadonlyArray<PulseGridBrowserRow>}

export type PulseGridBrowserView = {sections: ReadonlyArray<PulseGridBrowserSection>, more: int}

// Where a dragged sound lands: on a lane row, anywhere else in the lanes, or nowhere.
export type PulseGridDropTarget = {type: "lane", id: string} | {type: "new"} | {type: "none"}

export type PulseGridBrowserBox = {left: number, top: number, right: number, bottom: number}

// One favourite as Nitro keeps it for the Desk (Nitro's daw/pulsegrid/AGENT_WIRE.md, section 7). `sound` is what an
// agent pastes into setLaneSound or addLane unchanged.
export type PulseGridFavourite = {id: string, name: string, category: string, sound: PulseGridSoundInput}

// What the favourites live in: a function, because even reaching `localStorage` can throw when it is blocked.
export type PulseGridBrowserStore = () => Pick<Storage, "getItem" | "setItem">

// The part of the sound browser that needs no DOM: what the list shows for a tab and a query, the favourites in
// local storage, and which lane a drag lands on (SPEC.md, section 11).
export namespace PulseGridBrowserLogic {
    export const MaxRows = 200
    export const DragThreshold = 4
    export const StorageKey = "pulsegrid.favourites"
    export const Tabs: ReadonlyArray<{key: PulseGridCatalogTab, label: string}> = [
        {key: "all", label: "All"}, {key: "drums", label: "Drums"},
        {key: "synths", label: "Synths"}, {key: "mallets", label: "Mallets"}
    ]
    export const Categories: ReadonlyArray<{key: Category, title: string}> = [
        {key: "drums", title: "Drums"}, {key: "bass", title: "Bass"},
        {key: "synths", title: "Synths"}, {key: "mallets", title: "Mallets"}
    ]

    // Said once, quietly, where the library's folders would be, when the server does not let this site read them.
    export const NotAllowed = "openDAW's sample library is not available on this site."

    export const hasQuery = (query: string): boolean => query.trim() !== ""

    export const moved = (dx: number, dy: number): boolean => Math.hypot(dx, dy) >= DragThreshold

    export const more = (count: int): string => `${count} more. Type more letters.`

    export const noMatch = (query: string): string => `No sound matches "${query.trim()}".`

    export const folderKey = (category: Category, path: ReadonlyArray<string>): string => `${category}/${path.join("/")}`

    const itemRow = (item: PulseGridCatalogItem, depth: int, hint: boolean): PulseGridBrowserRow =>
        ({type: "item", item, depth, hint: hint ? item.folder.join(" / ") : ""})

    // The items of one category from `depth` down: first the sounds that sit at this depth, then each folder (in the
    // order they appear) with its contents when it is open.
    const tree = (category: Category, items: ReadonlyArray<PulseGridCatalogItem>, depth: int,
                  open: ReadonlySet<string>, out: Array<PulseGridBrowserRow>): void => {
        items.filter(item => item.folder.length === depth).forEach(item => out.push(itemRow(item, depth, false)))
        const folders = new Map<string, Array<PulseGridCatalogItem>>()
        items.filter(item => item.folder.length > depth).forEach(item => {
            const name = item.folder[depth]
            const held = folders.get(name)
            if (held === undefined) {folders.set(name, [item])} else {held.push(item)}
        })
        folders.forEach((held, name) => {
            const path = held[0].folder.slice(0, depth + 1)
            const key = folderKey(category, path)
            const isOpen = open.has(key)
            out.push({type: "folder", key, path: path.join("/"), name, depth, open: isOpen})
            if (isOpen) {tree(category, held, depth + 1, open, out)}
        })
    }

    // What the list shows. `favourites` are item ids, `open` the keys (folderKey) of the folders that are open.
    // Favourites that pass the tab and the query stand first. With a query the rest is one flat list of at most
    // MaxRows matches and `more` says how many were left out; without one it is the four categories in `Tabs` order.
    export const view = (items: ReadonlyArray<PulseGridCatalogItem>, tab: PulseGridCatalogTab, query: string,
                         favourites: ReadonlySet<string>, open: ReadonlySet<string>): PulseGridBrowserView => {
        const matches = PulseGridCatalog.find(items, {tab, query})
        const sections: Array<PulseGridBrowserSection> = []
        const liked = matches.filter(item => favourites.has(item.id))
        if (liked.length > 0) {
            sections.push({key: "favourites", title: "Favourites", rows: liked.map(item => itemRow(item, 0, true))})
        }
        if (hasQuery(query)) {
            const shown = matches.slice(0, MaxRows)
            if (shown.length > 0) {sections.push({key: "matches", title: "", rows: shown.map(item => itemRow(item, 0, true))})}
            return {sections, more: matches.length - shown.length}
        }
        Categories.forEach(({key, title}) => {
            const held = matches.filter(item => item.category === key)
            if (held.length === 0) {return}
            const rows: Array<PulseGridBrowserRow> = []
            tree(key, held, 0, open, rows)
            sections.push({key, title, rows})
        })
        return {sections, more: 0}
    }

    // The favourites kept in this browser, in the order they were made. A blocked or broken storage gives none.
    export const readFavourites = (store: PulseGridBrowserStore): ReadonlyArray<string> => {
        try {
            const raw = store().getItem(StorageKey)
            if (raw === null) {return []}
            const parsed: unknown = JSON.parse(raw)
            return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
        } catch {
            return []
        }
    }

    // False when the storage refused: the favourite then lasts as long as the window does.
    export const writeFavourites = (store: PulseGridBrowserStore, ids: ReadonlyArray<string>): boolean => {
        try {
            store().setItem(StorageKey, JSON.stringify(ids))
            return true
        } catch {
            return false
        }
    }

    export const toggleFavourite = (ids: ReadonlyArray<string>, id: string): ReadonlyArray<string> =>
        ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]

    // The favourites Nitro gave back: records with a string id, name and category and an object sound. Anything
    // else is dropped, and a repeated id keeps the first.
    export const parseFavourites = (items: ReadonlyArray<unknown>): ReadonlyArray<PulseGridFavourite> => {
        const seen = new Set<string>()
        return items.filter((item): item is PulseGridFavourite => {
            if (typeof item !== "object" || item === null) {return false}
            const {id, name, category, sound} = item as Record<string, unknown>
            if (typeof id !== "string" || typeof name !== "string" || typeof category !== "string"
                || typeof sound !== "object" || sound === null || seen.has(id)) {return false}
            seen.add(id)
            return true
        })
    }

    // What Nitro stores for these ids, in their order. A sound this tab has loaded is described afresh; one it has
    // not (a library that does not load here) keeps the record Nitro gave; an id with neither is left out.
    export const favouriteRecords = (ids: ReadonlyArray<string>, loaded: ReadonlyMap<string, PulseGridCatalogItem>,
                                     known: ReadonlyMap<string, PulseGridFavourite>): ReadonlyArray<PulseGridFavourite> =>
        ids.flatMap(id => {
            const item = loaded.get(id)
            if (item !== undefined) {
                return [{id, name: item.name, category: item.category, sound: PulseGridCatalog.sound(item)}]
            }
            const record = known.get(id)
            return record === undefined ? [] : [record]
        })

    const inside = (box: PulseGridBrowserBox, x: number, y: number): boolean =>
        x >= box.left && x < box.right && y >= box.top && y < box.bottom

    // The point is on a lane row (the first one that holds it), else inside the lanes, else nowhere. A row that was
    // scrolled out of the lanes does not count: the lanes' own box comes first.
    export const dropTarget = (x: number, y: number, lanes: PulseGridBrowserBox,
                               rows: ReadonlyArray<PulseGridBrowserBox & {id: string}>): PulseGridDropTarget => {
        if (!inside(lanes, x, y)) {return {type: "none"}}
        const row = rows.find(row => inside(row, x, y))
        return row === undefined ? {type: "new"} : {type: "lane", id: row.id}
    }
}
