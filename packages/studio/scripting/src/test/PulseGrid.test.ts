import {describe, expect, it} from "vitest"
import {createFixture} from "./Fixture"

const beat = "|x--- x--- x--- x---|"

describe("PulseGrid", () => {
    it("makes the default kit on its own unit and track, and reads it in one look", () => {
        const {project} = createFixture()
        const grid = project.addPulseGrid({label: "Beat", volume: -6})
        expect(grid.label).toBe("Beat")
        expect(grid.unit.volume).toBe(-6)
        expect(grid.unit.instrument.key).toBe("InstrumentComposite")
        expect(grid.unit.noteTracks).toHaveLength(1)
        expect(grid.doc.lanes.map(lane => lane.name)).toEqual(["Kick", "Snare", "Clap", "Hat", "Perc", "Synth", "Marimba"])
        expect(project.pulseGrids).toEqual([grid])
        for (const name of ["Kick", "Marimba", "TR-808 Bass Drum"]) {expect(grid.text).toContain(name)}
    })

    it("takes its own lanes and does not mistake a plain composite for a grid", () => {
        const {project} = createFixture()
        project.addInstrumentUnit("InstrumentComposite", {label: "Stack"}).instrument.addLayer("Nano")
        expect(project.pulseGrids).toEqual([])
        const grid = project.addPulseGrid({}, [{name: "Bell", kind: "melodic", sound: {instrument: "Tubular"}}])
        expect(grid.doc.lanes.map(lane => lane.name)).toEqual(["Bell"])
        expect(project.pulseGrids).toEqual([grid])
    })

    it("refuses an empty lane list and leaves no unit behind", () => {
        const {project} = createFixture()
        const units = project.audioUnits.length
        expect(() => project.addPulseGrid({}, [])).toThrow(/at least one lane/)
        expect(project.audioUnits).toHaveLength(units)
    })

    it("applies ops, answers with the new line, and stops at the first failure", () => {
        const {project} = createFixture()
        const grid = project.addPulseGrid()
        const results = grid.apply([
            {op: "setPatternText", lane: "Kick", text: beat},
            {op: "setStep", lane: "Hat", step: 99},
            {op: "setStep", lane: "Hat", step: 1}
        ])
        expect(results).toHaveLength(2)
        expect(results[0]).toEqual({ok: true, op: "setPatternText", lines: [`Kick ${beat}`]})
        expect(results[1].ok).toBe(false)
        expect(grid.doc.lanes[3].patterns).toEqual([])
    })

    it("writes back its own text form", () => {
        const {project} = createFixture()
        const source = project.addPulseGrid({label: "One"})
        source.apply([{op: "setPatternText", lane: "Snare", text: "|---- x--- ---- x---|"},
            {op: "setSetting", key: "swing", value: 60}])
        const target = project.addPulseGrid({label: "Two"})
        expect(target.applyText(source.text).every(result => result.ok)).toBe(true)
        expect(target.doc.settings.swing).toBe(60)
        expect(target.doc.lanes[1].patterns).toEqual(source.doc.lanes[1].patterns)
    })

    it("throws on text that does not parse and changes nothing", () => {
        const {project} = createFixture()
        const grid = project.addPulseGrid()
        const before = grid.doc
        expect(() => grid.applyText("this is not a grid")).toThrow(/applyText/)
        expect(() => grid.apply("nope" as never)).toThrow(/expected an array/)
        expect(grid.doc).toEqual(before)
    })

    it("survives the studio and edits the project open there", async () => {
        const {api, project} = createFixture()
        project.addPulseGrid({label: "Beat"}).apply([{op: "setPatternText", lane: "Kick", text: beat}])
        const written = project.pulseGrids[0].text
        project.openInStudio()
        const loaded = await api.getProject()
        expect(loaded.pulseGrids[0].text).toBe(written)
        expect(loaded.pulseGrids[0].apply([{op: "addLane", name: "Tom", kind: "drum", sound: {instrument: "Tubular"}},
            {op: "setPatternText", lane: "Tom", text: beat}]).every(result => result.ok)).toBe(true)
        loaded.openInStudio()
        const again = await api.getProject()
        expect(again.pulseGrids[0].doc.lanes.map(lane => lane.name)).toContain("Tom")
        expect(again.pulseGrids[0].text).toContain(`Tom ${beat}`)
    })
})
