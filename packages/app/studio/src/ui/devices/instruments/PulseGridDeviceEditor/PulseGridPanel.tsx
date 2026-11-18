import css from "./PulseGridPanel.sass?inline"
import {DefaultObservableValue, int, Lifecycle, Optional, Terminator} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"
import {Button} from "@/ui/components/Button"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridPanelEffects} from "./PulseGridPanelEffects"
import {PulseGridPanelInstrument} from "./PulseGridPanelInstrument"
import {PulseGridPanelLogic, PulseGridPanelTab} from "./PulseGridPanelLogic"
import {PulseGridPanelMix} from "./PulseGridPanelMix"

const className = Html.adoptStyleSheet(css, "PulseGridPanel")

type Construct = {lifecycle: Lifecycle, context: PulseGridContext}

// The column at the right of the window that follows the selected lane (SPEC.md section 10): arrows through the
// lanes, the lane's name and sound, and three tabs. Nothing here writes a box: every control sends ops.
export const PulseGridPanel = ({lifecycle, context}: Construct): HTMLElement => {
    const {doc, selectedLane} = context
    const tab = lifecycle.own(new DefaultObservableValue<PulseGridPanelTab>("instrument"))
    const open = lifecycle.own(new DefaultObservableValue<Optional<int>>(undefined))
    const view = lifecycle.own(new Terminator())
    const name: HTMLElement = <span className="lane-name" data-panel-lane=""/>
    const sound: HTMLElement = <span className="lane-sound" data-panel-sound=""/>
    const content: HTMLElement = <div className="content"/>
    const step = (offset: int): void => {
        const next = PulseGridPanelLogic.neighbour(doc.getValue().lanes.map(lane => lane.id), selectedLane.getValue(), offset)
        if (next !== undefined) {selectedLane.setValue(next)}
    }
    const arrow = (text: string, tooltip: string, offset: int, hook: string): HTMLElement => {
        const element: HTMLElement = (
            <Button lifecycle={lifecycle} className="pg-button" appearance={{tooltip}} onClick={() => step(offset)}>
                <span>{text}</span>
            </Button>
        )
        element.dataset[hook] = ""
        return element
    }
    const tabs: HTMLElement = (
        <div className="tabs" role="tablist">
            {PulseGridPanelLogic.Tabs.map(({key, label}) => {
                const button: HTMLElement = (
                    <Button lifecycle={lifecycle} className="pg-button" appearance={{tooltip: label}}
                            onClick={() => tab.setValue(key)}>
                        <span>{label}</span>
                    </Button>
                )
                button.dataset.tab = key
                return button
            })}
        </div>
    )
    const element: HTMLElement = (
        <aside className={className} data-panel="" aria-label="Instrument panel">
            <div className="head">
                {arrow("‹", "Previous lane", -1, "panelPrev")}
                <div className="title">{name}{sound}</div>
                {arrow("›", "Next lane", 1, "panelNext")}
            </div>
            {tabs}
            {content}
        </aside>
    )
    let built = ""
    let shown: Optional<string>
    const sync = (): void => {
        const lanes = doc.getValue().lanes
        const lane = PulseGridPanelLogic.laneOf(doc.getValue(), selectedLane.getValue())
        if (lane === undefined) {
            // nothing picked, or the picked lane is gone: the first lane takes the panel (this runs again by itself)
            if (lanes.length > 0) {selectedLane.setValue(lanes[0].id); return}
            built = ""
            view.terminate()
            name.textContent = ""
            sound.textContent = ""
            content.replaceChildren()
            return
        }
        element.style.setProperty("--lane", `hsl(${lane.hue} 98% 60%)`)
        name.textContent = lane.name
        sound.textContent = PulseGridPanelLogic.soundLine(lane.sound)
        Array.from(tabs.children).forEach(child =>
            child.classList.toggle("active", (child as HTMLElement).dataset.tab === tab.getValue()))
        if (lane.id !== shown) {
            shown = lane.id
            if (open.getValue() !== undefined) {open.setValue(undefined); return}
        }
        // an agent or an undo can take effects away under an open one
        const at = open.getValue()
        if (at !== undefined && at > lane.chain.length) {open.setValue(undefined); return}
        const key = `${lane.id}|${tab.getValue()}|${PulseGridPanelLogic.structure(lane, tab.getValue(), open.getValue())}`
        if (key === built) {return}
        built = key
        view.terminate()
        const args = {lifecycle: view, context, lane}
        content.replaceChildren(
            tab.getValue() === "instrument" ? PulseGridPanelInstrument(args)
                : tab.getValue() === "effects" ? PulseGridPanelEffects({...args, open})
                    : PulseGridPanelMix(args))
    }
    lifecycle.ownAll(
        doc.subscribe(sync),
        selectedLane.subscribe(sync),
        tab.subscribe(sync),
        open.subscribe(sync)
    )
    sync()
    return element
}
