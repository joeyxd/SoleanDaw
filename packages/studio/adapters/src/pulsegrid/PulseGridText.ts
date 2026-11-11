import {int} from "@opendaw/lib-std"
import {MidiKeys} from "@opendaw/lib-dsp"
import {PulseGridScales} from "./PulseGridScales"
import {
    PulseGridDoc, PulseGridError, PulseGridLaneDoc, PulseGridNote, PulseGridOp, PulseGridVariation
} from "./PulseGridTypes"

export type PulseGridLineLane = {name: string, kind: "drum" | "melodic", pitch: int}
export type PulseGridLinePattern = {length: int, notes: ReadonlyArray<PulseGridNote>}
export type PulseGridLine = {name: string | null, ownLength: int | null, notes: Array<PulseGridNote>}

const error = (message: string): never => {throw new PulseGridError(message)}
const defaults = PulseGridNote.Defaults
const nameChars = /^[A-Za-z0-9 _.#+-]+$/

const quoted = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`

// A lane name is written bare when nothing in it can be taken for grammar; digits alone would read as a step.
const quoteName = (name: string): string =>
    nameChars.test(name) && !name.startsWith(" ") && !name.endsWith(" ") && !/^\d+$/.test(name) ? name : quoted(name)

const readName = (source: string): {name: string, rest: string} => {
    if (source.startsWith("\"")) {
        let result = ""
        for (let i = 1; i < source.length; i++) {
            const char = source[i]
            if (char === "\\") {
                const next = source[++i]
                if (next !== "\\" && next !== "\"") error(`invalid name escape in ${source}; allowed escapes are \\\" and \\\\`)
                result += next
            } else if (char === "\"") {
                return {name: result, rest: source.slice(i + 1)}
            } else result += char
        }
        error(`unterminated quoted name ${source}; expected a closing quote`)
    }
    const end = source.search(/[/:\s]/)
    return {name: end < 0 ? source : source.slice(0, end), rest: end < 0 ? "" : source.slice(end)}
}

const parseInteger = (text: string, label: string, min: number, max: number, pattern: RegExp = /^-?\d+$/): int => {
    if (!pattern.test(text)) error(`${label} ${text} is not allowed; expected ${min}..${max}`)
    const value = Number(text)
    if (value < min || value > max) error(`${label} ${text} is not allowed; expected ${min}..${max}`)
    return value
}

const noteSort = (notes: ReadonlyArray<PulseGridNote>): Array<PulseGridNote> =>
    [...notes].sort((a, b) => a.step - b.step || a.pitch - b.pitch)

const addMods = (note: PulseGridNote, mods: string, allowPitch: boolean): PulseGridNote => {
    let result = {...note}
    for (let i = 0; i < mods.length;) {
        const mod = mods[i++]
        if (mod === "!") result.accent = true
        else if (mod === "v" || mod === "%" || mod === "l" || mod === "o" || mod === "r" || (mod === "p" && allowPitch)) {
            const start = i
            while (i < mods.length && !/[v%lor!p]/.test(mods[i])) i++
            const value = mods.slice(start, i)
            if (!value) error(`empty ${mod} detail in ${mods}; expected a value`)
            if (mod === "v") result.velocity = parseInteger(value, "velocity", 1, 127)
            else if (mod === "%") result.chance = parseInteger(value, "chance", 0, 100)
            else if (mod === "l") result.length = parseInteger(value, "length", 1, 255)
            else if (mod === "o") result.offset = parseInteger(value, "offset", -99, 99)
            else if (mod === "r") result.repeats = parseInteger(value, "repeats", 0, 8)
            else result.pitch = PulseGridText.parsePitch(value)
        } else error(`unknown mod ${mod} in ${mods}; allowed v, %, l, o, r, !${allowPitch ? ", p" : ""}`)
    }
    return result
}

