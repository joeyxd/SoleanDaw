import {int, UUID} from "@opendaw/lib-std"
import {AudioFileBox, NanoDeviceBox} from "@opendaw/studio-boxes"
import {DeviceBoxUtils} from "../DeviceBox"
import {PulseGridDevice, PulseGridLane} from "./PulseGridDevice"
import {PulseGridNotes} from "./PulseGridNotes"
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

    export const read = ({head, lanes}: PulseGridDevice): PulseGridDoc => {
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
            lanes: lanes.map(readLane)
        }
    }
}
