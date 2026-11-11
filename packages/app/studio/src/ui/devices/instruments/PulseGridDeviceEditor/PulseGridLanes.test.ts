import {describe, expect, it} from "vitest"
import {PulseGridDoc, PulseGridLaneDoc} from "@opendaw/studio-adapters"
import {PulseGridLaneLogic} from "./PulseGridLaneLogic"

const lane = (id: string, group: number, name = id, mix: Partial<PulseGridLaneDoc["mix"]> = {}): PulseGridLaneDoc => ({
    index: 0, id, name, kind: group === 0 ? "drum" : "melodic", group, hue: 0, pitch: 60, probability: 100,
    humanize: 0, accent: true, armed: false, enabled: true, seed: 0, sound: null, effects: [],
    mix: {gain: 0, pan: 0, mute: false, solo: false, ...mix}, patterns: []
})

const docOf = (lanes: ReadonlyArray<PulseGridLaneDoc>, length = 16): PulseGridDoc => ({
    version: 1, id: "head", name: "Test",
    settings: {length, swing: 50, groove: 0, probability: 100, humanize: 0, accentAmount: 50, root: 0, scale: 0},
    scene: 1, variation: "A", scenes: [], lanes: lanes.map((lane, index) => ({...lane, index: index + 1}))
})

describe("PulseGridLaneLogic.frames", () => {
    it("puts group 0 in DRUMS and every other lane in MELODY, in document order", () => {
        const doc = docOf([lane("kick", 0), lane("bass", 1, "Bass"), lane("snare", 0), lane("synth", 2, "Synth")])
        const [drums, melody] = PulseGridLaneLogic.frames(doc)
        expect(drums.title).toBe("DRUMS")
        expect(drums.subtitle).toBe("Beat Foundation")
        expect(drums.lanes.map(lane => lane.id)).toEqual(["kick", "snare"])
        expect(melody.title).toBe("MELODY")
        expect(melody.subtitle).toBe("Bass · Synth")
        expect(melody.lanes.map(lane => lane.id)).toEqual(["bass", "synth"])
    })
    it("leaves out a frame without lanes", () => {
        expect(PulseGridLaneLogic.frames(docOf([lane("a", 1)])).map(frame => frame.key)).toEqual(["melody"])
        expect(PulseGridLaneLogic.frames(docOf([lane("a", 0)])).map(frame => frame.key)).toEqual(["drums"])
    })
})

describe("PulseGridLaneLogic ruler and columns", () => {
    it("never makes the ruler shorter than the sequencer", () => {
        const doc = docOf([lane("a", 0)], 16)
        expect(PulseGridLaneLogic.rulerLength(doc, [])).toBe(16)
        expect(PulseGridLaneLogic.rulerLength(doc, [8, 4])).toBe(16)
        expect(PulseGridLaneLogic.rulerLength(doc, [16, 32])).toBe(32)
    })
    it("marks steps 1, 5, 9, 13 as beats", () => {
        const beats = Array.from({length: 16}, (_, index) => index + 1).filter(PulseGridLaneLogic.isBeat)
        expect(beats).toEqual([1, 5, 9, 13])
    })
    it("leaves a spacer track after every 4th step but the last", () => {
        expect(PulseGridLaneLogic.trackOf(1)).toBe(1)
        expect(PulseGridLaneLogic.trackOf(4)).toBe(4)
        expect(PulseGridLaneLogic.trackOf(5)).toBe(6)
        expect(PulseGridLaneLogic.trackOf(9)).toBe(11)
        expect(PulseGridLaneLogic.tracks(8).match(/minmax/g)?.length).toBe(8)
        expect(PulseGridLaneLogic.tracks(8).match(/ 3px /g)?.length).toBe(1)
        expect(PulseGridLaneLogic.tracks(8).endsWith("64px)")).toBe(true)
        expect(PulseGridLaneLogic.tracks(4).includes("3px")).toBe(false)
    })
    it("measures the least width of the cells", () => {
        expect(PulseGridLaneLogic.minCellsWidth(4)).toBe(4 * 18 + 3 * 3)
        expect(PulseGridLaneLogic.minCellsWidth(8)).toBe(8 * 18 + 3 + 8 * 3)
    })
})

