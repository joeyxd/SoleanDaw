import {int} from "@opendaw/lib-std"
import {PulseGridError, PulseGridNote, PulseGridVariation} from "./PulseGridTypes"

export namespace PulseGridNotes {
    const variations: ReadonlyArray<PulseGridVariation> = ["A", "B", "C", "D"]
    const clamp = (value: int, min: int, max: int): int => Math.max(min, Math.min(max, value))
    const compare = (a: PulseGridNote, b: PulseGridNote): int => a.step - b.step || a.pitch - b.pitch
    const check = (name: string, value: int, min: int, max: int): void => {
        if (!Number.isInteger(value) || value < min || value > max) {
            throw new PulseGridError(`${name} ${value} is not allowed: expected an integer ${min}..${max}`)
        }
    }

    export const decode = (bytes: Int8Array): Array<PulseGridNote> => {
        const notes: Array<PulseGridNote> = []
        for (let index = 0; index + 8 <= bytes.length && notes.length < PulseGridNote.MaxPerPattern; index += 8) {
            // The lane device reads every byte as unsigned except the offset; so does this.
            notes.push({
                step: clamp((bytes[index] & 0xFF) + 1, 1, 64),
                offset: clamp(bytes[index + 1], -99, 99),
                length: clamp(bytes[index + 2] & 0xFF, 1, 255),
                pitch: clamp(bytes[index + 3] & 0xFF, 0, 127),
                velocity: clamp(bytes[index + 4] & 0xFF, 1, 127),
                chance: clamp(bytes[index + 5] & 0xFF, 0, 100),
                accent: (bytes[index + 6] & 1) !== 0,
                repeats: clamp(bytes[index + 7] & 0xFF, 0, 8)
            })
        }
        return notes.sort(compare)
    }

    export const encode = (notes: ReadonlyArray<PulseGridNote>): Int8Array => {
        if (notes.length > PulseGridNote.MaxPerPattern) {
            throw new PulseGridError(`Note count ${notes.length} is not allowed: expected 0..128`)
        }
        const bytes = new Int8Array(notes.length * 8)
        notes.toSorted(compare).forEach((note, index) => {
            check("step", note.step, 1, 64)
            check("offset", note.offset, -99, 99)
            check("length", note.length, 1, 255)
            check("pitch", note.pitch, 0, 127)
            check("velocity", note.velocity, 1, 127)
            check("chance", note.chance, 0, 100)
            check("repeats", note.repeats, 0, 8)
            if (typeof note.accent !== "boolean") {
                throw new PulseGridError(`accent ${note.accent} is not allowed: expected true or false`)
            }
            bytes.set([note.step - 1, note.offset, note.length, note.pitch, note.velocity, note.chance,
                note.accent ? 1 : 0, note.repeats], index * 8)
        })
        return bytes
    }

    export const slot = (scene: int, variation: PulseGridVariation): int => {
        check("scene", scene, 1, 16)
        const index = variations.indexOf(variation)
        if (index < 0) {
            throw new PulseGridError(`variation ${variation} is not allowed: expected A, B, C or D`)
        }
        return (scene - 1) * 4 + index
    }

    export const slotOf = (slot: int): {scene: int, variation: PulseGridVariation} => {
        check("slot", slot, 0, 63)
        return {scene: Math.floor(slot / 4) + 1, variation: variations[slot % 4]}
    }
}
