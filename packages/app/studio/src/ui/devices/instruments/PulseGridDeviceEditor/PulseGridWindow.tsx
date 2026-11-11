import css from "./PulseGridWindow.sass?inline"
import {Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridTopBar} from "./PulseGridTopBar"
import {PulseGridSceneBar} from "./PulseGridSceneBar"
import {PulseGridLanes} from "./PulseGridLanes"
import {PulseGridBottomBar} from "./PulseGridBottomBar"

const className = Html.adoptStyleSheet(css, "PulseGridWindow")

type Construct = {lifecycle: Lifecycle, context: PulseGridContext}

export const PulseGridWindow = ({lifecycle, context}: Construct): HTMLElement => {
    const toast: HTMLElement = <div className="notice" role="status" aria-live="polite"/>
    let timer: ReturnType<typeof setTimeout> | undefined
    lifecycle.ownAll(
        {terminate: () => clearTimeout(timer)},
        context.notice.catchupAndSubscribe(owner => {
            clearTimeout(timer)
            const notice = owner.getValue()
            toast.classList.toggle("visible", notice !== undefined)
            toast.classList.toggle("error", notice?.kind === "error")
            if (notice === undefined) {return}
            toast.textContent = notice.text
            timer = setTimeout(() => context.notice.setValue(undefined), 3500)
        })
    )
    return (
        <div className={className}>
            <PulseGridTopBar lifecycle={lifecycle} context={context}/>
            <PulseGridSceneBar lifecycle={lifecycle} context={context}/>
            <div className="main"><PulseGridLanes lifecycle={lifecycle} context={context}/></div>
            <PulseGridBottomBar lifecycle={lifecycle} context={context}/>
            {toast}
        </div>
    )
}
