import {int, Optional} from "@opendaw/lib-std"
import {PulseGridBeat, PulseGridKit, PulseGridKits, PulseGridSample} from "./PulseGridKits"
import {PulseGridDoc, PulseGridLaneDoc, PulseGridNote, PulseGridOp, PulseGridVariation} from "./PulseGridTypes"

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

export namespace PulseGridView {
    // The variations of the playing scene that hold anything, plus the one that plays.
    export const usedVariations = (doc: PulseGridDoc): Array<PulseGridVariation> => Variations.filter(variation =>
        variation === doc.variation || doc.lanes.some(lane => lane.patterns.some(pattern =>
            pattern.scene === doc.scene && pattern.variation === variation)))

    export const freeVariation = (doc: PulseGridDoc): Optional<PulseGridVariation> => {
        const used = usedVariations(doc)
        return Variations.find(variation => !used.includes(variation))
    }

    // The pattern of a lane that plays now: its effective length and, per step (index 0 is step 1), what is
    // on it. Several notes on a step show the loudest; `notes` says how many.
    export const steps = (doc: PulseGridDoc, lane: PulseGridLaneDoc): {length: int, own: boolean, steps: Array<Optional<PulseGridStep>>} => {
        const pattern = lane.patterns.find(pattern => pattern.scene === doc.scene && pattern.variation === doc.variation)
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

    export const loadKit = (doc: PulseGridDoc, kit: PulseGridKit): Ops => PulseGridKits.kitOps(doc, kit)
    export const loadBeat = (doc: PulseGridDoc, beat: PulseGridBeat): Ops => PulseGridKits.beatOps(doc, beat)
}