describe("PulseGridLaneLogic.brightness", () => {
    it("grows with velocity and stays within 0.3 and 1", () => {
        expect(PulseGridLaneLogic.brightness(127)).toBe(1)
        expect(PulseGridLaneLogic.brightness(1)).toBeGreaterThanOrEqual(0.3)
        const steps = [45, 80, 100, 127].map(PulseGridLaneLogic.brightness)
        expect([...steps].sort((a, b) => a - b)).toEqual(steps)
        expect(PulseGridLaneLogic.brightness(127) - PulseGridLaneLogic.brightness(45)).toBeGreaterThan(0.4)
    })
})

describe("PulseGridLaneLogic.isQuiet", () => {
    it("dims a muted lane and, while any lane solos, the lanes that do not", () => {
        expect(PulseGridLaneLogic.isQuiet(lane("a", 0), false)).toBe(false)
        expect(PulseGridLaneLogic.isQuiet(lane("a", 0, "a", {mute: true}), false)).toBe(true)
        expect(PulseGridLaneLogic.isQuiet(lane("a", 0), true)).toBe(true)
        expect(PulseGridLaneLogic.isQuiet(lane("a", 0, "a", {solo: true}), true)).toBe(false)
    })
})

describe("PulseGridLaneLogic reorder", () => {
    it("counts the other rows above the pointer", () => {
        expect(PulseGridLaneLogic.dropSlot([10, 40, 70], 5)).toBe(0)
        expect(PulseGridLaneLogic.dropSlot([10, 40, 70], 45)).toBe(2)
        expect(PulseGridLaneLogic.dropSlot([10, 40, 70], 200)).toBe(3)
        expect(PulseGridLaneLogic.dropSlot([], 20)).toBe(0)
    })
    it("answers the new position among all lanes", () => {
        const doc = docOf([lane("k", 0), lane("s", 0), lane("c", 0), lane("b", 1), lane("y", 1)])
        const drums = ["k", "s", "c"]
        expect(PulseGridLaneLogic.moveTarget(doc, drums, "k", 2)).toBe(3)
        expect(PulseGridLaneLogic.moveTarget(doc, drums, "k", 0)).toBe(1)
        expect(PulseGridLaneLogic.moveTarget(doc, drums, "c", 0)).toBe(1)
        expect(PulseGridLaneLogic.moveTarget(doc, drums, "s", 1)).toBe(2)
        expect(PulseGridLaneLogic.moveTarget(doc, ["b", "y"], "y", 0)).toBe(4)
        expect(PulseGridLaneLogic.moveTarget(doc, ["b", "y"], "b", 1)).toBe(5)
    })
    it("works when the frames are interleaved in the document", () => {
        const doc = docOf([lane("k", 0), lane("b", 1), lane("s", 0), lane("y", 1)])
        expect(PulseGridLaneLogic.moveTarget(doc, ["k", "s"], "k", 1)).toBe(3)
        expect(PulseGridLaneLogic.moveTarget(doc, ["k", "s"], "s", 0)).toBe(1)
    })
})

describe("PulseGridLaneLogic.oneShots", () => {
    it("finds the One Shots folder below openDAW", () => {
        const folders = [
            {name: "openDAW", folders: [{name: "Loops"}, {name: "One Shots", folders: [{name: "TR-808"}]}]},
            {name: "ModeAudio", folders: [{name: "One Shots"}]}
        ]
        expect(PulseGridLaneLogic.oneShots(folders)?.folders?.[0].name).toBe("TR-808")
    })
    it("answers nothing when the index has none", () => {
        expect(PulseGridLaneLogic.oneShots([{name: "openDAW", folders: [{name: "Loops"}]}])).toBeUndefined()
    })
})
