import css from "./PulseGridBottomBar.sass?inline"
import {Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Events, Html} from "@opendaw/lib-dom"
import {PulseGridAudition} from "./PulseGridAudition"
import {PulseGridContext, PulseGridTool} from "./PulseGridContext"
import {PulseGridKeyboard} from "./PulseGridKeyboard"
import {PulseGridKeyScale} from "./PulseGridKeyScale"

const className = Html.adoptStyleSheet(css, "PulseGridBottomBar")

type Construct = {lifecycle: Lifecycle, context: PulseGridContext}

const Tools: ReadonlyArray<{tool: PulseGridTool, label: string, title: string}> = [
    {
        tool: "paint", label: "Paint",
        title: "Paint: press an empty place in a piano roll to put a note there, drag right to make it longer, " +
            "drag the right end of a note to change its length, click a note to remove it"
    },
    {tool: "erase", label: "Erase", title: "Erase: press a note, or drag over notes, to remove them"},
    {
        tool: "select", label: "Select",
        title: "Select: press a note to pick it (Shift adds or takes it out), drag from an empty place to pick what " +
            "the box touches, drag picked notes to other steps and rows (Alt copies), Delete removes them"
    },
    {tool: "listen", label: "Listen", title: "Listen: a press sounds the row's pitch on that lane and changes nothing"}
]

// The bar under the lanes: key and scale, the keyboard, the tools (SPEC.md, section 8; map H6, H7, H8).
export const PulseGridBottomBar = ({lifecycle, context}: Construct): HTMLElement => {
    const listen = PulseGridAudition.available(context)
    const buttons = Tools.filter(({tool}) => tool !== "listen" || listen).map(({tool, label, title}) => {
        const button: HTMLElement = <button type="button" title={title} aria-label={label}>{label}</button>
        lifecycle.own(Events.subscribe(button, "click", () => context.tool.setValue(tool)))
        return {tool, button}
    })
    lifecycle.own(context.tool.catchupAndSubscribe(owner => buttons.forEach(({tool, button}) => {
        const active = owner.getValue() === tool
        button.classList.toggle("active", active)
        button.setAttribute("aria-pressed", String(active))
    })))
    return (
        <div className={className}>
            <PulseGridKeyScale lifecycle={lifecycle} context={context}/>
            <PulseGridKeyboard lifecycle={lifecycle} context={context}/>
            <div className="pg-group tools">{buttons.map(({button}) => button)}</div>
        </div>
    )
}
