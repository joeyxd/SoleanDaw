import {describe, expect, it} from "vitest"
import {StringMapping, ValueMapping} from "@opendaw/lib-std"
import {PulseGridLaneDoc, PulseGridParamDoc} from "@opendaw/studio-adapters"
import {PulseGridPanelLogic} from "./PulseGridPanelLogic"

const param = (name: string, extra: Partial<PulseGridParamDoc> = {}): PulseGridParamDoc =>
    ({name, type: "float", value: 0, unit: "", ...extra})

const lane = (extra: Partial<PulseGridLaneDoc> = {}): PulseGridLaneDoc => ({
    index: 1, id: "a", name: "Kick", kind: "drum", group: 0, hue: 0, pitch: 36, probability: 100, humanize: 0,
    accent: true, armed: false, enabled: true, seed: 0, sound: null, effects: [], chain: [],
    mix: {gain: 0, pan: 0, mute: false, solo: false}, patterns: [], ...extra
})

describe("PulseGridPanelLogic.fallback", () => {
    it("is linear over min..max", () => {
        const tune = PulseGridPanelLogic.fallback(param("tune", {unit: "ct", min: -1200, max: 1200}))
        expect(tune.x(-1200)).toBe(0)
        expect(tune.x(0)).toBeCloseTo(0.5)
        expect(tune.y(0.75)).toBeCloseTo(600)
        expect(tune.y(1)).toBe(1200)
    })
    it("is linear over 0..1 without a range", () => {
        const plain = PulseGridPanelLogic.fallback(param("mix"))
        expect(plain.y(0.25)).toBeCloseTo(0.25)
    })
    it("is exponential when the range crosses decades", () => {
        const release = PulseGridPanelLogic.fallback(param("release", {unit: "s", min: 0.001, max: 8}))
        expect(release.x(0.001)).toBe(0)
        expect(release.y(1)).toBeCloseTo(8)
        expect(release.y(0.5)).toBeCloseTo(Math.sqrt(0.001 * 8), 5) // the middle of the knob is the geometric mean
        expect(release.x(release.y(0.3))).toBeCloseTo(0.3)
    })
    it("is the mixer's decibel curve for a decibel range that ends at 0", () => {
        const gain = PulseGridPanelLogic.fallback(param("volume", {unit: "db", min: -72, max: 0}))
        expect(gain.x(-72)).toBe(0)
        expect(gain.x(0)).toBe(1)
        expect(gain.y(0.5)).toBeCloseTo(-12, 5) // half way up the knob is -12 dB, as in the mixer
        expect(gain.x(gain.y(0.8))).toBeCloseTo(0.8)
    })
    it("stays linear for a decibel range that reaches above 0", () => {
        const boost = PulseGridPanelLogic.fallback(param("boost", {unit: "db", min: -24, max: 24}))
        expect(boost.y(0.5)).toBeCloseTo(0)
    })
})

describe("PulseGridPanelLogic.printValue", () => {
    it("prints floats with two, one or no decimals by size and the unit after a space", () => {
        expect(PulseGridPanelLogic.printValue(param("release", {unit: "s"}), 0.2)).toBe("0.2 s")
        expect(PulseGridPanelLogic.printValue(param("a"), 12.34)).toBe("12.3")
        expect(PulseGridPanelLogic.printValue(param("a"), 440.4)).toBe("440")
        expect(PulseGridPanelLogic.printValue(param("tune", {unit: "ct"}), -0.001)).toBe("0 ct")
    })
    it("prints decibels as dB, percent without a space, ints whole", () => {
        expect(PulseGridPanelLogic.printValue(param("volume", {unit: "db"}), -6)).toBe("-6 dB")
        expect(PulseGridPanelLogic.printValue(param("mix", {unit: "%"}), 50)).toBe("50%")
        expect(PulseGridPanelLogic.printValue(param("bits", {type: "int"}), 7.6)).toBe("8")
    })
})

describe("PulseGridPanelLogic.mapping", () => {
    const adapter = {
        valueMapping: ValueMapping.exponential(0.001, 8),
        stringMapping: StringMapping.numeric({unit: "s", fractionDigits: 3})
    }
    it("uses the adapter's value mapping and print text when there is one", () => {
        const release = param("release", {unit: "s", min: 0.001, max: 8})
        const mapping = PulseGridPanelLogic.mapping(release, adapter)
        expect(mapping.y(1)).toBeCloseTo(8)
        expect(mapping.x(0.001)).toBe(0)
        expect(mapping.print(0.2)).toBe("0.200 s")
    })
    it("falls back to the document's range and its own print without one", () => {
        const release = param("release", {unit: "s", min: 0.001, max: 8})
        expect(PulseGridPanelLogic.mapping(release).print(0.2)).toBe("0.2 s")
    })
    it("maps a percent of the document to the fraction the adapter knows", () => {
        const fraction = {
            valueMapping: ValueMapping.linear(0, 1),
            stringMapping: StringMapping.numeric({unit: "%", fractionDigits: 0})
        }
        const mapping = PulseGridPanelLogic.mapping(param("mix", {unit: "%", min: 0, max: 100}), fraction, 100)
        expect(mapping.x(50)).toBeCloseTo(0.5)
        expect(mapping.y(0.25)).toBeCloseTo(25)
        expect(mapping.print(50)).toContain("%")
    })
})

