import {describe, expect, it} from "vitest"
import {PulseGridError, PulseGridNote} from "./PulseGridTypes"
import {PulseGridMoves} from "./PulseGridMoves"

const makeNote = (step: number, pitch = 60) => ({step, pitch, ...PulseGridNote.Defaults})

describe("PulseGridMoves", () => {
    it("transposes without mutating the source or other note values", () => {
        const notes = [{...makeNote(2, 64), length: 8, velocity: 45, chance: 20, accent: true, offset: -4, repeats: 2}]
        const before = structuredClone(notes)
        expect(PulseGridMoves.transpose(notes, 1, "degrees", 0, 0)).toEqual([{...notes[0], pitch: 65}])
        expect(PulseGridMoves.transpose(notes, -12, "semitones", 0, 0)).toEqual([{...notes[0], pitch: 52}])
        expect(notes).toEqual(before)
    })

    it("fits chords independently per step and retains the louder note's modifiers", () => {
        const loud = {...makeNote(1, 61), velocity: 120, length: 8, accent: true}
        const notes = [makeNote(2, 61), loud, makeNote(1)]
        expect(PulseGridMoves.toScale(notes, 0, 0)).toEqual([{...loud, pitch: 60}, makeNote(2)])
        expect(notes[1].pitch).toBe(61)
    })

    it("rotates in both directions and wraps beyond the pattern", () => {
        const notes = [makeNote(1), makeNote(4)]
        expect(PulseGridMoves.rotate(notes, 1, 4).map(note => note.step)).toEqual([1, 2])
        expect(PulseGridMoves.rotate(notes, -1, 4).map(note => note.step)).toEqual([3, 4])
        expect(PulseGridMoves.rotate(notes, 5, 4).map(note => note.step)).toEqual([1, 2])
    })

    it("doubles notes and checks its length limit", () => {
        expect(PulseGridMoves.double([makeNote(2), makeNote(8)], 8).map(note => note.step)).toEqual([2, 8, 10, 16])
        expect(() => PulseGridMoves.double([], 33)).toThrow(PulseGridError)
    })

    it("halves by retaining the first half and rejects length one", () => {
        expect(PulseGridMoves.halve([makeNote(1), makeNote(8), makeNote(9), makeNote(16)], 16).map(note => note.step)).toEqual([1, 8])
        expect(() => PulseGridMoves.halve([], 1)).toThrow(PulseGridError)
    })

    it("creates the specified Euclidean rhythms and rotations", () => {
        const steps = (hits: number, length: number, rotate = 0) =>
            PulseGridMoves.euclid(hits, length, rotate, 100, 36).map(note => note.step)
        expect(steps(3, 8)).toEqual([1, 4, 7])
        expect(steps(4, 16)).toEqual([1, 5, 9, 13])
        expect(steps(5, 8)).toEqual([1, 3, 5, 6, 8])
        expect(steps(3, 8, 1)).toEqual([2, 5, 8])
        expect(() => PulseGridMoves.euclid(9, 8, 0, 100, 36)).toThrow(PulseGridError)
    })
})
