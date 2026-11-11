import {int, Optional} from "@opendaw/lib-std"
import {MidiKeys} from "@opendaw/lib-dsp"
import {PulseGridBeat, PulseGridKit, PulseGridKits, PulseGridSample} from "./PulseGridKits"
import {PulseGridScales} from "./PulseGridScales"
import {
    PulseGridDoc, PulseGridLaneDoc, PulseGridNote, PulseGridNoteKey, PulseGridOp, PulseGridPatternDoc, PulseGridVariation
} from "./PulseGridTypes"

// What the screen can do, each as the ops it sends. The screen has no other way to change a PulseGrid: every
// handler calls one of these and hands the result to PulseGridOps, so whatever a person can do on the screen
// an agent can do with the same ops (SPEC.md, section 6). A lane is always given by its id.
//
// PulseGridView is the other half: what the screen reads from the document, so no component works out for
// itself which pattern plays or how long it is.

type Ops = Array<PulseGridOp>

const Variations: ReadonlyArray<PulseGridVariation> = ["A", "B", "C", "D"]
const NewLaneHues: ReadonlyArray<int> = [181, 300, 36, 60, 77, 150, 210, 265, 330, 15]
const MachinePrefix = /^(TR-\d+|909|LinnDrum|Linn 9000|DMX|DrumTraks|Drumulator|DDD-1|R-8|RX5|SDSV)\s+/

export type PulseGridStep = {velocity: int, chance: int, accent: boolean, notes: int}

// One row of a piano roll: a pitch, its name as the DAW writes it ("C3"), whether it is the key's root and
// whether it belongs to the key and scale.
export type PulseGridRollRow = {pitch: int, name: string, root: boolean, inScale: boolean}

// The piano roll of a lane for the pattern that plays now (SPEC.md, section 8): the rows from the highest
// pitch down, and the notes inside the effective length.
export type PulseGridRoll = {length: int, own: boolean, rows: Array<PulseGridRollRow>, notes: Array<PulseGridNote>}

// How far a roll reaches around the lane pitch, and the room it leaves beyond its outermost notes, in semitones.
const RollReach = 12
const RollRoom = 4
const sameNote = (a: PulseGridNoteKey, b: PulseGridNoteKey): boolean => a.step === b.step && a.pitch === b.pitch

export namespace PulseGridView {
    // The variations the screen offers: A always, the one that plays, and every one of the playing scene that
    // holds anything.
    export const usedVariations = (doc: PulseGridDoc): Array<PulseGridVariation> => Variations.filter(variation =>
        variation === "A" || variation === doc.variation || doc.lanes.some(lane => lane.patterns.some(pattern =>
            pattern.scene === doc.scene && pattern.variation === variation)))

    export const freeVariation = (doc: PulseGridDoc): Optional<PulseGridVariation> => {
        const used = usedVariations(doc)
        return Variations.find(variation => !used.includes(variation))
    }

    const playing = (doc: PulseGridDoc, lane: PulseGridLaneDoc): Optional<PulseGridPatternDoc> =>
        lane.patterns.find(pattern => pattern.scene === doc.scene && pattern.variation === doc.variation)

    // The piano roll of a lane for the pattern that plays now. Rows: every pitch of the key and scale from an
    // octave under the lane pitch to an octave over it, reaching further where the pattern has notes (with
    // some room beyond the outermost ones). A note outside the scale gets a row of its own (`inScale` false),
    // so no note is ever hidden. Notes beyond the effective length are left out, as everywhere.
    export const roll = (doc: PulseGridDoc, lane: PulseGridLaneDoc): PulseGridRoll => {
        const pattern = playing(doc, lane)
        const own = pattern !== undefined && pattern.length !== 0
        const length = own ? pattern.length : doc.settings.length
        const notes = (pattern?.notes ?? []).filter(note => note.step <= length)
        const {root, scale} = doc.settings
        const low = Math.min(lane.pitch - RollReach, ...notes.map(note => note.pitch - RollRoom))
        const high = Math.max(lane.pitch + RollReach, ...notes.map(note => note.pitch + RollRoom))
        const pitches = new Set<int>([...PulseGridScales.pitches(root, scale, low, high), ...notes.map(note => note.pitch)])
        const rows = [...pitches].sort((a, b) => b - a).map(pitch => ({
            pitch, name: MidiKeys.toFullString(pitch),
            root: (((pitch - root) % 12) + 12) % 12 === 0,
            inScale: PulseGridScales.has(root, scale, pitch)
        }))
        return {length, own, rows, notes}
    }

