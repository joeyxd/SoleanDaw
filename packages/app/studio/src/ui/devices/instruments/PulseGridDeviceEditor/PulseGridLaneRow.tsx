import {Client, int, Terminator} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Events, Html} from "@opendaw/lib-dom"
import {ContextMenu} from "@opendaw/studio-core"
import {PulseGridActions, PulseGridDoc, PulseGridLaneDoc, PulseGridView} from "@opendaw/studio-adapters"
import {Surface} from "@/ui/surface/Surface.tsx"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridAudition} from "./PulseGridAudition"
import flashCss from "./PulseGridLaneFlash.sass?inline"
import {PulseGridLaneLogic} from "./PulseGridLaneLogic"
import {PulseGridLaneMenus} from "./PulseGridLaneMenus"
import {PulseGridRoll} from "./PulseGridRoll"
import {PulseGridValueRows} from "./PulseGridValueRows"

const flashClass = Html.adoptStyleSheet(flashCss, "PulseGridLaneFlash")

type Construct = {
    inner: Terminator
    context: PulseGridContext
    doc: PulseGridDoc
    lane: PulseGridLaneDoc
    columns: int
    anySolo: boolean
    paint: (cell: HTMLElement, laneId: string, step: int, on: boolean) => void
    reorder: (handle: HTMLElement, laneId: string) => void
}

export type PulseGridLaneRowView = {
    element: HTMLElement
    cells: ReadonlyArray<HTMLElement>
    // the step columns of the lane's piano roll when it is open, for the playhead; empty otherwise
    rollCells: ReadonlyArray<HTMLElement>
    length: int
}

// One lane: its head (handle, arrow, colour, name, sound, M and S) and exactly as many cells as its pattern is
// long. An open lane (context.openLanes) has more under its step row: a melodic lane its piano roll, every lane
// the velocity, chance and accent rows; their names stand under the head. The subscriptions go to `inner`, which
// the caller ends before it builds the rows again.
export const PulseGridLaneRow = ({inner, context, doc, lane, columns, anySolo, paint, reorder}: Construct): PulseGridLaneRowView => {
    const {length, own, steps} = PulseGridView.steps(doc, lane)
    const sub = [lane.sound?.label, own ? `/${length}` : undefined].filter(part => part !== undefined).join(" ")
    const cells = steps.map((value, index): HTMLElement => {
        const step = index + 1
        const cell: HTMLElement = (
            <div className={Html.buildClassList("cell",
                value !== undefined && "on",
                value?.accent && "accent",
                value !== undefined && value.chance < 100 && "chance")}
                 data-lane={lane.id}
                 data-step={String(step)}
                 style={{
                     gridColumn: String(PulseGridLaneLogic.trackOf(step)),
                     ...(value === undefined ? {} : {"--lv": String(PulseGridLaneLogic.brightness(value.velocity))})
                 }}/>
        )
        inner.own(Events.subscribe(cell, "pointerdown", (event: PointerEvent) => {
            if (event.button !== 0) {return}
            event.preventDefault()
            if (context.tool.getValue() === "listen") {
                PulseGridAudition.step(context, lane.id, step)
                return
            }
            paint(cell, lane.id, step, value === undefined)
        }))
        if (value !== undefined) {
            inner.own(ContextMenu.subscribe(cell, collector => PulseGridLaneMenus.step(context, lane, step, value)
                .forEach(group => collector.addItems(...group))))
        }
        return cell
    })
    const name: HTMLElement = <span className="name">{lane.name}</span>
    const grip: HTMLElement = <span className="grip" title="Drag to reorder"/>
    const open = context.openLanes.getValue().has(lane.id)
    const fold: HTMLElement = (
        <button className={Html.buildClassList("fold", open && "open")}
                title={open ? "Close" : lane.kind === "melodic" ? "Open the piano roll" : "Open velocity, chance and accent"}
                aria-expanded={String(open)}>▸</button>
    )
    const mini = (label: string, title: string, on: boolean, toggle: () => void): HTMLElement => {
        const button: HTMLElement = <button className={Html.buildClassList("mini", on && "on")} title={title}>{label}</button>
        inner.ownAll(
            Events.subscribe(button, "pointerdown", (event: PointerEvent) => event.stopPropagation()),
            Events.subscribe(button, "click", toggle))
        return button
    }
    const head: HTMLElement = (
        <div className="head">
            {grip}
            {fold}
            <span className="led"/>
            <div className="names">
                {name}
                <span className="sub">{sub}</span>
            </div>
            {mini("M", "Mute", lane.mix.mute, () => context.send(PulseGridActions.setMute(lane.id, !lane.mix.mute)))}
            {mini("S", "Solo", lane.mix.solo, () => context.send(PulseGridActions.setSolo(lane.id, !lane.mix.solo)))}
        </div>
    )
    const rename = (client: Client): void => {
        Surface.get(name).requestFloatingTextInput(client, lane.name).then(text => {
            const next = text.trim()
            if (next !== "" && next !== lane.name) {context.send(PulseGridActions.renameLane(lane.id, next))}
        })
    }
    inner.ownAll(
        Events.subscribe(head, "pointerdown", (event: PointerEvent) => {
            if (event.button === 0) {context.selectedLane.setValue(lane.id)}
        }),
        Events.subscribe(grip, "pointerdown", (event: PointerEvent) => {
            if (event.button !== 0) {return}
            event.preventDefault()
            reorder(grip, lane.id)
        }),
        Events.subscribe(fold, "pointerdown", (event: PointerEvent) => event.stopPropagation()),
        Events.subscribe(fold, "click", () => {
            const next = new Set(context.openLanes.getValue())
            if (!next.delete(lane.id)) {next.add(lane.id)}
            context.openLanes.setValue(next)
            context.selectedLane.setValue(lane.id)
        }),
        Events.subscribeDblDwn(name, rename),
        ContextMenu.subscribe(head, collector => PulseGridLaneMenus.lane(context, lane, () => rename(collector.client))
            .forEach(group => collector.addItems(...group))))
    const stepRow: HTMLElement = (
        <div className="cells"
             style={{
                 gridTemplateColumns: PulseGridLaneLogic.tracks(columns),
                 minWidth: `${PulseGridLaneLogic.minCellsWidth(columns)}px`
             }}>
            {cells}
        </div>
    )
    const roll = open && lane.kind === "melodic" ? PulseGridRoll({inner, context, doc, lane, columns}) : undefined
    const values = open ? PulseGridValueRows({inner, context, doc, lane, columns}) : undefined
    const element: HTMLElement = (
        <div className={Html.buildClassList("row", open && "open", flashClass,
            PulseGridLaneLogic.isQuiet(lane, anySolo) && "quiet")}
             data-lane={lane.id}
             style={{"--lane": `hsl(${lane.hue} 98% 60%)`}}>
            {open ? <div className="side">{head}{roll?.labels}{values?.labels}</div> : head}
            {open ? <div className="body">{stepRow}{roll?.element}{values?.element}</div> : stepRow}
        </div>
    )
    // An agent changed this lane: play the highlight. The row is built again after a change, and this catches up
    // with the flash still running, so the new row plays it too. The context empties `flash` once it has played.
    inner.own(Events.subscribe(element, "animationend", () => element.classList.remove("flash")))
    inner.own(context.flash.catchupAndSubscribe(owner => {
        if (!owner.getValue().includes(lane.id)) {return}
        element.classList.remove("flash")
        void element.offsetWidth // restart the animation when it is already playing
        element.classList.add("flash")
    }))
    return {element, cells, rollCells: roll?.cells ?? [], length}
}
