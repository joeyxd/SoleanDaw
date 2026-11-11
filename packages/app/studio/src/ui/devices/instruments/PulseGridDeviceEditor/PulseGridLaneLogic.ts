import {int, Optional} from "@opendaw/lib-std"
import {PulseGridDoc, PulseGridLaneDoc} from "@opendaw/studio-adapters"

export type PulseGridFrameKey = "drums" | "melody"

export type PulseGridFrame = {
    key: PulseGridFrameKey
    title: string
    subtitle: string
    lanes: ReadonlyArray<PulseGridLaneDoc>
}

export type PulseGridSoundFolder = {
    name: string
    folders?: ReadonlyArray<PulseGridSoundFolder>
    samples?: ReadonlyArray<{uuid: string, name: string, duration: number}>
}

export namespace PulseGridLaneLogic {
    export const HeadWidth = 196
    export const HeadGap = 8
    export const MinColumn = 18
    // a short pattern keeps step-sized cells instead of stretching across the window
    export const MaxColumn = 64
    export const ColumnGap = 3
    export const GroupGap = 3
    export const GroupSize = 4

    // DRUMS holds group 0, MELODY every other lane, each in document order. A frame without lanes is left out.
    export const frames = (doc: PulseGridDoc): ReadonlyArray<PulseGridFrame> => {
        const drums = doc.lanes.filter(lane => lane.group === 0)
        const melody = doc.lanes.filter(lane => lane.group !== 0)
        const result: Array<PulseGridFrame> = []
        if (drums.length > 0) {
            result.push({key: "drums", title: "DRUMS", subtitle: "Beat Foundation", lanes: drums})
        }
        if (melody.length > 0) {
            result.push({key: "melody", title: "MELODY", subtitle: melody.map(lane => lane.name).join(" · "), lanes: melody})
        }
        return result
    }

    export const rulerLength = (doc: PulseGridDoc, laneLengths: ReadonlyArray<int>): int =>
        Math.max(doc.settings.length, ...laneLengths)

    export const isBeat = (step: int): boolean => (step - 1) % GroupSize === 0

    // The grid track of a step (1..n) inside the cells: a spacer track follows every 4th step.
    export const trackOf = (step: int): int => step + Math.floor((step - 1) / GroupSize)

    export const tracks = (length: int): string => {
        const result: Array<string> = []
        for (let step = 1; step <= length; step++) {
            result.push(`minmax(${MinColumn}px, ${MaxColumn}px)`)
            if (step % GroupSize === 0 && step < length) {result.push(`${GroupGap}px`)}
        }
        return result.join(" ")
    }

    export const minCellsWidth = (length: int): int => {
        const spacers = Math.floor((length - 1) / GroupSize)
        const count = length + spacers
        return length * MinColumn + spacers * GroupGap + (count - 1) * ColumnGap
    }

    export const minSheetWidth = (length: int): int => HeadWidth + HeadGap + minCellsWidth(length)

    // 0.3 for the quietest, 1 for velocity 127: quiet steps stay visible but clearly dimmer.
    export const brightness = (velocity: int): number => {
        const unit = Math.min(1, Math.max(0, velocity / 127))
        return Math.round((0.3 + 0.7 * Math.pow(unit, 1.5)) * 100) / 100
    }

    export const isQuiet = (lane: PulseGridLaneDoc, anySolo: boolean): boolean =>
        lane.mix.mute || (anySolo && !lane.mix.solo)

    // Where the dragged lane lands among the others of its frame (0 is above the first), from the middle
    // heights of those others, top to bottom, and the pointer height.
    export const dropSlot = (middles: ReadonlyArray<number>, y: number): int =>
        middles.filter(middle => middle < y).length

    // The `to` of PulseGridActions.moveLane: the lane's new position among all lanes, 1 is the top lane. `frameIds`
    // are the lanes of its frame in order, `slot` is where it lands among the others of that frame.
    export const moveTarget = (doc: PulseGridDoc, frameIds: ReadonlyArray<string>, laneId: string, slot: int): int => {
        const others = frameIds.filter(id => id !== laneId)
        const rest = doc.lanes.filter(lane => lane.id !== laneId).map(lane => lane.id)
        if (others.length === 0) {return rest.length + 1}
        const clamped = Math.min(Math.max(slot, 0), others.length)
        return clamped < others.length
            ? rest.indexOf(others[clamped]) + 1
            : rest.indexOf(others[others.length - 1]) + 2
    }

    // The "openDAW" > "One Shots" folder of the sample index, wherever its parent sits.
    export const oneShots = (folders: ReadonlyArray<PulseGridSoundFolder>): Optional<PulseGridSoundFolder> => {
        for (const folder of folders) {
            if (folder.name.toLowerCase() === "one shots") {return folder}
            const found = oneShots(folder.folders ?? [])
            if (found !== undefined) {return found}
        }
        return undefined
    }
}
