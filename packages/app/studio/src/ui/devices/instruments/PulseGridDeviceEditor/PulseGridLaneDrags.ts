import {int, Terminable, Terminator} from "@opendaw/lib-std"
import {Events} from "@opendaw/lib-dom"
import {PulseGridActions, PulseGridView} from "@opendaw/studio-adapters"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridLaneLogic} from "./PulseGridLaneLogic"
import {PulseGridAudition} from "./PulseGridAudition"

// What a reorder drag needs to know about the frame it happens in.
export type PulseGridFrameRef = {
    readonly ids: ReadonlyArray<string>
    readonly rows: ReadonlyMap<string, HTMLElement>
    readonly drop: HTMLElement
}

export namespace PulseGridLaneDrags {
    const viewOf = (element: Element): Window => element.ownerDocument.defaultView ?? window

    // Paint drag: the first press decides on or off, then every step passed on the same lane gets that state. The
    // drag does not hold any cell, so the rows may be rebuilt under it. One drag is one undo step.
    export const paint = (context: PulseGridContext, owner: Terminator,
                          cell: HTMLElement, laneId: string, step: int, on: boolean): void => {
        const view = viewOf(cell)
        const document = cell.ownerDocument
        const session = owner.spawn()
        const state = {last: step, changed: false}
        const stateOf = (target: int): boolean => {
            const doc = context.doc.getValue()
            const lane = doc.lanes.find(lane => lane.id === laneId)
            return lane !== undefined && PulseGridView.steps(doc, lane).steps[target - 1] !== undefined
        }
        const apply = (targets: ReadonlyArray<int>): void => {
            const changed = targets.filter(target => stateOf(target) !== on)
            const ops = changed.flatMap(target => PulseGridActions.setStep(laneId, target, on))
            if (ops.length === 0) {return}
            context.send(ops, false)
            if (on) {changed.forEach(step => PulseGridAudition.step(context, laneId, step))}
            state.changed = true
        }
        apply([step])
        const finish = (): void => {
            session.terminate()
            if (state.changed) {context.mark()}
        }
        session.ownAll(
            Events.subscribe(view, "pointermove", (event: PointerEvent) => {
                // the release was lost (a menu took it): stop here instead of painting on hover
                if (event.buttons === 0) {
                    finish()
                    return
                }
                const hit = document.elementFromPoint(event.clientX, event.clientY)
                    ?.closest<HTMLElement>("[data-step]")
                if (hit === null || hit === undefined || hit.dataset.lane !== laneId) {return}
                const next = Number(hit.dataset.step)
                if (next === state.last) {return}
                const direction = next > state.last ? 1 : -1
                const passed: Array<int> = []
                for (let target = state.last + direction; target !== next + direction; target += direction) {
                    passed.push(target)
                }
                state.last = next
                apply(passed)
            }),
            Events.subscribe(view, "pointerup", finish),
            Events.subscribe(view, "pointercancel", finish))
    }

    // Reorder drag: shows where the lane will land inside its frame and sends one moveLane on release.
    export const reorder = (context: PulseGridContext, owner: Terminator,
                            handle: HTMLElement, frame: PulseGridFrameRef, laneId: string): Terminable => {
        const view = viewOf(handle)
        const session = owner.spawn()
        const row = frame.rows.get(laneId)
        const others = frame.ids.filter(id => id !== laneId)
        const slotAt = (y: number): int => PulseGridLaneLogic.dropSlot(others.map(id => {
            const rect = frame.rows.get(id)?.getBoundingClientRect()
            return rect === undefined ? 0 : rect.top + rect.height / 2
        }), y)
        const show = (slot: int): void => {
            if (others.length === 0) {return}
            const anchor = frame.rows.get(others[Math.min(slot, others.length - 1)])
            if (anchor === undefined) {return}
            const edge = slot < others.length ? anchor.offsetTop : anchor.offsetTop + anchor.offsetHeight
            frame.drop.style.top = `${edge - 2}px`
            frame.drop.style.display = "block"
        }
        row?.classList.add("lifting")
        session.own({
            terminate: () => {
                row?.classList.remove("lifting")
                frame.drop.style.display = "none"
            }
        })
        const state = {slot: frame.ids.indexOf(laneId)}
        session.ownAll(
            Events.subscribe(view, "pointermove", (event: PointerEvent) => {
                state.slot = slotAt(event.clientY)
                show(state.slot)
            }),
            Events.subscribe(view, "pointerup", () => {
                session.terminate()
                // released where it was picked up: nothing to send
                if (state.slot === frame.ids.indexOf(laneId)) {return}
                const doc = context.doc.getValue()
                const to = PulseGridLaneLogic.moveTarget(doc, frame.ids, laneId, state.slot)
                const from = doc.lanes.findIndex(lane => lane.id === laneId) + 1
                if (to !== from) {context.send(PulseGridActions.moveLane(laneId, to))}
            }),
            Events.subscribe(view, "pointercancel", () => session.terminate()))
        return session
    }
}
