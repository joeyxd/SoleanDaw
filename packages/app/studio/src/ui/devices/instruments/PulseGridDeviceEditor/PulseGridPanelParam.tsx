import {int, Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {PulseGridActions, PulseGridParamDoc} from "@opendaw/studio-adapters"
import {Button} from "@/ui/components/Button"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridPanelKnob} from "./PulseGridPanelKnob"
import {PulseGridPanelLogic} from "./PulseGridPanelLogic"
import {PulseGridPanelParams} from "./PulseGridPanelParams"

type Construct = {
    lifecycle: Lifecycle
    context: PulseGridContext
    laneId: string
    effect?: int // of the lane's effect `effect` (from 1); left out: of its instrument
    param: PulseGridParamDoc
    label?: string
}

// One parameter of a device on the panel: a knob for a float or an int, a toggle for a bool. It reads its value
// from the document every time, and every change is the op `setParam`, one undo step for one turn.
export const PulseGridPanelParam = ({lifecycle, context, laneId, effect, param, label}: Construct): HTMLElement => {
    const {doc} = context
    let last = param
    const current = (): PulseGridParamDoc => {
        const lane = PulseGridPanelLogic.laneOf(doc.getValue(), laneId)
        const found = lane === undefined ? undefined : PulseGridPanelLogic.paramOf(lane, effect, param.name)
        if (found !== undefined) {last = found}
        return last
    }
    const name = label ?? param.name
    if (param.type === "bool") {
        const button: HTMLElement = (
            <Button lifecycle={lifecycle} className="pg-button toggle" appearance={{tooltip: name}}
                    onClick={() => context.send(PulseGridActions.setParam(laneId, param.name, !current().value, effect))}>
                <span>{name}</span>
            </Button>
        )
        button.dataset.param = param.name
        const refresh = (): void => {button.classList.toggle("active", current().value === true)}
        lifecycle.own(doc.catchupAndSubscribe(refresh))
        return button
    }
    const mapping = PulseGridPanelParams.mappingOf(context, laneId, effect, param)
    return (
        <PulseGridPanelKnob lifecycle={lifecycle} label={name} mapping={mapping}
                            get={() => Number(current().value)}
                            valueAt={unit => PulseGridPanelLogic.valueAt(current(), mapping, unit)}
                            set={value => context.send(PulseGridActions.setParam(laneId, param.name, value, effect), false)}
                            commit={context.mark} revert={context.revert}
                            subscribe={refresh => doc.subscribe(refresh)}/>
    )
}

