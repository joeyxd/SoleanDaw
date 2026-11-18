import {BooleanField, Box, Float32Field, Int32Field} from "@opendaw/lib-box"
import {int, UUID} from "@opendaw/lib-std"
import {AudioFileBox, NanoDeviceBox} from "@opendaw/studio-boxes"
import {Pointers} from "@opendaw/studio-enums"
import {DeviceBoxUtils} from "../DeviceBox"
import {PulseGridDevice, PulseGridLane} from "./PulseGridDevice"
import {PulseGridNotes} from "./PulseGridNotes"
import {PulseGridSongRegions} from "./PulseGridSong"
import {
    PulseGridDoc, PulseGridEffectDoc, PulseGridLaneDoc, PulseGridParamDoc, PulseGridPatternDoc, PulseGridSound
} from "./PulseGridTypes"

export type PulseGridParamField = Float32Field | Int32Field | BooleanField

export namespace PulseGridDocs {
    const percent = (value: number): number => Math.round(value * 10000) / 100 + 0 // + 0: never -0
    // Parameters (SPEC.md section 10): top-level primitive fields that are not deprecated and can be automated,
    // in field-key order. The range comes from the field's constraints; some give none.
    export const paramFields = (box: Box): ReadonlyArray<PulseGridParamField> =>
        box.fields().filter((field): field is PulseGridParamField =>
            (field instanceof Float32Field || field instanceof Int32Field || field instanceof BooleanField)
            && !field.deprecated && field.pointerRules.accepts.includes(Pointers.Automation))

    export const rangeOf = (field: PulseGridParamField): {min?: number, max?: number} => {
        if (field instanceof BooleanField) {return {}}
        const c = field.constraints
        if (c === "unipolar") {return {min: 0, max: 1}}
        if (c === "bipolar") {return {min: -1, max: 1}}
        if (c === "non-negative" || c === "index") {return {min: 0}}
        if (typeof c !== "object") {return {}}
        if ("min" in c && "max" in c) {return {min: c.min, max: c.max}}
        if ("values" in c) {return c.values.length === 0 ? {} : {min: Math.min(...c.values), max: Math.max(...c.values)}}
        if ("length" in c) {return {min: 0, max: c.length - 1}}
        return {}
    }

    // A float32 shows its shortest form (0.2, not 0.20000000298).
    const clean = (value: number): number => Number(value.toPrecision(7))

    const readParam = (field: PulseGridParamField): PulseGridParamDoc => field instanceof BooleanField
        ? {name: field.fieldName, type: "bool", value: field.getValue(), unit: ""}
        : {
            name: field.fieldName, type: field instanceof Int32Field ? "int" : "float",
            value: field instanceof Int32Field ? field.getValue() : clean(field.getValue()), unit: field.unit,
            ...rangeOf(field)
        }

    export const paramsOf = (box: Box): ReadonlyArray<PulseGridParamDoc> => paramFields(box).map(readParam)

    // The audio effects of a lane's cell, in chain order.
    export const effectBoxes = ({cell}: PulseGridLane): ReadonlyArray<Box> =>
        cell.audioEffects.pointerHub.incoming().map(({box}) => box)
            .sort((a, b) => DeviceBoxUtils.lookupIndexField(a).getValue() - DeviceBoxUtils.lookupIndexField(b).getValue())

    const chain = (lane: PulseGridLane): Array<PulseGridEffectDoc> => effectBoxes(lane).map((box, index) => ({
        index: index + 1, name: box.name.replace(/DeviceBox$/, ""),
        label: DeviceBoxUtils.lookupLabelField(box).getValue(),
        enabled: DeviceBoxUtils.lookupEnabledField(box).getValue(), params: paramsOf(box)
    }))

    const sound = ({instrument}: PulseGridLane): PulseGridSound | null => instrument.mapOr(box => {
        const result: PulseGridSound = {
            instrument: box.name.replace(/(?:DeviceBox|Box)$/, ""),
            label: DeviceBoxUtils.lookupLabelField(box).getValue(),
            params: paramsOf(box)
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
            effects: effectBoxes(lane).map(box => box.name.replace(/DeviceBox$/, "")),
            chain: chain(lane),
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
