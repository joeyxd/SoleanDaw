import {BooleanField, Box, BoxEditing, Int32Field, IndexedBox} from "@opendaw/lib-box"
import {int} from "@opendaw/lib-std"
import {InstrumentCompositeBox} from "@opendaw/studio-boxes"
import {DeviceBoxUtils} from "../DeviceBox"
import {PulseGridDevice, PulseGridLane} from "./PulseGridDevice"
import {PulseGridFactory} from "./PulseGridFactory"
import {PulseGridDocs} from "./PulseGridDocs"
import {PulseGridMoves} from "./PulseGridMoves"
import {PulseGridNotes} from "./PulseGridNotes"
import {PulseGridScales} from "./PulseGridScales"
import {PulseGridSongRegions} from "./PulseGridSong"
import {PulseGridText} from "./PulseGridText"
import {
    PulseGridDoc, PulseGridError, PulseGridLaneRef, PulseGridNote, PulseGridNoteInput, PulseGridOp, PulseGridOpName,
    PulseGridOpResult, PulseGridOpsEnv, PulseGridSlot, PulseGridSong, PulseGridSongEntry, PulseGridSongEntryInput, PulseGridVariation
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

const laneSounds = (device: PulseGridDevice, lane: PulseGridLane): Answer =>
    doc => PulseGridText.formatSounds(doc.lanes[device.lanes.indexOf(lane)])
// Effect `position` (1..n) of the lane's chain.
const effectOf = (lane: PulseGridLane, position: unknown): Box => {
    const effects = PulseGridDocs.effectBoxes(lane)
    if (effects.length === 0) {fail(`lane "${lane.device.label.getValue()}" has no effects`)}
    return effects[integer("effect", position, 1, effects.length) - 1]
}

// What a scene holds, read before anything moves: the four patterns of every lane, its name and its flag.
type SceneData = {
    label: string, used: boolean, patterns: ReadonlyArray<ReadonlyArray<{length: int, notes: Int8Array}>>
}
const emptyScene = (device: PulseGridDevice): SceneData => ({
    label: "", used: false,
    patterns: device.lanes.map(() => Array.from({length: 4}, () => ({length: 0, notes: new Int8Array(0)})))
})
const sceneData = (device: PulseGridDevice, scene: int): SceneData => ({
    label: device.head.scenes.getField(scene - 1).label.getValue(),
    used: device.head.scenes.getField(scene - 1).used.getValue(),
    patterns: device.lanes.map(lane => Array.from({length: 4}, (_, variation) => {
        const pattern = lane.device.patterns.getField((scene - 1) * 4 + variation)
        return {length: pattern.length.getValue(), notes: pattern.notes.getValue().slice()}
    }))
})
const sceneHolds = (data: SceneData, variation: int): boolean => data.patterns.some(lane =>
    lane[variation].length !== 0 || PulseGridNotes.decode(lane[variation].notes).length > 0)
const writePatterns = (device: PulseGridDevice, scene: int, data: SceneData): void => {
    device.lanes.forEach((lane, index) => data.patterns[index].forEach((stored, variation) => {
        const pattern = lane.device.patterns.getField((scene - 1) * 4 + variation)
        pattern.length.setValue(stored.length)
        pattern.notes.setValue(stored.notes.slice())
    }))
}
const sceneAnswer: Answer = doc => [PulseGridText.formatScenes(doc), PulseGridText.formatPlaying(doc),
    ...(doc.song.entries.length > 0 ? [PulseGridText.formatSong(doc)] : [])].filter(line => line !== "")

// Scenes 1..count change places: `map` says where each one goes (undefined: it is removed, and what it held is
// emptied or overwritten). The playing number follows its scene. The song's scene notes follow too.
const stageRearrange = (device: PulseGridDevice, writes: Writes, count: int,
                        map: (scene: int) => int | undefined): void => {
    const {head} = device
    const scenes = Array.from({length: count}, (_, index) => index + 1)
    const stored = scenes.map(scene => sceneData(device, scene))
    for (const target of scenes) {
        const source = scenes.find(scene => map(scene) === target)
        if (source === target) {continue}
        const data = source === undefined ? emptyScene(device) : stored[source - 1]
        writes.push(() => {
            writePatterns(device, target, data)
            head.scenes.getField(target - 1).label.setValue(data.label)
            head.scenes.getField(target - 1).used.setValue(data.used)
        })
    }
    const playing = head.scene.getValue() + 1
    const variation = head.variation.getValue()
    let nextScene = map(playing)
    let nextVariation = variation
    if (nextScene === undefined) {
        // The scene that takes the number plays, the last one when the last was removed; with A when the
        // variation that played holds nothing there.
        nextScene = playing < count ? playing : count - 1
        const taker = scenes.find(scene => map(scene) === nextScene)!
        if (!sceneHolds(stored[taker - 1], variation)) {nextVariation = 0}
    }
    const scene = nextScene
    writes.push(() => {
        if (scene !== playing) {head.scene.setValue(scene - 1)}
        if (nextVariation !== variation) {head.variation.setValue(nextVariation)}
        PulseGridSongRegions.renumber(device, map)
    })
}

// One entry of a song as an op gives it, checked and with its defaults: variation A and one cycle.
const songEntry = (input: PulseGridSongEntryInput, count: int): PulseGridSongEntry => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        fail(`entry ${String(input)} is not allowed: expected {scene, variation?, cycles?} or {rest: true, cycles?}`)
    }
    const raw = input as Record<string, unknown>
    const cycles = raw.cycles === undefined ? 1 : raw.cycles
    if (typeof cycles !== "number" || !Number.isFinite(cycles) || cycles <= 0 || cycles > PulseGridSong.MaxCycles) {
        fail(`cycles ${String(cycles)} is not allowed: expected a number above 0 up to ${PulseGridSong.MaxCycles}`)
    }
    if (raw.rest !== undefined) {
        if (raw.rest !== true || raw.scene !== undefined || raw.variation !== undefined) {
            fail(`rest ${String(raw.rest)} is not allowed: expected {rest: true, cycles?} with no scene or variation`)
        }
        return {rest: true, cycles: cycles as number}
    }
    const scene = integer("scene", raw.scene, 1, count)
    const variation = raw.variation === undefined ? "A" : raw.variation
    if (variation !== "A" && variation !== "B" && variation !== "C" && variation !== "D") {
        fail(`variation ${String(variation)} is not allowed: expected A, B, C or D`)
    }
    return {scene, variation: variation as PulseGridVariation, cycles: cycles as number}
}
// A region's position and length are 32 bit pulses.
const checkEnd = (end: number): void => {
    if (end > 2147483647) {
        fail(`a song that ends at pulse ${end} is not allowed: expected at most 2147483647; use fewer cycles or a lower from`)
    }
}
const checkUnit = (device: PulseGridDevice): void => {
    if (!PulseGridSongRegions.hasUnit(device)) {
        fail("the song is not allowed here: the PulseGrid is not on an audio unit, so there is no track for its regions")
    }
}

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

