import css from "./PulseGridTopBar.sass?inline"
import {DefaultObservableValue, Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Events, Html} from "@opendaw/lib-dom"
import {PulseGridActions, PulseGridKits, TempoRange, Validator} from "@opendaw/studio-adapters"
import {MenuItem} from "@opendaw/studio-core"
import {IconSymbol} from "@opendaw/studio-enums"
import {Button} from "@/ui/components/Button"
import {Icon} from "@/ui/components/Icon"
import {MenuButton} from "@/ui/components/MenuButton"
import {Surface} from "@/ui/surface/Surface"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridDial} from "./PulseGridDial"

const className = Html.adoptStyleSheet(css, "PulseGridTopBar")

type Construct = {lifecycle: Lifecycle, context: PulseGridContext}

export const PulseGridTopBar = ({lifecycle, context}: Construct): HTMLElement => {
    const {service, doc} = context
    const {editing, timelineBox: {bpm}} = service.project
    let active = true
    lifecycle.own({terminate: () => {active = false}})
    const name: HTMLElement = <span className="name" title="Double-click to rename"/>
    lifecycle.own(Events.subscribeDblDwn(name, async event => {
        const next = await Surface.get(name).requestFloatingTextInput(event, doc.getValue().name)
        if (active && next !== doc.getValue().name) {context.send(PulseGridActions.rename(next))}
    }))
    const kit = MenuItem.root().setRuntimeChildrenProcedure(parent => parent.addMenuItem(
        MenuItem.header({label: "Kits", icon: IconSymbol.DrumSet}),
        ...PulseGridKits.All.map(kit => MenuItem.default({label: kit.name})
            .setTriggerProcedure(() => context.send(PulseGridActions.loadKit(doc.getValue(), kit)))),
        MenuItem.header({label: "Beats", icon: IconSymbol.DrumSet}),
        ...PulseGridKits.Beats.map(beat => MenuItem.default({label: beat.name})
            .setTriggerProcedure(() => context.send(PulseGridActions.loadBeat(doc.getValue(), beat))))
    ))
    const playIcon: HTMLElement = <span/>
    const play: HTMLElement = (
        <Button lifecycle={lifecycle} className="pg-button play" appearance={{tooltip: "Play / Stop"}}
                onClick={() => service.engine.isPlaying.getValue() ? service.engine.stop() : service.engine.play()}>
            {playIcon}
        </Button>
    )
    lifecycle.own(service.engine.isPlaying.catchupAndSubscribe(owner => {
        const playing = owner.getValue()
        play.classList.toggle("active", playing)
        playIcon.replaceChildren(<Icon symbol={playing ? IconSymbol.Stop : IconSymbol.Play}/>)
        play.setAttribute("aria-label", playing ? "Stop" : "Play")
    }))
    const undoDisabled = lifecycle.own(new DefaultObservableValue(true))
    const redoDisabled = lifecycle.own(new DefaultObservableValue(true))
    const refreshHistory = (): void => {
        undoDisabled.setValue(!editing.canUndo())
        redoDisabled.setValue(!editing.canRedo())
    }
    lifecycle.ownAll(
        doc.catchupAndSubscribe(owner => {
            name.textContent = owner.getValue().name
            refreshHistory()
        }),
        editing.subscribe(refreshHistory)
    )
    return (
        <div className={className}>
            <div className="brand pg-group"><Icon symbol={IconSymbol.DrumSet}/><strong>PulseGrid</strong>{name}</div>
            <div className="pg-group kit"><MenuButton root={kit}><span>Kit</span><span>⌄</span></MenuButton></div>
            <div className="pg-group">{play}</div>
            <PulseGridDial lifecycle={lifecycle} label="Tempo" unit="BPM" min={TempoRange.min} max={TempoRange.max}
                           decimals={2} step={0.01} perPixel={0.5} get={() => bpm.getValue()}
                           set={value => editing.modify(() => bpm.setValue(Validator.clampBpm(value)), false)}
                           commit={() => editing.mark()} revert={() => editing.revertPending()}
                           subscribe={refresh => bpm.subscribe(refresh)}/>
            <PulseGridDial lifecycle={lifecycle} label="Swing" unit="%" min={50} max={75}
                           get={() => doc.getValue().settings.swing}
                           set={value => context.send(PulseGridActions.setSwing(value), false)}
                           commit={context.mark} revert={context.revert}
                           subscribe={refresh => doc.subscribe(refresh)}/>
            <PulseGridDial lifecycle={lifecycle} label="Length" unit={value => value === 1 ? "Step" : "Steps"}
                           min={1} max={64}
                           get={() => doc.getValue().settings.length}
                           set={value => context.send(PulseGridActions.setLength(value), false)}
                           commit={context.mark} revert={context.revert}
                           subscribe={refresh => doc.subscribe(refresh)}/>
            <div className="pg-group history">
                <Button lifecycle={lifecycle} className="pg-button" disabled={undoDisabled}
                        appearance={{tooltip: "Undo"}} onClick={() => {if (editing.canUndo()) {editing.undo()}}}>
                    <Icon symbol={IconSymbol.Undo}/>
                </Button>
                <Button lifecycle={lifecycle} className="pg-button" disabled={redoDisabled}
                        appearance={{tooltip: "Redo"}} onClick={() => {if (editing.canRedo()) {editing.redo()}}}>
                    <Icon symbol={IconSymbol.Redo}/>
                </Button>
            </div>
        </div>
    )
}
