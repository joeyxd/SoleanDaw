import {BoxEditing} from "@opendaw/lib-box"
import {int} from "@opendaw/lib-std"
import {InstrumentCompositeBox} from "@opendaw/studio-boxes"
import {PulseGridDevice, PulseGridLane} from "./PulseGridDevice"
import {PulseGridFactory} from "./PulseGridFactory"
import {PulseGridDocs} from "./PulseGridDocs"
import {PulseGridMoves} from "./PulseGridMoves"
import {PulseGridNotes} from "./PulseGridNotes"
import {PulseGridScales} from "./PulseGridScales"
import {PulseGridText} from "./PulseGridText"
import {
    PulseGridDoc, PulseGridError, PulseGridLaneRef, PulseGridNote, PulseGridNoteInput, PulseGridOp, PulseGridOpName,
    PulseGridOpResult, PulseGridSlot
} from "./PulseGridTypes"

type Writes = Array<() => void>
type Answer = (doc: PulseGridDoc) => Array<string>

const fail = (message: string): never => {throw new PulseGridError(message)}
const number = (name: string, value: unknown, min: number, max: number, integer = false): number => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max ||
        (integer && !Number.isInteger(value))) {
        fail(`${name} ${String(value)} is not allowed: expected ${integer ? "an integer " : "a number "}${min}..${max}`)
    }
    return value as number
}
const integer = (name: string, value: unknown, min = -2147483648, max = 2147483647): int =>
    number(name, value, min, max, true)
const string = (name: string, value: unknown): string => {
    if (typeof value !== "string") {fail(`${name} ${String(value)} is not allowed: expected a string`)}
    return value as string
}
const boolean = (name: string, value: unknown): boolean => {
    if (typeof value !== "boolean") {fail(`${name} ${String(value)} is not allowed: expected true or false`)}
    return value as boolean
}
const array = <T>(name: string, value: ReadonlyArray<T>): ReadonlyArray<T> => {
    if (!Array.isArray(value)) {fail(`${name} ${String(value)} is not allowed: expected an array`)}
    return value
}
const laneOf = (device: PulseGridDevice, ref: PulseGridLaneRef): PulseGridLane => {
    if (typeof ref !== "string" && typeof ref !== "number") {
        fail(`lane ${String(ref)} is not allowed: expected a position, name or id`)
    }
    return PulseGridDevice.lane(device, ref)
}
const noteInput = (input: PulseGridNoteInput): PulseGridNoteInput => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        fail(`note ${String(input)} is not allowed: expected an object with a step and optional note values`)
    }
    return input
}
const slotOf = (device: PulseGridDevice, slot: PulseGridSlot): int => {
    if (slot === null || typeof slot !== "object" || Array.isArray(slot)) {
        fail(`slot ${String(slot)} is not allowed: expected an object with scene and variation`)
    }
    const current = PulseGridNotes.slotOf(device.head.scene.getValue() * 4 + device.head.variation.getValue())
    return PulseGridNotes.slot(slot.scene === undefined ? current.scene : slot.scene,
        slot.variation === undefined ? current.variation : slot.variation)
}
const patternOf = (device: PulseGridDevice, lane: PulseGridLane, slot: int) => {
    const pattern = lane.device.patterns.getField(slot)
    const ownLength = pattern.length.getValue()
    return {pattern, ownLength, length: ownLength || device.head.length.getValue(),
        notes: PulseGridNotes.decode(pattern.notes.getValue())}
}
const stagePattern = (writes: Writes, lane: PulseGridLane, slot: int, length: int,
                      notes: ReadonlyArray<PulseGridNote>): void => {
    const bytes = PulseGridNotes.encode(notes)
    const pattern = lane.device.patterns.getField(slot)
    writes.push(() => {
        pattern.length.setValue(length)
        pattern.notes.setValue(bytes)
    })
}
const patternAnswer = (device: PulseGridDevice, lanes: ReadonlyArray<PulseGridLane>, slot: int,
                       omitEmpty = false): Answer => doc => {
    const {scene, variation} = PulseGridNotes.slotOf(slot)
    const prefix = scene === doc.scene && variation === doc.variation ? "" : `scene ${scene} ${variation} `
    return device.lanes.flatMap((lane, index) => {
        if (!lanes.includes(lane)) {return []}
        const laneDoc = doc.lanes[index]
        const pattern = laneDoc.patterns.find(p => p.scene === scene && p.variation === variation)
        if (omitEmpty && pattern === undefined) {return []}
        const length = pattern?.length ?? 0
        const notes = (pattern?.notes ?? []).filter(note => note.step <= (length || doc.settings.length))
        return [prefix + PulseGridText.formatLine(laneDoc, {length, notes}, doc.settings.length)]
    })
}
const laneAnswer = (device: PulseGridDevice, lane: PulseGridLane): Answer =>
    doc => [PulseGridText.formatLane(doc.lanes[device.lanes.indexOf(lane)])]

