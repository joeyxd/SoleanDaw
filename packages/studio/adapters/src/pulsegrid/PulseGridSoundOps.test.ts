import {describe, expect, it} from "vitest"
import {BoxGraph, IndexedBox} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {
    AudioUnitBox, CrusherDeviceBox, DelayDeviceBox, InstrumentCompositeBox, InstrumentCompositeCellBox, NanoDeviceBox,
    PulseGridBox, PulseGridLaneDeviceBox, TubularDeviceBox, VaporisateurDeviceBox
} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {PulseGridDevice} from "./PulseGridDevice"
import {PulseGridDocs} from "./PulseGridDocs"
import {PulseGridOps} from "./PulseGridOps"
import {PulseGridText} from "./PulseGridText"
import {PulseGridEffectMaker, PulseGridOp, PulseGridOpResult} from "./PulseGridTypes"

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
    const run = (env: {effects?: PulseGridEffectMaker}, ops: ReadonlyArray<PulseGridOp>) => {
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
            .toMatchObject({unit: "%", min: 0, max: 1})
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
        expect(lines[1]).toBe("1 kick  fx 1 Crusher  off  crush 0%  bits 16bits  boost 0dB  mix 1%")
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
        expect(lines[at + 2]).toBe("  1 kick  fx 1 Crusher  crush 0%  bits 8bits  boost 0dB  mix 1%")
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
