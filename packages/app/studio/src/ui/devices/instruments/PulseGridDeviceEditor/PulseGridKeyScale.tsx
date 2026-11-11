import css from "./PulseGridKeyScale.sass?inline"
import {Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"
import {MenuItem} from "@opendaw/studio-core"
import {PulseGridActions, PulseGridScales} from "@opendaw/studio-adapters"
import {MenuButton} from "@/ui/components/MenuButton"
import {PulseGridContext} from "./PulseGridContext"

const className = Html.adoptStyleSheet(css, "PulseGridKeyScale")

type Construct = {lifecycle: Lifecycle, context: PulseGridContext}

const Keys: ReadonlyArray<number> = Array.from({length: 12}, (_, root) => root)

// The key and the scale of the sequencer, each a menu. Used in the top bar (map A8) and in the bottom bar
// (map H6), so every call builds its own elements and subscriptions.
export const PulseGridKeyScale = ({lifecycle, context}: Construct): HTMLElement => {
    const {doc} = context
    const keyName: HTMLElement = <span/>
    const scaleName: HTMLElement = <span/>
    const keyMenu = MenuItem.root().setRuntimeChildrenProcedure(parent => parent.addMenuItem(
        ...Keys.map(root => MenuItem.default({
            label: PulseGridScales.keyName(root), checked: doc.getValue().settings.root === root
        }).setTriggerProcedure(() => context.send(PulseGridActions.setKey(root))))))
    const scaleMenu = MenuItem.root().setRuntimeChildrenProcedure(parent => parent.addMenuItem(
        ...PulseGridScales.All.map(scale => MenuItem.default({
            label: scale.name, checked: doc.getValue().settings.scale === scale.index
        }).setTriggerProcedure(() => context.send(PulseGridActions.setScale(scale.index))))))
    lifecycle.own(doc.catchupAndSubscribe(owner => {
        const {root, scale} = owner.getValue().settings
        keyName.textContent = PulseGridScales.keyName(root)
        scaleName.textContent = PulseGridScales.byIndex(scale).name
    }))
    return (
        <div className={Html.buildClassList(className, "pg-group")}>
            <span className="pg-label">Key</span>
            <MenuButton root={keyMenu} appearance={{tooltip: "Key"}}>{keyName}<span>⌄</span></MenuButton>
            <span className="pg-label">Scale</span>
            <MenuButton root={scaleMenu} appearance={{tooltip: "Scale"}}
                        onInit={button => button.classList.add("scale")}>{scaleName}<span>⌄</span></MenuButton>
        </div>
    )
}