// Only copy note modifiers; op metadata must never become note data.
const modifiers = (input: Partial<PulseGridNote>): Partial<PulseGridNote> => {
    const result: Partial<PulseGridNote> = {}
    for (const key of ["velocity", "length", "chance", "accent", "offset", "repeats"] as const) {
        if (input[key] !== undefined) {Object.assign(result, {[key]: input[key]})}
    }
    return result
}
const makeNote = (lane: PulseGridLane, input: PulseGridNoteInput, length: int,
                  previous?: PulseGridNote): PulseGridNote => {
    noteInput(input)
    integer("step", input.step, 1, length)
    if (input.pitch !== undefined) {integer("pitch", input.pitch, 0, 127)}
    const pitch = lane.device.kind.getValue() === 0 ? lane.device.pitch.getValue()
        : input.pitch === undefined ? lane.device.pitch.getValue() : input.pitch
    const note = {...PulseGridNote.Defaults, ...previous, ...modifiers(input), step: input.step, pitch}
    PulseGridNotes.encode([note])
    return note
}
const replacement = (lane: PulseGridLane, inputs: ReadonlyArray<PulseGridNoteInput>, length: int): Array<PulseGridNote> => {
    const result: Array<PulseGridNote> = []
    for (const input of array("notes", inputs)) {
        const note = makeNote(lane, input, length)
        const index = result.findIndex(n => n.step === note.step &&
            (lane.device.kind.getValue() === 0 || n.pitch === note.pitch))
        if (index < 0) {result.push(note)}
        else if (lane.device.kind.getValue() === 0) {result[index] = note}
        else {fail(`note ${note.step}:${note.pitch} repeats; allowed one note per step and pitch`)}
    }
    return result
}

