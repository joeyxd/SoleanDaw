import {describe, expect, it} from "vitest"
import {PulseGridDoc, PulseGridError, PulseGridLaneDoc, PulseGridNote, PulseGridVariation} from "./PulseGridTypes"
import {PulseGridText} from "./PulseGridText"

const note = (step: number, pitch: number, changes: Partial<PulseGridNote> = {}): PulseGridNote =>
    ({step, pitch, ...PulseGridNote.Defaults, ...changes})

const lane = (name: string, kind: "drum" | "melodic", pitch: number): {name: string, kind: "drum" | "melodic", pitch: number} =>
    ({name, kind, pitch})

const sameNotes = (actual: ReadonlyArray<PulseGridNote>, expected: ReadonlyArray<PulseGridNote>) =>
    expect(actual).toEqual([...expected].sort((a, b) => a.step - b.step || a.pitch - b.pitch))

const random = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
}

describe("PulseGridText pattern lines", () => {
    it("formats bars and default drum notes exactly", () => {
        const notes = [1, 5, 9, 13].map(step => note(step, 36))
        expect(PulseGridText.formatLine(lane("kick", "drum", 36), {length: 0, notes}, 16)).toBe("kick |x--- x--- x--- x---|")
        expect(PulseGridText.formatLine(lane("kick", "drum", 36), {length: 0, notes: [...notes, note(17, 36)]}, 32)).toContain("|x--- x--- x--- x---|x---")
    })

    it("parses grid cells and details", () => {
        const parsed = PulseGridText.parseLine("hat/8 |x-x- 5-X-| 3:%50 7:l2", {pitch: 42, effectiveLength: 16})
        expect(parsed.ownLength).toBe(8)
        expect(parsed.notes).toEqual([
            note(1, 42), note(3, 42, {chance: 50}), note(5, 42, {velocity: 70}), note(7, 42, {accent: true, length: 2})
        ])
    })

    it("parses list notes with names, modifiers, and multiple pitches per step", () => {
        const parsed = PulseGridText.parseLine("marimba: 1:C3 5:E3l8 9:G3 9:B3v90!", {pitch: 60, effectiveLength: 16})
        expect(parsed.notes.map(item => item.pitch)).toEqual([60, 64, 67, 71])
        expect(parsed.notes[1].length).toBe(8)
        expect(parsed.notes[3]).toMatchObject({velocity: 90, accent: true})
        expect(parsed.notes.filter(item => item.step === 9)).toHaveLength(2)
        expect(PulseGridText.parseLine("1:C3", {pitch: 60, effectiveLength: 16}).name).toBeNull()
    })

    it("round trips seeded drum and melodic patterns", () => {
        const rand = random(193845)
        for (const kind of ["drum", "melodic"] as const) {
            for (let run = 0; run < 200; run++) {
                const length = 1 + Math.floor(rand() * 32)
                const notes: Array<PulseGridNote> = []
                for (let step = 1; step <= length; step++) {
                    const count = kind === "drum" ? (rand() < 0.6 ? 1 : 0) : Math.floor(rand() * 4)
                    const pitches = new Set<number>()
                    for (let j = 0; j < count; j++) {
                        let pitch = 36
                        if (kind === "melodic") {
                            do { pitch = 48 + Math.floor(rand() * 36) } while (pitches.has(pitch))
                            pitches.add(pitch)
                        }
                        notes.push(note(step, pitch, {
                        velocity: 1 + Math.floor(rand() * 127), length: 1 + Math.floor(rand() * 255),
                        chance: Math.floor(rand() * 101), accent: rand() < 0.5, offset: -99 + Math.floor(rand() * 199), repeats: Math.floor(rand() * 9)
                        }))
                    }
                }
                const headLength = 32
                const patternLength = run % 2 ? length : 0
                const source = {length: patternLength, notes}
                const text = PulseGridText.formatLine(lane(kind, kind, 36), source, headLength)
                const parsed = PulseGridText.parseLine(text, {pitch: 36, effectiveLength: patternLength || headLength})
                expect(parsed.ownLength).toBe(patternLength || null)
                const expected = kind === "drum" ? notes.map(item => ({...item, pitch: 36})) : notes
                sameNotes(parsed.notes, expected)
            }
        }
    })

    it("uses list form for repeated drum steps", () => {
        const notes = [note(2, 36), note(2, 40)]
        const text = PulseGridText.formatLine(lane("kick", "drum", 36), {length: 0, notes}, 8)
        expect(text).toContain(":")
        sameNotes(PulseGridText.parseLine(text, {pitch: 36, effectiveLength: 8}).notes, notes.map(item => ({...item, pitch: item.pitch})))
    })

    it("quotes names that contain separators", () => {
        for (const name of ["hat/snare", "warm: room"]) {
            const text = PulseGridText.formatLine(lane(name, "drum", 36), {length: 0, notes: [note(1, 36)]}, 4)
            expect(text.startsWith("\"")).toBe(true)
            expect(PulseGridText.parseLine(text, {pitch: 36, effectiveLength: 4}).name).toBe(name)
        }
    })

    it("rejects malformed counts, details, ranges, modifiers, and duplicate notes", () => {
        const cases = [
            ["kick |x--- x--- x--- x--|", 16], ["kick |x---| 2:v10", 4], ["kick: 5:C3", 4],
            ["kick/8 |x---|", 4], ["kick |x---| 1:z3", 4], ["kick |x---| 1:v0", 4], ["kick |x---| 1:v128", 4],
            ["bass: 1:C3 1:C3", 4]
        ] as const
        for (const [text, length] of cases) expect(() => PulseGridText.parseLine(text, {pitch: 36, effectiveLength: length})).toThrow(PulseGridError)
        try { PulseGridText.parseLine("kick |x--- x--- x--- x--|", {pitch: 36, effectiveLength: 16}) } catch (cause) {
            expect((cause as Error).message).toContain("15")
            expect((cause as Error).message).toContain("16")
        }
    })
})

