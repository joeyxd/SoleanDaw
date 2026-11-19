import {Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {PulseGridActions, PulseGridKnobs, PulseGridLaneDoc} from "@opendaw/studio-adapters"
import {MenuItem} from "@opendaw/studio-core"
import {Button} from "@/ui/components/Button"
import {MenuButton} from "@/ui/components/MenuButton"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridDial} from "./PulseGridDial"
import {PulseGridPicture} from "./PulseGridIcons"
import {PulseGridPanelLogic} from "./PulseGridPanelLogic"
import {PulseGridPanelParam} from "./PulseGridPanelParam"
import {PulseGridPictures} from "./PulseGridPictures"
import {PulseGridSounds} from "./PulseGridSounds"

type Construct = {lifecycle: Lifecycle, context: PulseGridContext, lane: PulseGridLaneDoc}

// Tab Instrument: the picture of the instrument, the sound and Change sound, the four
// big knobs, then the lane's Chance, Humanize and Step accents. Every control is an op.
export const PulseGridPanelInstrument = ({lifecycle, context, lane}: Construct): HTMLElement => {
    const {doc} = context
    const {sound} = lane
    const laneNow = (): PulseGridLaneDoc => PulseGridPanelLogic.laneOf(doc.getValue(), lane.id) ?? lane
    const percent = (label: string, key: "probability" | "humanize",
                     build: (lane: string, value: number) => ReturnType<typeof PulseGridActions.setLaneChance>): HTMLElement => (
        <div data-dial={label.toLowerCase()}>
            <PulseGridDial lifecycle={lifecycle} label={label} unit="%" min={0} max={100}
                           get={() => laneNow()[key]}
                           set={value => context.send(build(lane.id, value), false)}
                           commit={context.mark} revert={context.revert}
                           subscribe={refresh => doc.subscribe(refresh)}/>
        </div>
    )
    const accent: HTMLElement = (
        <Button lifecycle={lifecycle} className={`pg-button${lane.accent ? " active" : ""}`}
                appearance={{tooltip: "Let the steps' accents sound louder on this lane"}}
                onClick={() => context.send(PulseGridActions.setLaneAccent(lane.id, !laneNow().accent))}>
            <span>Step accents</span>
        </Button>
    )
    accent.dataset.toggle = "accent"
    if (sound === null) {return <div className="body empty">This lane has no instrument.</div>}
    return (
        <div className="body instrument">
            <div className="picture">
                <PulseGridPicture kind={PulseGridPictures.of(lane)}/>
                <span className="sound" data-sound="">{sound.label}</span>
                {sound.instrument === "Nano" ? (
                    <div className="pg-group change">
                        <MenuButton root={MenuItem.root().setRuntimeChildrenProcedure(parent => parent.addMenuItem(
                            ...PulseGridSounds.menuItems(sample =>
                                context.send(PulseGridActions.setLaneSound(lane.id, sample)))))}>
                            <span>Change sound</span><span>⌄</span>
                        </MenuButton>
                    </div>
                ) : false}
            </div>
            <div className="knobs">
                {PulseGridKnobs.of(sound.instrument, sound.params).map(({label, param}) => {
                    const entry = sound.params.find(candidate => candidate.name === param)
                    return entry === undefined ? false : (
                        <PulseGridPanelParam lifecycle={lifecycle} context={context} laneId={lane.id} param={entry} label={label}/>
                    )
                })}
            </div>
            <div className="values">
                {percent("Chance", "probability", PulseGridActions.setLaneChance)}
                {percent("Humanize", "humanize", PulseGridActions.setLaneHumanize)}
                {accent}
            </div>
        </div>
    )
}