const prepare = (device: PulseGridDevice, op: PulseGridOp, writes: Writes, env: PulseGridOpsEnv): Answer => {
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
            let slot = slotOf(device, op)
            // A scene with no variation named: the variation that plays is kept only where it holds something.
            if (op.scene !== undefined && op.variation === undefined &&
                !device.lanes.some(lane => PulseGridDocs.holds(lane, slot))) {
                slot -= slot % 4
            }
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
                PulseGridSongRegions.relabel(device, op.scene)
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
        case "newScene": {
            const count = PulseGridDocs.sceneCount(device)
            if (count >= 16) {fail(`newScene with ${count} scenes is not allowed: expected at most 16 scenes`)}
            const name = op.name === undefined ? undefined : string("name", op.name)
            const copy = op.copyOf === undefined ? undefined : sceneData(device, integer("copyOf", op.copyOf, 1, count))
            writes.push(() => {
                const scene = head.scenes.getField(count)
                scene.used.setValue(true)
                if (name !== undefined) {scene.label.setValue(name)}
                if (copy !== undefined) {writePatterns(device, count + 1, copy)}
            })
            return sceneAnswer
        }
        case "removeScene": {
            const count = PulseGridDocs.sceneCount(device)
            const scene = integer("scene", op.scene, 1, count)
            if (count === 1) {fail(`removeScene ${scene} is not allowed: the only scene cannot be removed`)}
            stageRearrange(device, writes, count, other => other === scene ? undefined : other > scene ? other - 1 : other)
            return sceneAnswer
        }
        case "moveScene": {
            const count = PulseGridDocs.sceneCount(device)
            const scene = integer("scene", op.scene, 1, count)
            const to = integer("to", op.to, 1, count)
            stageRearrange(device, writes, count, other => other === scene ? to
                : scene < to ? (other > scene && other <= to ? other - 1 : other)
                    : (other >= to && other < scene ? other + 1 : other))
            return sceneAnswer
        }
        case "setSong": {
            const count = PulseGridDocs.sceneCount(device)
            if (op.on === undefined && op.entries === undefined) {
                fail("setSong with neither on nor entries is not allowed: expected at least one of them")
            }
            const on = op.on === undefined ? undefined : boolean("on", op.on)
            const from = op.from === undefined ? 1 : number("from", op.from, 1, 8947849)
            let entries: Array<PulseGridSongEntry> | undefined
            if (op.entries !== undefined) {
                const inputs = array("entries", op.entries)
                if (inputs.length > PulseGridSong.MaxEntries) {
                    fail(`entries ${inputs.length} is not allowed: expected 0 to ${PulseGridSong.MaxEntries} entries`)
                }
                entries = inputs.map((input, index) => {
                    try {return songEntry(input, count)} catch (error) {
                        if (error instanceof PulseGridError) {throw new PulseGridError(`entry ${index + 1}: ${error.message}`)}
                        throw error
                    }
                })
                checkUnit(device)
                checkEnd(PulseGridSongRegions.endOf(device, entries, from))
            }
            const switchTo = on ?? (entries !== undefined && entries.length > 0 ? true : undefined)
            writes.push(() => {
                if (entries !== undefined) {PulseGridSongRegions.write(device, entries, from)}
                if (switchTo !== undefined) {head.song.setValue(switchTo)}
            })
            return doc => [PulseGridText.formatSong(doc)]
        }
        case "addToSong": {
            const entry = songEntry({scene: op.scene, variation: op.variation, cycles: op.cycles}, PulseGridDocs.sceneCount(device))
            if ("rest" in entry) {return fail("addToSong is not allowed to add a rest: expected a scene")}
            checkUnit(device)
            checkEnd(PulseGridSongRegions.end(device) + PulseGridSongRegions.duration(device, entry.cycles))
            writes.push(() => PulseGridSongRegions.append(device, entry))
            return doc => [PulseGridText.formatSong(doc)]
        }
        case "setParam": {
            const lane = laneOf(device, op.lane)
            const owner = op.effect === undefined ? undefined : effectOf(lane, op.effect)
            const box = owner ?? lane.instrument.unwrapOrUndefined()
            const name = string("param", op.param)
            if (box === undefined) {fail(`lane "${lane.device.label.getValue()}" has no instrument; add one with setLaneSound`)}
            const fields = PulseGridDocs.paramFields(box!)
            const squash = (text: string): string => text.toLowerCase().replace(/[-_ ]/g, "")
            const field = fields.find(f => f.fieldName === name) ?? fields.find(f => squash(f.fieldName) === squash(name))
            if (field === undefined) {
                fail(`No such parameter "${name}" on ${box!.name.replace(/(?:DeviceBox|Box)$/, "")}; allowed parameters: ${
                    fields.map(f => f.fieldName).join(", ")}`)
            }
            const target = field!
            if (target instanceof BooleanField) {
                const value = boolean("value", op.value)
                writes.push(() => target.setValue(value))
            } else {
                const {min = -Infinity, max = Infinity} = PulseGridDocs.rangeOf(target)
                const value = op.value
                const kind = target instanceof Int32Field ? "an integer" : "a number"
                if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max ||
                    (target instanceof Int32Field && !Number.isInteger(value))) {
                    fail(`${target.fieldName} ${String(value)} is not allowed: expected ${kind}${
                        min === -Infinity && max === Infinity ? "" : ` ${min}..${max}`}${target.unit}`)
                }
                writes.push(() => target.setValue(value as number))
            }
            return laneSounds(device, lane)
        }
        case "addEffect": {
            const lane = laneOf(device, op.lane)
            const maker = env.effects
            if (maker === undefined) {fail("addEffect is not available: the host passed no effect maker")}
            const name = string("effect", op.effect)
            if (!maker!.names.includes(name)) {
                fail(`effect ${name} is not allowed: expected one of ${maker!.names.join(", ")}`)
            }
            const count = PulseGridDocs.effectBoxes(lane).length
            const at = op.at === undefined ? count + 1 : integer("at", op.at, 1, count + 1)
            writes.push(() => maker!.create(name, lane.cell.audioEffects, at - 1))
            return laneSounds(device, lane)
        }
        case "removeEffect": {
            const lane = laneOf(device, op.lane)
            const box = effectOf(lane, op.effect)
            // The same as Devices.deleteEffectDevices (DeviceAdapter.ts): close the gap, then delete the box.
            writes.push(() => {
                PulseGridDocs.effectBoxes(lane).filter(other => other !== box)
                    .forEach((other, index) => DeviceBoxUtils.lookupIndexField(other).setValue(index))
                box.delete()
            })
            return laneSounds(device, lane)
        }
        case "setEffect": {
            const lane = laneOf(device, op.lane)
            const box = effectOf(lane, op.effect)
            if (op.enabled === undefined && op.to === undefined) {
                fail("setEffect needs enabled or to: expected at least one of them")
            }
            if (op.enabled !== undefined) {
                const enabled = boolean("enabled", op.enabled)
                writes.push(() => DeviceBoxUtils.lookupEnabledField(box).setValue(enabled))
            }
            if (op.to !== undefined) {
                const to = integer("to", op.to, 1, PulseGridDocs.effectBoxes(lane).length)
                writes.push(() => {
                    const from = PulseGridDocs.effectBoxes(lane).indexOf(box)
                    if (from !== to - 1) {IndexedBox.moveIndices(lane.cell.audioEffects, [from], to > from + 1 ? to : to - 1)}
                })
            }
            return laneSounds(device, lane)
        }
        default: {
            // Proven exhaustive for typed callers; an agent's raw JSON can still get here.
            const exhaustive: never = op
            return fail(`op ${String((exhaustive as {op?: unknown}).op)} is not known`)
        }
    }
}

export namespace PulseGridOps {
    export const apply = (composite: InstrumentCompositeBox, ops: ReadonlyArray<PulseGridOp>,
                          env: PulseGridOpsEnv = {}): Array<PulseGridOpResult> => {
        const found = PulseGridDevice.find(composite)
        if (found.isEmpty()) {throw new PulseGridError("Composite is not a PulseGrid; expected a PulseGrid lane device")}
        let device = found.unwrap()
        const results: Array<PulseGridOpResult> = []
        for (const op of ops) {
            try {
                const writes: Writes = []
                const answer = prepare(device, op, writes, env)
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