const detailsFor = (note: PulseGridNote, cell: string, includePitch: boolean): string => {
    let details = ""
    if (cell === "x" || cell === "X") {
        if (note.velocity !== 100) details += `v${note.velocity}`
    } else if (/^[1-9]$/.test(cell)) {
        if (note.velocity !== Number(cell) * 14) details += `v${note.velocity}`
    } else if (note.velocity !== defaults.velocity) details += `v${note.velocity}`
    if (note.chance !== defaults.chance) details += `%${note.chance}`
    if (note.length !== defaults.length) details += `l${note.length}`
    if (note.offset !== defaults.offset) details += `o${note.offset}`
    if (note.repeats !== defaults.repeats) details += `r${note.repeats}`
    if (note.accent && cell !== "X") details += "!"
    if (includePitch && note.pitch !== -1) details += `p${PulseGridText.pitchName(note.pitch)}`
    return details
}

const formatDetails = (notes: ReadonlyArray<PulseGridNote>, cells: ReadonlyArray<string>, pitchDetails: boolean): string => {
    const result: Array<string> = []
    for (const note of noteSort(notes)) {
        const mods = detailsFor(note, cells[note.step - 1] ?? "", pitchDetails)
        if (mods) result.push(`${note.step}:${mods}`)
    }
    return result.join(" ")
}

export namespace PulseGridText {
    export const pitchName = (pitch: int): string => MidiKeys.toFullString(pitch)

