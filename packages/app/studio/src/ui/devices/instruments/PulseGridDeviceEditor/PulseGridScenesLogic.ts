import {int, Optional} from "@opendaw/lib-std"

// The decisions of the scenes column, the Pattern / Song switch and the strip's scene buttons, without a DOM.
export namespace PulseGridScenesLogic {
    export const MaxScenes = 16
    // pulses in one step (PPQN 960, a step is a 16th)
    export const StepPulses = 240
    // a pointer must travel this far (px) before a press on a row becomes a drag
    export const DragThreshold = 4

    export const NoticeAddedToSong = "Added to the song. Switch to Song to hear it."
    export const NoticeEmptySong = "The song is empty: right-click a scene, Add to song."

    // An unnamed scene shows its number.
    export const label = (scene: int, name: string): string => name.trim() === "" ? `Scene ${scene}` : name.trim()

    // The arrows step through the scenes that exist and wrap at both ends.
    export const wrap = (current: int, offset: int, count: int): int =>
        ((current - 1 + offset) % count + count) % count + 1

    export const canAdd = (count: int): boolean => count < MaxScenes

    export const canDelete = (count: int): boolean => count > 1

    // Where a dragged row lands, 1 is the top row. `middles` are the middle heights of all rows in scene order
    // (the dragged one included), `y` is the pointer height. The row lands after every other row whose middle
    // lies above the pointer; the result is `from` when it stays where it was.
    export const dropTarget = (middles: ReadonlyArray<number>, from: int, y: number): int =>
        middles.filter((middle, index) => index !== from - 1 && middle < y).length + 1

    // The step of the song position, or -1 while nothing runs: the column draws again only when it changes.
    export const stepOf = (position: number, running: boolean): int =>
        running ? Math.floor(position / StepPulses) : -1

    // The scene whose row is marked "in-song": the one the song plays now, only while the song is on and runs.
    export const inSongScene = (songOn: boolean, running: boolean,
                                at: Optional<{scene: int} | null>): Optional<int> =>
        songOn && running && at !== undefined && at !== null ? at.scene : undefined

    // The notice after "Add to song": only while the Pattern mode is in force.
    export const addedNotice = (songOn: boolean): Optional<string> => songOn ? undefined : NoticeAddedToSong

    // The notice after a click on a switch button: only for Song and a song without entries.
    export const switchNotice = (turnOn: boolean, entries: int): Optional<string> =>
        turnOn && entries === 0 ? NoticeEmptySong : undefined
}
