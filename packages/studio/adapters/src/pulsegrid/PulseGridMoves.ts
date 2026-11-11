import {int} from "@opendaw/lib-std"
import {PulseGridError, PulseGridNote, PulseGridNote as Note} from "./PulseGridTypes"

const checkSize = (notes: ReadonlyArray<PulseGridNote>): void => {
    if (notes.length > Note.MaxPerPattern) {
        throw new PulseGridError(`pattern has ${notes.length} notes; allowed 0..${Note.MaxPerPattern}`)
    }
}

export namespace PulseGridMoves {
    export const sort = (notes: ReadonlyArray<PulseGridNote>): Array<PulseGridNote> =>
        [...notes].sort((a, b) => a.step - b.step || a.pitch - b.pitch)

    export const rotate = (notes: ReadonlyArray<PulseGridNote>, steps: int, length: int): Array<PulseGridNote> => {
        const result = sort(notes.map(note => ({...note, step: ((note.step - 1 + steps) % length + length) % length + 1})))
        checkSize(result)
        return result
    }

    export const double = (notes: ReadonlyArray<PulseGridNote>, length: int): Array<PulseGridNote> => {
        if (length > 32) throw new PulseGridError(`cannot double length ${length}; allowed 1..32`)
        const result = sort([...notes, ...notes.map(note => ({...note, step: note.step + length}))])
        checkSize(result)
        return result
    }

    export const halve = (notes: ReadonlyArray<PulseGridNote>, length: int): Array<PulseGridNote> => {
        if (length === 1) throw new PulseGridError("cannot halve length 1; allowed length 2..64")
        const result = sort(notes.filter(note => note.step <= Math.floor(length / 2)))
        checkSize(result)
        return result
    }

    export const euclid = (hits: int, steps: int, rotateBy: int, velocity: int, pitch: int): Array<PulseGridNote> => {
        if (!Number.isInteger(steps) || steps < 1 || steps > 64) {
            throw new PulseGridError(`steps ${steps} is not allowed; expected 1..64`)
        }
        if (!Number.isInteger(hits) || hits < 0 || hits > steps) {
            throw new PulseGridError(`hits ${hits} is not allowed for ${steps} steps; expected 0..${steps}`)
        }
        const notes = Array.from({length: steps}, (_, i) => i)
            .filter(i => (i * hits) % steps < hits)
            .map(i => ({step: i + 1, pitch, ...PulseGridNote.Defaults, velocity}))
        checkSize(notes)
        return rotate(notes, rotateBy, steps)
    }
}
