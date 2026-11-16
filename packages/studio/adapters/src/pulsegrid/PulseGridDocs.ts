import {int, UUID} from "@opendaw/lib-std"
import {AudioFileBox, NanoDeviceBox} from "@opendaw/studio-boxes"
import {DeviceBoxUtils} from "../DeviceBox"
import {PulseGridDevice, PulseGridLane} from "./PulseGridDevice"
import {PulseGridNotes} from "./PulseGridNotes"
import {PulseGridSongRegions} from "./PulseGridSong"
import {PulseGridDoc, PulseGridLaneDoc, PulseGridPatternDoc, PulseGridSound} from "./PulseGridTypes"

export namespace PulseGridDocs {
    const percent = (value: number): number => Math.round(value * 10000) / 100 + 0 // + 0: never -0
    const sound = ({instrument}: PulseGridLane): PulseGridSound | null => instrument.mapOr(box => {
        const result: PulseGridSound = {
            instrument: box.name.replace(/(?:DeviceBox|Box)$/, ""),
            label: DeviceBoxUtils.lookupLabelField(box).getValue()
        }
        if (box instanceof NanoDeviceBox) {
            box.file.targetVertex.ifSome(({box: file}) => {
                if (file instanceof AudioFileBox) {
                    result.sample = {uuid: UUID.toString(file.address.uuid), name: file.fileName.getValue()}
                }
            })
        }
        return result
    }, null)

    const readLane = (lane: PulseGridLane, index: int): PulseGridLaneDoc => {
        const {cell, device} = lane
        const patterns: Array<PulseGridPatternDoc> = []
        for (let slot = 0; slot < 64; slot++) {
            const pattern = device.patterns.getField(slot)
            const length = pattern.length.getValue()
            const notes = PulseGridNotes.decode(pattern.notes.getValue())
            if (length !== 0 || notes.length > 0) {patterns.push({...PulseGridNotes.slotOf(slot), length, notes})}
        }
        return {
            index: index + 1,
            id: UUID.toString(device.address.uuid),
            name: device.label.getValue(),
            kind: device.kind.getValue() === 0 ? "drum" : "melodic",
            group: device.group.getValue(),
            hue: device.hue.getValue(),
            pitch: device.pitch.getValue(),
            probability: percent(device.probability.getValue()),
            humanize: percent(device.humanize.getValue()),
            accent: device.accent.getValue(),
            armed: device.armed.getValue(),
            enabled: device.enabled.getValue(),
            seed: device.seed.getValue(),
            sound: sound(lane),
            effects: cell.audioEffects.pointerHub.incoming().map(({box}) => box)
                .sort((a, b) => DeviceBoxUtils.lookupIndexField(a).getValue() - DeviceBoxUtils.lookupIndexField(b).getValue())
                .map(box => box.name.replace(/DeviceBox$/, "")),
            mix: {gain: cell.gain.getValue(), pan: percent(cell.pan.getValue()),
                mute: cell.mute.getValue(), solo: cell.solo.getValue()},
            patterns
        }
    }

    // Whether a lane holds anything in a slot: notes, or an own length.
    export const holds = ({device}: PulseGridLane, slot: int): boolean => {
        const pattern = device.patterns.getField(slot)
        return pattern.length.getValue() !== 0 || PulseGridNotes.decode(pattern.notes.getValue()).length > 0
    }

    // The highest scene that exists: scene 1, the one that plays, one with its `used` flag, or one in which any
    // lane holds a pattern (SPEC.md section 9).
    export const sceneCount = ({head, lanes}: PulseGridDevice): int => {
        let count = Math.max(1, head.scene.getValue() + 1)
        for (let index = 0; index < 16; index++) {
            if (head.scenes.getField(index).used.getValue()) {count = Math.max(count, index + 1)}
        }
        for (const lane of lanes) {
            for (let slot = 0; slot < 64; slot++) {
                if (Math.floor(slot / 4) + 1 > count && holds(lane, slot)) {count = Math.floor(slot / 4) + 1}
            }
        }
        return count
    }

    export const read = (device: PulseGridDevice): PulseGridDoc => {
        const {head, lanes} = device
        const scenes: Array<PulseGridDoc["scenes"][number]> = []
        for (let index = 0; index < 16; index++) {
            const scene = head.scenes.getField(index)
            const name = scene.label.getValue()
            const used = scene.used.getValue()
            if (name.length > 0 || used) {scenes.push({scene: index + 1, name, used})}
        }
        return {
            version: 1,
            id: UUID.toString(head.address.uuid),
            name: head.label.getValue(),
            settings: {
                length: head.length.getValue(), swing: Math.round(head.swing.getValue() * 100) / 100,
                groove: percent(head.groove.getValue()), probability: percent(head.probability.getValue()),
                humanize: percent(head.humanize.getValue()), accentAmount: percent(head.accentAmount.getValue()),
                root: head.root.getValue(), scale: head.scale.getValue()
            },
            ...PulseGridNotes.slotOf(head.scene.getValue() * 4 + head.variation.getValue()),
            scenes,
            sceneCount: sceneCount(device),
            song: {on: head.song.getValue(), ...PulseGridSongRegions.read(device)},
            lanes: lanes.map(readLane)
        }
    }
}
