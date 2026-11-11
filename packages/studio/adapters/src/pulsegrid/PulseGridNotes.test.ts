import {describe, expect, it} from "vitest"
import {PulseGridNotes} from "./PulseGridNotes"
import {PulseGridError, PulseGridNote, PulseGridVariation} from "./PulseGridTypes"

const note: PulseGridNote = {
    step: 1, pitch: 60, velocity: 127, length: 255, chance: 35, accent: true, offset: -99, repeats: 8
}

describe("PulseGridNotes", () => {
    it("round trips every field, with zero-based steps, unsigned length and signed offset", () => {
        const bytes = PulseGridNotes.encode([note])
        expect(bytes).toBeInstanceOf(Int8Array)
        expect(Array.from(bytes)).toEqual([0, -99, -1, 60, 127, 35, 1, 8])
        expect(PulseGridNotes.decode(bytes)).toEqual([note])
        expect(PulseGridNotes.decode(PulseGridNotes.encode([]))).toEqual([])
    })

    it.each([9, 15])("drops an incomplete last record from %i bytes", size => {
        const bytes = new Int8Array(size)
        bytes.set(PulseGridNotes.encode([note]))
        expect(PulseGridNotes.decode(bytes)).toEqual([note])
    })

    it("clamps corrupt stored values and reads every byte but the offset as unsigned, as the lane device does", () => {
        expect(PulseGridNotes.decode(new Int8Array([100, -128, 0, -1, 0, 127, 3, 100]))).toEqual([{
            step: 64, offset: -99, length: 1, pitch: 127, velocity: 1, chance: 100, accent: true, repeats: 8
        }])
        expect(PulseGridNotes.decode(new Int8Array([-128, 127, -1, 127, -1, -1, 2, -1]))).toEqual([{
            step: 64, offset: 99, length: 255, pitch: 127, velocity: 127, chance: 100, accent: false, repeats: 8
        }])
        expect(PulseGridNotes.decode(new Int8Array(7))).toEqual([])
        expect(PulseGridNotes.decode(new Int8Array(129 * 8))).toHaveLength(128)
    })

    it("sorts by step, then pitch, without mutating input", () => {
        const input = [{...note, step: 64}, {...note, pitch: 72}, {...note, pitch: 36}]
        const snapshot = structuredClone(input)
        expect(PulseGridNotes.decode(PulseGridNotes.encode(input))).toEqual([input[2], input[1], input[0]])
        expect(input).toEqual(snapshot)
    })

    it("accepts 128 notes and refuses 129 with a readable range", () => {
        expect(PulseGridNotes.encode(Array.from({length: 128}, () => note))).toHaveLength(1024)
        expect(() => PulseGridNotes.encode(Array.from({length: 129}, () => note))).toThrow(PulseGridError)
        expect(() => PulseGridNotes.encode(Array.from({length: 129}, () => note))).toThrow(/129.*0\.\.128/)
    })

    it.each([
        ["step", 0, "1..64"], ["step", 65, "1..64"], ["velocity", 0, "1..127"],
        ["chance", 101, "0..100"], ["length", 0, "1..255"], ["length", 256, "1..255"],
        ["pitch", -1, "0..127"], ["offset", -100, "-99..99"], ["repeats", 9, "0..8"],
        ["step", 1.5, "1..64"], ["chance", NaN, "0..100"]
    ] as const)("rejects %s %s", (field, value, range) => {
        const encode = () => PulseGridNotes.encode([{...note, [field]: value}])
        expect(encode).toThrow(PulseGridError)
        expect(encode).toThrow(`${field} ${value}`)
        expect(encode).toThrow(range)
    })

    it("maps scene and variation to slots and back", () => {
        expect(PulseGridNotes.slot(1, "A")).toBe(0)
        expect(PulseGridNotes.slot(2, "B")).toBe(5)
        expect(PulseGridNotes.slot(16, "D")).toBe(63)
        expect(PulseGridNotes.slotOf(5)).toEqual({scene: 2, variation: "B"})
        for (let slot = 0; slot < 64; slot++) {
            const {scene, variation} = PulseGridNotes.slotOf(slot)
            expect(PulseGridNotes.slot(scene, variation)).toBe(slot)
        }
    })

    it("rejects invalid scenes, variations and slots", () => {
        for (const scene of [0, 17, 1.5, NaN]) {
            expect(() => PulseGridNotes.slot(scene, "A")).toThrow(PulseGridError)
        }
        expect(() => PulseGridNotes.slot(1, "E" as PulseGridVariation)).toThrow(PulseGridError)
        for (const slot of [-1, 64, 0.5, NaN]) {
            expect(() => PulseGridNotes.slotOf(slot)).toThrow(PulseGridError)
        }
    })
})
