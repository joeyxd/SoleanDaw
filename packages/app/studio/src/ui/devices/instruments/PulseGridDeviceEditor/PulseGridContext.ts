import {DefaultObservableValue, Lifecycle, MutableObservableValue, ObservableValue, Optional, UUID} from "@opendaw/lib-std"
import {deferNextFrame} from "@opendaw/lib-dom"
import {InstrumentCompositeBox} from "@opendaw/studio-boxes"
import {
    PulseGridDevice, PulseGridDoc, PulseGridDocs, PulseGridError, PulseGridNoteKey, PulseGridOp, PulseGridOpResult,
    PulseGridOps
} from "@opendaw/studio-adapters"
import {StudioService} from "@/service/StudioService"

// The one door between the PulseGrid screen and the project.
//
// Reading: `doc` is the whole sequencer as plain data (PulseGridDoc). It is read again after every change to
// the project, whoever made it: this screen, undo, another editor, an agent. Components draw from `doc` and
// from PulseGridView, never from boxes.
//
// Writing: `send` is the only way the screen changes a PulseGrid. It takes ops, the same ones an agent sends,
// built by PulseGridActions. A component never touches a box or `editing` itself.

export type PulseGridNotice = {kind: "error" | "info", text: string}

// What a press or a drag in a piano roll does (SPEC.md, section 8).
export type PulseGridTool = "paint" | "erase" | "select" | "listen"

// The notes picked with the Select tool: always of one lane, in the pattern that plays.
export type PulseGridPicked = {lane: string, notes: ReadonlyArray<PulseGridNoteKey>}

export type PulseGridContext = {
    readonly service: StudioService
    readonly composite: InstrumentCompositeBox
    readonly doc: ObservableValue<PulseGridDoc>
    // the lane the person works on (its id), for the highlight now and the instrument panel later
    readonly selectedLane: MutableObservableValue<Optional<string>>
    // what the window says in its toast: a refused op now, "Max: busier hats in B" once agents write here
    readonly notice: MutableObservableValue<Optional<PulseGridNotice>>
    // the lanes (ids) that just changed under an agent's hands; rows with these ids flash. The lifecycle owns it
    // and empties it after the flash has played. Components only read it.
    readonly flash: MutableObservableValue<ReadonlyArray<string>>
    // What belongs to the screen and not to the document, so an agent never sees it: the tool in hand, the lanes
    // (ids) that are open, and the picked notes. They outlive the rows, which are built again after every change.
    readonly tool: MutableObservableValue<PulseGridTool>
    readonly openLanes: MutableObservableValue<ReadonlySet<string>>
    readonly picked: MutableObservableValue<Optional<PulseGridPicked>>
    // Applies the ops as one undo step and answers what each one did. A refused op is shown as a notice; the
    // ops before it stay. With `mark` false the change joins the gesture in progress: call `mark()` when the
    // gesture ends (pointer up), so one drag is one undo step. When the gesture is cancelled instead (Escape),
    // `revert()` takes back what it sent so far and leaves no undo step behind.
    send(ops: ReadonlyArray<PulseGridOp>, mark?: boolean): ReadonlyArray<PulseGridOpResult>
    mark(): void
    revert(): void
}

export namespace PulseGridContext {
    // the screens that are open now, by their composite, so an agent's change can reach the one that shows it
    const open = new Map<string, PulseGridContext>()

    export const opened = (composite: InstrumentCompositeBox): Optional<PulseGridContext> =>
        open.get(UUID.toString(composite.address.uuid))

    export const FlashMillis = 1300

    export const create = (lifecycle: Lifecycle, service: StudioService, composite: InstrumentCompositeBox): PulseGridContext => {
        const {project: {editing, boxGraph}} = service
        const read = (): Optional<PulseGridDoc> => {
            if (!composite.isAttached()) {return undefined}
            try {
                return PulseGridDevice.find(composite).match({
                    none: () => undefined,
                    some: device => PulseGridDocs.read(device)
                })
            } catch (error) {
                if (!(error instanceof PulseGridError)) {throw error}
                console.warn(`PulseGrid: ${error.message}`)
                return undefined
            }
        }
        const first = read()
        if (first === undefined) {throw new Error("Not a PulseGrid")}
        const doc = lifecycle.own(new DefaultObservableValue<PulseGridDoc>(first))
        const selectedLane = lifecycle.own(new DefaultObservableValue<Optional<string>>(undefined))
        const notice = lifecycle.own(new DefaultObservableValue<Optional<PulseGridNotice>>(undefined))
        const flash = lifecycle.own(new DefaultObservableValue<ReadonlyArray<string>>([]))
        const tool = lifecycle.own(new DefaultObservableValue<PulseGridTool>("paint"))
        const openLanes = lifecycle.own(new DefaultObservableValue<ReadonlySet<string>>(new Set()))
        const picked = lifecycle.own(new DefaultObservableValue<Optional<PulseGridPicked>>(undefined))
        const state = {text: JSON.stringify(first)}
        let flashTimer: ReturnType<typeof setTimeout> | undefined
        lifecycle.ownAll(
            {terminate: () => clearTimeout(flashTimer)},
            flash.subscribe(owner => {
                clearTimeout(flashTimer)
                if (owner.getValue().length === 0) {return}
                flashTimer = setTimeout(() => flash.setValue([]), FlashMillis)
            }))
        // The document is small, so reading all of it and comparing its text is cheaper than tracking which
        // of the boxes behind it changed, and it cannot miss one.
        const refresh = (): void => {
            const next = read()
            if (next === undefined) {return}
            const text = JSON.stringify(next)
            if (text === state.text) {return}
            state.text = text
            doc.setValue(next)
        }
        const deferred = lifecycle.own(deferNextFrame(refresh))
        lifecycle.own(boxGraph.subscribeToAllUpdates({onUpdate: () => deferred.request()}))
        const context: PulseGridContext = {
            service, composite, doc, selectedLane, notice, flash, tool, openLanes, picked,
            send: (ops, mark = true) => {
                if (ops.length === 0) {return []}
                const results = editing.modify(() => PulseGridOps.apply(composite, ops), mark).unwrapOrElse(() => [])
                const refused = results.find(result => !result.ok)
                if (refused !== undefined && !refused.ok) {notice.setValue({kind: "error", text: refused.error})}
                refresh()
                return results
            },
            mark: () => editing.mark(),
            revert: () => {
                editing.revertPending()
                refresh()
            }
        }
        const key = UUID.toString(composite.address.uuid)
        open.set(key, context)
        lifecycle.own({terminate: () => {if (open.get(key) === context) {open.delete(key)}}})
        return context
    }
}
