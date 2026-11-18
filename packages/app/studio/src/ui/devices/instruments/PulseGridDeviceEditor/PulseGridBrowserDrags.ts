import {Optional, Terminator} from "@opendaw/lib-std"
import {Events} from "@opendaw/lib-dom"
import {PulseGridActions, PulseGridCatalogItem} from "@opendaw/studio-adapters"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridBrowserLogic, PulseGridDropTarget} from "./PulseGridBrowserLogic"

export namespace PulseGridBrowserDrags {
    // The label that follows the pointer. It lives on the page's body with its own inline style: the browser column
    // clips what is inside it, and the label has to cross into the lanes.
    const makeLabel = (document: Document, text: string): HTMLElement => {
        const label = document.createElement("div")
        label.textContent = text
        label.setAttribute("data-browser-drag", "")
        Object.assign(label.style, {
            position: "fixed", zIndex: "100000", pointerEvents: "none", maxWidth: "220px", padding: "4px 10px",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", font: "600 12px sans-serif",
            borderRadius: "8px", color: "#efeaff", background: "#a22ada", boxShadow: "0 4px 18px #000a"
        } satisfies Partial<CSSStyleDeclaration>)
        document.body.appendChild(label)
        return label
    }

    // Drag a sound from the list: after 4 px a label follows the pointer, the lane row under it is marked, and
    // letting go on a row gives that lane the sound, letting go elsewhere in the lanes makes a new lane. Anywhere
    // else, or Escape, does nothing. `moved` is told when the press became a drag, so its click can be ignored;
    // `ended` when the press is over, however it ended. Only the pointer that pressed moves or ends it.
    export const start = (context: PulseGridContext, owner: Terminator, item: PulseGridCatalogItem,
                          down: PointerEvent, lanes: () => Optional<HTMLElement>, moved: () => void,
                          ended: () => void): void => {
        const document = (down.target as Node).ownerDocument ?? window.document
        const view = document.defaultView ?? window
        const session = owner.spawn()
        const state: {label: Optional<HTMLElement>, marked: Optional<HTMLElement>} = {label: undefined, marked: undefined}
        const rows = (): ReadonlyArray<{id: string, element: HTMLElement}> =>
            Array.from(lanes()?.querySelectorAll<HTMLElement>(".row[data-lane]") ?? [])
                .map(element => ({id: element.dataset.lane ?? "", element}))
        const targetAt = (x: number, y: number): PulseGridDropTarget => {
            const area = lanes()
            if (area === undefined) {return {type: "none"}}
            return PulseGridBrowserLogic.dropTarget(x, y, area.getBoundingClientRect(), rows().map(({id, element}) => {
                const {left, top, right, bottom} = element.getBoundingClientRect()
                return {id, left, top, right, bottom}
            }))
        }
        const show = (target: PulseGridDropTarget): void => {
            const next = target.type === "lane" ? rows().find(({id}) => id === target.id)?.element : undefined
            if (next !== state.marked) {
                state.marked?.classList.remove("target")
                next?.classList.add("target")
                state.marked = next
            }
            lanes()?.classList.toggle("dropping", target.type === "new")
            if (state.label !== undefined) {
                state.label.style.opacity = target.type === "none" ? "0.55" : "1"
            }
        }
        session.own({
            terminate: () => {
                state.label?.remove()
                state.marked?.classList.remove("target")
                lanes()?.classList.remove("dropping")
                ended()
            }
        })
        session.ownAll(
            Events.subscribe(view, "pointermove", (event: PointerEvent) => {
                if (event.pointerId !== down.pointerId) {return}
                if (event.buttons === 0) {
                    // the release was lost (a menu took it): stop here instead of dragging on hover
                    session.terminate()
                    return
                }
                if (state.label === undefined) {
                    if (!PulseGridBrowserLogic.moved(event.clientX - down.clientX, event.clientY - down.clientY)) {return}
                    moved()
                    state.label = makeLabel(document, item.name)
                }
                state.label.style.left = `${event.clientX + 14}px`
                state.label.style.top = `${event.clientY + 10}px`
                show(targetAt(event.clientX, event.clientY))
            }),
            Events.subscribe(view, "pointerup", (event: PointerEvent) => {
                if (event.pointerId !== down.pointerId) {return}
                const dragged = state.label !== undefined
                session.terminate()
                if (!dragged) {return}
                const target = targetAt(event.clientX, event.clientY)
                if (target.type === "lane") {
                    context.send(PulseGridActions.loadSound(target.id, item))
                } else if (target.type === "new") {
                    context.send(PulseGridActions.addSoundLane(context.doc.getValue(), item))
                }
            }),
            Events.subscribe(view, "pointercancel", (event: PointerEvent) => {
                if (event.pointerId === down.pointerId) {session.terminate()}
            }),
            Events.subscribe(view, "keydown", (event: KeyboardEvent) => {
                if (event.key === "Escape") {session.terminate()}
            }))
    }
}