    // The pitches a lane sounds at a song position in pulses: the notes of the pattern that plays whose step has
    // begun and whose length has not run out. A drum lane sounds its lane pitch. It is what the keyboard lights
    // up; swing, chance and humanize are not in it.
    export const sounding = (doc: PulseGridDoc, lane: PulseGridLaneDoc, position: number): Array<int> => {
        const {length, notes} = roll(doc, lane)
        const at = (((position / 240) % length) + length) % length
        return [...new Set(notes.filter(note => at >= note.step - 1 && at < note.step - 1 + note.length / 4)
            .map(note => lane.kind === "drum" ? lane.pitch : note.pitch))]
    }

    // Where picked notes land when they move by `steps` and by `degrees` (rows of the roll: steps of the key and
    // scale, up is positive). The move is shortened until every picked note stays inside the pattern's steps
    // and inside 0..127, so a drag stops at the edge and never loses a note. `keys` are in the order of `picked`.
    export const moved = (doc: PulseGridDoc, lane: PulseGridLaneDoc, picked: ReadonlyArray<PulseGridNoteKey>,
                          steps: int, degrees: int): {steps: int, degrees: int, keys: Array<PulseGridNoteKey>} => {
        if (picked.length === 0) {return {steps: 0, degrees: 0, keys: []}}
        const {length} = roll(doc, lane)
        const {root, scale} = doc.settings
        const first = Math.min(...picked.map(key => key.step)), last = Math.max(...picked.map(key => key.step))
        const by = Math.max(1 - first, Math.min(length - last, steps))
        const shifted = (rows: int) => picked.map(key => PulseGridScales.shift(root, scale, key.pitch, rows))
        let rows = degrees
        while (rows !== 0 && shifted(rows).some(pitch => pitch === undefined)) {rows -= Math.sign(rows)}
        const pitches = shifted(rows)
        return {steps: by, degrees: rows, keys: picked.map((key, index) => ({step: key.step + by, pitch: pitches[index] as int}))}
    }

    // The pattern of a lane that plays now: its effective length and, per step (index 0 is step 1), what is
    // on it. Several notes on a step show the loudest; `notes` says how many.
    export const steps = (doc: PulseGridDoc, lane: PulseGridLaneDoc): {length: int, own: boolean, steps: Array<Optional<PulseGridStep>>} => {
        const pattern = playing(doc, lane)
        const own = pattern !== undefined && pattern.length !== 0
        const length = own ? pattern.length : doc.settings.length
        const steps: Array<Optional<PulseGridStep>> = new Array(length).fill(undefined)
        for (const note of pattern?.notes ?? []) {
            if (note.step > length) {continue}
            const step = steps[note.step - 1]
            steps[note.step - 1] = step === undefined
                ? {velocity: note.velocity, chance: note.chance, accent: note.accent, notes: 1}
                : {
                    velocity: Math.max(step.velocity, note.velocity), chance: Math.max(step.chance, note.chance),
                    accent: step.accent || note.accent, notes: step.notes + 1
                }
        }
        return {length, own, steps}
    }

    // The step a lane plays at a song position in pulses (PPQN 960, a step is a 16th), counted from 0.
    export const playingStep = (position: number, length: int): int => {
        const step = Math.floor(position / 240) % length
        return step < 0 ? step + length : step
    }
}

export namespace PulseGridActions {
    const setting = (key: "length" | "swing" | "groove" | "probability" | "humanize") =>
        (value: number): Ops => [{op: "setSetting", key, value}]

    export const rename = (name: string): Ops => [{op: "setSetting", key: "name", value: name}]
    export const setLength = setting("length")
    export const setSwing = setting("swing")
    export const setGroove = setting("groove")
    export const setProbability = setting("probability")
    export const setHumanize = setting("humanize")

    export const pickScene = (scene: int): Ops => [{op: "setPlaying", scene}]
    export const pickVariation = (variation: PulseGridVariation): Ops => [{op: "setPlaying", variation}]
    // Copies what plays into the first empty variation of the scene and plays that. Nothing when all four are used.
    export const newVariation = (doc: PulseGridDoc): Ops => {
        const variation = PulseGridView.freeVariation(doc)
        return variation === undefined ? [] : [
            {op: "copyVariation", from: {variation: doc.variation}, to: {variation}},
            {op: "setPlaying", variation}
        ]
    }

    export const setStep = (lane: string, step: int, on: boolean): Ops => [{op: "setStep", lane, step, on}]
    export const setStepValues = (lane: string, step: int,
                                  values: Partial<Pick<PulseGridNote, "velocity" | "chance" | "accent">>): Ops =>
        [{op: "setStep", lane, step, ...values}]

