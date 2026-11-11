import css from "./PulseGridValueRows.sass?inline"
import {int, Terminator} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Events, Html} from "@opendaw/lib-dom"
import {PulseGridDoc, PulseGridLaneDoc, PulseGridStep, PulseGridView} from "@opendaw/studio-adapters"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridLaneLogic} from "./PulseGridLaneLogic"
import {PulseGridValueDrags, PulseGridValueKind} from "./PulseGridValueDrags"
import {PulseGridValueLogic} from "./PulseGridValueLogic"

const className = Html.adoptStyleSheet(css, "PulseGridValueRows")

type Construct = {
    inner: Terminator
    context: PulseGridContext
    doc: PulseGridDoc
    lane: PulseGridLaneDoc
    columns: int
}

export type PulseGridValueRowsView = {
    // three rows (velocity, chance, accent), each with one place per step on the same tracks as the lane's cells
    element: HTMLElement
    // their three names for the lane's side column, exactly as high as the rows of `element`
    labels: HTMLElement
}

const Rows: ReadonlyArray<{kind: PulseGridValueKind, name: string, height: int}> = [
    {kind: "velocity", name: "Velocity", height: PulseGridValueLogic.VelocityHeight},
    {kind: "chance", name: "Chance", height: PulseGridValueLogic.ChanceHeight},
    {kind: "accent", name: "Accent", height: PulseGridValueLogic.AccentHeight}
]

// The face of one step in a row; a step without a note has none.
const face = (kind: PulseGridValueKind, value: PulseGridStep): HTMLElement => {
    switch (kind) {
        case "velocity":
            return <div className="bar"
                        style={{height: `${PulseGridValueLogic.barHeight(value.velocity, PulseGridValueLogic.VelocityHeight)}px`}}/>
        case "chance":
            return <div className="dot" style={{"--c": String(value.chance / 100)}}/>
        case "accent":
            return <div className={Html.buildClassList("star", value.accent && "on")}>★</div>
    }
}

// The velocity, chance and accent rows under an open lane (SPEC.md, section 8): a bar dragged up and down, a dot
// dragged up and down, a star pressed. They change every note of the step and are empty where a step has none.
// Built again after every change of the document, like the lane rows; subscriptions go to `inner`.
export const PulseGridValueRows = ({inner, context, doc, lane, columns}: Construct): PulseGridValueRowsView => {
    const {steps} = PulseGridView.steps(doc, lane)
    const rows = Rows.map(({kind, height}): HTMLElement => {
        const places = steps.map((value, index): HTMLElement => {
            const step = index + 1
            return (
                <div className={Html.buildClassList("place", value === undefined && "empty")}
                     data-step={String(step)}
                     style={{gridColumn: String(PulseGridLaneLogic.trackOf(step))}}>
                    {value === undefined ? null : face(kind, value)}
                </div>
            )
        })
        const row: HTMLElement = (
            <div className="line"
                 data-values={lane.id}
                 data-row={kind}
                 style={{
                     height: `${height}px`,
                     gridTemplateColumns: PulseGridLaneLogic.tracks(columns),
                     minWidth: `${PulseGridLaneLogic.minCellsWidth(columns)}px`
                 }}>
                {places}
            </div>
        )
        inner.own(Events.subscribe(row, "pointerdown", (event: PointerEvent) => {
            if (event.button !== 0) {return}
            event.preventDefault()
            PulseGridValueDrags.press(context, kind, lane.id, event)
        }))
        return row
    })
    const labels: HTMLElement = (
        <div className={Html.buildClassList(className, "labels")}>
            {Rows.map(({name, height}) => <div className="label" style={{height: `${height}px`}}>{name}</div>)}
        </div>
    )
    const element: HTMLElement = <div className={Html.buildClassList(className, "values")}>{rows}</div>
    return {element, labels}
}
