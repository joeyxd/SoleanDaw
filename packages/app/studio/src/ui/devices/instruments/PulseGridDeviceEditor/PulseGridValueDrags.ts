import {int, Terminator} from "@opendaw/lib-std"
import {Events} from "@opendaw/lib-dom"
import {PulseGridActions, PulseGridView} from "@opendaw/studio-adapters"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridValueLogic} from "./PulseGridValueLogic"

export type PulseGridValueKind = "velocity" | "chance" | "accent"

export namespace PulseGridValueDrags {
    // The gesture of a value row. The first press decides what the drag does (the accent's new state), then every
    // step with notes that the pointer passes gets the value at the pointer's height. The rows are built again
    // after every change, so nothing here keeps an element: the row and the step are found again on each event.
    // The session ends itself on release, so it needs no owner that outlives the rows. One drag is one undo step;
    // Escape takes it back. Only one gesture runs at a time and it follows only the pointer that began it: a
    // second press (another finger, the mouse beside a touch) first ends the one in progress.
    let active: (() => void) | undefined
    export const press = (context: PulseGridContext, kind: PulseGridValueKind, laneId: string, event: PointerEvent): void => {
        active?.()
        const view = (event.target as Element).ownerDocument.defaultView ?? window
        const document = view.document
        const pointerId = event.pointerId
        const session = new Terminator()
        const state: {last: int, changed: boolean, accent: boolean} = {last: 0, changed: false, accent: false}
        const locate = (x: number, y: number): {rect: DOMRect, step: int | undefined} | undefined => {
            const under = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-row]")
            const row = under !== null && under !== undefined && under.dataset.values === laneId && under.dataset.row === kind
                ? under
                : document.querySelector<HTMLElement>(`[data-values="${CSS.escape(laneId)}"][data-row="${kind}"]`)
            if (row === null) {return undefined}
            const places = Array.from(row.querySelectorAll<HTMLElement>("[data-step]"))
            // past either end of the row the nearest step counts, so a quick drag off the end still reaches it
            const place = places.find(element => {
                const rect = element.getBoundingClientRect()
                return x >= rect.left && x <= rect.right
            }) ?? (places.length === 0 ? undefined
                : x < places[0].getBoundingClientRect().left ? places[0]
                    : x > places[places.length - 1].getBoundingClientRect().right ? places[places.length - 1] : undefined)
            return {rect: row.getBoundingClientRect(), step: place === undefined ? undefined : Number(place.dataset.step)}
        }
        const stepOf = (target: int) => {
            const doc = context.doc.getValue()
            const lane = doc.lanes.find(lane => lane.id === laneId)
            return lane === undefined ? undefined : PulseGridView.steps(doc, lane).steps[target - 1]
        }
        const apply = (targets: ReadonlyArray<int>, y: number, rect: DOMRect): void => {
            const ops = targets.flatMap(target => {
                const current = stepOf(target)
                if (current === undefined) {return []}
                switch (kind) {
                    case "velocity": {
                        const velocity = PulseGridValueLogic.velocityAt(y, rect.top, rect.height)
                        return velocity === current.velocity ? [] : PulseGridActions.setStepValues(laneId, target, {velocity})
                    }
                    case "chance": {
                        const chance = PulseGridValueLogic.chanceAt(y, rect.top, rect.height)
                        return chance === current.chance ? [] : PulseGridActions.setStepValues(laneId, target, {chance})
                    }
                    case "accent":
                        return state.accent === current.accent ? [] : PulseGridActions.setStepValues(laneId, target, {accent: state.accent})
                }
            })
            if (ops.length === 0) {return}
            context.send(ops, false)
            state.changed = true
        }
        const first = locate(event.clientX, event.clientY)
        if (first?.step === undefined) {return}
        const start = stepOf(first.step)
        if (start === undefined) {return}
        state.last = first.step
        state.accent = !start.accent
        const finish = (): void => {
            if (active === finish) {active = undefined}
            session.terminate()
            if (state.changed) {context.mark()}
        }
        active = finish
        apply([first.step], event.clientY, first.rect)
        session.ownAll(
            Events.subscribe(view, "pointermove", (move: PointerEvent) => {
                if (move.pointerId !== pointerId) {return}
                // the release was lost (a menu took it): stop here instead of changing values on hover
                if (move.buttons === 0) {
                    finish()
                    return
                }
                const found = locate(move.clientX, move.clientY)
                if (found?.step === undefined) {return}
                const next = found.step
                if (next === state.last && kind === "accent") {return}
                const direction = next >= state.last ? 1 : -1
                const passed: Array<int> = []
                for (let target = state.last + direction; target !== next + direction; target += direction) {
                    passed.push(target)
                }
                if (next === state.last) {passed.push(next)}
                state.last = next
                apply(passed, move.clientY, found.rect)
            }),
            Events.subscribe(view, "keydown", (key: KeyboardEvent) => {
                if (key.key !== "Escape") {return}
                if (active === finish) {active = undefined}
                session.terminate()
                if (state.changed) {context.revert()}
            }),
            Events.subscribe(view, "pointerup", (up: PointerEvent) => {if (up.pointerId === pointerId) {finish()}}),
            Events.subscribe(view, "pointercancel", (cancel: PointerEvent) => {if (cancel.pointerId === pointerId) {finish()}}))
    }
}