    export const parsePitch = (text: string): int => {
        const value = text.trim()
        if (/^\d+$/.test(value)) return parseInteger(value, "pitch", 0, 127)
        const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(value)
        if (!match) return error(`pitch ${text} is not allowed; expected MIDI 0..127 or a note name such as C3 or Bb2`)
        const names: Record<string, number> = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11}
        const pc = names[match[1].toUpperCase()] + (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0)
        const octave = Number(match[3])
        const pitch = (octave + 2) * 12 + pc
        if (pitch < 0 || pitch > 127) return error(`pitch ${text} is not allowed; expected MIDI 0..127`)
        return pitch
    }

    export const formatLine = (lane: PulseGridLineLane, pattern: PulseGridLinePattern, headLength: int): string => {
        const length = pattern.length === 0 ? headLength : pattern.length
        const prefix = `${quoteName(lane.name)}${pattern.length === 0 ? "" : `/${pattern.length}`}`
        const byStep = new Map<number, Array<PulseGridNote>>()
        pattern.notes.forEach(note => byStep.set(note.step, [...(byStep.get(note.step) ?? []), note]))
        const gridForm = lane.kind === "drum" && [...byStep.values()].every(stepNotes => stepNotes.length <= 1)
        if (!gridForm) {
            const list = noteSort(pattern.notes).map(note => {
                const mods = detailsFor(note, "", false)
                return `${note.step}:${pitchName(note.pitch)}${mods}`
            }).join(" ")
            return `${prefix}:${list ? ` ${list}` : ""}`
        }
        const cells = Array.from({length}, (_, i) => {
            const note = byStep.get(i + 1)?.[0]
            if (!note) return "-"
            if (note.velocity === 100) return note.accent ? "X" : "x"
            if (!note.accent && note.velocity % 14 === 0 && note.velocity >= 14 && note.velocity <= 126) return String(note.velocity / 14)
            return "x"
        })
        let grid = "|"
        cells.forEach((cell, i) => {
            grid += cell
            if ((i + 1) % 16 === 0) grid += "|"
            else if ((i + 1) % 4 === 0 && i + 1 < cells.length) grid += " "
        })
        if (!grid.endsWith("|")) grid += "|"
        const detail = formatDetails(pattern.notes, cells, false)
        return `${prefix} ${grid}${detail ? ` ${detail}` : ""}`
    }

    export const parseLine = (text: string, context: {pitch: int, effectiveLength: int}): PulseGridLine => {
        const source = text.trim()
        let name: string | null = null
        let rest = source
        if (source.startsWith("\"")) {
            const parsed = readName(source)
            name = parsed.name
            rest = parsed.rest
        } else if (!source.startsWith("|") && !source.startsWith(":") && !/^\d+:/.test(source)) {
            const gridAt = source.indexOf("|")
            const colonAt = source.indexOf(":")
            if (gridAt >= 0 && (colonAt < 0 || gridAt < colonAt)) {
                const head = source.slice(0, gridAt).trimEnd()
                const length = /\/(\d+)$/.exec(head)
                name = length ? head.slice(0, length.index) : head
                rest = `${length ? length[0] : ""}${source.slice(gridAt)}`
            } else if (colonAt >= 0) {
                const head = source.slice(0, colonAt).trimEnd()
                const length = /\/(\d+)$/.exec(head)
                name = length ? head.slice(0, length.index) : head
                rest = `${length ? length[0] : ""}${source.slice(colonAt)}`
            } else error(`line ${text} is not allowed; expected a name and grid or list`)
        }
        let ownLength: int | null = null
        rest = rest.trimStart()
        if (rest.startsWith("/")) {
            const lengthMatch = /^\/(\d+)/.exec(rest)
            if (!lengthMatch) return error(`length ${rest} is not allowed; expected /1..64`)
            ownLength = parseInteger(lengthMatch[1], "length", 1, 64)
            rest = rest.slice(lengthMatch[0].length).trimStart()
        }
        const effectiveLength = ownLength ?? context.effectiveLength
        if (rest.startsWith("|")) {
            const cells: Array<string> = []
            let cursor = 1
            while (cursor < rest.length && cells.length < effectiveLength) {
                const char = rest[cursor++]
                if (char === " " || char === "|") continue
                cells.push(char)
            }
            if (cells.length !== effectiveLength) error(`grid has ${cells.length} cells; expected ${effectiveLength}`)
            let notes: Array<PulseGridNote> = []
            cells.forEach((cell, i) => {
                if (cell === "-") return
                if (cell !== "x" && cell !== "X" && !/^[1-9]$/.test(cell)) error(`cell ${cell} at step ${i + 1} is not allowed; expected -, x, X, or 1..9`)
                const velocity = cell === "x" || cell === "X" ? 100 : Number(cell) * 14
                notes.push({step: i + 1, pitch: context.pitch, ...defaults, velocity, accent: cell === "X"})
            })
            if (rest[cursor] === "|") cursor++
            if (rest[cursor] && rest[cursor] !== " " && rest[cursor] !== "\t") {
                let extra = 0
                while (cursor < rest.length && rest[cursor] !== " " && rest[cursor] !== "\t" && rest[cursor] !== "|") {
                    extra++
                    cursor++
                }
                error(`grid has at least ${effectiveLength + extra} cells; expected ${effectiveLength}`)
            }
            const afterGrid = rest.slice(cursor).trim()
            const detailTokens = afterGrid ? afterGrid.split(/\s+/) : []
            for (const token of detailTokens) {
                const match = /^(\d+):(.+)$/.exec(token)
                if (!match) return error(`detail ${token} is not allowed; expected <step>:<mods>`)
                const step = parseInteger(match[1], "step", 1, effectiveLength)
                const index = notes.findIndex(note => note.step === step)
                if (index < 0) return error(`detail for step ${step} has no note; details require a note at that step`)
                notes[index] = addMods(notes[index], match[2], true)
            }
            return {name, ownLength, notes: noteSort(notes)}
        }
        if (!rest.startsWith(":")) {
            // In unnamed list form the first token is the first note.
            if (name !== null) error(`line ${text} is not allowed; expected a grid or colon list`)
        } else rest = rest.slice(1).trimStart()
        const tokens = rest ? rest.split(/\s+/) : []
        const notes: Array<PulseGridNote> = []
        const seen = new Set<string>()
        for (const token of tokens) {
            const match = /^(\d+):([A-Ga-g][#b]?-?\d+|\d+)(.*)$/.exec(token)
            if (!match) return error(`note ${token} is not allowed; expected <step>:<pitch><mods>`)
            const step = parseInteger(match[1], "step", 1, effectiveLength)
            const pitch = parsePitch(match[2])
            const key = `${step}:${pitch}`
            if (seen.has(key)) error(`note ${token} repeats step ${step} and pitch ${pitch}; each pair may appear once`)
            seen.add(key)
            notes.push(addMods({step, pitch, ...defaults}, match[3], false))
        }
        return {name, ownLength, notes: noteSort(notes)}
    }

    export const formatSettings = (doc: PulseGridDoc): string => {
        const s = doc.settings
        const root = MidiKeys.Names.English[s.root]
        return `length ${s.length}  swing ${s.swing}  groove ${s.groove}  probability ${s.probability}  humanize ${s.humanize}  accent ${s.accentAmount}  key ${root}  scale ${PulseGridScales.byIndex(s.scale).id}`
    }

    export const formatPlaying = (doc: PulseGridDoc): string => `playing scene ${doc.scene} ${doc.variation}`

    export const formatScenes = (doc: PulseGridDoc): string =>
        doc.scenes.length === 0 ? "" : `scenes ${doc.scenes.map(scene => `${scene.scene} ${quoted(scene.name)}`).join("  ")}`

    export const formatLane = (lane: PulseGridLaneDoc): string => {
        const sound = lane.sound
        const sample = sound?.sample && sound.sample.name !== sound.label ? ` ${quoted(sound.sample.name)}` : ""
        const pieces = [`${lane.index} ${quoteName(lane.name)}`, lane.kind, pitchName(lane.pitch),
            sound ? `${sound.instrument} ${quoted(sound.label)}${sample}` : "none",
            `gain ${lane.mix.gain}`, `pan ${lane.mix.pan}`]
        if (lane.mix.mute) pieces.push("mute")
        if (lane.mix.solo) pieces.push("solo")
        if (lane.probability !== 100) pieces.push(`chance ${lane.probability}`)
        if (lane.humanize !== 0) pieces.push(`humanize ${lane.humanize}`)
        if (!lane.accent) pieces.push("no-accent")
        if (lane.armed) pieces.push("armed")
        if (!lane.enabled) pieces.push("off")
        if (lane.effects.length) pieces.push(`fx ${lane.effects.join(", ")}`)
        return pieces.join("  ")
    }

    export const toText = (doc: PulseGridDoc): string => {
        const lines = [`PulseGrid ${quoted(doc.name)}`, formatSettings(doc), formatPlaying(doc)]
        const scenes = formatScenes(doc)
        if (scenes) lines.push(scenes)
        lines.push("lanes", ...doc.lanes.map(lane => `  ${formatLane(lane)}`))
        const slotKeys = new Set<string>([`${doc.scene}:${doc.variation}`])
        doc.lanes.forEach(lane => lane.patterns.forEach(pattern => slotKeys.add(`${pattern.scene}:${pattern.variation}`)))
        const slots = [...slotKeys].map(key => {
            const [scene, variation] = key.split(":")
            return {scene: Number(scene), variation: variation as PulseGridVariation}
        }).sort((a, b) => a.scene - b.scene || a.variation.localeCompare(b.variation))
        const playingIndex = slots.findIndex(slot => slot.scene === doc.scene && slot.variation === doc.variation)
        if (playingIndex > 0) slots.unshift(...slots.splice(playingIndex, 1))
        for (const slot of slots) {
            lines.push(`scene ${slot.scene} ${slot.variation}`)
            for (const lane of doc.lanes) {
                const pattern = lane.patterns.find(item => item.scene === slot.scene && item.variation === slot.variation)
                if (pattern && (pattern.notes.length > 0 || pattern.length !== 0)) {
                    lines.push(`  ${formatLine(lane, {length: pattern.length, notes: pattern.notes}, doc.settings.length)}`)
                }
            }
        }
        return lines.join("\n")
    }

    export const parseText = (text: string): {ops: Array<PulseGridOp>, errors: Array<string>} => {
        const ops: Array<PulseGridOp> = []
        const errors: Array<string> = []
        let inLanes = false
        let slot: {scene: int, variation: PulseGridVariation} | null = null
        const lines = text.split(/\r?\n/)
        lines.forEach((raw, index) => {
            const lineNumber = index + 1
            const line = raw.trim()
            if (!line) return
            const report = (message: string) => errors.push(`line ${lineNumber}: ${message}`)
            try {
                if (line === "lanes") {inLanes = true; slot = null; return}
                const sceneHeader = /^scene\s+(\d+)\s+([A-D])$/.exec(line)
                if (sceneHeader) {
                    slot = {scene: parseInteger(sceneHeader[1], "scene", 1, 16), variation: sceneHeader[2] as PulseGridVariation}
                    inLanes = false
                    return
                }
                if (inLanes) return
                if (line.startsWith("PulseGrid ")) {
                    const value = line.slice(10).trim()
                    const parsed = value.startsWith("\"") ? readName(value) : {name: value, rest: ""}
                    if (parsed.rest) error(`name line ${line} has extra text; expected PulseGrid <name>`)
                    ops.push({op: "setSetting", key: "name", value: parsed.name})
                    return
                }
                // Any of the eight settings, in any order: an agent may send only "swing 58".
                const expected = ["length", "swing", "groove", "probability", "humanize", "accent", "key", "scale"]
                const words = line.split(/\s+/)
                if (expected.includes(words[0])) {
                    if (words.length % 2 !== 0) error(`settings line ${line} is not allowed; expected pairs of a setting and its value`)
                    const found: Array<PulseGridOp> = []
                    for (let at = 0; at < words.length; at += 2) {
                        const key = words[at], value = words[at + 1]
                        if (!expected.includes(key)) error(`setting ${key} is not allowed; expected ${expected.join(", ")}`)
                        const setting = key === "accent" ? "accentAmount" : key === "key" ? "root" : key
                        const ranges: Record<string, [number, number]> = {
                            length: [1, 64], swing: [50, 75], groove: [0, 100], probability: [0, 100],
                            humanize: [0, 100], accent: [0, 100]
                        }
                        const parsed = key === "key"
                            ? (() => {
                                if (!/^[A-G](?:#)?$/.test(value)) error(`key ${value} is not allowed; expected C, C#, D, D#, E, F, F#, G, G#, A, A#, or B`)
                                return PulseGridText.parsePitch(`${value}0`) % 12
                            })()
                            : key === "scale"
                                ? (() => {
                                    const scale = PulseGridScales.find(value)
                                    if (scale === undefined) {return error(`scale ${value} is not allowed; expected ${PulseGridScales.All.map(scale => scale.id).join(", ")}`)}
                                    return scale.index
                                })()
                            : key === "length"
                                ? parseInteger(value, key, ...ranges[key])
                                : parseInteger(value, key, ...ranges[key], /^\d+(\.\d+)?$/) // amounts may carry decimals
                        found.push({op: "setSetting", key: setting as keyof PulseGridDoc["settings"], value: parsed})
                    }
                    ops.push(...found)
                    return
                }
                const playing = /^playing scene (\d+) ([A-D])$/.exec(line)
                if (playing) {
                    ops.push({op: "setPlaying", scene: parseInteger(playing[1], "scene", 1, 16), variation: playing[2] as PulseGridVariation})
                    return
                }
                if (line.startsWith("scenes ")) {
                    // <scene> "<name>" pairs with any spacing; a bare name runs to the next double space.
                    const found: Array<PulseGridOp> = []
                    let rest = line.slice(7).trim()
                    while (rest) {
                        const match = /^(\d+)\s+/.exec(rest)
                        if (!match) error(`scenes entry ${rest} is not allowed; expected <scene> "<name>"`)
                        const after = rest.slice(match![0].length)
                        const bareEnd = after.search(/\s{2,}/)
                        const sceneName = after.startsWith("\"") ? readName(after)
                            : {name: bareEnd < 0 ? after : after.slice(0, bareEnd), rest: bareEnd < 0 ? "" : after.slice(bareEnd)}
                        found.push({op: "nameScene", scene: parseInteger(match![1], "scene", 1, 16), name: sceneName.name})
                        rest = sceneName.rest.trim()
                    }
                    if (found.length === 0) error(`scenes line ${line} is not allowed; expected <scene> "<name>"`)
                    ops.push(...found)
                    return
                }
                if (slot) {
                    const patternText = raw.trim()
                    if (!patternText.includes("|") && !patternText.includes(":")) error(`unknown line ${line}`)
                    const patternName = patternText.startsWith("\"")
                        ? readName(patternText).name
                        : patternText.startsWith("|") || patternText.startsWith(":") || /^\d+:/.test(patternText)
                            ? ""
                            : patternText.slice(0, Math.min(...[patternText.indexOf("/"), patternText.indexOf(":"), patternText.indexOf("|")].filter(i => i >= 0))).trim()
                    const op: PulseGridOp = {op: "setPatternText", lane: patternName, scene: slot.scene, variation: slot.variation, text: patternText}
                    ops.push(op)
                    return
                }
                error(`unknown line ${line}`)
            } catch (cause) {
                report(cause instanceof Error ? cause.message : String(cause))
            }
        })
        return {ops, errors}
    }
}
