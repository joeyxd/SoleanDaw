import {int} from "@opendaw/lib-std"

// The contract of the PulseGrid model: the document an agent or the screen reads, and the operations both write
// with. Rules and the text form are in ./SPEC.md. Everything here is plain JSON, so it travels as is.
//
// Counting: everything in these types counts from 1 (steps, scenes, lanes), as the screen does. Amounts are
// percents 0..100. Only the stored bytes count from 0, and PulseGridNotes is the single place that converts.

export type PulseGridVariation = "A" | "B" | "C" | "D"

// Thrown for input that is not allowed (a step out of range, a line that does not parse). Its message is what the
// person or the agent reads: it says what was given and what is allowed. PulseGridOps turns it into a failed
// result; any other error is a bug and travels on.
export class PulseGridError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "PulseGridError"
    }
}

export type PulseGridNote = {
    step: int // 1..64
    pitch: int // MIDI 0..127; a drum lane plays its lane pitch whatever is stored here
    velocity: int // 1..127
    length: int // quarter steps 1..255, 4 is one step
    chance: int // percent 0..100
    accent: boolean
    offset: int // 1/100 of a step, -99..99
    repeats: int // 0..8, 0 and 1 play once
}

export namespace PulseGridNote {
    export const Defaults = {velocity: 100, length: 4, chance: 100, accent: false, offset: 0, repeats: 0} as const
    export const MaxPerPattern = 128
    export const MaxSteps = 64
}

// A note as an op gives it: step and pitch say which note, the rest is optional.
export type PulseGridNoteInput = Pick<PulseGridNote, "step"> & Partial<Omit<PulseGridNote, "step">>

export type PulseGridPatternDoc = {
    scene: int // 1..16
    variation: PulseGridVariation
    length: int // own length 1..64, or 0: follows the head
    notes: ReadonlyArray<PulseGridNote> // sorted by step, then pitch
}

export type PulseGridSound = {
    instrument: string // the instrument's box name without "DeviceBox": "Nano", "Tubular", "Playfield", ...
    label: string
    sample?: {uuid: string, name: string} // when the instrument plays one audio file
}

export type PulseGridLaneDoc = {
    index: int // position, 1 is the top lane
    id: string // uuid of the lane device
    name: string
    kind: "drum" | "melodic"
    group: int // 0 drums, 1 melody
    hue: int
    pitch: int
    probability: number // percent
    humanize: number // percent
    accent: boolean
    armed: boolean
    enabled: boolean
    seed: int
    sound: PulseGridSound | null // null: the cell has no instrument
    effects: ReadonlyArray<string> // audio effects of the cell, in order, box names without "DeviceBox"
    mix: {gain: number, pan: number, mute: boolean, solo: boolean} // gain in dB, pan -100 (left) to 100 (right)
    patterns: ReadonlyArray<PulseGridPatternDoc> // only slots that hold notes or an own length, by scene then variation
}

export type PulseGridSettings = {
    length: int // 1..64 steps
    swing: number // 50..75
    groove: number // percent
    probability: number // percent
    humanize: number // percent
    accentAmount: number // percent
    root: int // 0..11, 0 is C
    scale: int
}

export type PulseGridDoc = {
    version: 1
    id: string // uuid of the head
    name: string
    settings: PulseGridSettings
    scene: int // the scene that plays, 1..16
    variation: PulseGridVariation // the variation that plays
    scenes: ReadonlyArray<{scene: int, name: string, used: boolean}> // only named or used scenes
    lanes: ReadonlyArray<PulseGridLaneDoc>
}

// A lane by position (1 is the top lane), by name (case does not matter; must be the only lane of that name)
// or by id.
export type PulseGridLaneRef = int | string

// Which pattern an op means. Whatever is left out is what plays now.
export type PulseGridSlot = {scene?: int, variation?: PulseGridVariation}

// A sound as an op gives it, complete enough to build the instrument with nothing to fetch. Names from a
// catalogue ("TR-808/Bass Drum", "Tubular Classics/Marimba") are turned into this by whoever holds the catalogue.
export type PulseGridSoundInput =
    // one audio file in a sampler; duration in seconds; label defaults to the sample's name
    | {instrument: "Nano", sample: {uuid: string, name: string, duration: number}, label?: string}
    // the FM synth; patch is the 155 bytes of one DX7 voice, left out for the init voice
    | {instrument: "Tubular", voice?: {name: string, patch: ReadonlyArray<int>}, label?: string}

export type PulseGridOp =
    // the head
    | {op: "setSetting", key: keyof PulseGridSettings | "name", value: number | string}
    | {op: "setPlaying", scene?: int, variation?: PulseGridVariation}
    | {op: "nameScene", scene: int, name: string}
    // a lane
    | {
    op: "setLane", lane: PulseGridLaneRef, name?: string, kind?: "drum" | "melodic", pitch?: int,
    probability?: number, humanize?: number, accent?: boolean, group?: int, hue?: int, armed?: boolean,
    enabled?: boolean
}
    | {op: "setLaneMix", lane: PulseGridLaneRef, gain?: number, pan?: number, mute?: boolean, solo?: boolean}
    // notes of one pattern
    | ({op: "setStep", lane: PulseGridLaneRef, step: int, on?: boolean} & Partial<Omit<PulseGridNote, "step" | "pitch">> & PulseGridSlot)
    | ({op: "setNote", lane: PulseGridLaneRef, note: PulseGridNoteInput} & PulseGridSlot)
    | ({op: "removeNote", lane: PulseGridLaneRef, step: int, pitch?: int} & PulseGridSlot)
    | ({op: "setPattern", lane: PulseGridLaneRef, notes: ReadonlyArray<PulseGridNoteInput>, length?: int} & PulseGridSlot)
    | ({op: "setPatternText", lane: PulseGridLaneRef, text: string} & PulseGridSlot)
    | ({op: "setPatternLength", lane: PulseGridLaneRef, length: int} & PulseGridSlot)
    // musical moves; without a lane they act on every lane
    | ({op: "clear", lane?: PulseGridLaneRef} & PulseGridSlot)
    | ({op: "rotate", lane?: PulseGridLaneRef, steps: int} & PulseGridSlot)
    | ({op: "double", lane?: PulseGridLaneRef} & PulseGridSlot)
    | ({op: "halve", lane?: PulseGridLaneRef} & PulseGridSlot)
    | ({op: "euclid", lane: PulseGridLaneRef, hits: int, steps?: int, rotate?: int, velocity?: int} & PulseGridSlot)
    | {
    op: "copyVariation", from: {scene?: int, variation: PulseGridVariation},
    to: {scene?: int, variation: PulseGridVariation}, lanes?: ReadonlyArray<PulseGridLaneRef>
}
    // the lanes themselves
    | {
    op: "addLane", name: string, kind: "drum" | "melodic", sound: PulseGridSoundInput, pitch?: int, group?: int,
    hue?: int, at?: int
}
    | {op: "removeLane", lane: PulseGridLaneRef}
    | {op: "moveLane", lane: PulseGridLaneRef, to: int}
    | {op: "setLaneSound", lane: PulseGridLaneRef, sound: PulseGridSoundInput}

export type PulseGridOpName = PulseGridOp["op"]

// What one op answers. `lines` are the new text lines of whatever it changed (SPEC.md, "What an op answers").
export type PulseGridOpResult =
    | {ok: true, op: PulseGridOpName, lines: ReadonlyArray<string>}
    | {ok: false, op: PulseGridOpName, error: string}
