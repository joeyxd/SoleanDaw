import css from "./PulseGridRoll.sass?inline"
import {int, isDefined, Terminator} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Events, Html} from "@opendaw/lib-dom"
import {PulseGridActions, PulseGridDoc, PulseGridLaneDoc, PulseGridView} from "@opendaw/studio-adapters"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridLaneLogic} from "./PulseGridLaneLogic"
import {PulseGridRollLogic as Logic} from "./PulseGridRollLogic"
import {PulseGridRollDrags as Drags} from "./PulseGridRollDrags"

const className = Html.adoptStyleSheet(css, "PulseGridRoll")

type Construct = {
    inner: Terminator
    context: PulseGridContext
    doc: PulseGridDoc
    lane: PulseGridLaneDoc
    columns: int
}

export type PulseGridRollView = {
    // the grid: one line per row of PulseGridView.roll, its columns on the same tracks as the lane's step cells
    element: HTMLElement
    // the row names for the lane's side column: one per row, exactly as high as the rows of `element`
    labels: HTMLElement
    // one element per step of the pattern, in order: the lanes view puts the class "playing" on the one that plays
    cells: ReadonlyArray<HTMLElement>
}

export const PulseGridRoll = ({inner, context, doc, lane, columns}: Construct): PulseGridRollView => {
    const roll = PulseGridView.roll(doc, lane)
    const rowClass = (root: boolean, inScale: boolean): string =>
        Html.buildClassList(root && "root", !inScale && "outside")
    const cells = Array.from({length: roll.length}, (_, index): HTMLElement => (
        <div className={Html.buildClassList("col", PulseGridLaneLogic.isBeat(index + 1) && "beat")}
             data-step={String(index + 1)}
             style={{gridColumn: String(PulseGridLaneLogic.trackOf(index + 1)), gridRow: "1 / -1"}}/>
    ))
    const notes = roll.notes.map(note => {
        const span = Logic.span(note.step, note.length, roll.length)
        const element: HTMLElement = (
            <div className={Html.buildClassList("note", note.accent && "accent", note.chance < 100 && "chance")}
                 data-step={String(note.step)} data-pitch={String(note.pitch)}
                 style={{gridColumn: `${span.start} / ${span.end}`,
                     gridRow: String(roll.rows.findIndex(row => row.pitch === note.pitch) + 1),
                     width: span.width, "--lv": String(PulseGridLaneLogic.brightness(note.velocity))}}/>
        )
        return {note, element}
    })
    const element: HTMLElement = (
        <div className={className} data-roll={lane.id}
             style={{gridTemplateColumns: PulseGridLaneLogic.tracks(columns),
                 minWidth: `${PulseGridLaneLogic.minCellsWidth(columns)}px`,
                 gridTemplateRows: `repeat(${roll.rows.length}, ${Logic.RowHeight}px)`}}>
            {roll.rows.map((row, index) => (
                <div className={Html.buildClassList("line", rowClass(row.root, row.inScale))}
                     style={{gridRow: String(index + 1), gridColumn: "1 / -1"}}/>
            ))}
            {cells}
            {notes.map(({element}) => element)}
        </div>
    )
    const labels: HTMLElement = (
        <div className={Html.buildClassList(className, "labels")}
             style={{gridAutoRows: `${Logic.RowHeight}px`}}>
            {roll.rows.map(row => <div className={rowClass(row.root, row.inScale)}>{row.name}</div>)}
        </div>
    )
    const document = element.ownerDocument
    const view = document.defaultView ?? window
    const owner = Drags.owner(inner, context, document, lane.id)
    const markPicked = (): void => {
        const picked = context.picked.getValue()
        notes.forEach(({note, element}) => element.classList.toggle("picked",
            picked?.lane === lane.id && picked.notes.some(key => Logic.same(key, note))))
    }
    const cursor = (event?: PointerEvent): void => {
        const tool = context.tool.getValue()
        element.dataset.tool = tool
        const note = event?.target instanceof Element ? event.target.closest<HTMLElement>(".note") : null
        const edge = isDefined(note) && isDefined(event) && event.clientX >= note.getBoundingClientRect().right - 6
            && (tool === "paint" || (tool === "select" && note.classList.contains("picked")))
        element.classList.toggle("resize", edge)
    }
    inner.ownAll(
        context.picked.catchupAndSubscribe(markPicked),
        context.tool.catchupAndSubscribe(() => cursor()),
        Events.subscribe(element, "pointermove", cursor),
        Events.subscribe(element, "pointerleave", () => element.classList.remove("resize")),
        Events.subscribe(element, "pointerdown", (event: PointerEvent) => {
            if (event.button !== 0) {return}
            const hit = event.target instanceof Element ? event.target.closest<HTMLElement>(".note") : null
            const at = Drags.point(document, lane.id, event.clientX, event.clientY, isDefined(hit))
            if (!isDefined(at)) {return}
            event.preventDefault()
            context.selectedLane.setValue(lane.id)
            const note = isDefined(hit) ? {step: Number(hit.dataset.step), pitch: Number(hit.dataset.pitch)} : undefined
            const edge = isDefined(hit) && event.clientX >= hit.getBoundingClientRect().right - 6
            Drags.start(owner, context, document, doc, lane, event, at, note, edge)
        }),
        Events.subscribe(view, "pointerdown", (event: PointerEvent) => {
            const target = event.target
            if (!(target instanceof Element) || !isDefined(target.closest("[data-roll]"))) {
                context.picked.setValue(undefined)
            }
        }, {capture: true}),
        Events.subscribe(view, "keydown", (event: KeyboardEvent) => {
            if (event.key !== "Delete" && event.key !== "Backspace") {return}
            const target = event.target
            if (target instanceof Element && isDefined(target.closest("input, textarea, [contenteditable]:not([contenteditable=false])"))) {return}
            const picked = context.picked.getValue()
            if (picked?.lane !== lane.id || picked.notes.length === 0) {return}
            event.preventDefault()
            event.stopImmediatePropagation()
            const keys = picked.notes
            context.picked.setValue(undefined)
            context.send(PulseGridActions.removeNotes(lane.id, keys))
        }, {capture: true}))
    return {element, labels, cells}
}
