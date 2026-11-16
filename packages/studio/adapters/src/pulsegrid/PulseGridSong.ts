import {int, UUID} from "@opendaw/lib-std"
import {AudioUnitBox, NoteEventBox, NoteEventCollectionBox, NoteRegionBox, TrackBox} from "@opendaw/studio-boxes"
import {ColorCodes} from "../factories/ColorCodes"
import {TrackType} from "../timeline/TrackType"
import {PulseGridDevice} from "./PulseGridDevice"
import {PulseGridSongEntry} from "./PulseGridTypes"

// The song as regions (SPEC.md section 9): note regions on the first Notes track of the PulseGrid's audio unit,
// whose first note is a scene note. Everything that reads or writes those regions is here, so the ops and the
// document agree on what the song is.

const Step = 240 // pulses in one step
const Letters = "ABCD"
const isSceneNote = (pitch: int): boolean => pitch >= 0 && pitch <= 63

// A region that is part of the song: `slot` is the pitch of its first note, (scene - 1) * 4 + variation index.
export type PulseGridSceneRegion = {
    region: NoteRegionBox, collection: NoteEventCollectionBox, slot: int, position: int, duration: int
}

export namespace PulseGridSongRegions {
    export const round = (value: number): number => Math.round(value * 10000) / 10000

    const unitOf = ({composite}: PulseGridDevice): AudioUnitBox | undefined => {
        const box = composite.host.targetVertex.unwrapOrUndefined()?.box
        return box instanceof AudioUnitBox ? box : undefined
    }

    const tracksOf = (unit: AudioUnitBox): Array<TrackBox> => unit.tracks.pointerHub.incoming()
        .map(({box}) => box).filter((box): box is TrackBox => box instanceof TrackBox)

    const notesOf = (collection: NoteEventCollectionBox): Array<NoteEventBox> => collection.events.pointerHub.incoming()
        .map(({box}) => box).filter((box): box is NoteEventBox => box instanceof NoteEventBox)

    // Whether the box graph reaches the audio unit that hosts the PulseGrid; without it there is no song track.
    export const hasUnit = (device: PulseGridDevice): boolean => unitOf(device) !== undefined

    // The song track: the first Notes track of the unit, the one with the lowest index.
    export const track = (device: PulseGridDevice): TrackBox | undefined => {
        const unit = unitOf(device)
        return unit === undefined ? undefined : tracksOf(unit).filter(box => box.type.getValue() === TrackType.Notes)
            .sort((a, b) => a.index.getValue() - b.index.getValue())[0]
    }

    const ensureTrack = (device: PulseGridDevice): TrackBox => {
        const existing = track(device)
        if (existing !== undefined) {return existing}
        const unit = unitOf(device)!
        const index = tracksOf(unit).reduce((next, box) => Math.max(next, box.index.getValue() + 1), 0)
        return TrackBox.create(device.head.graph, UUID.generate(), box => {
            box.type.setValue(TrackType.Notes)
            box.enabled.setValue(true)
            box.index.setValue(index)
            box.target.refer(unit)
            box.tracks.refer(unit.tracks)
        })
    }

    // The scene regions of the song track, by position.
    export const sceneRegions = (device: PulseGridDevice): Array<PulseGridSceneRegion> => {
        const found = track(device)
        if (found === undefined) {return []}
        return found.regions.pointerHub.incoming().map(({box}) => box)
            .filter((box): box is NoteRegionBox => box instanceof NoteRegionBox)
            .flatMap(region => {
                const collection = region.events.targetVertex.unwrapOrUndefined()?.box
                if (!(collection instanceof NoteEventCollectionBox)) {return []}
                const first = notesOf(collection).sort((a, b) =>
                    a.position.getValue() - b.position.getValue() || a.pitch.getValue() - b.pitch.getValue())[0]
                if (first === undefined || !isSceneNote(first.pitch.getValue())) {return []}
                return [{region, collection, slot: first.pitch.getValue(),
                    position: region.position.getValue(), duration: region.duration.getValue()}]
            })
            .sort((a, b) => a.position - b.position)
    }

    // The song as its regions say it. A gap reads as a rest; a region that starts before the one before it ends
    // cuts that one short; cycles and `from` are rounded to four decimals.
    export const read = (device: PulseGridDevice): {from: number, entries: Array<PulseGridSongEntry>} => {
        const regions = sceneRegions(device)
        const entries: Array<PulseGridSongEntry> = []
        if (regions.length === 0) {return {from: 1, entries}}
        const cycle = device.head.length.getValue() * Step
        let cursor = regions[0].position
        regions.forEach((current, index) => {
            const gap = current.position - cursor
            if (round(gap / cycle) > 0) {entries.push({rest: true, cycles: round(gap / cycle)})}
            const next = regions[index + 1]
            const end = next !== undefined && next.position < current.position + current.duration
                ? next.position : current.position + current.duration
            const cycles = round((end - current.position) / cycle)
            if (cycles > 0) {
                entries.push({scene: Math.floor(current.slot / 4) + 1, variation: Letters[current.slot % 4] as "A", cycles})
            }
            cursor = Math.max(cursor, end)
        })
        return {from: round(regions[0].position / Step + 1), entries}
    }

