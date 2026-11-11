import {describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {
    AudioFileBox, AudioUnitBox, DelayDeviceBox, InstrumentCompositeBox, InstrumentCompositeCellBox,
    NanoDeviceBox, PulseGridBox, PulseGridLaneDeviceBox, ReverbDeviceBox
} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {PulseGridDevice} from "./PulseGridDevice"
import {PulseGridDocs} from "./PulseGridDocs"
import {PulseGridNotes} from "./PulseGridNotes"
import {PulseGridNote} from "./PulseGridTypes"

describe("PulseGridDocs", () => {
    it("reads plain JSON with human units, ordered patterns, sounds, effects and scenes", () => {
        const {boxGraph: graph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} =
            ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
        graph.beginTransaction()
        const unit = AudioUnitBox.create(graph, UUID.generate(), box => {
            box.collection.refer(rootBox.audioUnits)
            box.output.refer(primaryAudioBusBox.input)
            box.index.setValue(1)
        })
        const composite = InstrumentCompositeBox.create(graph, UUID.generate(), box => box.host.refer(unit.input))
        const head = PulseGridBox.create(graph, UUID.generate(), box => {
            box.label.setValue("Night drive")
            box.length.setValue(32)
            box.probability.setValue(0.35)
            box.groove.setValue(0.123456)
            box.humanize.setValue(0.15)
            box.accentAmount.setValue(0.65)
            box.swing.setValue(54.12)
            box.root.setValue(7)
            box.scale.setValue(2)
            box.scene.setValue(1)
            box.variation.setValue(1)
            box.scenes.getField(3).used.setValue(true)
            box.scenes.getField(1).label.setValue("Drop")
        })
        const cells = [0, 1].map(index => InstrumentCompositeCellBox.create(graph, UUID.generate(), box => {
            box.composite.refer(composite.cells)
            box.index.setValue(index)
            box.pan.setValue(-0.5)
            box.gain.setValue(-3)
            box.mute.setValue(true)
            box.solo.setValue(true)
        }))
        const lanes = cells.map((cell, index) => PulseGridLaneDeviceBox.create(graph, UUID.generate(), box => {
            box.host.refer(cell.midiEffects)
            box.index.setValue(0)
            box.grid.refer(head)
            box.label.setValue(index === 0 ? "Kick" : "Empty")
        }))
        const lane = lanes[0]
        lane.kind.setValue(1)
        lane.group.setValue(1)
        lane.hue.setValue(120)
        lane.pitch.setValue(36)
        lane.probability.setValue(0.8)
        lane.humanize.setValue(0.123456)
        lane.accent.setValue(false)
        lane.armed.setValue(true)
        lane.enabled.setValue(false)
        lane.seed.setValue(42)
        const note: PulseGridNote = {step: 1, pitch: 36, ...PulseGridNote.Defaults}
        lane.patterns.getField(5).notes.setValue(PulseGridNotes.encode([note]))
        lane.patterns.getField(0).length.setValue(8)
        const sample = AudioFileBox.create(graph, UUID.generate(), box => box.fileName.setValue("Kick 808.wav"))
        const instrument = NanoDeviceBox.create(graph, UUID.generate(), box => {
            box.host.refer(cells[0].instrument)
            box.label.setValue("Kick 808")
            box.file.refer(sample)
        })
        ReverbDeviceBox.create(graph, UUID.generate(), box => {
            box.host.refer(cells[0].audioEffects)
            box.index.setValue(4)
        })
        DelayDeviceBox.create(graph, UUID.generate(), box => {
            box.host.refer(cells[0].audioEffects)
            box.index.setValue(1)
        })
        graph.endTransaction()
        expect(lane.patterns.getField(5).notes.getValue()).toBeInstanceOf(Int8Array)
        const device = PulseGridDevice.find(composite).unwrap()
        const doc = PulseGridDocs.read(device)
        expect(doc).toEqual({
            version: 1, id: UUID.toString(head.address.uuid), name: "Night drive",
            settings: {length: 32, swing: 54.12, groove: 12.35, probability: 35, humanize: 15,
                accentAmount: 65, root: 7, scale: 2},
            scene: 2, variation: "B",
            scenes: [{scene: 2, name: "Drop", used: false}, {scene: 4, name: "", used: true}],
            lanes: [
                {index: 1, id: UUID.toString(lane.address.uuid), name: "Kick", kind: "melodic", group: 1,
                    hue: 120, pitch: 36, probability: 80, humanize: 12.35, accent: false, armed: true,
                    enabled: false, seed: 42,
                    sound: {instrument: "Nano", label: "Kick 808",
                        sample: {uuid: UUID.toString(sample.address.uuid), name: "Kick 808.wav"}},
                    effects: ["Delay", "Reverb"], mix: {gain: -3, pan: -50, mute: true, solo: true},
                    patterns: [{scene: 1, variation: "A", length: 8, notes: []},
                        {scene: 2, variation: "B", length: 0, notes: [note]}]},
                {index: 2, id: UUID.toString(lanes[1].address.uuid), name: "Empty", kind: "drum", group: 0,
                    hue: 0, pitch: 60, probability: 100, humanize: 0, accent: true, armed: false,
                    enabled: true, seed: 0, sound: null, effects: [],
                    mix: {gain: -3, pan: -50, mute: true, solo: true}, patterns: []}
            ]
        })
        expect(JSON.parse(JSON.stringify(doc))).toEqual(doc)
        graph.beginTransaction()
        lane.patterns.getField(5).notes.setValue(new Int8Array(0))
        instrument.label.setValue("Changed")
        graph.endTransaction()
        expect(doc.lanes[0].patterns[1].notes).toEqual([note])
        expect(doc.lanes[0].sound?.label).toBe("Kick 808")
        expect(PulseGridDocs.read(device).lanes[0].sound?.label).toBe("Changed")
    })
})
