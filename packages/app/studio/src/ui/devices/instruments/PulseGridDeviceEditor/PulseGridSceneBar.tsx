import css from "./PulseGridSceneBar.sass?inline"
import {Lifecycle, Terminator} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"
import {PulseGridActions, PulseGridView} from "@opendaw/studio-adapters"
import {MenuItem} from "@opendaw/studio-core"
import {Button} from "@/ui/components/Button"
import {MenuButton} from "@/ui/components/MenuButton"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridDial} from "./PulseGridDial"
import {PulseGridScenesLogic} from "./PulseGridScenesLogic"

const className = Html.adoptStyleSheet(css, "PulseGridSceneBar")

type Construct = {lifecycle: Lifecycle, context: PulseGridContext}

export const PulseGridSceneBar = ({lifecycle, context}: Construct): HTMLElement => {
    const {doc} = context
    const sceneName = (scene: number): string =>
        doc.getValue().scenes.find(entry => entry.scene === scene)?.name || `Scene ${scene}`
    const label: HTMLElement = <span/>
    const variations: HTMLElement = <div className="variations"/>
    const buttons = lifecycle.own(new Terminator())
    let variationKey = ""
    const pickScene = (offset: number): void => {
        const current = doc.getValue()
        context.send(PulseGridActions.pickScene(PulseGridScenesLogic.wrap(current.scene, offset, current.sceneCount)))
    }
    const modeButton = (song: boolean, text: string, tooltip: string): HTMLElement => {
        const button: HTMLElement = (
            <Button lifecycle={lifecycle} className="pg-button" appearance={{tooltip}}
                    onClick={() => context.send(PulseGridActions.setSongMode(song))}>
                <span>{text}</span>
            </Button>
        )
        button.dataset.song = song ? "song" : "pattern"
        return button
    }
    const patternButton = modeButton(false, "Pattern", "Loop the scene and variation you pick")
    const songButton = modeButton(true, "Song", "Play the scenes of the song in order")
    lifecycle.own(doc.catchupAndSubscribe(owner => {
        const {on} = owner.getValue().song
        patternButton.classList.toggle("active", !on)
        songButton.classList.toggle("active", on)
    }))
    lifecycle.own(doc.catchupAndSubscribe(owner => {
        const current = owner.getValue()
        label.textContent = sceneName(current.scene)
        const used = PulseGridView.usedVariations(current)
        const key = `${current.variation}:${used.join("")}`
        if (key === variationKey) {return}
        variationKey = key
        buttons.terminate()
        variations.replaceChildren(...used.map(variation => (
            <Button lifecycle={buttons} className={`pg-button${current.variation === variation ? " active" : ""}`}
                    appearance={{tooltip: `Variation ${variation}`}}
                    onClick={() => context.send(PulseGridActions.pickVariation(variation))}>
                <span>{variation}</span>
            </Button>
        )))
        if (PulseGridView.freeVariation(current) !== undefined) {
            variations.appendChild(
                <Button lifecycle={buttons} className="pg-button" appearance={{tooltip: "Copy into a new variation"}}
                        onClick={() => context.send(PulseGridActions.newVariation(doc.getValue()))}>
                    <span>+</span>
                </Button>
            )
        }
    }))
    return (
        <div className={className}>
            <div className="pg-group scene">
                <span className="pg-label">Scene</span>
                <Button lifecycle={lifecycle} className="pg-button" appearance={{tooltip: "Previous scene"}}
                        onClick={() => pickScene(-1)}><span>‹</span></Button>
                <MenuButton root={MenuItem.root().setRuntimeChildrenProcedure(parent => parent.addMenuItem(
                    ...Array.from({length: doc.getValue().sceneCount}, (_, index) => {
                        const scene = index + 1
                        return MenuItem.default({label: `${scene}. ${sceneName(scene)}`, checked: doc.getValue().scene === scene})
                            .setTriggerProcedure(() => context.send(PulseGridActions.pickScene(scene)))
                    })
                ))}>{label}<span>⌄</span></MenuButton>
                <Button lifecycle={lifecycle} className="pg-button" appearance={{tooltip: "Next scene"}}
                        onClick={() => pickScene(1)}><span>›</span></Button>
            </div>
            <div className="pg-group variation"><span className="pg-label">Variation</span>{variations}</div>
            <div className="pg-group mode"><span className="pg-label">Mode</span>{patternButton}{songButton}</div>
            <PulseGridDial lifecycle={lifecycle} label="Groove" unit="%" min={0} max={100}
                           get={() => doc.getValue().settings.groove}
                           set={value => context.send(PulseGridActions.setGroove(value), false)}
                           commit={context.mark} revert={context.revert}
                           subscribe={refresh => doc.subscribe(refresh)}/>
            <PulseGridDial lifecycle={lifecycle} label="Probability" unit="%" min={0} max={100}
                           get={() => doc.getValue().settings.probability}
                           set={value => context.send(PulseGridActions.setProbability(value), false)}
                           commit={context.mark} revert={context.revert}
                           subscribe={refresh => doc.subscribe(refresh)}/>
            <PulseGridDial lifecycle={lifecycle} label="Humanize" unit="%" min={0} max={100}
                           get={() => doc.getValue().settings.humanize}
                           set={value => context.send(PulseGridActions.setHumanize(value), false)}
                           commit={context.mark} revert={context.revert}
                           subscribe={refresh => doc.subscribe(refresh)}/>
        </div>
    )
}