    export const setMute = (lane: string, mute: boolean): Ops => [{op: "setLaneMix", lane, mute}]
    export const setSolo = (lane: string, solo: boolean): Ops => [{op: "setLaneMix", lane, solo}]
    export const renameLane = (lane: string, name: string): Ops => [{op: "setLane", lane, name}]
    export const moveLane = (lane: string, to: int): Ops => [{op: "moveLane", lane, to}]
    export const removeLane = (lane: string): Ops => [{op: "removeLane", lane}]
    export const clearLane = (lane: string): Ops => [{op: "clear", lane}]
    export const shiftLane = (lane: string, steps: int): Ops => [{op: "rotate", lane, steps}]
    export const setLaneSound = (lane: string, sample: PulseGridSample): Ops =>
        [{op: "setLaneSound", lane, sound: PulseGridKits.sound(sample)}]

    // A new drum lane under the last drum lane, named after the sample without its machine ("TR-808 Cowbell"
    // is "Cowbell"), with a number when that name is taken.
    export const addDrumLane = (doc: PulseGridDoc, sample: PulseGridSample): Ops => {
        const base = sample.name.replace(MachinePrefix, "").trim() || sample.name
        const taken = (name: string) => doc.lanes.some(lane => lane.name.toLowerCase() === name.toLowerCase())
        let name = base
        for (let count = 2; taken(name); count++) {name = `${base} ${count}`}
        const drums = doc.lanes.filter(lane => lane.kind === "drum")
        const at = drums.length === 0 ? 1 : drums[drums.length - 1].index + 1
        return [{
            op: "addLane", name, kind: "drum", sound: PulseGridKits.sound(sample),
            hue: NewLaneHues[drums.length % NewLaneHues.length], at
        }]
    }

    // Melody (SPEC.md, section 8)
    export const setKey = (root: int): Ops => [{op: "setSetting", key: "root", value: root}]
    export const setScale = (scale: int): Ops => [{op: "setSetting", key: "scale", value: scale}]
    // where a new note of the lane lands when a step of its closed row is pressed
    export const setLanePitch = (lane: string, pitch: int): Ops => [{op: "setLane", lane, pitch}]
    export const paintNote = (lane: string, step: int, pitch: int,
                              values: Partial<Pick<PulseGridNote, "length" | "velocity">> = {}): Ops =>
        [{op: "setNote", lane, note: {step, pitch, ...values}}]
    export const resizeNote = (lane: string, step: int, pitch: int, length: int): Ops =>
        [{op: "setNote", lane, note: {step, pitch, length}}]
    export const eraseNote = (lane: string, step: int, pitch: int): Ops => [{op: "removeNote", lane, step, pitch}]
    export const removeNotes = (lane: string, picked: ReadonlyArray<PulseGridNoteKey>): Ops =>
        picked.map(({step, pitch}) => ({op: "removeNote", lane, step, pitch}))
    // Moves the picked notes of the pattern that plays (PulseGridView.moved says where to), or copies them
    // with `copy`, and gives the whole pattern as one op. A note that lands on one that stays replaces it.
    // `doc` is the document as it was when the drag began: every call of a drag says the whole move from
    // there, so the drag sends it again whenever the pointer reaches another step or row, also back at the start.
    export const moveNotes = (doc: PulseGridDoc, laneId: string, picked: ReadonlyArray<PulseGridNoteKey>,
                              steps: int, degrees: int, copy: boolean = false): Ops => {
        const lane = doc.lanes.find(lane => lane.id === laneId)
        if (lane === undefined || picked.length === 0) {return []}
        const {notes} = PulseGridView.roll(doc, lane)
        const {keys} = PulseGridView.moved(doc, lane, picked, steps, degrees)
        const landed = new Map<string, PulseGridNote>()
        picked.forEach((key, index) => {
            const note = notes.find(note => sameNote(note, key))
            if (note !== undefined) {landed.set(`${keys[index].step}:${keys[index].pitch}`, {...note, ...keys[index]})}
        })
        const staying = notes.filter(note => !landed.has(`${note.step}:${note.pitch}`)
            && (copy || !picked.some(key => sameNote(note, key))))
        return [{op: "setPattern", lane: laneId, notes: [...staying, ...landed.values()]}]
    }
    export const transposeLane = (lane: string, semitones: int): Ops => [{op: "transpose", lane, semitones}]
    export const laneToScale = (lane: string): Ops => [{op: "toScale", lane}]

    export const loadKit = (doc: PulseGridDoc, kit: PulseGridKit): Ops => PulseGridKits.kitOps(doc, kit)
    export const loadBeat = (doc: PulseGridDoc, beat: PulseGridBeat): Ops => PulseGridKits.beatOps(doc, beat)
}