const makeLane = (index: number, name: string, kind: "drum" | "melodic", pitch: number,
                 patterns: PulseGridLaneDoc["patterns"] = []): PulseGridLaneDoc => ({
    index, id: `lane-${index}`, name, kind, group: kind === "drum" ? 0 : 1, hue: index, pitch,
    probability: 100, humanize: 0, accent: true, armed: false, enabled: true, seed: index,
    sound: {instrument: "Nano", label: name}, effects: [], mix: {gain: 0, pan: 0, mute: false, solo: false}, patterns
})

describe("PulseGridText whole document", () => {
    it("formats and parses names, settings, scenes, playing, and pattern slots", () => {
        const variation: PulseGridVariation = "A"
        const doc: PulseGridDoc = {
            version: 1, id: "head", name: "Night drive",
            settings: {length: 16, swing: 54, groove: 20, probability: 100, humanize: 0, accentAmount: 50, root: 0, scale: 0},
            scene: 1, variation,
            scenes: [{scene: 1, name: "Intro", used: true}, {scene: 2, name: "Drop", used: true}],
            lanes: [
                makeLane(1, "kick", "drum", 36, [{scene: 1, variation: "A", length: 0, notes: [1, 5, 9, 13].map(step => note(step, 36))}]),
                makeLane(2, "hat", "drum", 42, [{scene: 1, variation: "B", length: 0, notes: [note(1, 42), note(3, 42)]}]),
                makeLane(3, "marimba", "melodic", 60, [{scene: 2, variation: "A", length: 0, notes: [note(5, 64)]}])
            ]
        }
        const text = PulseGridText.toText(doc)
        expect(text.replace(/ +/g, " ")).toBe([
            "PulseGrid \"Night drive\"",
            "length 16 swing 54 groove 20 probability 100 humanize 0 accent 50 key C scale 0",
            "playing scene 1 A", "scenes 1 \"Intro\" 2 \"Drop\"", "lanes",
            "  1 kick drum C1 Nano \"kick\" gain 0 pan 0",
            "  2 hat drum F#1 Nano \"hat\" gain 0 pan 0",
            "  3 marimba melodic C3 Nano \"marimba\" gain 0 pan 0",
            "scene 1 A", " kick |x--- x--- x--- x---|", "scene 1 B", " hat |x-x- ---- ---- ----|",
            "scene 2 A", " marimba: 5:E3"
        ].join("\n").replace(/ +/g, " "))
        const parsed = PulseGridText.parseText(text)
        expect(parsed.errors).toEqual([])
        expect(parsed.ops.slice(0, 10)).toEqual([
            {op: "setSetting", key: "name", value: "Night drive"},
            {op: "setSetting", key: "length", value: 16}, {op: "setSetting", key: "swing", value: 54},
            {op: "setSetting", key: "groove", value: 20}, {op: "setSetting", key: "probability", value: 100},
            {op: "setSetting", key: "humanize", value: 0}, {op: "setSetting", key: "accentAmount", value: 50},
            {op: "setSetting", key: "root", value: 0}, {op: "setSetting", key: "scale", value: 0},
            {op: "setPlaying", scene: 1, variation: "A"}
        ])
        expect(parsed.ops.slice(-3)).toEqual([
            {op: "setPatternText", lane: "kick", scene: 1, variation: "A", text: "kick |x--- x--- x--- x---|"},
            {op: "setPatternText", lane: "hat", scene: 1, variation: "B", text: "hat |x-x- ---- ---- ----|"},
            {op: "setPatternText", lane: "marimba", scene: 2, variation: "A", text: "marimba: 5:E3"}
        ])
        expect(PulseGridText.parseText(`${text}\nstrange thing`).errors).toEqual(["line 15: unknown line strange thing"])
    })

    it("reads a part of the text: some settings, scenes with any spacing, one block", () => {
        expect(PulseGridText.parseText("swing 54.5  groove 20\nscenes 1 \"Intro\" 2 \"The Drop\"\nscene 2 B\n  kick |x---|")).toEqual({
            ops: [
                {op: "setSetting", key: "swing", value: 54.5}, {op: "setSetting", key: "groove", value: 20},
                {op: "nameScene", scene: 1, name: "Intro"}, {op: "nameScene", scene: 2, name: "The Drop"},
                {op: "setPatternText", lane: "kick", scene: 2, variation: "B", text: "kick |x---|"}
            ], errors: []
        })
        const bad = PulseGridText.parseText("swing 54 tempo 120\nlength 16.5")
        expect(bad.ops).toEqual([])
        expect(bad.errors).toHaveLength(2)
    })

    it("writes the lane line as the spec shows it, and a name of digits in quotes", () => {
        const lane: PulseGridLaneDoc = {
            ...makeLane(2, "hat", "drum", 60), probability: 80, armed: true, effects: ["Delay", "Reverb"],
            sound: {instrument: "Nano", label: "CH 808", sample: {uuid: "u", name: "TR-808 Closed Hi-Hat"}},
            mix: {gain: -3, pan: 20, mute: true, solo: false}
        }
        expect(PulseGridText.formatLane(lane))
            .toBe("2 hat  drum  C3  Nano \"CH 808\" \"TR-808 Closed Hi-Hat\"  gain -3  pan 20  mute  chance 80  armed  fx Delay, Reverb")
        expect(PulseGridText.formatLane({...lane, sound: null, effects: [], armed: false, probability: 100}))
            .toBe("2 hat  drum  C3  none  gain -3  pan 20  mute")
        const line = PulseGridText.formatLine({name: "1", kind: "melodic", pitch: 60}, {length: 0, notes: [note(1, 60)]}, 16)
        expect(line).toBe("\"1\": 1:C3")
        expect(PulseGridText.parseLine(line, {pitch: 60, effectiveLength: 16}).name).toBe("1")
    })
})
