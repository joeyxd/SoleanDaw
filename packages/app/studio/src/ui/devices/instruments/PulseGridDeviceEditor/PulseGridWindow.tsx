import css from "./PulseGridWindow.sass?inline"
import {Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"
import {PulseGridActions} from "@opendaw/studio-adapters"
import {Button} from "@/ui/components/Button"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridScenesLogic} from "./PulseGridScenesLogic"
import {PulseGridTopBar} from "./PulseGridTopBar"
import {PulseGridSceneBar} from "./PulseGridSceneBar"
import {PulseGridLanes} from "./PulseGridLanes"
import {PulseGridScenes} from "./PulseGridScenes"
import {PulseGridBrowser} from "./PulseGridBrowser"
import {PulseGridBottomBar} from "./PulseGridBottomBar"
import {PulseGridPanel} from "./PulseGridPanel"

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
    // Song on and an empty song is silence with nothing on screen to say why (a preset saved in Song without its
    // timeline loads that way). This line stays for as long as the state does, with the way out next to it.
    const emptySong: HTMLElement = (
        <div className="empty-song hidden" role="status">
            <span>{PulseGridScenesLogic.NoticeEmptySong}</span>
            <Button lifecycle={lifecycle} className="pg-button" appearance={{tooltip: "Loop the scene and variation you pick"}}
                    onClick={() => context.send(PulseGridActions.setSongMode(false))}>
                <span>Switch to Pattern</span>
            </Button>
        </div>
    )
    lifecycle.own(context.doc.catchupAndSubscribe(owner => {
        const {on, entries} = owner.getValue().song
        emptySong.classList.toggle("hidden", !PulseGridScenesLogic.emptySong(on, entries.length))
    }))
    return (
        <div className={className}>
            <PulseGridTopBar lifecycle={lifecycle} context={context}/>
            <PulseGridSceneBar lifecycle={lifecycle} context={context}/>
            {emptySong}
            <div className="main">
                <div className="side">
                    <PulseGridScenes lifecycle={lifecycle} context={context}/>
                    <PulseGridBrowser lifecycle={lifecycle} context={context}/>
                </div>
                <div className="lanes"><PulseGridLanes lifecycle={lifecycle} context={context}/></div>
                <PulseGridPanel lifecycle={lifecycle} context={context}/>
            </div>
            <PulseGridBottomBar lifecycle={lifecycle} context={context}/>
            {toast}
        </div>
    )
}