const prepare = (device: PulseGridDevice, op: PulseGridOp, writes: Writes): Answer => {
    const {head} = device
    if (op === null || typeof op !== "object") {fail(`op ${String(op)} is not allowed: expected an object`)}
    switch (op.op) {
        case "setSetting": {
            const {key, value} = op
            if (key === "name") {
                const name = string(key, value)
                writes.push(() => head.label.setValue(name))
            } else if (key === "scale") {
                const scale = typeof value === "number" || typeof value === "string" ? PulseGridScales.find(value) : undefined
                if (scale === undefined) {
                    fail(`scale ${String(value)} is not allowed: expected ${PulseGridScales.All.map(scale => scale.id).join(", ")}`)
                }
                const checked = scale!.index
                writes.push(() => head.scale.setValue(checked))
            } else if (key === "length" || key === "root") {
                const named = key === "root" && typeof value === "string"
                    ? Array.from({length: 12}, (_, root) => PulseGridScales.keyName(root)).indexOf(value.toUpperCase())
                    : value
                if (key === "root" && typeof value === "string" && named === -1) {
                    fail(`root ${value} is not allowed: expected 0..11 or C, C#, D, D#, E, F, F#, G, G#, A, A#, B`)
                }
                const checked = integer(key, named, key === "length" ? 1 : 0, key === "length" ? 64 : 11)
                writes.push(() => head[key].setValue(checked))
            } else if (key === "swing" || key === "groove" || key === "probability" || key === "humanize" ||
                key === "accentAmount") {
                const checked = key === "swing" ? number(key, value, 50, 75) : number(key, value, 0, 100) / 100
                writes.push(() => head[key].setValue(checked))
            } else {
                fail(`setting ${String(key)} is not allowed: expected name, length, swing, groove, probability, ` +
                    "humanize, accentAmount, root or scale")
            }
            return doc => [PulseGridText.formatSettings(doc)]
        }
        case "setPlaying": {
            const slot = slotOf(device, op)
            writes.push(() => {
                head.scene.setValue(Math.floor(slot / 4))
                head.variation.setValue(slot % 4)
            })
            return doc => [PulseGridText.formatPlaying(doc)]
        }
        case "nameScene": {
            PulseGridNotes.slot(op.scene, "A")
            const name = string("name", op.name)
            const scene = head.scenes.getField(op.scene - 1)
            writes.push(() => {
                scene.label.setValue(name)
                scene.used.setValue(true)
            })
            return doc => [PulseGridText.formatScenes(doc)]
        }
        case "setLane": {
            const lane = laneOf(device, op.lane)
            const box = lane.device
            if (op.name !== undefined) {
                const name = string("name", op.name)
                writes.push(() => box.label.setValue(name))
            }
            if (op.kind !== undefined) {
                if (op.kind !== "drum" && op.kind !== "melodic") {
                    fail(`kind ${op.kind} is not allowed: expected drum or melodic`)
                }
                const kind = op.kind === "drum" ? 0 : 1
                writes.push(() => box.kind.setValue(kind))
            }
            for (const key of ["pitch", "probability", "humanize", "group", "hue"] as const) {
                if (op[key] === undefined) {continue}
                const value = key === "probability" || key === "humanize" ? number(key, op[key], 0, 100) / 100
                    : key === "pitch" ? integer(key, op[key], 0, 127)
                    : key === "hue" ? integer(key, op[key], 0, 359) : integer(key, op[key])
                writes.push(() => box[key].setValue(value))
            }
            for (const key of ["accent", "armed", "enabled"] as const) {
                if (op[key] === undefined) {continue}
                const value = boolean(key, op[key])
                writes.push(() => box[key].setValue(value))
            }
            return laneAnswer(device, lane)
        }
        case "setLaneMix": {
            const lane = laneOf(device, op.lane)
            for (const key of ["gain", "pan"] as const) {
                if (op[key] === undefined) {continue}
                const value = key === "pan" ? number(key, op[key], -100, 100) / 100
                    : number(key, op[key], -72, 0)
                writes.push(() => lane.cell[key].setValue(value))
            }
            for (const key of ["mute", "solo"] as const) {
                if (op[key] === undefined) {continue}
                const value = boolean(key, op[key])
                writes.push(() => lane.cell[key].setValue(value))
            }
            return laneAnswer(device, lane)
        }
        case "setStep":
        case "setNote":
        case "removeNote":
        case "setPattern":
        case "setPatternText":
        case "setPatternLength": {
            const lane = laneOf(device, op.lane)
            const slot = slotOf(device, op)
            const stored = patternOf(device, lane, slot)
            let ownLength = stored.ownLength
            let length = stored.length
            let notes = stored.notes
            if (op.op === "setPatternLength") {
                ownLength = integer("length", op.length, 0, 64)
            } else if (op.op === "setPattern" || op.op === "setPatternText") {
                let inputs: ReadonlyArray<PulseGridNoteInput>
                if (op.op === "setPatternText") {
                    const parsed = PulseGridText.parseLine(string("text", op.text),
                        {pitch: lane.device.pitch.getValue(), effectiveLength: length})
                    ownLength = parsed.ownLength ?? ownLength
                    inputs = parsed.notes
                } else {
                    if (op.length !== undefined) {ownLength = integer("length", op.length, 0, 64)}
                    inputs = op.notes
                }
                length = ownLength || head.length.getValue()
                notes = [...replacement(lane, inputs, length), ...notes.filter(n => n.step > length)]
            } else if (op.op === "removeNote") {
                integer("step", op.step, 1, length)
                if (op.pitch !== undefined) {integer("pitch", op.pitch, 0, 127)}
                notes = notes.filter(n => n.step !== op.step || (op.pitch !== undefined && n.pitch !== op.pitch))
            } else if (op.op === "setNote") {
                noteInput(op.note)
                const pitch = lane.device.kind.getValue() === 0 ? lane.device.pitch.getValue()
                    : op.note.pitch === undefined ? lane.device.pitch.getValue() : op.note.pitch
                const existing = notes.find(n => n.step === op.note.step &&
                    (lane.device.kind.getValue() === 0 || n.pitch === pitch))
                const note = makeNote(lane, op.note, length, existing)
                notes = [...notes.filter(n => n.step !== note.step ||
                    (lane.device.kind.getValue() !== 0 && n.pitch !== note.pitch)), note]
            } else {
                if (op.on !== undefined) {boolean("on", op.on)}
                if ("pitch" in op) {fail("pitch is not allowed on setStep: use setNote to place a pitch")}
                const existing = notes.filter(n => n.step === op.step)
                const changed = existing.length === 0 || lane.device.kind.getValue() === 0
                    ? [makeNote(lane, op, length, existing[0])]
                    : existing.map(n => makeNote(lane, {...op, pitch: n.pitch}, length, n))
                notes = [...notes.filter(n => n.step !== op.step), ...(op.on === false ? [] : changed)]
            }
            stagePattern(writes, lane, slot, ownLength, notes)
            return patternAnswer(device, [lane], slot)
        }
        case "clear":
        case "rotate":
        case "double":
        case "halve":
        case "euclid": {
            const slot = slotOf(device, op)
            // euclid replaces a whole rhythm, so it always names its lane.
            const lanes = op.lane === undefined && op.op !== "euclid" ? device.lanes
                : [laneOf(device, op.lane as PulseGridLaneRef)]
            if (op.op === "rotate") {integer("steps", op.steps)}
            for (const lane of lanes) {
                const stored = patternOf(device, lane, slot)
                let {ownLength, length, notes} = stored
                const active = notes.filter(n => n.step <= length)
                if (op.op === "clear") {
                    ownLength = 0
                    notes = []
                } else if (op.op === "rotate") {
                    notes = [...PulseGridMoves.rotate(active, op.steps, length), ...notes.filter(n => n.step > length)]
                } else if (op.op === "double") {
                    const doubled = PulseGridMoves.double(active, length)
                    ownLength = length * 2
                    notes = [...doubled, ...notes.filter(n => n.step > ownLength)]
                } else if (op.op === "halve") {
                    // The helper checks the move; its discarded half stays stored under the length rule.
                    PulseGridMoves.halve(active, length)
                    ownLength = Math.floor(length / 2)
                } else {
                    const steps = op.steps === undefined ? length : integer("steps", op.steps, 1, 64)
                    const rotate = op.rotate === undefined ? 0 : integer("rotate", op.rotate)
                    const velocity = op.velocity === undefined ? 100 : integer("velocity", op.velocity, 1, 127)
                    const rhythm = PulseGridMoves.euclid(op.hits, steps, rotate, velocity, lane.device.pitch.getValue())
                    if (steps !== length) {ownLength = steps}
                    notes = [...rhythm, ...notes.filter(n => n.step > steps)]
                }
                stagePattern(writes, lane, slot, ownLength, notes)
            }
            return patternAnswer(device, lanes, slot, op.lane === undefined)
        }
        case "transpose":
        case "toScale": {
            const slot = slotOf(device, op)
            const lanes = op.lane === undefined ? device.lanes.filter(lane => lane.device.kind.getValue() === 1)
                : [laneOf(device, op.lane)]
            let by = 0
            let unit: "semitones" | "degrees" = "semitones"
            if (op.op === "transpose") {
                if ((op.semitones === undefined) === (op.degrees === undefined)) {
                    fail(`transpose semitones ${String(op.semitones)} degrees ${String(op.degrees)} is not allowed: ` +
                        "expected exactly one of semitones or degrees, a nonzero integer")
                }
                unit = op.semitones === undefined ? "degrees" : "semitones"
                by = integer(unit, op[unit])
                if (by === 0) {fail(`${unit} ${by} is not allowed: expected a nonzero integer`)}
            }
            for (const lane of lanes) {
                if (lane.device.kind.getValue() === 0) {
                    fail(`${op.op} lane ${String(op.lane)} is not allowed: expected a melodic lane; ` +
                        "a drum lane's pitch is its tuning (setLane)")
                }
                const {ownLength, length, notes} = patternOf(device, lane, slot)
                const active = notes.filter(note => note.step <= length)
                const root = head.root.getValue(), scale = head.scale.getValue()
                const moved = op.op === "transpose" ? PulseGridMoves.transpose(active, by, unit, root, scale)
                    : PulseGridMoves.toScale(active, root, scale)
                stagePattern(writes, lane, slot, ownLength, [...moved, ...notes.filter(note => note.step > length)])
            }
            return patternAnswer(device, lanes, slot, op.lane === undefined)
        }
        case "copyVariation": {
            const from = slotOf(device, op.from)
            const to = slotOf(device, op.to)
            const lanes = op.lanes === undefined ? device.lanes : array("lanes", op.lanes).map(ref => laneOf(device, ref))
            for (const lane of device.lanes.filter(lane => lanes.includes(lane))) {
                const {ownLength, notes} = patternOf(device, lane, from)
                stagePattern(writes, lane, to, ownLength, notes)
            }
            return patternAnswer(device, lanes, to)
        }
        case "addLane":
        case "removeLane":
        case "moveLane":
        case "setLaneSound": {
            let lane: PulseGridLane
            if (op.op === "addLane") {
                writes.push(() => {lane = PulseGridFactory.addLane(device, op, op.at)})
            } else {
                lane = laneOf(device, op.lane)
                if (op.op === "removeLane") {
                    writes.push(() => PulseGridFactory.removeLane(device, lane))
                    return () => []
                }
                if (op.op === "moveLane") {
                    writes.push(() => PulseGridFactory.moveLane(device, lane, op.to))
                } else {writes.push(() => PulseGridFactory.setLaneSound(device, lane, op.sound))}
            }
            return doc => [PulseGridText.formatLane(doc.lanes[
                PulseGridDevice.find(device.composite).unwrap().lanes.findIndex(other => other.device === lane.device)])]
        }
        default: {
            // Proven exhaustive for typed callers; an agent's raw JSON can still get here.
            const exhaustive: never = op
            return fail(`op ${String((exhaustive as {op?: unknown}).op)} is not known`)
        }
    }
}

