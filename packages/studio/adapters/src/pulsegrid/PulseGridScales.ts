import {int, Optional} from "@opendaw/lib-std"
import {MidiKeys} from "@opendaw/lib-dsp"

// Key and scale of a PulseGrid (SPEC.md, section 8). The head stores `root` (0..11, 0 is C) and `scale`, an
// index into MidiKeys.StockScales. A person or an agent reads and writes a scale by its id ("natural-minor");
// the number is only what is stored. Key and scale never move a note by themselves: they decide which rows the
// piano roll shows and what `transpose` by degrees and `toScale` do.
export namespace PulseGridScales {
    export type Scale = {index: int, id: string, name: string}

    export const All: ReadonlyArray<Scale> = MidiKeys.StockScales.map((scale, index) =>
        ({index, id: scale.name.toLowerCase().replace(/\s+/g, "-"), name: scale.name}))

    // what people say for a scale that has a longer id
    const Aliases: Readonly<Record<string, string>> = {"minor": "natural-minor"}

    // Stored data never fails: an index out of range reads as the first scale.
    export const byIndex = (index: int): Scale => All[index] ?? All[0]

    // A scale by its stored number, its id, its name or an alias; case does not matter.
    export const find = (value: number | string): Optional<Scale> => {
        if (typeof value === "number") {return All[value]}
        const text = value.trim().toLowerCase().replace(/[\s_]+/g, "-")
        if (/^\d+$/.test(text)) {return All[Number(text)]}
        const id = Aliases[text] ?? text
        return All.find(scale => scale.id === id)
    }

    export const keyName = (root: int): string => MidiKeys.Names.English[((root % 12) + 12) % 12]

    // "C Natural Minor"
    export const label = (root: int, scale: int): string => `${keyName(root)} ${byIndex(scale).name}`

    export const has = (root: int, scale: int, pitch: int): boolean =>
        MidiKeys.StockScales[byIndex(scale).index].has((((pitch - root) % 12) + 12) % 12)

    // Every pitch of the scale from `low` to `high`, both included, lowest first, inside 0..127.
    export const pitches = (root: int, scale: int, low: int, high: int): Array<int> => {
        const result: Array<int> = []
        for (let pitch = Math.max(0, low); pitch <= Math.min(127, high); pitch++) {
            if (has(root, scale, pitch)) {result.push(pitch)}
        }
        return result
    }

    // The nearest pitch of the scale inside 0..127; when two are as near, the lower one.
    export const snap = (root: int, scale: int, pitch: int): int => {
        for (let distance = 0; distance < 12; distance++) {
            const below = pitch - distance, above = pitch + distance
            if (below >= 0 && below <= 127 && has(root, scale, below)) {return below}
            if (above >= 0 && above <= 127 && has(root, scale, above)) {return above}
        }
        return Math.min(127, Math.max(0, pitch))
    }

    // A pitch moved by scale degrees: up (or down) to the next pitch of the scale, `degrees` times. A pitch
    // outside the scale lands on the scale with its first move. Nothing when it would leave 0..127.
    export const shift = (root: int, scale: int, pitch: int, degrees: int): Optional<int> => {
        const direction = Math.sign(degrees)
        let result = pitch
        for (let count = Math.abs(degrees); count > 0; count--) {
            do {result += direction} while (result >= 0 && result <= 127 && !has(root, scale, result))
            if (result < 0 || result > 127) {return undefined}
        }
        return result
    }
}
