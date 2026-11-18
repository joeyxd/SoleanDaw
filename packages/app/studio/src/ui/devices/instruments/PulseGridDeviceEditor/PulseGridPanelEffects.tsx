import {int, Lifecycle, MutableObservableValue, Optional} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {PulseGridActions, PulseGridEffectDoc, PulseGridLaneDoc} from "@opendaw/studio-adapters"
import {MenuItem, PulseGridEffects} from "@opendaw/studio-core"
import {Button} from "@/ui/components/Button"
import {MenuButton} from "@/ui/components/MenuButton"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridPanelParam} from "./PulseGridPanelParam"
import {PulseGridPanelParams} from "./PulseGridPanelParams"

type Construct = {
    lifecycle: Lifecycle
    context: PulseGridContext
    lane: PulseGridLaneDoc
    // the effect (from 1) that shows its parameters; the panel builds again when it changes
    open: MutableObservableValue<Optional<int>>
}

// Tab Effects: the lane's chain, each effect with on/off, up, down and remove, and its parameters when opened;
// Add effect; Open in device panel. The ops are setEffect, removeEffect, addEffect and setParam.
export const PulseGridPanelEffects = ({lifecycle, context, lane, open}: Construct): HTMLElement => {
    const count = lane.chain.length
    const button = (action: string, text: string, tooltip: string, onClick: () => void, extra = ""): HTMLElement => {
        const element: HTMLElement = (
            <Button lifecycle={lifecycle} className={`pg-button ${extra}`} appearance={{tooltip}} onClick={onClick}>
                <span>{text}</span>
            </Button>
        )
        element.dataset.action = action
        return element
    }
    const row = (effect: PulseGridEffectDoc): HTMLElement => {
        const {index} = effect
        const opened = open.getValue() === index
        const move = (to: int): void => {
            if (to < 1 || to > count) {return}
            const now = open.getValue()
            context.send(PulseGridActions.moveEffect(lane.id, index, to))
            open.setValue(now === index ? to : now === to ? index : now)
        }
        const name: HTMLElement = (
            <button type="button" className="fx-name" data-action="fx-open"
                    onclick={() => open.setValue(opened ? undefined : index)}>
                <span>{effect.label || effect.name}</span><span>{opened ? "⌃" : "⌄"}</span>
            </button>
        )
        return (
            <div className={`fx${opened ? " open" : ""}${effect.enabled ? "" : " off"}`} data-fx={index} data-fx-name={effect.name}>
                <div className="fx-head">
                    {name}
                    {button("fx-toggle", effect.enabled ? "On" : "Off", effect.enabled ? "Switch off" : "Switch on",
                        () => context.send(PulseGridActions.switchEffect(lane.id, index, !effect.enabled)),
                        effect.enabled ? "active" : "")}
                    {button("fx-up", "↑", "Move up", () => move(index - 1), index === 1 ? "disabled" : "")}
                    {button("fx-down", "↓", "Move down", () => move(index + 1), index === count ? "disabled" : "")}
                    {button("fx-remove", "✕", "Remove", () => {
                        const now = open.getValue()
                        context.send(PulseGridActions.removeEffect(lane.id, index))
                        open.setValue(now === undefined || now === index ? undefined : now > index ? now - 1 : now)
                    })}
                </div>
                {opened ? (
                    <div className="params">
                        {effect.params.map(param => (
                            <PulseGridPanelParam lifecycle={lifecycle} context={context} laneId={lane.id}
                                                 effect={index} param={param}/>
                        ))}
                    </div>
                ) : false}
            </div>
        )
    }
    const menu = MenuItem.root().setRuntimeChildrenProcedure(parent => parent.addMenuItem(
        ...context.effects.names.map(name => {
            const factory = PulseGridEffects.factoryOf(name)
            return MenuItem.default({label: factory?.defaultName ?? name, icon: factory?.defaultIcon})
                .setTriggerProcedure(() => {
                    context.send(PulseGridActions.addEffect(lane.id, name))
                    open.setValue(undefined)
                })
        })))
    return (
        <div className="body effects">
            {count === 0 ? <div className="empty">This lane has no effects.</div> : (
                <div className="chain">{lane.chain.map(row)}</div>
            )}
            <div className="pg-group add" data-action="add-effect">
                <MenuButton root={menu}><span>Add effect</span><span>⌄</span></MenuButton>
            </div>
            {button("open-device", "Open in device panel", "Show this lane's cell in SoleanDaw's own device editors", () => {
                const found = PulseGridPanelParams.laneOf(context, lane.id)
                if (found !== undefined) {context.service.project.userEditingManager.audioUnit.edit(found.cell)}
            })}
        </div>
    )
}
