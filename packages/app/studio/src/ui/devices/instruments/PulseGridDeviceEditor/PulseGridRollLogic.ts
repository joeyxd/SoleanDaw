import {int, Optional} from "@opendaw/lib-std"
import {PulseGridNoteKey, PulseGridRollRow} from "@opendaw/studio-adapters"
import {PulseGridLaneLogic} from "./PulseGridLaneLogic"

export type PulseGridRollBox = {left: number, top: number, right: number, bottom: number}
export type PulseGridRollHit = {key: PulseGridNoteKey, box: PulseGridRollBox}

export namespace PulseGridRollLogic {
    export const RowHeight = 14
    export const RowGap = 1
    export const rowAt = (y: number, count: int): Optional<int> => {
        const row = Math.floor(y / (RowHeight + RowGap))
        return y < 0 || row >= count || y % (RowHeight + RowGap) >= RowHeight ? undefined : row
    }
    export const span = (step: int, length: int, limit: int): {start: int, end: int, width: string} => {
        const duration = Math.min(length / 4, limit - step + 1)
        const count = Math.ceil(duration)
        const start = PulseGridLaneLogic.trackOf(step)
        const end = PulseGridLaneLogic.trackOf(step + count - 1) + 1
        const fixed = (end - start - 1) * PulseGridLaneLogic.ColumnGap
            + (end - start - count) * PulseGridLaneLogic.GroupGap
        const trim = (count - duration) / count
        return {start, end, width: trim === 0 ? "100%" : `calc(${100 * (1 - trim)}% + ${fixed * trim}px)`}
    }
    export const degrees = (rows: ReadonlyArray<PulseGridRollRow>, from: int, to: int): int => {
        const rank = (index: int): int => rows.slice(0, index + 1).filter(row => row.inScale).length
        return rank(from) - rank(to)
    }
    export const box = (fromX: number, fromY: number, toX: number, toY: number): PulseGridRollBox => ({
        left: Math.min(fromX, toX), right: Math.max(fromX, toX),
        top: Math.min(fromY, toY), bottom: Math.max(fromY, toY)
    })
    export const touched = (notes: ReadonlyArray<PulseGridRollHit>, box: PulseGridRollBox): Array<PulseGridNoteKey> =>
        notes.filter(({box: note}) => note.left <= box.right && note.right >= box.left
            && note.top <= box.bottom && note.bottom >= box.top).map(({key}) => key)
    export const paintLength = (start: int, end: int, limit: int): int =>
        Math.min(63, limit - start + 1, Math.max(1, end - start + 1)) * 4
    export const resizeLength = paintLength
    export const same = (first: PulseGridNoteKey, second: PulseGridNoteKey): boolean =>
        first.step === second.step && first.pitch === second.pitch
}