export namespace PulseGridOps {
    export const apply = (composite: InstrumentCompositeBox, ops: ReadonlyArray<PulseGridOp>): Array<PulseGridOpResult> => {
        const found = PulseGridDevice.find(composite)
        if (found.isEmpty()) {throw new PulseGridError("Composite is not a PulseGrid; expected a PulseGrid lane device")}
        let device = found.unwrap()
        const results: Array<PulseGridOpResult> = []
        for (const op of ops) {
            try {
                const writes: Writes = []
                const answer = prepare(device, op, writes)
                writes.forEach(write => write())
                if (op.op === "addLane" || op.op === "removeLane" || op.op === "moveLane" || op.op === "setLaneSound") {
                    device = PulseGridDevice.find(composite).unwrap()
                }
                results.push({ok: true, op: op.op, lines: answer(PulseGridDocs.read(device))})
            } catch (error) {
                if (!(error instanceof PulseGridError)) {throw error}
                results.push({ok: false, op: (op as PulseGridOp | null)?.op as PulseGridOpName, error: error.message})
                break
            }
        }
        return results
    }

    export const run = (editing: BoxEditing, composite: InstrumentCompositeBox,
                        ops: ReadonlyArray<PulseGridOp>): Array<PulseGridOpResult> =>
        editing.modify(() => apply(composite, ops)).unwrap()
}
