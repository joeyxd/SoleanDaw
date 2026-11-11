import css from "./PulseGridKeyboard.sass?inline"
import {int, Lifecycle, Optional} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {deferNextFrame, Events, Html} from "@opendaw/lib-dom"
import {MidiKeys} from "@opendaw/lib-dsp"
import {PulseGridActions, PulseGridDoc, PulseGridLaneDoc, PulseGridScales, PulseGridView} from "@opendaw/studio-adapters"
import {PulseGridAudition} from "./PulseGridAudition"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridValueLogic} from "./PulseGridValueLogic"

const className = Html.adoptStyleSheet(css, "PulseGridKeyboard")

type Construct = {lifecycle: Lifecycle, context: PulseGridContext}

// The lane the keyboard serves: the selected one, else the first melodic lane, else the first lane.
const laneOf = (doc: PulseGridDoc, selected: Optional<string>): Optional<PulseGridLaneDoc> =>
    doc.lanes.find(lane => lane.id === selected)
    ?? doc.lanes.find(lane => lane.kind === "melodic")
    ?? doc.lanes[0]

// Three octaves around the selected lane's pitch. The keys of the key and scale are lit, the roots stand out, the
// lane pitch is ringed, and while the song plays the pitches the lane sounds carry the class "sounding".
export const PulseGridKeyboard = ({lifecycle, context}: Construct): HTMLElement => {
    const {engine} = context.service
    const keys: HTMLElement = <div className="keys"/>
    const laneName: HTMLElement = <span className="lane"/>
    const pitchName: HTMLElement = <span className="pitch"/>
    const element: HTMLElement = (
        <div className={Html.buildClassList(className, "pg-group")}>
            {keys}
            <div className="info">{laneName}{pitchName}</div>
        </div>
    )
    const state: {signature: string, keys: Map<int, HTMLElement>, lit: ReadonlySet<int>} =
        {signature: "", keys: new Map(), lit: new Set()}

    const paintPlayhead = (): void => {
        const doc = context.doc.getValue()
        const lane = laneOf(doc, context.selectedLane.getValue())
        const next: ReadonlySet<int> = lane === undefined || !engine.isPlaying.getValue()
            ? new Set()
            : new Set(PulseGridView.sounding(doc, lane, engine.position.getValue()))
        state.lit.forEach(pitch => {if (!next.has(pitch)) {state.keys.get(pitch)?.classList.remove("sounding")}})
        next.forEach(pitch => {if (!state.lit.has(pitch)) {state.keys.get(pitch)?.classList.add("sounding")}})
        state.lit = next
    }
    const playhead = lifecycle.own(deferNextFrame(paintPlayhead))

    const refresh = (): void => {
        const doc = context.doc.getValue()
        const lane = laneOf(doc, context.selectedLane.getValue())
        if (lane === undefined) {
            state.signature = ""
            state.keys = new Map()
            state.lit = new Set()
            keys.replaceChildren()
            laneName.textContent = ""
            pitchName.textContent = ""
            return
        }
        const {root, scale} = doc.settings
        laneName.textContent = lane.name
        pitchName.textContent = MidiKeys.toFullString(lane.pitch)
        element.style.setProperty("--ring", `hsl(${lane.hue} 98% 60%)`)
        const signature = `${root}|${scale}|${lane.id}|${lane.pitch}`
        if (signature === state.signature) {return}
        state.signature = signature
        const {first, last} = PulseGridValueLogic.keyboardRange(lane.pitch)
        const whites = PulseGridValueLogic.whiteCount(first, last)
        state.keys = new Map()
        state.lit = new Set()
        keys.replaceChildren(...PulseGridValueLogic.keyShapes(first, last).map(shape => {
            const key: HTMLElement = (
                <div className={Html.buildClassList("key", shape.black ? "black" : "white",
                    PulseGridScales.has(root, scale, shape.pitch) && "scale",
                    (((shape.pitch - root) % 12) + 12) % 12 === 0 && "root",
                    shape.pitch === lane.pitch && "ringed")}
                     data-pitch={String(shape.pitch)}
                     title={MidiKeys.toFullString(shape.pitch)}
                     style={{left: `${shape.left / whites * 100}%`, width: `${shape.width / whites * 100}%`}}/>
            )
            state.keys.set(shape.pitch, key)
            return key
        }))
        paintPlayhead()
    }

    // One listener on the keys: they are built again when key, scale, lane or pitch change, also by this press.
    lifecycle.own(Events.subscribe(keys, "pointerdown", (event: PointerEvent) => {
        if (event.button !== 0) {return}
        const hit = (event.target as Element).closest<HTMLElement>("[data-pitch]")
        if (hit === null) {return}
        const lane = laneOf(context.doc.getValue(), context.selectedLane.getValue())
        if (lane === undefined) {return}
        event.preventDefault()
        const pitch = Number(hit.dataset.pitch)
        PulseGridAudition.listen(context, lane.id, pitch)
        if (lane.kind === "melodic" && lane.pitch !== pitch) {context.send(PulseGridActions.setLanePitch(lane.id, pitch))}
    }))
    lifecycle.ownAll(
        context.doc.catchupAndSubscribe(refresh),
        context.selectedLane.subscribe(refresh),
        engine.position.subscribe(playhead.request),
        engine.isPlaying.subscribe(playhead.request))
    return element
}
