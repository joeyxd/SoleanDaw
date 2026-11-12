import {int, UUID} from "@opendaw/lib-std"
import {NoteSignal, PulseGridDevice, PulseGridView} from "@opendaw/studio-adapters"
import {PulseGridContext} from "./PulseGridContext"

// Hearing one lane by itself: the Listen tool, a key of the keyboard, the note that was just painted.
export namespace PulseGridAudition {
    // Whether this build can sound one lane without changing the project.
    export const available = (context: PulseGridContext): boolean => {
        try {context.service.engine.assertWorklet(); return true} catch {return false}
    }

    // Sounds the lane's instrument at a pitch now, for a moment. The project does not change.
    export const listen = (context: PulseGridContext, laneId: string, pitch: int, velocity: int = 100,
                           duration: number = 240): void => {
        if (!available(context) || !context.composite.isAttached()) {return}
        const lane = context.doc.getValue().lanes.find(lane => lane.id === laneId)
        if (lane === undefined) {return}
        PulseGridDevice.find(context.composite).ifSome(device => {
            const target = device.lanes.find(lane => UUID.toString(lane.device.address.uuid) === laneId)
            if (target === undefined) {return}
            context.service.engine.noteSignal(NoteSignal.audition(target.cell.address.uuid,
                lane.kind === "drum" ? lane.pitch : pitch, duration, velocity / 127))
        })
    }

    export const step = (context: PulseGridContext, laneId: string, step: int, emptyPitch?: int): void => {
        const doc = context.doc.getValue()
        const lane = doc.lanes.find(lane => lane.id === laneId)
        if (lane === undefined) {return}
        const notes = PulseGridView.roll(doc, lane).notes.filter(note => note.step === step)
        if (notes.length === 0 && emptyPitch !== undefined) {listen(context, laneId, emptyPitch)}
        notes.forEach(note => listen(context, laneId, note.pitch, note.velocity))
    }
}
