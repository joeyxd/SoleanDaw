import {describe, expect, it} from "vitest"
import {readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {BoxGraph, IndexedBox} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {AudioUnitBox, CrusherDeviceBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {Dx7Sysex} from "../devices/instruments/Tubular/Dx7Sysex"
import {InstrumentFactories} from "../factories/InstrumentFactories"
import {IconSymbol} from "@opendaw/studio-enums"
import {PulseGridActions, PulseGridView} from "./PulseGridActions"
import {PulseGridCatalog, PulseGridCatalogItem} from "./PulseGridCatalog"
import {PulseGridDevice} from "./PulseGridDevice"
import {PulseGridDocs} from "./PulseGridDocs"
import {PulseGridKits} from "./PulseGridKits"
import {PulseGridOps} from "./PulseGridOps"
import {PulseGridText} from "./PulseGridText"
import {PulseGridDoc, PulseGridEffectMaker, PulseGridNote, PulseGridOp, PulseGridOpName} from "./PulseGridTypes"

// The effect maker of a host, made small: one effect, built the way studio-core's maker builds its own.
const effectMaker = (graph: BoxGraph): PulseGridEffectMaker => ({
    names: ["Crusher"],
    create: (name, host, index) => {
        CrusherDeviceBox.create(graph, UUID.generate(), box => {
            box.label.setValue(name)
            box.index.setValue(IndexedBox.insertOrder(host, index))
            box.host.refer(host)
        })
    }
})

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
        try {return PulseGridOps.apply(composite, ops, {effects: effectMaker(graph)})} finally {graph.endTransaction()}
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
// Catalogue items: a sample of a folder (a drum), the Tubular Classics' Vibes and Bass Drum (melodic, and a drum voice).
const items = PulseGridCatalog.items(
    {name: "One Shots", folders: [{name: "TR-707", samples: [cowbell]}]},
    [{name: "Tubular Classics", voices: Dx7Sysex.decode(new Uint8Array(readFileSync(
        fileURLToPath(new URL("../../../../app/studio/public/tubular/cartridges/Tubular_Classics.syx", import.meta.url)))))}])
const item = (name: string): PulseGridCatalogItem => items.find(item => item.name === name)!

// Every action of the screen, the ops it must send, and one real call. A new action does not compile until it
// is listed here.
// `setup` is applied first, for an action that needs more than a new PulseGrid (two scenes to remove one).
const crusher: PulseGridOp = {op: "addEffect", lane: "Kick", effect: "Crusher"}
type Case = {
    ops: ReadonlyArray<PulseGridOpName>, call: (doc: PulseGridDoc, lane: string) => Array<PulseGridOp>,
    setup?: ReadonlyArray<PulseGridOp>
}
const cases: Record<keyof typeof PulseGridActions, Case> = {
    rename: {ops: ["setSetting"], call: () => PulseGridActions.rename("Night drive")},
    setLength: {ops: ["setSetting"], call: () => PulseGridActions.setLength(32)},
    setSwing: {ops: ["setSetting"], call: () => PulseGridActions.setSwing(58)},
    setGroove: {ops: ["setSetting"], call: () => PulseGridActions.setGroove(40)},
    setProbability: {ops: ["setSetting"], call: () => PulseGridActions.setProbability(75)},
    setHumanize: {ops: ["setSetting"], call: () => PulseGridActions.setHumanize(22)},
    setKey: {ops: ["setSetting"], call: () => PulseGridActions.setKey(6)},
    setScale: {ops: ["setSetting"], call: () => PulseGridActions.setScale(1)},
    setLanePitch: {ops: ["setLane"], call: (_, lane) => PulseGridActions.setLanePitch(lane, 62)},
    paintNote: {ops: ["setNote"], call: (_, lane) => PulseGridActions.paintNote(lane, 1, 60)},
    resizeNote: {ops: ["setNote"], call: (_, lane) => PulseGridActions.resizeNote(lane, 1, 60, 8)},
    eraseNote: {ops: ["removeNote"], call: (_, lane) => PulseGridActions.eraseNote(lane, 1, 60)},
    removeNotes: {ops: ["removeNote"], call: (_, lane) => PulseGridActions.removeNotes(lane, [{step: 1, pitch: 60}])},
    moveNotes: {ops: ["setPattern"], call: (doc, lane) => PulseGridActions.moveNotes(doc, lane, [{step: 1, pitch: 60}], 1, 1)},
    transposeLane: {ops: ["transpose"], call: doc => PulseGridActions.transposeLane(doc.lanes.find(lane => lane.kind === "melodic")!.id, 12)},
    laneToScale: {ops: ["toScale"], call: doc => PulseGridActions.laneToScale(doc.lanes.find(lane => lane.kind === "melodic")!.id)},
    pickScene: {ops: ["setPlaying"], call: () => PulseGridActions.pickScene(3)},
    pickVariation: {ops: ["setPlaying"], call: () => PulseGridActions.pickVariation("C")},
    newVariation: {ops: ["copyVariation", "setPlaying"], call: doc => PulseGridActions.newVariation(doc)},
    renameScene: {ops: ["nameScene"], call: () => PulseGridActions.renameScene(1, "Intro")},
    newScene: {ops: ["newScene", "setPlaying"], call: doc => PulseGridActions.newScene(doc, 1)},
    removeScene: {ops: ["removeScene"], setup: [{op: "newScene"}], call: () => PulseGridActions.removeScene(2)},
    moveScene: {ops: ["moveScene"], setup: [{op: "newScene"}], call: () => PulseGridActions.moveScene(1, 2)},
    addSceneToSong: {ops: ["addToSong"], call: () => PulseGridActions.addSceneToSong(1, "B")},
    setSongMode: {ops: ["setSong"], call: () => PulseGridActions.setSongMode(true)},
    setStep: {ops: ["setStep"], call: (_, lane) => PulseGridActions.setStep(lane, 5, true)},
    setStepValues: {ops: ["setStep"], call: (_, lane) => PulseGridActions.setStepValues(lane, 1, {velocity: 60, accent: true})},
    setMute: {ops: ["setLaneMix"], call: (_, lane) => PulseGridActions.setMute(lane, true)},
    setSolo: {ops: ["setLaneMix"], call: (_, lane) => PulseGridActions.setSolo(lane, true)},
    renameLane: {ops: ["setLane"], call: (_, lane) => PulseGridActions.renameLane(lane, "Boom")},
    moveLane: {ops: ["moveLane"], call: (_, lane) => PulseGridActions.moveLane(lane, 3)},
    removeLane: {ops: ["removeLane"], call: (_, lane) => PulseGridActions.removeLane(lane)},
    clearLane: {ops: ["clear"], call: (_, lane) => PulseGridActions.clearLane(lane)},
    setVolume: {ops: ["setLaneMix"], call: (_, lane) => PulseGridActions.setVolume(lane, -6)},
    setPan: {ops: ["setLaneMix"], call: (_, lane) => PulseGridActions.setPan(lane, 25)},
    setLaneChance: {ops: ["setLane"], call: (_, lane) => PulseGridActions.setLaneChance(lane, 80)},
    setLaneHumanize: {ops: ["setLane"], call: (_, lane) => PulseGridActions.setLaneHumanize(lane, 10)},
    setLaneAccent: {ops: ["setLane"], call: (_, lane) => PulseGridActions.setLaneAccent(lane, false)},
    setParam: {ops: ["setParam"], call: (_, lane) => PulseGridActions.setParam(lane, "volume", -6)},
    addEffect: {ops: ["addEffect"], call: (_, lane) => PulseGridActions.addEffect(lane, "Crusher")},
    removeEffect: {ops: ["removeEffect"], setup: [crusher, crusher], call: (_, lane) => PulseGridActions.removeEffect(lane, 2)},
    switchEffect: {ops: ["setEffect"], setup: [crusher], call: (_, lane) => PulseGridActions.switchEffect(lane, 1, false)},
    moveEffect: {ops: ["setEffect"], setup: [crusher, crusher], call: (_, lane) => PulseGridActions.moveEffect(lane, 1, 2)},
    shiftLane: {ops: ["rotate"], call: (_, lane) => PulseGridActions.shiftLane(lane, -1)},
    setLaneSound: {ops: ["setLaneSound"], call: (_, lane) => PulseGridActions.setLaneSound(lane, sample)},
    addDrumLane: {ops: ["addLane"], call: doc => PulseGridActions.addDrumLane(doc, cowbell)},
    loadSound: {ops: ["setLaneSound"], call: (_, lane) => PulseGridActions.loadSound(lane, item("Vibraphone"))},
    addSoundLane: {ops: ["addLane"], call: doc => PulseGridActions.addSoundLane(doc, item("Vibraphone"))},
    loadKit: {ops: ["setLaneSound"], call: doc => PulseGridActions.loadKit(doc, PulseGridKits.All[1])},
    loadBeat: {ops: ["setSetting", "setPatternLength", "setPatternText", "clear"],
        call: doc => PulseGridActions.loadBeat(doc, PulseGridKits.Beats[0])}
}

describe("PulseGridActions", () => {
    it("lists every action the namespace exports", () => {
        expect(Object.keys(cases).sort()).toEqual(Object.keys(PulseGridActions).sort())
    })

    it.each(Object.entries(cases))("%s sends only its ops and they all apply", (_name, {ops, call, setup}) => {
        const f = fixture()
        if (setup !== undefined) {f.ok(setup)}
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

    it("loads a catalogue item into a lane: a sample into a Nano, a voice into a Tubular", () => {
        const f = fixture()
        f.ok(PulseGridActions.loadSound(f.lane("Kick").id, item("Cowbell")))
        expect(f.lane("Kick").sound).toMatchObject({instrument: "Nano", sample: {uuid: cowbell.uuid}})
        f.ok(PulseGridActions.loadSound(f.lane("Snare").id, item("Vibraphone")))
        expect(f.lane("Snare").sound).toMatchObject({instrument: "Tubular", label: "Vibraphone"})
        expect(f.lane("Snare").name).toBe("Snare")
    })

    it("adds a drum item as a drum lane under the last drum lane, numbered when the name is taken", () => {
        const f = fixture()
        f.ok(PulseGridActions.addSoundLane(f.read(), item("Cowbell")))
        f.ok(PulseGridActions.addSoundLane(f.read(), item("Cowbell")))
        f.ok(PulseGridActions.addSoundLane(f.read(), item("FM Snare")))
        expect(f.read().lanes.map(lane => lane.name)).toEqual([
            "Kick", "Snare", "Clap", "Hat", "Perc", "Cowbell", "Cowbell 2", "FM Snare", "Synth", "Marimba"])
        expect(f.lane("Cowbell").sound?.sample?.uuid).toBe(cowbell.uuid)
        expect(f.lane("FM Snare").sound).toMatchObject({instrument: "Tubular", label: "FM Snare"})
        expect(["Cowbell", "Cowbell 2", "FM Snare"].map(name => [f.lane(name).kind, f.lane(name).group, f.lane(name).hue]))
            .toEqual([["drum", 0, 150], ["drum", 0, 210], ["drum", 0, 265]])
    })

    it("adds a melodic item after the last lane on pitch 60, in the next new-lane hue", () => {
        const f = fixture()
        f.ok(PulseGridActions.addSoundLane(f.read(), item("Vibraphone")))
        f.ok(PulseGridActions.addSoundLane(f.read(), item("Marimba")))
        f.ok(PulseGridActions.addSoundLane(f.read(), item("Vibraphone")))
        const lanes = f.read().lanes
        expect(lanes.map(lane => lane.name)).toEqual([
            "Kick", "Snare", "Clap", "Hat", "Perc", "Synth", "Marimba", "Vibraphone", "Marimba 2", "Vibraphone 2"])
        expect(lanes.slice(7).map(lane => [lane.kind, lane.group, lane.pitch, lane.hue])).toEqual([
            ["melodic", 1, 60, 36], ["melodic", 1, 60, 60], ["melodic", 1, 60, 77]])
        expect(lanes[7].sound).toMatchObject({instrument: "Tubular", label: "Vibraphone"})
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

describe("PulseGrid melody views and gestures", () => {
    const note = (step: number, pitch: number, values: Partial<PulseGridNote> = {}): PulseGridNote =>
        ({step, pitch, ...PulseGridNote.Defaults, ...values})

    it("shows fifteen C major pitches around an empty melodic lane and flags the roots", () => {
        const f = fixture()
        const roll = PulseGridView.roll(f.read(), f.lane("Synth"))
        expect(roll).toMatchObject({length: 16, own: false, notes: []})
        expect(roll.rows.map(row => row.pitch)).toEqual([72, 71, 69, 67, 65, 64, 62, 60, 59, 57, 55, 53, 52, 50, 48])
        expect(roll.rows.filter(row => row.root).map(row => row.pitch)).toEqual([72, 60, 48])
        expect(roll.rows.every(row => row.inScale)).toBe(true)
        expect(roll.rows.find(row => row.pitch === 60)?.name).toBe("C3")
    })

    it("adds an out-of-scale row and widens the roll for far notes", () => {
        const f = fixture()
        f.ok([{op: "setPattern", lane: "Synth", notes: [note(1, 61), note(2, 24), note(3, 96)]}])
        const roll = PulseGridView.roll(f.read(), f.lane("Synth"))
        expect(roll.rows.find(row => row.pitch === 61)).toMatchObject({inScale: false, root: false})
        expect(roll.rows[0].pitch).toBeGreaterThanOrEqual(96)
        expect(roll.rows.at(-1)!.pitch).toBeLessThanOrEqual(24)
        expect(roll.notes.map(note => note.pitch)).toEqual([61, 24, 96])
    })

    it("excludes hidden notes from the roll and its pitch range", () => {
        const f = fixture()
        f.ok([{op: "setPattern", lane: "Synth", notes: [note(1, 60), note(12, 127)]},
            {op: "setPatternLength", lane: "Synth", length: 8}])
        const roll = PulseGridView.roll(f.read(), f.lane("Synth"))
        expect(roll).toMatchObject({length: 8, own: true, notes: [note(1, 60)]})
        expect(roll.rows[0].pitch).toBe(72)
    })

    it.each([[-100, -2], [100, 3]])("stops a drag of %s at the pattern edge", (steps, expected) => {
        const f = fixture()
        f.ok([{op: "setPatternLength", lane: "Synth", length: 8}])
        const picked = [{step: 5, pitch: 64}, {step: 3, pitch: 60}]
        const moved = PulseGridView.moved(f.read(), f.lane("Synth"), picked, steps, 1)
        expect(moved).toEqual({steps: expected, degrees: 1,
            keys: [{step: 5 + expected, pitch: 65}, {step: 3 + expected, pitch: 62}]})
    })

    it.each([[0, -10], [127, 10]])("stops degree dragging at MIDI pitch %s", (pitch, degrees) => {
        const f = fixture()
        expect(PulseGridView.moved(f.read(), f.lane("Synth"), [{step: 1, pitch}], 0, degrees))
            .toEqual({steps: 0, degrees: 0, keys: [{step: 1, pitch}]})
    })

    it("shortens a degree drag for the whole selection at the MIDI boundary", () => {
        const f = fixture()
        expect(PulseGridView.moved(f.read(), f.lane("Synth"), [{step: 2, pitch: 125}, {step: 1, pitch: 60}], 0, 5))
            .toEqual({steps: 0, degrees: 1, keys: [{step: 2, pitch: 127}, {step: 1, pitch: 62}]})
    })

    it("sounds the drum lane pitch instead of the stored pitch", () => {
        const f = fixture()
        f.ok([{op: "setNote", lane: "Kick", note: note(1, 60)}, {op: "setLane", lane: "Kick", pitch: 36}])
        expect(PulseGridView.sounding(f.read(), f.lane("Kick"), 0)).toEqual([36])
    })

    it("sounds a length-eight note for two steps and wraps at the own pattern length", () => {
        const f = fixture()
        f.ok([{op: "setNote", lane: "Synth", note: note(1, 64, {length: 8})},
            {op: "setPatternLength", lane: "Synth", length: 4}])
        for (const position of [0, 240, 479, 960, 1200]) {
            expect(PulseGridView.sounding(f.read(), f.lane("Synth"), position)).toEqual([64])
        }
        expect(PulseGridView.sounding(f.read(), f.lane("Synth"), 480)).toEqual([])
    })

    it.each([[1, 1, false], [2, 0, true], [0, 0, false]] as const)(
        "applies a move (%s, %s), copy %s, preserving every note value", (steps, degrees, copy) => {
            const f = fixture()
            const original = note(1, 60, {velocity: 70, length: 8, chance: 30, offset: -12, repeats: 2, accent: true})
            const obstacle = note(2, 62)
            const other = note(5, 67, {velocity: 45, length: 3, chance: 90, offset: 3, repeats: 1, accent: true})
            f.ok([{op: "setPattern", lane: "Synth", notes: [original, obstacle, other]}])
            const before = f.lane("Synth").patterns[0]
            f.ok(PulseGridActions.moveNotes(f.read(), f.lane("Synth").id, [{step: 1, pitch: 60}], steps, degrees, copy))
            const pattern = f.lane("Synth").patterns[0]
            if (steps === 0 && degrees === 0) {expect(pattern).toEqual(before)}
            else if (copy) {expect(pattern.notes).toEqual([original, obstacle, {...original, step: 3}, other])}
            else {expect(pattern.notes).toEqual([{...original, step: 2, pitch: 62}, other])}
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
            instrument: "Nano", label: kit.sounds.Kick.name, sample: {uuid: kit.sounds.Kick.uuid, name: kit.sounds.Kick.name},
            params: expect.any(Array)
        })
    })

    it.each(PulseGridKits.Beats.map(beat => [beat.name, beat] as const))("loads the beat %s", (_name, beat) => {
        const f = fixture()
        f.ok(PulseGridActions.loadBeat(f.read(), beat))
    })

    describe("scenes and the song", () => {
        it("lists scenes 1 to sceneCount with name, playing and a thumbnail per lane over the effective length", () => {
            const f = fixture()
            const kick = f.lane("Kick").id, hat = f.lane("Hat").id
            f.ok(PulseGridActions.setStep(kick, 1, true))
            f.ok(PulseGridActions.setStep(kick, 5, true))
            f.ok(PulseGridActions.renameScene(1, "Intro"))
            f.ok([...PulseGridActions.newScene(f.read(), 1), {op: "setPattern", lane: hat, notes: [{step: 3}], length: 8}])
            const doc = f.read()
            expect(doc.scene).toBe(2)
            const scenes = PulseGridView.scenes(doc)
            expect(scenes.map(({scene, name, playing, variation}) => ({scene, name, playing, variation})))
                .toEqual([{scene: 1, name: "Intro", playing: false, variation: "A"},
                    {scene: 2, name: "", playing: true, variation: "A"}])
            expect(scenes[0].thumbnail.length).toBe(doc.lanes.length)
            expect(scenes[0].thumbnail[0]).toEqual({hue: doc.lanes[0].hue,
                steps: Array.from({length: 16}, (_, index) => index === 0 || index === 4)})
            expect(scenes[1].thumbnail[0].steps).toEqual(scenes[0].thumbnail[0].steps)
            expect(scenes[1].thumbnail[doc.lanes.findIndex(lane => lane.name === "Hat")].steps)
                .toEqual(Array.from({length: 8}, (_, index) => index === 2))
            expect(scenes[1].thumbnail[2].steps.length).toBe(16)
        })

        it("shows A for a scene that does not play, else the first variation that holds anything", () => {
            const f = fixture()
            const kick = f.lane("Kick").id
            f.ok([{op: "setStep", lane: kick, step: 1, scene: 2, variation: "C"},
                {op: "setStep", lane: kick, step: 2, scene: 3, variation: "A"},
                {op: "setStep", lane: kick, step: 3, scene: 3, variation: "B"}])
            const scenes = PulseGridView.scenes(f.read())
            expect(scenes.map(scene => scene.variation)).toEqual(["A", "C", "A"])
            expect(scenes[1].thumbnail[0].steps.indexOf(true)).toBe(0)
            expect(scenes[2].thumbnail[0].steps.indexOf(true)).toBe(1)
            f.ok(PulseGridActions.pickScene(3))
            f.ok(PulseGridActions.pickVariation("B"))
            expect(PulseGridView.scenes(f.read())[2]).toMatchObject({playing: true, variation: "B"})
        })

        it("gives a new scene its number, copies one when asked, and plays it", () => {
            const f = fixture()
            f.ok(PulseGridActions.setStep(f.lane("Kick").id, 2, true))
            f.ok(PulseGridActions.newScene(f.read()))
            expect(f.read()).toMatchObject({scene: 2, sceneCount: 2})
            expect(f.read().lanes.map(lane => lane.patterns.filter(p => p.scene === 2))).toEqual(f.read().lanes.map(() => []))
            f.ok(PulseGridActions.newScene(f.read(), 1))
            expect(f.read()).toMatchObject({scene: 3, sceneCount: 3})
            expect(f.lane("Kick").patterns.find(p => p.scene === 3)?.notes.map(n => n.step)).toEqual([2])
        })

        it("removes and moves scenes and adds one to the song", () => {
            const f = fixture()
            f.ok(PulseGridActions.newScene(f.read()))
            f.ok(PulseGridActions.newScene(f.read()))
            f.ok(PulseGridActions.moveScene(3, 1))
            expect(f.read().scene).toBe(1)
            f.ok(PulseGridActions.removeScene(1))
            expect(f.read()).toMatchObject({scene: 1, sceneCount: 2})
            f.ok(PulseGridActions.addSceneToSong(2, "B"))
            f.ok(PulseGridActions.setSongMode(true))
            expect(f.read().song).toEqual({on: true, from: 1, entries: [{scene: 2, variation: "B", cycles: 1}]})
        })

        it("refuses a 17th scene by its op, with its message", () => {
            const f = fixture()
            for (let count = 1; count < 16; count++) {f.ok(PulseGridActions.newScene(f.read()))}
            const results = f.apply(PulseGridActions.newScene(f.read()))
            expect(results).toEqual([{ok: false, op: "newScene", error: expect.stringContaining("16")}])
            expect(f.read().sceneCount).toBe(16)
        })

        it("says which scene and variation the song plays at a position", () => {
            const doc: PulseGridDoc = {
                ...fixture().read(),
                song: {on: true, from: 2, entries: [
                    {scene: 1, variation: "A", cycles: 1}, {rest: true, cycles: 0.5}, {scene: 2, variation: "C", cycles: 2}]}
            }
            const cycle = 16 * 240
            const at = (position: number) => PulseGridView.songAt(doc, position)
            expect(at(0)).toBeNull()
            expect(at(239)).toBeNull()
            expect(at(240)).toEqual({scene: 1, variation: "A"})
            expect(at(240 + cycle - 1)).toEqual({scene: 1, variation: "A"})
            expect(at(240 + cycle)).toBeNull()
            expect(at(240 + 1.5 * cycle)).toEqual({scene: 2, variation: "C"})
            expect(at(240 + 3.5 * cycle - 1)).toEqual({scene: 2, variation: "C"})
            expect(at(240 + 3.5 * cycle)).toBeNull()
            expect(PulseGridView.songAt({...doc, song: {on: true, from: 1, entries: []}}, 0)).toBeNull()
        })
    })
})
