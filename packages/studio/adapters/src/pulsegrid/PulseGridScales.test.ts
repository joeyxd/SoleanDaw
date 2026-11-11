import {describe, expect, it} from "vitest"
import {PulseGridScales as Scales} from "./PulseGridScales"

describe("PulseGridScales", () => {
    it("stores exactly the contract's scale ids in order", () => {
        expect(Scales.All.map(scale => scale.id)).toEqual([
            "major", "natural-minor", "harmonic-minor", "melodic-minor", "dorian", "phrygian", "lydian",
            "mixolydian", "locrian", "pentatonic-major", "pentatonic-minor", "blues", "whole-tone", "diminished", "augmented"
        ])
        expect(Scales.All.map(scale => scale.index)).toEqual(Array.from({length: 15}, (_, i) => i))
    })

    it.each([1, "1", "natural-minor", "MINOR", "Natural Minor"])("finds scale %s", value => {
        expect(Scales.find(value)).toEqual({index: 1, id: "natural-minor", name: "Natural Minor"})
    })

    it("refuses unknown scales and reads unknown stored indices as major", () => {
        expect(Scales.find("missing")).toBeUndefined()
        expect(Scales.find(15)).toBeUndefined()
        expect(Scales.byIndex(15)).toEqual(Scales.All[0])
    })

    it("tests pitch membership relative to the key and scale", () => {
        expect(Scales.has(0, 0, 60)).toBe(true)
        expect(Scales.has(0, 0, 61)).toBe(false)
        expect(Scales.has(2, 1, 65)).toBe(true)
        expect(Scales.has(2, 1, 66)).toBe(false)
    })

    it("lists pitches in ascending order within inclusive MIDI bounds", () => {
        expect(Scales.pitches(0, 0, 60, 72)).toEqual([60, 62, 64, 65, 67, 69, 71, 72])
        expect(Scales.pitches(0, 0, -10, 2)).toEqual([0, 2])
        expect(Scales.pitches(0, 0, 125, 140)).toEqual([125, 127])
    })

    it.each([[61, 60], [60, 60], [0, 0], [127, 127]])("snaps C major pitch %s to %s", (pitch, expected) => {
        expect(Scales.snap(0, 0, pitch)).toBe(expected)
    })

    it("snaps inward at both MIDI boundaries when the endpoint is outside the scale", () => {
        expect(Scales.snap(1, 0, 0)).toBe(0)
        expect(Scales.snap(2, 0, 0)).toBe(1)
        expect(Scales.snap(1, 0, 127)).toBe(126)
    })

    it.each([
        [60, 1, 62], [64, 1, 65], [61, 1, 62], [61, -1, 60], [60, 7, 72],
        [60, -2, 57], [60, 0, 60], [127, 1, undefined], [0, -1, undefined]
    ])("shifts pitch %s by %s degrees to %s", (pitch, degrees, expected) => {
        expect(Scales.shift(0, 0, pitch, degrees)).toBe(expected)
    })
})
