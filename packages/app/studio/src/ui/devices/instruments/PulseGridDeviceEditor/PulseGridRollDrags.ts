import {int, isDefined, Optional, Terminator} from "@opendaw/lib-std"
import {Events} from "@opendaw/lib-dom"
import {PulseGridActions, PulseGridDoc, PulseGridLaneDoc, PulseGridNoteKey, PulseGridOp, PulseGridView} from "@opendaw/studio-adapters"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridAudition} from "./PulseGridAudition"
import {PulseGridRollLogic as Logic} from "./PulseGridRollLogic"

export namespace PulseGridRollDrags {
    const owners = new WeakMap<PulseGridContext, Map<string, Terminator>>()
    const rollOf = (document: Document, lane: string): Optional<HTMLElement> =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-roll]")).find(roll => roll.dataset.roll === lane)
    export const owner = (inner: Terminator, context: PulseGridContext, document: Document, lane: string): Terminator => {
        let lanes = owners.get(context)
        if (!isDefined(lanes)) {owners.set(context, lanes = new Map())}
        let owner = lanes.get(lane)
        if (!isDefined(owner)) {lanes.set(lane, owner = new Terminator())}
        const retained = owner
        const retainedLanes = lanes
        inner.own({terminate: () => queueMicrotask(() => {
            if (isDefined(rollOf(document, lane))) {return}
            retained.terminate()
            retainedLanes.delete(lane)
        })})
        return owner
    }
    export const point = (document: Document, lane: string, x: number, y: number, clamp = false):
        Optional<{step: int, row: int}> => {
        const roll = rollOf(document, lane)
        if (!isDefined(roll)) {return undefined}
        const rect = roll.getBoundingClientRect()
        const row = Logic.rowAt(y - rect.top, roll.querySelectorAll(".line").length)
        if (!isDefined(row)) {return undefined}
        const columns = Array.from(roll.querySelectorAll<HTMLElement>(".col"))
        const column = columns.find(column => {
            const rect = column.getBoundingClientRect()
            return x >= rect.left && x <= rect.right
        }) ?? (clamp ? columns.reduce<Optional<HTMLElement>>((nearest, column) => {
            const distance = (element: HTMLElement): number => Math.abs(x - (element.getBoundingClientRect().left
                + element.getBoundingClientRect().right) / 2)
            return !isDefined(nearest) || distance(column) < distance(nearest) ? column : nearest
        }, undefined) : undefined)
        return isDefined(column) ? {step: Number(column.dataset.step), row} : undefined
    }
    export const start = (owner: Terminator, context: PulseGridContext, document: Document,
                          startDoc: PulseGridDoc, lane: PulseGridLaneDoc, event: PointerEvent,
                          at: {step: int, row: int}, note: Optional<PulseGridNoteKey>, edge: boolean): void => {
        const view = document.defaultView ?? window
        owner.terminate()
        const session = owner.spawn()
        const pressed = {x: event.clientX, y: event.clientY, id: event.pointerId}
        const tool = context.tool.getValue()
        const roll = PulseGridView.roll(startDoc, lane)
        const pitch = roll.rows[at.row].pitch
        if (tool === "listen") {
            PulseGridAudition.listen(context, lane.id, pitch)
            session.terminate()
            return
        }
        const before = context.picked.getValue()
        const previous = before?.lane === lane.id ? before.notes : []
        let picked = previous
        if (tool === "select") {
            if (isDefined(note)) {
                picked = event.shiftKey
                    ? previous.some(key => Logic.same(key, note)) ? previous.filter(key => !Logic.same(key, note)) : [...previous, note]
                    : previous.some(key => Logic.same(key, note)) ? previous : [note]
            } else if (!event.shiftKey) {picked = []}
            context.picked.setValue(picked.length > 0 ? {lane: lane.id, notes: picked} : undefined)
        }
        const startPicked = picked
        const state = {changed: false, dragged: false, ended: false, length: isDefined(note)
            ? roll.notes.find(key => Logic.same(key, note))?.length ?? 4 : 4, delta: "0:0:false"}
        const send = (ops: ReadonlyArray<PulseGridOp>): void => {
            if (ops.length === 0) {return}
            state.changed = true
            context.send(ops, false)
        }
        const erase = (pointer: PointerEvent): void => {
            const hit = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>(".note")
            if (hit?.closest<HTMLElement>("[data-roll]")?.dataset.roll !== lane.id) {return}
            send(PulseGridActions.eraseNote(lane.id, Number(hit.dataset.step), Number(hit.dataset.pitch)))
        }
        const finish = (cancel = false, click = false): void => {
            if (state.ended) {return}
            state.ended = true
            rollOf(document, lane.id)?.querySelector(".selection")?.remove()
            session.terminate()
            if (cancel) {
                if (state.changed) {context.revert()}
                context.picked.setValue(before)
            } else {
                if (click && !state.dragged && tool === "paint" && isDefined(note)) {
                    send(PulseGridActions.eraseNote(lane.id, note.step, note.pitch))
                }
                if (state.changed) {context.mark()}
            }
        }
        session.own({terminate: () => {
            if (!state.ended) {
                state.ended = true
                if (state.changed) {context.mark()}
            }
        }})
        session.ownAll(
            Events.subscribe(view, "pointermove", (pointer: PointerEvent) => {
                if (pointer.pointerId !== pressed.id) {return}
                if (pointer.buttons === 0) {finish(); return}
                state.dragged ||= Math.hypot(pointer.clientX - pressed.x, pointer.clientY - pressed.y) >= 3
                if (tool === "erase") {erase(pointer); return}
                if (!state.dragged) {return}
                if (tool === "select" && !isDefined(note)) {
                    const box = Logic.box(pressed.x, pressed.y, pointer.clientX, pointer.clientY)
                    const current = rollOf(document, lane.id)
                    if (!isDefined(current)) {return}
                    const keys = Logic.touched(Array.from(current.querySelectorAll<HTMLElement>(".note")).map(element => ({
                        key: {step: Number(element.dataset.step), pitch: Number(element.dataset.pitch)},
                        box: element.getBoundingClientRect()
                    })), box)
                    const notes = [...startPicked, ...keys.filter(key => !startPicked.some(other => Logic.same(key, other)))]
                    context.picked.setValue(notes.length > 0 ? {lane: lane.id, notes} : undefined)
                    let selection = current.querySelector<HTMLElement>(".selection")
                    if (!isDefined(selection)) {
                        selection = document.createElement("div")
                        selection.className = "selection"
                        current.appendChild(selection)
                    }
                    const rect = current.getBoundingClientRect()
                    Object.assign(selection.style, {left: `${box.left - rect.left}px`, top: `${box.top - rect.top}px`,
                        width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px`})
                    return
                }
                const next = point(document, lane.id, pointer.clientX, pointer.clientY, true)
                if (!isDefined(next)) {return}
                const selected = isDefined(note) && startPicked.some(key => Logic.same(key, note))
                if ((tool === "paint" && (!isDefined(note) || edge)) || (tool === "select" && edge && selected)) {
                    const key = note ?? {step: at.step, pitch}
                    const length = Logic.resizeLength(key.step, next.step, roll.length)
                    if (length === state.length) {return}
                    state.length = length
                    send(PulseGridActions.resizeNote(lane.id, key.step, key.pitch, length))
                } else if (tool === "select" && selected) {
                    const steps = next.step - at.step
                    const currentDoc = context.doc.getValue()
                    const currentLane = currentDoc.lanes.find(current => current.id === lane.id)
                    if (!isDefined(currentLane)) {return}
                    const currentRows = PulseGridView.roll(currentDoc, currentLane).rows
                    const target = currentRows[next.row]
                    if (!isDefined(target)) {return}
                    const rows = [...roll.rows, ...currentRows.filter(row => !roll.rows.some(start => start.pitch === row.pitch))]
                        .sort((first, second) => second.pitch - first.pitch)
                    const degrees = Logic.degrees(rows, rows.findIndex(row => row.pitch === pitch),
                        rows.findIndex(row => row.pitch === target.pitch))
                    const delta = `${steps}:${degrees}:${pointer.altKey}`
                    if (delta === state.delta) {return}
                    state.delta = delta
                    send(PulseGridActions.moveNotes(startDoc, lane.id, startPicked, steps, degrees, pointer.altKey))
                    context.picked.setValue({lane: lane.id,
                        notes: PulseGridView.moved(startDoc, lane, startPicked, steps, degrees).keys})
                }
            }),
            Events.subscribe(view, "pointerup", (pointer: PointerEvent) => {
                if (pointer.pointerId === pressed.id) {finish(false, true)}
            }),
            Events.subscribe(view, "pointercancel", (pointer: PointerEvent) => {
                if (pointer.pointerId === pressed.id) {finish(true)}
            }),
            Events.subscribe(view, "keydown", (key: KeyboardEvent) => {
                if (key.key !== "Escape") {return}
                key.preventDefault()
                key.stopImmediatePropagation()
                finish(true)
            }, {capture: true}))
        if (tool === "paint" && !isDefined(note)) {
            send(PulseGridActions.paintNote(lane.id, at.step, pitch))
            PulseGridAudition.listen(context, lane.id, pitch)
        } else if (tool === "erase") {erase(event)}
    }
}