    // The pulse where a song of these entries ends, to check it before anything is written.
    export const endOf = (device: PulseGridDevice, entries: ReadonlyArray<PulseGridSongEntry>, from: number): number =>
        Math.round((from - 1 + entries.reduce((sum, {cycles}) => sum + cycles, 0) * device.head.length.getValue()) * Step)

    // The pulse right after the last scene region, 0 when the song has none.
    export const end = (device: PulseGridDevice): number => {
        const last = sceneRegions(device).at(-1)
        return last === undefined ? 0 : last.position + last.duration
    }

    export const duration = (device: PulseGridDevice, cycles: number): number =>
        Math.max(1, Math.round(cycles * device.head.length.getValue() * Step))

    const labelOf = (device: PulseGridDevice, scene: int, letter: string): string =>
        `${device.head.scenes.getField(scene - 1).label.getValue() || `Scene ${scene}`} ${letter}`

    const remove = (regions: ReadonlyArray<PulseGridSceneRegion>): void => {
        const collections = new Set<NoteEventCollectionBox>()
        regions.forEach(({region, collection}) => {
            collections.add(collection)
            region.delete()
        })
        // A collection no region uses any more goes with its notes.
        collections.forEach(collection => {
            if (collection.owners.pointerHub.incoming().length === 0) {collection.delete()}
        })
    }

    const create = (device: PulseGridDevice, trackBox: TrackBox, position: int, pulses: int,
                    entry: Extract<PulseGridSongEntry, {scene: int}>): void => {
        const {graph} = device.head
        const length = device.head.length.getValue()
        const slot = (entry.scene - 1) * 4 + Letters.indexOf(entry.variation)
        const collection = NoteEventCollectionBox.create(graph, UUID.generate())
        for (let step = 0; step < length; step++) {
            NoteEventBox.create(graph, UUID.generate(), box => {
                box.events.refer(collection.events)
                box.position.setValue(step * Step)
                box.duration.setValue(Step)
                box.pitch.setValue(slot)
            })
        }
        NoteRegionBox.create(graph, UUID.generate(), box => {
            box.position.setValue(position)
            box.duration.setValue(pulses)
            box.loopOffset.setValue(0)
            box.loopDuration.setValue(length * Step)
            box.label.setValue(labelOf(device, entry.scene, entry.variation))
            box.hue.setValue(ColorCodes.forTrackType(TrackType.Notes))
            box.regions.refer(trackBox.regions)
            box.events.refer(collection.owners)
        })
    }

    // Replaces every scene region by the regions of these entries, the first starting at song step `from`.
    // A rest writes no region. Regions that are not scene regions stay.
    export const write = (device: PulseGridDevice, entries: ReadonlyArray<PulseGridSongEntry>, from: number): void => {
        remove(sceneRegions(device))
        const trackBox = ensureTrack(device)
        const length = device.head.length.getValue()
        let steps = from - 1
        for (const entry of entries) {
            const position = Math.round(steps * Step)
            steps += entry.cycles * length
            // The end is rounded, not the length: neighbours then meet on the same pulse, and a fraction of a
            // cycle never leaves a one-pulse gap that would read back as a rest.
            if ("scene" in entry) {create(device, trackBox, position, Math.max(1, Math.round(steps * Step) - position), entry)}
        }
    }

    // One more region right after the last scene region.
    export const append = (device: PulseGridDevice, entry: Extract<PulseGridSongEntry, {scene: int}>): void => {
        const position = end(device)
        create(device, ensureTrack(device), position, duration(device, entry.cycles), entry)
    }

    // The scene notes follow their scenes: `map` gives the new number of a scene, undefined when it is gone. The
    // regions of a scene that is gone are removed (a note of it inside another region is removed too, so it
    // rests); the regions of a scene that changed number are relabelled from the scene names as they stand.
    export const renumber = (device: PulseGridDevice, map: (scene: int) => int | undefined): void => {
        const regions = sceneRegions(device)
        const sceneOf = ({slot}: PulseGridSceneRegion): int => Math.floor(slot / 4) + 1
        remove(regions.filter(entry => map(sceneOf(entry)) === undefined))
        const kept = regions.filter(entry => map(sceneOf(entry)) !== undefined)
        const done = new Set<NoteEventCollectionBox>()
        kept.forEach(({collection}) => {
            if (done.has(collection)) {return}
            done.add(collection)
            notesOf(collection).forEach(note => {
                const pitch = note.pitch.getValue()
                if (!isSceneNote(pitch)) {return}
                const scene = map(Math.floor(pitch / 4) + 1)
                if (scene === undefined) {note.delete()} else {note.pitch.setValue((scene - 1) * 4 + pitch % 4)}
            })
        })
        kept.forEach(entry => {
            const was = sceneOf(entry)
            const now = map(was)!
            if (now !== was) {entry.region.label.setValue(labelOf(device, now, Letters[entry.slot % 4]))}
        })
    }

    // The label of every region of the scene, after its name changed.
    export const relabel = (device: PulseGridDevice, scene: int): void => {
        sceneRegions(device).filter(({slot}) => Math.floor(slot / 4) + 1 === scene)
            .forEach(({region, slot}) => region.label.setValue(labelOf(device, scene, Letters[slot % 4])))
    }
}
