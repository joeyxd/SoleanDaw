import {Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {PulseGridActions, PulseGridLaneDoc} from "@opendaw/studio-adapters"
import {Button} from "@/ui/components/Button"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridDial} from "./PulseGridDial"
import {PulseGridPanelLogic} from "./PulseGridPanelLogic"

type Construct = {lifecycle: Lifecycle, context: PulseGridContext, lane: PulseGridLaneDoc}

// Tab Mix: the lane's Volume and Pan dials, Mute and Solo. The ops are the ones of the lane head's M and S.
export const PulseGridPanelMix = ({lifecycle, context, lane}: Construct): HTMLElement => {
    const {doc} = context
    const mixNow = (): PulseGridLaneDoc["mix"] => (PulseGridPanelLogic.laneOf(doc.getValue(), lane.id) ?? lane).mix
    const toggle = (key: "mute" | "solo", label: string): HTMLElement => {
        const build = key === "mute" ? PulseGridActions.setMute : PulseGridActions.setSolo
        const button: HTMLElement = (
            <Button lifecycle={lifecycle} className={`pg-button${lane.mix[key] ? " active" : ""}`}
                    appearance={{tooltip: label}}
                    onClick={() => context.send(build(lane.id, !mixNow()[key]))}>
                <span>{label}</span>
            </Button>
        )
        button.dataset.toggle = key
        return button
    }
    return (
        <div className="body mix">
            <div data-dial="volume">
                <PulseGridDial lifecycle={lifecycle} label="Volume" unit="dB" min={-72} max={0} step={0.1} decimals={1}
                               get={() => mixNow().gain}
                               set={value => context.send(PulseGridActions.setVolume(lane.id, value), false)}
                               commit={context.mark} revert={context.revert}
                               subscribe={refresh => doc.subscribe(refresh)}/>
            </div>
            <div data-dial="pan">
                <PulseGridDial lifecycle={lifecycle} label="Pan" unit="" min={-100} max={100}
                               get={() => mixNow().pan}
                               set={value => context.send(PulseGridActions.setPan(lane.id, value), false)}
                               commit={context.mark} revert={context.revert}
                               subscribe={refresh => doc.subscribe(refresh)}/>
            </div>
            <div className="switches">{toggle("mute", "Mute")}{toggle("solo", "Solo")}</div>
        </div>
    )
}
