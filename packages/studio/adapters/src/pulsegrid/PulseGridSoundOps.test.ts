import {describe, expect, it} from "vitest"
import {readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {BoxGraph, IndexedBox} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {
    AudioUnitBox, CrusherDeviceBox, DelayDeviceBox, InstrumentCompositeBox, InstrumentCompositeCellBox, NanoDeviceBox,
    PulseGridBox, PulseGridLaneDeviceBox, TubularDeviceBox, VaporisateurDeviceBox
} from "@opendaw/studio-boxes"
import {Dx7Sysex} from "../devices/instruments/Tubular/Dx7Sysex"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {PulseGridCatalog} from "./PulseGridCatalog"
import {PulseGridDevice} from "./PulseGridDevice"
import {PulseGridDocs} from "./PulseGridDocs"
import {PulseGridOps} from "./PulseGridOps"
import {PulseGridText} from "./PulseGridText"
import {PulseGridCartridge, PulseGridEffectMaker, PulseGridOp, PulseGridOpResult, PulseGridOpsEnv} from "./PulseGridTypes"

// The maker of a host, made small: two effects, built the way studio-core's maker builds its own (label, host,
// index through IndexedBox.insertOrder, which shifts the effects after it).
const makerFor = (graph: BoxGraph): PulseGridEffectMaker => ({
    names: ["Crusher", "Delay"],
    create: (name, host, index) => {
        const make = (box: CrusherDeviceBox | DelayDeviceBox) => {
            box.label.setValue(name)
            box.index.setValue(IndexedBox.insertOrder(host, index))
            box.host.refer(host)
        }
        if (name === "Crusher") {CrusherDeviceBox.create(graph, UUID.generate(), make)} else {
            DelayDeviceBox.create(graph, UUID.generate(), make)
        }
    }
})

// Lane 1 "kick" has a Nano, lane 2 "bare" has no instrument.
const fixture = () => {
    const {boxGraph: graph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} =
        ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    graph.beginTransaction()
    const unit = AudioUnitBox.create(graph, UUID.generate(), box => {
        box.collection.refer(rootBox.audioUnits)
        box.output.refer(primaryAudioBusBox.input)
        box.index.setValue(1)
    })
    const composite = InstrumentCompositeBox.create(graph, UUID.generate(), box => box.host.refer(unit.input))
    const head = PulseGridBox.create(graph, UUID.generate())
    const cells = [0, 1].map(index => InstrumentCompositeCellBox.create(graph, UUID.generate(), box => {
        box.composite.refer(composite.cells)
        box.index.setValue(index)
    }))
    cells.forEach((cell, index) => PulseGridLaneDeviceBox.create(graph, UUID.generate(), box => {
        box.host.refer(cell.midiEffects)
        box.grid.refer(head)
        box.index.setValue(0)
        box.label.setValue(["kick", "bare"][index])
    }))
    const nano = NanoDeviceBox.create(graph, UUID.generate(), box => {
        box.host.refer(cells[0].instrument)
        box.label.setValue("Kick")
    })
    graph.endTransaction()
    const read = () => PulseGridDocs.read(PulseGridDevice.find(composite).unwrap())
    const run = (env: PulseGridOpsEnv, ops: ReadonlyArray<PulseGridOp>) => {
        graph.beginTransaction()
        try {return PulseGridOps.apply(composite, ops, env)} finally {graph.endTransaction()}
    }
    const apply = (...ops: ReadonlyArray<PulseGridOp>) => run({effects: makerFor(graph)}, ops)
    const ok = (...ops: ReadonlyArray<PulseGridOp>) => {
        const results = apply(...ops)
        expect(results.filter(result => !result.ok)).toEqual([])
    }
    const chain = () => read().lanes[0].chain.map(effect => `${effect.index}:${effect.name}`)
    const indexes = () => cells[0].audioEffects.pointerHub.incoming()
        .map(({box}) => (box as CrusherDeviceBox).index.getValue()).sort()
    return {graph, composite, cells, nano, read, run, apply, ok, chain, indexes}
}
const refused = (result: PulseGridOpResult): string => result.ok ? "" : result.error
const linesOf = (result: PulseGridOpResult): ReadonlyArray<string> => result.ok ? result.lines : []

describe("PulseGrid sounds: parameters", () => {
    it("lists the parameters of a Nano in field-key order, with ranges and units, and no deprecated field", () => {
        const f = fixture()
        const params = f.read().lanes[0].sound!.params
        const names = params.map(param => param.name)
        expect(names.slice(0, 6)).toEqual(["volume", "octave", "tune", "rootKey", "release", "attack"])
        expect(names).not.toContain("enabled")
        expect(names).not.toContain("minimized")
        expect(params[0]).toEqual({name: "volume", type: "float", value: -3, unit: "dB"})
        expect(params[1]).toEqual({name: "octave", type: "int", value: 0, unit: "oct", min: -3, max: 3})
        expect(params[2]).toEqual({name: "tune", type: "float", value: 0, unit: "ct", min: -1200, max: 1200})
        expect(params.find(param => param.name === "attack")).toEqual(
            {name: "attack", type: "float", value: 0.003, unit: "s", min: 0.001, max: 5})
        expect(params.find(param => param.name === "loop")).toEqual({name: "loop", type: "bool", value: false, unit: ""})
        expect(f.read().lanes[1].sound).toBeNull()
        expect(f.read().lanes[1].chain).toEqual([])
    })

    it("does not list the deprecated volume and tune of a Vaporisateur, and reads a Tubular's units", () => {
        const f = fixture()
        // Boxes read inside an open transaction: they have no host, so it is never ended.
        f.graph.beginTransaction()
        const vaporisateur = VaporisateurDeviceBox.create(f.graph, UUID.generate())
        const tubular = TubularDeviceBox.create(f.graph, UUID.generate())
        const names = PulseGridDocs.paramsOf(vaporisateur).map(param => param.name)
        expect(names).toContain("cutoff")
        expect(names).not.toContain("volume")
        expect(names).not.toContain("tune")
        expect(PulseGridDocs.paramsOf(tubular).find(param => param.name === "tune"))
            .toEqual({name: "tune", type: "float", value: 0, unit: "ct", min: -100, max: 100})
        expect(PulseGridDocs.paramsOf(tubular).find(param => param.name === "cutoff"))
            .toMatchObject({unit: "%", min: 0, max: 100, value: 100})
    })

    it("writes a float, an int and a bool of the instrument and answers the lane's sounds lines", () => {
        const f = fixture()
        const results = f.apply(
            {op: "setParam", lane: 1, param: "tune", value: 12.5},
            {op: "setParam", lane: "kick", param: "octave", value: 2},
            {op: "setParam", lane: 1, param: "loop", value: true})
        expect(results.map(result => result.ok)).toEqual([true, true, true])
        expect(f.nano.tune.getValue()).toBe(12.5)
        expect(f.nano.octave.getValue()).toBe(2)
        expect(f.nano.loop.getValue()).toBe(true)
        expect(linesOf(results[2])).toEqual(PulseGridText.formatSounds(f.read().lanes[0]))
        expect(linesOf(results[2])[0]).toContain("tune 12.5ct  root-key 60")
        expect(linesOf(results[2])[0]).toContain("loop on")
    })

    it("finds a parameter by its written name too (root-key)", () => {
        const f = fixture()
        f.ok({op: "setParam", lane: 1, param: "root-key", value: 48})
        expect(f.nano.rootKey.getValue()).toBe(48)
    })

    it("writes a parameter of an effect", () => {
        const f = fixture()
        f.ok({op: "addEffect", lane: 1, effect: "Crusher"},
            {op: "setParam", lane: 1, effect: 1, param: "bits", value: 8},
            {op: "setParam", lane: 1, effect: 1, param: "boost", value: 6})
        const crusher = f.read().lanes[0].chain[0]
        expect(crusher.params.find(param => param.name === "bits")!.value).toBe(8)
        expect(crusher.params.find(param => param.name === "boost")!.value).toBe(6)
    })

    it("gives and takes a fraction stored with the unit % as a percent", () => {
        const f = fixture()
        f.ok({op: "addEffect", lane: 1, effect: "Crusher"},
            {op: "setParam", lane: 1, effect: 1, param: "mix", value: 50})
        const mix = f.read().lanes[0].chain[0].params.find(param => param.name === "mix")!
        expect(mix).toMatchObject({value: 50, unit: "%", min: 0, max: 100})
        const refused = f.apply({op: "setParam", lane: 1, effect: 1, param: "mix", value: 150})
        expect(refused.at(-1)).toMatchObject({ok: false})
        expect(JSON.stringify(refused.at(-1))).toContain("0..100%")
    })

    it("refuses a value outside the range and says the range, writing nothing", () => {
        const f = fixture()
        f.ok({op: "addEffect", lane: 1, effect: "Crusher"})
        const [tune, octave, bits, text, bool] = [
            f.apply({op: "setParam", lane: 1, param: "tune", value: 5000}),
            f.apply({op: "setParam", lane: 1, param: "octave", value: 1.5}),
            f.apply({op: "setParam", lane: 1, effect: 1, param: "bits", value: 17}),
            f.apply({op: "setParam", lane: 1, param: "tune", value: "loud" as unknown as number}),
            f.apply({op: "setParam", lane: 1, param: "loop", value: 1 as unknown as boolean})
        ].map(results => refused(results[0]))
        expect(tune).toContain("-1200..1200")
        expect(tune).toContain("5000")
        expect(octave).toContain("an integer")
        expect(octave).toContain("-3..3")
        expect(bits).toContain("1..16")
        expect(text).toContain("a number")
        expect(bool).toContain("true or false")
        expect(f.nano.tune.getValue()).toBe(0)
        expect(f.nano.octave.getValue()).toBe(0)
    })

    it("refuses an unknown parameter and lists the ones the device has", () => {
        const f = fixture()
        const message = refused(f.apply({op: "setParam", lane: 1, param: "cutoff", value: 1})[0])
        expect(message).toContain("cutoff")
        expect(message).toContain("Nano")
        expect(message).toContain("allowed parameters: volume, octave, tune, rootKey, release, attack")
    })

    it("refuses a lane without an instrument, and an effect that does not exist", () => {
        const f = fixture()
        expect(refused(f.apply({op: "setParam", lane: "bare", param: "tune", value: 0})[0])).toContain("has no instrument")
        expect(refused(f.apply({op: "setParam", lane: 1, effect: 1, param: "bits", value: 8})[0])).toContain("has no effects")
        f.ok({op: "addEffect", lane: 1, effect: "Crusher"})
        expect(refused(f.apply({op: "setParam", lane: 1, effect: 2, param: "bits", value: 8})[0])).toContain("1..1")
    })
})

describe("PulseGrid sounds: the effect chain", () => {
    it("adds an effect at the end, and at 1 so the others move down", () => {
        const f = fixture()
        f.ok({op: "addEffect", lane: 1, effect: "Crusher"}, {op: "addEffect", lane: 1, effect: "Delay"})
        expect(f.chain()).toEqual(["1:Crusher", "2:Delay"])
        f.ok({op: "addEffect", lane: 1, effect: "Delay", at: 1})
        expect(f.chain()).toEqual(["1:Delay", "2:Crusher", "3:Delay"])
        expect(f.indexes()).toEqual([0, 1, 2])
        expect(f.read().lanes[0].effects).toEqual(["Delay", "Crusher", "Delay"])
        expect(f.read().lanes[1].chain).toEqual([])
    })

    it("refuses an unknown name listing the names, a bad position, and a host without a maker", () => {
        const f = fixture()
        const unknown = refused(f.apply({op: "addEffect", lane: 1, effect: "Flanger"})[0])
        expect(unknown).toContain("Flanger")
        expect(unknown).toContain("Crusher, Delay")
        expect(refused(f.apply({op: "addEffect", lane: 1, effect: "Delay", at: 3})[0])).toContain("1..1")
        const none = f.run({}, [{op: "addEffect", lane: 1, effect: "Delay"}])[0]
        expect(refused(none)).toContain("no effect maker")
        expect(f.chain()).toEqual([])
    })

    it("removes an effect with its box and closes the gap", () => {
        const f = fixture()
        f.ok({op: "addEffect", lane: 1, effect: "Crusher"}, {op: "addEffect", lane: 1, effect: "Delay"},
            {op: "addEffect", lane: 1, effect: "Crusher"})
        const removed = f.cells[0].audioEffects.pointerHub.incoming().map(({box}) => box)
            .find(box => (box as CrusherDeviceBox).index.getValue() === 0)!
        f.ok({op: "removeEffect", lane: 1, effect: 1})
        expect(f.chain()).toEqual(["1:Delay", "2:Crusher"])
        expect(f.indexes()).toEqual([0, 1])
        expect(f.graph.findBox(removed.address.uuid).isEmpty()).toBe(true)
        expect(refused(f.apply({op: "removeEffect", lane: 1, effect: 3})[0])).toContain("1..2")
    })

    it("switches an effect on and off, and moves it keeping the order of the others", () => {
        const f = fixture()
        f.ok({op: "addEffect", lane: 1, effect: "Crusher"}, {op: "addEffect", lane: 1, effect: "Delay"},
            {op: "addEffect", lane: 1, effect: "Crusher"})
        f.ok({op: "setEffect", lane: 1, effect: 2, enabled: false})
        expect(f.read().lanes[0].chain.map(effect => effect.enabled)).toEqual([true, false, true])
        f.ok({op: "setEffect", lane: 1, effect: 1, to: 3})
        expect(f.chain()).toEqual(["1:Delay", "2:Crusher", "3:Crusher"])
        expect(f.read().lanes[0].chain[0].enabled).toBe(false)
        f.ok({op: "setEffect", lane: 1, effect: 3, to: 1, enabled: true})
        expect(f.chain()).toEqual(["1:Crusher", "2:Delay", "3:Crusher"])
        expect(f.indexes()).toEqual([0, 1, 2])
        const before = f.chain()
        f.ok({op: "setEffect", lane: 1, effect: 2, to: 2})
        expect(f.chain()).toEqual(before)
        expect(refused(f.apply({op: "setEffect", lane: 1, effect: 2})[0])).toContain("enabled or to")
        expect(refused(f.apply({op: "setEffect", lane: 1, effect: 2, to: 4})[0])).toContain("1..3")
    })

    it("answers the sounds lines of the lane", () => {
        const f = fixture()
        const results = f.apply({op: "addEffect", lane: 1, effect: "Crusher"},
            {op: "setEffect", lane: 1, effect: 1, enabled: false})
        const lines = linesOf(results[1])
        expect(lines).toHaveLength(2)
        expect(lines[0].startsWith("1 kick  Nano  volume -3dB  octave 0oct  tune 0ct  root-key 60  release 0.1s")).toBe(true)
        expect(lines[1]).toBe("1 kick  fx 1 Crusher  off  crush 0%  bits 16bits  boost 0dB  mix 100%")
    })
})

describe("PulseGrid sounds: text", () => {
    it("writes the sounds block after the lanes, one effect line each, and parseText skips it", () => {
        const f = fixture()
        f.ok({op: "addEffect", lane: 1, effect: "Crusher"}, {op: "setParam", lane: 1, effect: 1, param: "bits", value: 8})
        const text = PulseGridText.toText(f.read())
        const lines = text.split("\n")
        const at = lines.indexOf("sounds")
        expect(at).toBeGreaterThan(lines.indexOf("lanes"))
        expect(lines[at + 1]).toMatch(/^ {2}1 kick {2}Nano {2}volume -3dB {2}octave 0oct {2}tune 0ct {2}root-key 60 {2}/)
        expect(lines[at + 2]).toBe("  1 kick  fx 1 Crusher  crush 0%  bits 8bits  boost 0dB  mix 100%")
        expect(lines[at + 3]).toBe("scene 1 A")
        const parsed = PulseGridText.parseText(text)
        expect(parsed.errors).toEqual([])
        expect(parsed.ops.some(op => op.op === "setParam" || op.op === "addEffect")).toBe(false)
        expect(PulseGridText.parseText(text.replace("sounds", "sounds\n  anything at all")).errors).toEqual([])
    })

    it("writes numbers with at most 3 decimals, never -0, and booleans as on and off", () => {
        const f = fixture()
        f.ok({op: "setParam", lane: 1, param: "tune", value: 0.123456},
            {op: "setParam", lane: 1, param: "volume", value: -0.0001},
            {op: "setParam", lane: 1, param: "loop", value: true})
        const line = PulseGridText.formatSounds(f.read().lanes[0])[0]
        expect(line).toContain("tune 0.123ct")
        expect(line).toContain("volume 0dB")
        expect(line).not.toContain("-0")
        expect(line).toContain("loop on")
    })

    it("has no sounds block when no lane has a sound or an effect", () => {
        const f = fixture()
        f.graph.beginTransaction()
        f.nano.delete()
        f.graph.endTransaction()
        expect(PulseGridText.toText(f.read())).not.toContain("sounds")
    })
})

// Two real cartridges of the app: the Tubular Classics and SynprezFM 24 (the home of Xylophone3).
const book: ReadonlyArray<PulseGridCartridge> = ["Tubular Classics", "SynprezFM 24"].map(name => {
    const root = fileURLToPath(new URL("../../../../app/studio/public/tubular/cartridges/", import.meta.url))
    const file = name === "Tubular Classics" ? "Tubular_Classics.syx" : "SynprezFM_24.syx"
    return {name, voices: Dx7Sysex.decode(new Uint8Array(readFileSync(root + file)))}
})

describe("PulseGrid sounds: Tubular voices by name", () => {
    const byName = (item: string, cartridge?: string) => ({
        instrument: "Tubular", voice: cartridge === undefined ? {name: item} : {name: item, cartridge}
    } as const)
    const done = (f: ReturnType<typeof fixture>, ...ops: ReadonlyArray<PulseGridOp>) => {
        const results = f.run({voices: () => book}, ops)
        expect(results.filter(result => !result.ok)).toEqual([])
        expect(results.length).toBe(ops.length)
    }
    const picked = (name: string) => PulseGridCatalog.sound(PulseGridCatalog.items(undefined, book).find(item => item.name === name)!)

    it("setLaneSound builds the lane the browser builds, for a shown name and for a name with its cartridge", () => {
        for (const [asked, shown, cartridge] of [["Vibraphone", "Vibraphone"], ["Vibes", "Vibraphone"],
            ["xylophone3", "Xylophone", "SynprezFM 24"], ["Xylophone", "Xylophone", "SynprezFM 24"]] as const) {
            const f = fixture()
            done(f, {op: "setLaneSound", lane: 1, sound: byName(asked, cartridge)})
            const named = f.read().lanes[0].sound
            done(f, {op: "setLaneSound", lane: 1, sound: picked(shown)})
            expect(named?.instrument).toBe("Tubular")
            expect(named?.label).toBe(shown)
            expect(named).toEqual(f.read().lanes[0].sound)
        }
        const f = fixture()
        done(f, {op: "setLaneSound", lane: 1, sound: byName("Vibraphone")})
        const init = fixture()
        done(init, {op: "setLaneSound", lane: 1, sound: {instrument: "Tubular"}})
        expect(f.read().lanes[0].sound?.params).not.toEqual(init.read().lanes[0].sound?.params)
    })

    it("addLane does the same, a label of the input wins, and a stored name keeps its name as the label", () => {
        const f = fixture()
        done(f, {op: "addLane", name: "Mallet", kind: "melodic", sound: byName("Marimba")},
            {op: "addLane", name: "Mallet 2", kind: "melodic", sound: picked("Marimba")},
            {op: "addLane", name: "Own", kind: "melodic", sound: {...byName("Rhodes"), label: "Mine"}},
            {op: "addLane", name: "Stored", kind: "melodic", sound: byName("Rhodes")})
        const lanes = f.read().lanes
        expect(lanes.length).toBe(6)
        expect(lanes[2].sound).toEqual(lanes[3].sound)
        expect(lanes[4].sound?.label).toBe("Mine")
        expect(lanes[5].sound?.label).toBe("Rhodes")
        expect(lanes[5].sound?.params).toEqual(lanes[4].sound?.params)
    })

    it("works as before for a voice with a patch, without a voice book in the env", () => {
        const f = fixture()
        const {voice} = picked("Marimba") as unknown as {voice: {name: string, patch: Array<number>}}
        let asked = 0
        const results = f.run({voices: () => {asked++; return []}}, [
            {op: "setLaneSound", lane: 1, sound: {instrument: "Tubular", voice, label: "Direct"}}])
        expect(results.map(result => result.ok)).toEqual([true])
        expect(asked).toBe(0)
        expect(f.read().lanes[0].sound?.label).toBe("Direct")
        done(f, {op: "addLane", name: "Plain", kind: "melodic", sound: {instrument: "Tubular", voice}})
        expect(f.read().lanes[2].sound?.label).toBe("Marimba")
    })

    it("refuses with its message and changes nothing: no voice book, an empty book, an unknown voice", () => {
        const f = fixture()
        const before = f.read()
        const refuse = (env: PulseGridOpsEnv, op: PulseGridOp) => {
            const results = f.run(env, [op, {op: "setLane", lane: 1, name: "Never"}])
            expect(results.length).toBe(1)
            expect(f.read()).toEqual(before)
            return refused(results[0])
        }
        for (const op of [
            {op: "setLaneSound", lane: 1, sound: byName("Vibraphone")},
            {op: "addLane", name: "New", kind: "melodic", sound: byName("Vibraphone")}] as ReadonlyArray<PulseGridOp>) {
            expect(refuse({}, op)).toBe("this host has no Tubular voices by name; send the voice with its patch")
            expect(refuse({voices: () => []}, op)).toBe("the Tubular voices are not loaded yet; send the request again")
        }
        expect(refuse({voices: () => book}, {op: "setLaneSound", lane: 1, sound: byName("Vibrafone")}))
            .toBe("voice Vibrafone is not known")
        expect(refuse({voices: () => book}, {op: "addLane", name: "New", kind: "melodic", sound: byName("Marimba", "Nowhere")}))
            .toBe("voice Marimba is not known; names that hold a word of it: Marimba")
        const lead = "voice Big Bass is not known; names that hold a word of it: "
        const message = refuse({voices: () => book}, {op: "setLaneSound", lane: 1, sound: byName("Big Bass")})
        expect(message.startsWith(lead)).toBe(true)
        expect(message.slice(lead.length).split(", ").length).toBe(5)
    })

    it("passes any other error on: a book that throws is a bug, not a refusal", () => {
        const f = fixture()
        expect(() => f.run({voices: () => {throw new Error("boom")}}, [
            {op: "setLaneSound", lane: 1, sound: byName("Vibraphone")}])).toThrow("boom")
    })
})
