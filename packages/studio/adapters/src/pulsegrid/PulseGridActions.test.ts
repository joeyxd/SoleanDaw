import {describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {AudioUnitBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {InstrumentFactories} from "../factories/InstrumentFactories"
import {IconSymbol} from "@opendaw/studio-enums"
import {PulseGridActions, PulseGridView} from "./PulseGridActions"
import {PulseGridDevice} from "./PulseGridDevice"
import {PulseGridDocs} from "./PulseGridDocs"
import {PulseGridKits} from "./PulseGridKits"
import {PulseGridOps} from "./PulseGridOps"
import {PulseGridText} from "./PulseGridText"
import {PulseGridDoc, PulseGridOp, PulseGridOpName} from "./PulseGridTypes"

// A PulseGrid as the editor makes one: the instrument factory with its default kit.
const fixture = () => {
    const {boxGraph: graph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} =
        ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    graph.beginTransaction()
    const unit = AudioUnitBox.create(graph, UUID.generate(), box => {
        box.collection.refer(rootBox.audioUnits)
        box.output.refer(primaryAudioBusBox.input)
        box.index.setValue(1)
    })
    const composite = InstrumentFactories.PulseGrid.create(graph, unit.input, "PulseGrid", IconSymbol.DrumSet)
    graph.endTransaction()
    const read = () => PulseGridDocs.read(PulseGridDevice.find(composite).unwrap())
    const apply = (ops: ReadonlyArray<PulseGridOp>) => {
        graph.beginTransaction()
        try {return PulseGridOps.apply(composite, ops)} finally {graph.endTransaction()}
    }
    const ok = (ops: ReadonlyArray<PulseGridOp>) => {
        const results = apply(ops)
        expect(results.filter(result => !result.ok)).toEqual([])
        expect(results.length).toBe(ops.length)
    }
    const lane = (name: string) => read().lanes.find(lane => lane.name === name)!
    const line = (name: string) => {
        const doc = read()
        return PulseGridText.toText(doc).split("\n").find(line => line.trim().startsWith(`${name} |`))?.trim()
    }
    return {graph, composite, read, apply, ok, lane, line}
}
const sample = PulseGridKits.All[0].sounds.Perc
const cowbell = {uuid: "83cfb3ec-f361-42dc-af1d-766f2bb0100d", name: "TR-707 Cowbell", duration: 0.1495}

// Every action of the screen, the ops it must send, and one real call. A new action does not compile until it
// is listed here.
type Case = {ops: ReadonlyArray<PulseGridOpName>, call: (doc: PulseGridDoc, lane: string) => Array<PulseGridOp>}
const cases: Record<keyof typeof PulseGridActions, Case> = {
    rename: {ops: ["setSetting"], call: () => PulseGridActions.rename("Night drive")},
    setLength: {ops: ["setSetting"], call: () => PulseGridActions.setLength(32)},
    setSwing: {ops: ["setSetting"], call: () => PulseGridActions.setSwing(58)},
    setGroove: {ops: ["setSetting"], call: () => PulseGridActions.setGroove(40)},
    setProbability: {ops: ["setSetting"], call: () => PulseGridActions.setProbability(75)},
    setHumanize: {ops: ["setSetting"], call: () => PulseGridActions.setHumanize(22)},
    pickScene: {ops: ["setPlaying"], call: () => PulseGridActions.pickScene(3)},
    pickVariation: {ops: ["setPlaying"], call: () => PulseGridActions.pickVariation("C")},
    newVariation: {ops: ["copyVariation", "setPlaying"], call: doc => PulseGridActions.newVariation(doc)},
    setStep: {ops: ["setStep"], call: (_, lane) => PulseGridActions.setStep(lane, 5, true)},
    setStepValues: {ops: ["setStep"], call: (_, lane) => PulseGridActions.setStepValues(lane, 1, {velocity: 60, accent: true})},
    setMute: {ops: ["setLaneMix"], call: (_, lane) => PulseGridActions.setMute(lane, true)},
    setSolo: {ops: ["setLaneMix"], call: (_, lane) => PulseGridActions.setSolo(lane, true)},
    renameLane: {ops: ["setLane"], call: (_, lane) => PulseGridActions.renameLane(lane, "Boom")},
    moveLane: {ops: ["moveLane"], call: (_, lane) => PulseGridActions.moveLane(lane, 3)},
    removeLane: {ops: ["removeLane"], call: (_, lane) => PulseGridActions.removeLane(lane)},
    clearLane: {ops: ["clear"], call: (_, lane) => PulseGridActions.clearLane(lane)},
    shiftLane: {ops: ["rotate"], call: (_, lane) => PulseGridActions.shiftLane(lane, -1)},
    setLaneSound: {ops: ["setLaneSound"], call: (_, lane) => PulseGridActions.setLaneSound(lane, sample)},
    addDrumLane: {ops: ["addLane"], call: doc => PulseGridActions.addDrumLane(doc, cowbell)},
    loadKit: {ops: ["setLaneSound"], call: doc => PulseGridActions.loadKit(doc, PulseGridKits.All[1])},
    loadBeat: {ops: ["setSetting", "setPatternLength", "setPatternText", "clear"],
        call: doc => PulseGridActions.loadBeat(doc, PulseGridKits.Beats[0])}
}

describe("PulseGridActions", () => {
    it("lists every action the namespace exports", () => {
        expect(Object.keys(cases).sort()).toEqual(Object.keys(PulseGridActions).sort())
    })

    it.each(Object.entries(cases))("%s sends only its ops and they all apply", (_name, {ops, call}) => {
        const f = fixture()
        const sent = call(f.read(), f.lane("Kick").id)
        expect(sent.length).toBeGreaterThan(0)
        expect(Array.from(new Set(sent.map(op => op.op))).sort()).toEqual(Array.from(new Set(ops)).sort())
        f.ok(sent)
    })

    it("toggles a step on and off and sets its values", () => {
        const f = fixture()
        const kick = f.lane("Kick").id
        f.ok(PulseGridActions.setStep(kick, 1, true))
        f.ok(PulseGridActions.setStep(kick, 5, true))
        f.ok(PulseGridActions.setStepValues(kick, 5, {velocity: 42, chance: 50, accent: true}))
        expect(PulseGridView.steps(f.read(), f.lane("Kick")).steps[4]).toEqual({velocity: 42, chance: 50, accent: true, notes: 1})
        f.ok(PulseGridActions.setStep(kick, 1, false))
        const view = PulseGridView.steps(f.read(), f.lane("Kick"))
        expect(view.length).toBe(16)
        expect(view.own).toBe(false)
        expect(view.steps.map(step => step !== undefined)).toEqual([
            false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false])
    })

    it("makes a new variation from what plays, until all four are used", () => {
        const f = fixture()
        f.ok(PulseGridActions.setStep(f.lane("Kick").id, 1, true))
        expect(PulseGridView.usedVariations(f.read())).toEqual(["A"])
        f.ok([...PulseGridActions.pickScene(2), ...PulseGridActions.pickVariation("C")])
        expect(PulseGridView.usedVariations(f.read())).toEqual(["A", "C"])
        f.ok([...PulseGridActions.pickScene(1), ...PulseGridActions.pickVariation("A")])
        f.ok(PulseGridActions.newVariation(f.read()))
        expect(f.read().variation).toBe("B")
        expect(f.line("Kick")).toBe("Kick |x--- ---- ---- ----|")
        f.ok(PulseGridActions.newVariation(f.read()))
        f.ok(PulseGridActions.newVariation(f.read()))
        expect(PulseGridView.usedVariations(f.read())).toEqual(["A", "B", "C", "D"])
        expect(PulseGridView.freeVariation(f.read())).toBeUndefined()
        expect(PulseGridActions.newVariation(f.read())).toEqual([])
    })

    it("adds a drum lane under the last drum lane, named after the sample", () => {
        const f = fixture()
        f.ok(PulseGridActions.addDrumLane(f.read(), cowbell))
        f.ok(PulseGridActions.addDrumLane(f.read(), cowbell))
        expect(f.read().lanes.map(lane => lane.name)).toEqual([
            "Kick", "Snare", "Clap", "Hat", "Perc", "Cowbell", "Cowbell 2", "Synth", "Marimba"])
        expect(f.lane("Cowbell").sound?.sample?.uuid).toBe(cowbell.uuid)
        expect(f.lane("Cowbell").kind).toBe("drum")
    })

    it("follows a lane's own length and the song position", () => {
        const f = fixture()
        const hat = f.lane("Hat").id
        f.ok([{op: "setPatternLength", lane: hat, length: 6}, ...PulseGridActions.setStep(hat, 6, true)])
        const view = PulseGridView.steps(f.read(), f.lane("Hat"))
        expect([view.length, view.own, view.steps.length]).toEqual([6, true, 6])
        expect(PulseGridView.playingStep(0, 16)).toBe(0)
        expect(PulseGridView.playingStep(239, 16)).toBe(0)
        expect(PulseGridView.playingStep(240 * 17, 16)).toBe(1)
        expect(PulseGridView.playingStep(240 * 7, 6)).toBe(1)
    })
})

describe("PulseGridKits", () => {
    it("holds kits with five real samples each and beats of 16 cells", () => {
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        expect(new Set(PulseGridKits.All.map(kit => kit.id)).size).toBe(PulseGridKits.All.length)
        for (const kit of PulseGridKits.All) {
            expect(Object.keys(kit.sounds)).toEqual(["Kick", "Snare", "Clap", "Hat", "Perc"])
            for (const sound of Object.values(kit.sounds)) {
                expect(sound.uuid).toMatch(uuid)
                expect(sound.name.length).toBeGreaterThan(0)
                expect(sound.duration).toBeGreaterThan(0)
            }
        }
        for (const beat of PulseGridKits.Beats) {
            for (const cells of Object.values(beat.lines)) {expect(cells).toMatch(/^[-xX1-9]{16}$/)}
        }
    })

    it("gives each drum its sound by lane name, wherever the lane sits, and leaves the rest alone", () => {
        const f = fixture()
        const kit = PulseGridKits.All[1]
        f.ok([
            {op: "setLane", lane: "Hat", name: "Hi-Hat"}, {op: "moveLane", lane: "Hi-Hat", to: 1},
            {op: "setStep", lane: "Kick", step: 1}, {op: "removeLane", lane: "Clap"}
        ])
        f.ok(PulseGridActions.loadKit(f.read(), kit))
        expect(f.lane("Hi-Hat").sound?.sample).toEqual({uuid: kit.sounds.Hat.uuid, name: kit.sounds.Hat.name})
        expect(f.lane("Kick").sound?.sample?.uuid).toBe(kit.sounds.Kick.uuid)
        expect(f.lane("Snare").sound?.sample?.uuid).toBe(kit.sounds.Snare.uuid)
        expect(f.lane("Perc").sound?.sample?.uuid).toBe(kit.sounds.Perc.uuid)
        expect(f.read().lanes.map(lane => lane.name)).toEqual(["Hi-Hat", "Kick", "Snare", "Perc", "Synth", "Marimba"])
        expect(f.lane("Marimba").sound?.instrument).toBe("Tubular")
        expect(f.line("Kick")).toBe("Kick |x--- ---- ---- ----|")
    })

    it("still knows a renamed lane by what it plays, and leaves a drum that is none of the five alone", () => {
        const f = fixture()
        const tom = {uuid: "0d345936-3a4b-4542-b710-278bde1e101e", name: "TR-808 Low Tom", duration: 1}
        f.ok([{op: "setLane", lane: "Kick", name: "Boom"}, {op: "setLane", lane: "Hat", name: "Tick"}])
        f.ok(PulseGridActions.addDrumLane(f.read(), tom))
        const kit = PulseGridKits.All[1]
        f.ok(PulseGridActions.loadKit(f.read(), kit))
        expect(f.lane("Boom").sound?.sample?.uuid).toBe(kit.sounds.Kick.uuid)
        expect(f.lane("Tick").sound?.sample?.uuid).toBe(kit.sounds.Hat.uuid)
        expect(f.lane("Low Tom").sound?.sample?.uuid).toBe(tom.uuid)
        f.ok(PulseGridActions.loadKit(f.read(), PulseGridKits.All[4]))
        expect(f.lane("Boom").sound?.sample?.uuid).toBe(PulseGridKits.All[4].sounds.Kick.uuid)
    })

    it("falls back to the order of the drum lanes when none has a drum's name", () => {
        const f = fixture()
        const silent = {uuid: "7d4a36ea-c0bb-429f-b85b-b9220988f5a2", name: "Texture 01", duration: 3}
        f.ok(["Kick", "Snare", "Clap", "Hat", "Perc"].flatMap((name, index): Array<PulseGridOp> => [
            {op: "setLane", lane: name, name: `Lane ${index + 1}`},
            {op: "setLaneSound", lane: `Lane ${index + 1}`, sound: PulseGridKits.sound({...silent, uuid: silent.uuid.slice(0, -1) + index})}
        ]))
        const kit = PulseGridKits.All[2]
        f.ok(PulseGridActions.loadKit(f.read(), kit))
        expect(f.lane("Lane 1").sound?.sample?.uuid).toBe(kit.sounds.Kick.uuid)
        expect(f.lane("Lane 5").sound?.sample?.uuid).toBe(kit.sounds.Perc.uuid)
    })

    it("writes a beat into what plays, clears the drums it does not use and sets its swing", () => {
        const f = fixture()
        f.ok([{op: "setStep", lane: "Snare", step: 3}, {op: "setStep", lane: "Marimba", step: 1}])
        const beat = PulseGridKits.Beats.find(beat => beat.id === "four-on-the-floor")!
        f.ok(PulseGridActions.loadBeat(f.read(), beat))
        expect(f.line("Kick")).toBe("Kick |x--- x--- x--- x---|")
        expect(f.line("Clap")).toBe("Clap |---- x--- ---- x---|")
        expect(f.line("Snare")).toBeUndefined()
        expect(f.lane("Marimba").patterns[0].notes.length).toBe(1)
        expect(f.read().settings.swing).toBe(50)
        f.ok(PulseGridActions.loadBeat(f.read(), PulseGridKits.Beats.find(beat => beat.id === "boom-bap")!))
        expect(f.read().settings.swing).toBe(58)
        expect(f.line("Hat")).toBe("Hat |x-5- x-5- x-5- x-5-|")
    })

    it("keeps a beat at 16 steps under another pattern length", () => {
        const f = fixture()
        f.ok(PulseGridActions.setLength(32))
        f.ok(PulseGridActions.loadBeat(f.read(), PulseGridKits.Beats[0]))
        expect(PulseGridView.steps(f.read(), f.lane("Kick"))).toMatchObject({length: 16, own: true})
        expect(f.line("Kick/16")).toBe("Kick/16 |x--- x--- x--- x---|")
        f.ok(PulseGridActions.setLength(16))
        f.ok(PulseGridActions.loadBeat(f.read(), PulseGridKits.Beats[0]))
        expect(PulseGridView.steps(f.read(), f.lane("Kick"))).toMatchObject({length: 16, own: false})
    })

    it.each(PulseGridKits.All.map(kit => [kit.name, kit] as const))("loads the kit %s", (_name, kit) => {
        const f = fixture()
        f.ok(PulseGridActions.loadKit(f.read(), kit))
        expect(f.lane("Kick").sound).toEqual({
            instrument: "Nano", label: kit.sounds.Kick.name, sample: {uuid: kit.sounds.Kick.uuid, name: kit.sounds.Kick.name}
        })
    })

    it.each(PulseGridKits.Beats.map(beat => [beat.name, beat] as const))("loads the beat %s", (_name, beat) => {
        const f = fixture()
        f.ok(PulseGridActions.loadBeat(f.read(), beat))
    })
})
