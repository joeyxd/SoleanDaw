import {describe, expect, it} from "vitest"
import {PulseGridRollRow} from "@opendaw/studio-adapters"
import {PulseGridRollLogic as Logic} from "./PulseGridRollLogic"

describe("PulseGridRollLogic rows", () => {
    it("finds the first row", () => {
        expect(Logic.RowHeight).toBe(14)
        expect(Logic.rowAt(0, 3)).toBe(0)
        expect(Logic.rowAt(13.9, 3)).toBe(0)
    })
    it("finds the last row", () => {
        expect(Logic.rowAt(30, 3)).toBe(2)
        expect(Logic.rowAt(43.9, 3)).toBe(2)
    })
    it("does not accept the one pixel gaps", () => {
        expect(Logic.rowAt(14, 3)).toBeUndefined()
        expect(Logic.rowAt(14.9, 3)).toBeUndefined()
        expect(Logic.rowAt(15, 3)).toBe(1)
        expect(Logic.rowAt(29, 3)).toBeUndefined()
    })
    it("does not accept offsets outside the roll or an empty roll", () => {
        expect(Logic.rowAt(-0.1, 3)).toBeUndefined()
        expect(Logic.rowAt(44, 3)).toBeUndefined()
        expect(Logic.rowAt(45, 3)).toBeUndefined()
        expect(Logic.rowAt(0, 0)).toBeUndefined()
    })
})
describe("PulseGridRollLogic note spans", () => {
    it("spans a whole step", () => {
        expect(Logic.span(1, 4, 16)).toEqual({start: 1, end: 2, width: "100%"})
    })
    it("includes the spacer track when crossing a beat", () => {
        expect(Logic.span(4, 8, 16)).toEqual({start: 4, end: 7, width: "100%"})
    })
    it("ends a fractional length inside the last step, keeping the gaps whole", () => {
        expect(Logic.span(1, 6, 16)).toEqual({start: 1, end: 3, width: "calc(75% + 0.75px)"})
        expect(Logic.span(4, 6, 16)).toEqual({start: 4, end: 7, width: "calc(75% + 2.25px)"})
        expect(Logic.span(5, 1, 16)).toEqual({start: 6, end: 7, width: "calc(25% + 0px)"})
    })
    it("cuts the part beyond the effective length", () => {
        expect(Logic.span(15, 32, 16)).toEqual({start: 18, end: 20, width: "100%"})
        expect(Logic.span(16, 5, 16)).toEqual({start: 19, end: 20, width: "100%"})
    })
})
describe("PulseGridRollLogic degrees", () => {
    const rows: Array<PulseGridRollRow> = [
        {pitch: 64, name: "E3", root: false, inScale: true},
        {pitch: 63, name: "D#3", root: false, inScale: false},
        {pitch: 62, name: "D3", root: false, inScale: true},
        {pitch: 60, name: "C3", root: true, inScale: true}
    ]
    it("counts scale rows downwards, skipping a row outside the scale", () => {
        expect(Logic.degrees(rows, 0, 2)).toBe(-1)
        expect(Logic.degrees(rows, 0, 3)).toBe(-2)
    })
    it("counts upwards as positive and no movement as zero", () => {
        expect(Logic.degrees(rows, 2, 0)).toBe(1)
        expect(Logic.degrees(rows, 3, 0)).toBe(2)
        expect(Logic.degrees(rows, 1, 1)).toBe(0)
    })
})
describe("PulseGridRollLogic selection", () => {
    it("normalizes a box drawn up and left", () => {
        expect(Logic.box(20, 30, 5, 10)).toEqual({left: 5, top: 10, right: 20, bottom: 30})
    })
    it("picks notes whose bodies or edges touch the box in both dimensions", () => {
        const first = {step: 1, pitch: 60}, second = {step: 4, pitch: 62}, third = {step: 1, pitch: 64}
        const notes = [
            {key: first, box: {left: 0, top: 15, right: 80, bottom: 29}},
            {key: second, box: {left: 100, top: 30, right: 118, bottom: 44}},
            {key: third, box: {left: 0, top: 0, right: 18, bottom: 14}}
        ]
        expect(Logic.touched(notes, Logic.box(50, 20, 100, 35))).toEqual([first, second])
        expect(Logic.touched(notes, Logic.box(81, 15, 99, 29))).toEqual([])
    })
})
describe("PulseGridRollLogic drag lengths", () => {
    it("paints whole steps including both ends and never fewer than one", () => {
        expect(Logic.paintLength(3, 3, 16)).toBe(4)
        expect(Logic.paintLength(3, 6, 16)).toBe(16)
        expect(Logic.paintLength(3, 1, 16)).toBe(4)
    })
    it("limits painting at the pattern end and at the largest stored whole length", () => {
        expect(Logic.paintLength(15, 30, 16)).toBe(8)
        expect(Logic.paintLength(1, 64, 64)).toBe(252)
    })
    it("resizes to whole steps, with a one step minimum and a pattern end maximum", () => {
        expect(Logic.resizeLength(5, 4, 16)).toBe(4)
        expect(Logic.resizeLength(5, 7, 16)).toBe(12)
        expect(Logic.resizeLength(5, 90, 16)).toBe(48)
        expect(Logic.resizeLength(1, 64, 64)).toBe(252)
    })
})