describe("PulseGridPanelLogic.valueAt", () => {
    const tune = param("tune", {min: -100, max: 100})
    const mapping = PulseGridPanelLogic.fallback(tune)
    it("maps a place on the knob to a value and keeps it in range", () => {
        expect(PulseGridPanelLogic.valueAt(tune, mapping, 0.5)).toBeCloseTo(0)
        expect(PulseGridPanelLogic.valueAt(tune, mapping, 2)).toBe(100)
        expect(PulseGridPanelLogic.valueAt(tune, mapping, -1)).toBe(-100)
    })
    it("writes whole numbers for an int", () => {
        const bits = param("bits", {type: "int", min: 1, max: 16})
        expect(PulseGridPanelLogic.valueAt(bits, PulseGridPanelLogic.fallback(bits), 0.5)).toBe(9)
    })
    it("never writes below a decibel range's floor", () => {
        const gain = param("volume", {unit: "db", min: -72, max: 0})
        expect(PulseGridPanelLogic.valueAt(gain, PulseGridPanelLogic.fallback(gain), 0)).toBe(-72)
    })
})

describe("PulseGridPanelLogic words and lanes", () => {
    it("names the instrument for a person", () => {
        expect(PulseGridPanelLogic.word("Nano")).toBe("Sampler")
        expect(PulseGridPanelLogic.word("Tubular")).toBe("FM synth")
        expect(PulseGridPanelLogic.word("Vaporisateur")).toBe("Vaporisateur")
    })
    it("puts the sound and the word on one line", () => {
        expect(PulseGridPanelLogic.soundLine({instrument: "Nano", label: "TR-808 Kick", params: []})).toBe("TR-808 Kick · Sampler")
        expect(PulseGridPanelLogic.soundLine(null)).toBe("No instrument")
    })
    it("steps to the next and the previous lane and wraps at both ends", () => {
        const ids = ["a", "b", "c"]
        expect(PulseGridPanelLogic.neighbour(ids, "a", 1)).toBe("b")
        expect(PulseGridPanelLogic.neighbour(ids, "c", 1)).toBe("a")
        expect(PulseGridPanelLogic.neighbour(ids, "a", -1)).toBe("c")
        expect(PulseGridPanelLogic.neighbour(ids, "b", -1)).toBe("a")
    })
    it("starts at the first lane when none is picked or the picked one is gone", () => {
        expect(PulseGridPanelLogic.neighbour(["a", "b"], undefined, 1)).toBe("a")
        expect(PulseGridPanelLogic.neighbour(["a", "b"], "gone", -1)).toBe("a")
        expect(PulseGridPanelLogic.neighbour([], undefined, 1)).toBeUndefined()
    })
})

describe("PulseGridPanelLogic.paramOf and structure", () => {
    const withSound = lane({
        sound: {instrument: "Nano", label: "Kick", params: [param("tune", {value: 5})]},
        chain: [{index: 1, name: "Crusher", label: "Crusher", enabled: true, params: [param("bits", {type: "int", value: 8})]}]
    })
    it("finds a parameter of the instrument or of an effect", () => {
        expect(PulseGridPanelLogic.paramOf(withSound, undefined, "tune")?.value).toBe(5)
        expect(PulseGridPanelLogic.paramOf(withSound, 1, "bits")?.value).toBe(8)
        expect(PulseGridPanelLogic.paramOf(withSound, 2, "bits")).toBeUndefined()
        expect(PulseGridPanelLogic.paramOf(lane(), undefined, "tune")).toBeUndefined()
    })
    it("keeps the body while only values change and rebuilds it when the shape changes", () => {
        const moved = lane({...withSound, sound: {...withSound.sound!, params: [param("tune", {value: 900})]}})
        expect(PulseGridPanelLogic.structure(moved, "instrument", undefined))
            .toBe(PulseGridPanelLogic.structure(withSound, "instrument", undefined))
        const off = lane({...withSound, chain: [{...withSound.chain[0], enabled: false}]})
        expect(PulseGridPanelLogic.structure(off, "effects", undefined))
            .not.toBe(PulseGridPanelLogic.structure(withSound, "effects", undefined))
        expect(PulseGridPanelLogic.structure(withSound, "effects", 1))
            .not.toBe(PulseGridPanelLogic.structure(withSound, "effects", undefined))
        expect(PulseGridPanelLogic.structure(lane({mix: {gain: -9, pan: 3, mute: false, solo: false}}), "mix", undefined))
            .toBe(PulseGridPanelLogic.structure(lane(), "mix", undefined))
    })
})
