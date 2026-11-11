import css from "./PulseGridLanes.sass?inline"
import {int, Lifecycle, Terminable, Terminator} from "@opendaw/lib-std"
import {createElement, replaceChildren} from "@opendaw/lib-jsx"
import {deferNextFrame, Html} from "@opendaw/lib-dom"
import {Colors} from "@opendaw/studio-enums"
import {MenuItem} from "@opendaw/studio-core"
import {PulseGridActions, PulseGridDoc, PulseGridView} from "@opendaw/studio-adapters"
import {MenuButton} from "@/ui/components/MenuButton"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridFrame, PulseGridLaneLogic} from "./PulseGridLaneLogic"
import {PulseGridFrameRef, PulseGridLaneDrags} from "./PulseGridLaneDrags"
import {PulseGridLaneRow} from "./PulseGridLaneRow"
import {PulseGridSounds} from "./PulseGridSounds"

const className = Html.adoptStyleSheet(css, "PulseGridLanes")

type Construct = {
    lifecycle: Lifecycle
    context: PulseGridContext
}

// Cells that carry the playhead: the ruler of a frame (class "lit") or the cells of one lane (class "playing").
type Track = {cells: ReadonlyArray<HTMLElement>, length: int, mark: string, lit: int}

// The lanes of a PulseGrid: the DRUMS and MELODY frames, the step ruler, one row per lane, the playhead.
// It reads `context.doc` and writes with `context.send`; the song position is the only thing it reads elsewhere.
export const PulseGridLanes = ({lifecycle, context}: Construct): HTMLElement => {
    const {engine} = context.service
    const element: HTMLElement = <div className={className}/>
    const inner = lifecycle.own(new Terminator())
    const drags = lifecycle.own(new Terminator())
    const state: {tracks: Array<Track>, rows: Map<string, HTMLElement>, reorder: Terminable} = {
        tracks: [], rows: new Map(), reorder: Terminable.Empty
    }
    PulseGridSounds.load()

    const paintPlayhead = (): void => {
        const playing = engine.isPlaying.getValue()
        const position = engine.position.getValue()
        for (const track of state.tracks) {
            const next = playing ? PulseGridView.playingStep(position, track.length) : -1
            if (next === track.lit) {continue}
            track.cells[track.lit]?.classList.remove(track.mark)
            track.cells[next]?.classList.add(track.mark)
            track.lit = next
        }
    }
    const playhead = lifecycle.own(deferNextFrame(paintPlayhead))

    const markSelected = (): void => {
        const selected = context.selectedLane.getValue()
        state.rows.forEach((row, id) => row.classList.toggle("selected", id === selected))
    }

    const addLaneButton = (): HTMLElement => (
        <div className="add">
            <MenuButton root={MenuItem.root().setRuntimeChildrenProcedure(parent => parent
                .addMenuItem(...PulseGridSounds.menuItems(sample => context
                    .send(PulseGridActions.addDrumLane(context.doc.getValue(), sample)))))}
                        appearance={{color: Colors.shadow}}>
                <span>+ Add lane</span>
            </MenuButton>
        </div>
    )

    const buildFrame = (doc: PulseGridDoc, frame: PulseGridFrame, anySolo: boolean): HTMLElement => {
        const columns = PulseGridLaneLogic.rulerLength(doc,
            frame.lanes.map(lane => PulseGridView.steps(doc, lane).length))
        const drop: HTMLElement = <div className="drop"/>
        const rows = new Map<string, HTMLElement>()
        const ref: PulseGridFrameRef = {ids: frame.lanes.map(lane => lane.id), rows, drop}
        const numbers = Array.from({length: columns}, (_, index): HTMLElement => (
            <div className={Html.buildClassList("num", PulseGridLaneLogic.isBeat(index + 1) && "beat")}
                 style={{gridColumn: String(PulseGridLaneLogic.trackOf(index + 1))}}>{String(index + 1)}</div>
        ))
        state.tracks.push({cells: numbers, length: doc.settings.length, mark: "lit", lit: -1})
        const laneRows = frame.lanes.map(lane => {
            const view = PulseGridLaneRow({
                inner, context, doc, lane, columns, anySolo,
                paint: (cell, laneId, step, on) => PulseGridLaneDrags.paint(context, drags, cell, laneId, step, on),
                reorder: (handle, laneId) => {
                    state.reorder.terminate()
                    state.reorder = PulseGridLaneDrags.reorder(context, inner, handle, ref, laneId)
                }
            })
            rows.set(lane.id, view.element)
            state.rows.set(lane.id, view.element)
            state.tracks.push({cells: view.cells, length: view.length, mark: "playing", lit: -1})
            if (view.rollCells.length > 0) {
                state.tracks.push({cells: view.rollCells, length: view.length, mark: "playing", lit: -1})
            }
            return view.element
        })
        return (
            <section className={Html.buildClassList("frame", frame.key)} data-frame={frame.key}>
                <div className="scroll">
                    <div className="sheet" style={{minWidth: `${PulseGridLaneLogic.minSheetWidth(columns)}px`}}>
                        <div className="top">
                            <div className="title">
                                <span className="heading">{frame.title}</span>
                                <span className="subtitle">{frame.subtitle}</span>
                            </div>
                            <div className="cells ruler"
                                 style={{
                                     gridTemplateColumns: PulseGridLaneLogic.tracks(columns),
                                     minWidth: `${PulseGridLaneLogic.minCellsWidth(columns)}px`
                                 }}>
                                {numbers}
                            </div>
                        </div>
                        {laneRows}
                        {drop}
                        {frame.key === "drums" && addLaneButton()}
                    </div>
                </div>
            </section>
        )
    }

    const render = (doc: PulseGridDoc): void => {
        const scrolls = new Map<string, number>()
        element.querySelectorAll<HTMLElement>(".frame").forEach(frame =>
            scrolls.set(frame.dataset.frame ?? "", frame.querySelector<HTMLElement>(".scroll")?.scrollLeft ?? 0))
        state.reorder.terminate()
        inner.terminate()
        state.tracks = []
        state.rows = new Map()
        const anySolo = doc.lanes.some(lane => lane.mix.solo)
        const frames = PulseGridLaneLogic.frames(doc)
        replaceChildren(element,
            frames.some(frame => frame.key === "drums") ? null : addLaneButton(),
            frames.map(frame => buildFrame(doc, frame, anySolo)))
        element.querySelectorAll<HTMLElement>(".frame").forEach(frame => {
            const scroll = frame.querySelector<HTMLElement>(".scroll")
            if (scroll !== null) {scroll.scrollLeft = scrolls.get(frame.dataset.frame ?? "") ?? 0}
        })
        markSelected()
        paintPlayhead()
    }

    lifecycle.ownAll(
        context.doc.catchupAndSubscribe(owner => render(owner.getValue())),
        context.openLanes.subscribe(() => render(context.doc.getValue())),
        context.selectedLane.subscribe(markSelected),
        engine.position.subscribe(playhead.request),
        engine.isPlaying.subscribe(playhead.request))
    return element
}
