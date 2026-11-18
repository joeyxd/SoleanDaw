import {describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {AudioUnitBox} from "@opendaw/studio-boxes"
import {IconSymbol} from "@opendaw/studio-enums"
import {
    InstrumentFactories, ProjectSkeleton, PulseGridDevice, PulseGridDocs, PulseGridOps
} from "@opendaw/studio-adapters"
import {PulseGridEffects} from "./PulseGridEffects"

describe("PulseGridEffects", () => {
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
        const chain = () => PulseGridDocs.read(PulseGridDevice.find(composite).unwrap()).lanes[0].chain
        const apply = (...ops: Parameters<typeof PulseGridOps.apply>[1]) => {
            graph.beginTransaction()
            try {return PulseGridOps.apply(composite, ops, {effects: PulseGridEffects.maker(graph)})} finally {
                graph.endTransaction()
            }
        }
        return {graph, chain, apply}
    }

    it("names effects, each with a factory for the screen", () => {
        const {names} = PulseGridEffects.maker(fixture().graph)
        expect(names.length).toBeGreaterThan(10)
        expect(new Set(names).size).toBe(names.length)
        names.forEach(name => expect(PulseGridEffects.factoryOf(name), name).toBeDefined())
    })

    it("adds every named effect to a lane through the ops, and the doc's chain shows it by that name", () => {
        const f = fixture()
        const {names} = PulseGridEffects.maker(f.graph)
        names.forEach((name, index) => {
            const [result] = f.apply({op: "addEffect", lane: 1, effect: name})
            expect(result, name).toMatchObject({ok: true, op: "addEffect"})
            const chain = f.chain()
            expect(chain.length, name).toBe(index + 1)
            expect(chain[index], name).toMatchObject({index: index + 1, name, enabled: true})
            expect(Array.isArray(chain[index].params), name).toBe(true)
        })
        expect(f.chain().map(effect => effect.name)).toEqual(names)
    })

    it("adds at the front so the others move down, and removes one closing the gap", () => {
        const f = fixture()
        const [first, second] = PulseGridEffects.maker(f.graph).names
        expect(f.apply({op: "addEffect", lane: 1, effect: first}, {op: "addEffect", lane: 1, effect: second, at: 1})
            .map(result => result.ok)).toEqual([true, true])
        expect(f.chain().map(effect => effect.name)).toEqual([second, first])
        expect(f.apply({op: "removeEffect", lane: 1, effect: 1})[0].ok).toBe(true)
        expect(f.chain().map(effect => `${effect.index}:${effect.name}`)).toEqual([`1:${first}`])
    })

    it("refuses a name the maker does not have, listing the names", () => {
        const f = fixture()
        const [result] = f.apply({op: "addEffect", lane: 1, effect: "Wclap"})
        expect(result.ok).toBe(false)
        expect(result.ok ? "" : result.error).toContain(PulseGridEffects.maker(f.graph).names[0])
        expect(f.chain()).toEqual([])
    })
})
