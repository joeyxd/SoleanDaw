import {int} from "@opendaw/lib-std"
import {MidiKeys} from "@opendaw/lib-dsp"

export type PulseGridKeyShape = {pitch: int, black: boolean, left: number, width: number}

// The arithmetic of the value rows and of the keyboard, without a DOM.
export namespace PulseGridValueLogic {
    export const VelocityHeight = 34
    export const ChanceHeight = 18
    export const AccentHeight = 18
    export const RowGap = 4
    export const KeyboardOctaves = 3
    // a black key is this wide in white keys
    export const BlackWidth = 0.6

    const unitAt = (y: number, top: number, height: number): number =>
        height <= 0 ? 0 : Math.min(1, Math.max(0, 1 - (y - top) / height))

    // 127 at the top of the row, 1 at the bottom; above or below the row it stays at the limit.
    export const velocityAt = (y: number, top: number, height: number): int =>
        Math.round(1 + unitAt(y, top, height) * 126)

    // 100 at the top, 0 at the bottom, in steps of 5.
    export const chanceAt = (y: number, top: number, height: number): int =>
        Math.round(unitAt(y, top, height) * 20) * 5

    // The bar of a velocity in a row of `height` pixels: at least one pixel, so a quiet note is still seen.
    export const barHeight = (velocity: int, height: number): number =>
        Math.max(1, Math.round(Math.min(127, Math.max(0, velocity)) / 127 * height))

    // The lowest pitch of the keyboard: the C of the octave under the lane pitch, kept inside 0..127.
    export const keyboardStart = (pitch: int): int => Math.min(127, Math.max(0, Math.floor(pitch / 12) * 12 - 12))

    // The pitches the keyboard shows: from the C under to the B over the octave of `pitch`, inside 0..127.
    export const keyboardRange = (pitch: int): {first: int, last: int} =>
        ({first: keyboardStart(pitch), last: Math.min(127, Math.floor(pitch / 12) * 12 + 12 * (KeyboardOctaves - 1) - 1)})

    // Where the keys of a range stand, in units of one white key: a white key is one unit wide at the number of
    // white keys before it; a black key sits across the border to the white key after the one before it.
    export const keyShapes = (first: int, last: int): ReadonlyArray<PulseGridKeyShape> => {
        const shapes: Array<PulseGridKeyShape> = []
        let whites = 0
        for (let pitch = first; pitch <= last; pitch++) {
            if (MidiKeys.isBlackKey(pitch)) {
                shapes.push({pitch, black: true, left: whites - BlackWidth / 2, width: BlackWidth})
            } else {
                shapes.push({pitch, black: false, left: whites, width: 1})
                whites++
            }
        }
        return shapes
    }

    export const whiteCount = (first: int, last: int): int => {
        let count = 0
        for (let pitch = first; pitch <= last; pitch++) {
            if (!MidiKeys.isBlackKey(pitch)) {count++}
        }
        return count
    }
}
