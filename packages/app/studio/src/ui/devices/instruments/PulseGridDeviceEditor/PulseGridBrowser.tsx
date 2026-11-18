import css from "./PulseGridBrowser.sass?inline"
import {DefaultObservableValue, Lifecycle, Optional, Terminator} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Events, Html} from "@opendaw/lib-dom"
import {PulseGridActions, PulseGridCatalogItem, PulseGridCatalogTab} from "@opendaw/studio-adapters"
import {SearchInput} from "@/ui/components/SearchInput"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridBrowserDrags} from "./PulseGridBrowserDrags"
import {PulseGridBrowserLogic as Logic, PulseGridBrowserRow} from "./PulseGridBrowserLogic"
import {PulseGridSoundBook, PulseGridSounds} from "./PulseGridSounds"

const className = Html.adoptStyleSheet(css, "PulseGridBrowser")

type Construct = {lifecycle: Lifecycle, context: PulseGridContext}

const Indent = 12

// The sounds a lane can take, under the scenes (SPEC.md, section 11). A click on a name gives the selected lane the
// sound, + makes a lane with it, a drag lands on a lane or on the lanes. It reads the document and writes ops with
// `context.send`; the favourites are kept in local storage, not in the project.
export const PulseGridBrowser = ({lifecycle, context}: Construct): HTMLElement => {
    const query = lifecycle.own(new DefaultObservableValue<string>(""))
    const drags = lifecycle.own(new Terminator())
    const state: {
        tab: PulseGridCatalogTab, favourites: ReadonlyArray<string>, open: Set<string>,
        book: Optional<PulseGridSoundBook>, byId: Map<string, PulseGridCatalogItem>, suppressClick: boolean
    } = {
        tab: "all", favourites: Logic.readFavourites(() => localStorage), open: new Set(),
        book: undefined, byId: new Map(), suppressClick: false
    }
    PulseGridSounds.load()

    const list: HTMLElement = <div className="list"/>
    const tabs: ReadonlyArray<HTMLElement> = Logic.Tabs.map(({key, label}) => {
        const button: HTMLElement = (
            <button type="button" role="tab" data-tab={key}>{label}</button>
        )
        lifecycle.own(Events.subscribe(button, "click", () => {
            state.tab = key
            render()
        }))
        return button
    })
    const search: HTMLElement = (
        <div className="search" data-search="">
            <SearchInput lifecycle={lifecycle} model={query} placeholder="Search sounds"/>
        </div>
    )
    const element: HTMLElement = (
        <section className={className} data-browser="" aria-label="Sounds">
            <div className="heading">SOUNDS</div>
            <div className="tabs" role="tablist">{tabs}</div>
            {search}
            {list}
        </section>
    )
    const lanes = (): Optional<HTMLElement> =>
        element.closest(".main")?.querySelector<HTMLElement>(":scope > .lanes") ?? undefined

    const addLane = (item: PulseGridCatalogItem): void => {
        context.send(PulseGridActions.addSoundLane(context.doc.getValue(), item))
    }
    // the selected lane takes the sound; with no lane (or one that is gone) a new lane does
    const take = (item: PulseGridCatalogItem): void => {
        const lane = context.selectedLane.getValue()
        if (lane !== undefined && context.doc.getValue().lanes.some(entry => entry.id === lane)) {
            context.send(PulseGridActions.loadSound(lane, item))
        } else {
            addLane(item)
        }
    }
    const toggleFavourite = (item: PulseGridCatalogItem): void => {
        state.favourites = Logic.toggleFavourite(state.favourites, item.id)
        Logic.writeFavourites(() => localStorage, state.favourites)
        render()
    }
    const toggleFolder = (key: string): void => {
        if (!state.open.delete(key)) {state.open.add(key)}
        render()
    }

    const itemElement = (row: Extract<PulseGridBrowserRow, {type: "item"}>): HTMLElement => {
        const {item, depth, hint} = row
        const liked = state.favourites.includes(item.id)
        return (
            <div className="item" data-item={item.id} style={{paddingLeft: `${depth * Indent}px`}}>
                <button type="button" className={Html.buildClassList("heart", liked && "on")} data-heart=""
                        aria-label="Favourite" aria-pressed={String(liked)} title="Favourite">{liked ? "♥" : "♡"}</button>
                <button type="button" className="pick" data-pick="" title={hint === "" ? item.name : `${item.name} (${hint})`}>
                    <span className="name">{item.name}</span>
                    {hint === "" ? null : <span className="hint">{hint}</span>}
                </button>
                <button type="button" className="add" data-add="" aria-label="New lane with this sound"
                        title="New lane with this sound">+</button>
            </div>
        )
    }
    const folderElement = (row: Extract<PulseGridBrowserRow, {type: "folder"}>): HTMLElement => (
        <button type="button" className={Html.buildClassList("folder", row.open && "open")} data-folder={row.path}
                data-key={row.key} aria-expanded={String(row.open)} style={{paddingLeft: `${row.depth * Indent + 4}px`}}>
            <span className="chevron" aria-hidden="true">▸</span>
            <span className="label">{row.name}</span>
        </button>
    )
    const line = (text: string, hook: "state" | "more"): HTMLElement => {
        const element: HTMLElement = <div className={hook} role="status">{text}</div>
        element.setAttribute(`data-${hook}`, "")
        return element
    }

    // What to give focus back to after the list is built again: the same button of the same row in the same group.
    const focusSelector = (): Optional<string> => {
        const active = list.ownerDocument.activeElement
        if (!(active instanceof HTMLElement) || !list.contains(active)) {return undefined}
        const group = active.closest<HTMLElement>("[data-group]")?.dataset.group
        const scope = group === undefined ? "" : `[data-group="${CSS.escape(group)}"] `
        const folder = active.closest<HTMLElement>("[data-folder]")
        if (folder !== null) {return `${scope}[data-folder="${CSS.escape(folder.dataset.folder ?? "")}"]`}
        const item = active.closest<HTMLElement>("[data-item]")
        const part = ["heart", "pick", "add"].find(name => active.hasAttribute(`data-${name}`))
        if (item === null || part === undefined) {return undefined}
        return `${scope}[data-item="${CSS.escape(item.dataset.item ?? "")}"] [data-${part}]`
    }

    const render = (): void => {
        tabs.forEach(button => {
            const on = button.dataset.tab === state.tab
            button.classList.toggle("active", on)
            button.setAttribute("aria-selected", String(on))
        })
        const scroll = list.scrollTop
        const focus = focusSelector()
        const book = PulseGridSounds.catalogue()
        if (book !== state.book) {
            state.book = book
            state.byId = new Map(book.status === "ready" ? book.items.map(item => [item.id, item]) : [])
        }
        if (book.status !== "ready") {
            list.replaceChildren(line(book.status === "failed" ? "Sounds are not available" : "Loading sounds…", "state"))
            return
        }
        const text = query.getValue()
        const {sections, more} = Logic.view(book.items, state.tab, text, new Set(state.favourites), state.open)
        const built: Array<HTMLElement> = sections.map(section => (
            <section className="group" data-group={section.key}>
                {section.title === "" ? null : <div className="title">{section.title}</div>}
                {section.rows.map(row => row.type === "item" ? itemElement(row) : folderElement(row))}
            </section>
        ))
        if (more > 0) {built.push(line(Logic.more(more), "more"))}
        if (sections.length === 0) {
            built.push(line(Logic.hasQuery(text) ? Logic.noMatch(text) : "Nothing in this tab.", "state"))
        }
        list.replaceChildren(...built)
        list.scrollTop = scroll
        if (focus !== undefined) {list.querySelector<HTMLElement>(focus)?.focus({preventScroll: true})}
    }

    const itemOf = (target: EventTarget | null): Optional<PulseGridCatalogItem> => {
        const id = target instanceof Element ? target.closest<HTMLElement>("[data-item]")?.dataset.item : undefined
        return id === undefined ? undefined : state.byId.get(id)
    }
    lifecycle.ownAll(
        Events.subscribe(search, "keydown", (event: KeyboardEvent) => event.stopPropagation()),
        Events.subscribe(list, "pointerdown", (event: PointerEvent) => {
            state.suppressClick = false
            if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest("[data-pick]") === null) {return}
            const item = itemOf(event.target)
            if (item === undefined) {return}
            // one drag at a time: a second finger ends the first press before it starts its own
            drags.terminate()
            // the click that follows a drag is ignored; the flag falls after that click, so the keyboard works again
            PulseGridBrowserDrags.start(context, drags, item, event, lanes, () => {state.suppressClick = true},
                () => {setTimeout(() => {state.suppressClick = false}, 0)})
        }),
        Events.subscribe(list, "click", (event: MouseEvent) => {
            const target = event.target
            if (!(target instanceof Element)) {return}
            const item = itemOf(target)
            if (item === undefined) {
                const key = target.closest<HTMLElement>("[data-folder]")?.dataset.key
                if (key !== undefined) {toggleFolder(key)}
            } else if (target.closest("[data-heart]") !== null) {
                toggleFavourite(item)
            } else if (target.closest("[data-add]") !== null) {
                addLane(item)
            } else if (target.closest("[data-pick]") !== null && !state.suppressClick) {
                take(item)
            }
        }),
        query.subscribe(() => render()),
        PulseGridSounds.subscribe(render))
    render()
    return element
}
