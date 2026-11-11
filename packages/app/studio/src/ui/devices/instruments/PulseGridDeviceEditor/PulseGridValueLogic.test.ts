import {describe, expect, it} from "vitest"
import {PulseGridValueLogic} from "./PulseGridValueLogic"

describe("PulseGridValueLogic.velocityAt", () => {
    it("is 127 at the top of the row and 1 at the bottom", () => {
        expect(PulseGridValueLogic.velocityAt(100, 100, 34)).toBe(127)
        expect(PulseGridValueLogic.velocityAt(134, 100, 34)).toBe(1)
    })
    it("stays at the limits above and below the row", () => {
        expect(PulseGridValueLogic.velocityAt(40, 100, 34)).toBe(127)
        expect(PulseGridValueLogic.velocityAt(400, 100, 34)).toBe(1)
    })
    it("is about 64 in the middle", () => {
        expect(PulseGridValueLogic.velocityAt(117, 100, 34)).toBe(64)
    })
})

describe("PulseGridValueLogic.chanceAt", () => {
    it("is 100 at the top and 0 at the bottom, and keeps to them outside the row", () => {
        expect(PulseGridValueLogic.chanceAt(100, 100, 18)).toBe(100)
        expect(PulseGridValueLogic.chanceAt(118, 100, 18)).toBe(0)
        expect(PulseGridValueLogic.chanceAt(0, 100, 18)).toBe(100)
        expect(PulseGridValueLogic.chanceAt(900, 100, 18)).toBe(0)
    })
    it("moves in steps of 5", () => {
        for (let y = 100; y <= 118; y += 0.5) {
            expect(PulseGridValueLogic.chanceAt(y, 100, 18) % 5).toBe(0)
        }
        expect(PulseGridValueLogic.chanceAt(109, 100, 18)).toBe(50)
    })
})

describe("PulseGridValueLogic.barHeight", () => {
    it("is the share of the row, and at least one pixel", () => {
        expect(PulseGridValueLogic.barHeight(127, 34)).toBe(34)
        expect(PulseGridValueLogic.barHeight(64, 34)).toBe(17)
        expect(PulseGridValueLogic.barHeight(1, 34)).toBe(1)
    })
})

describe("PulseGridValueLogic.keyboardStart", () => {
    it("is the C of the octave under the lane pitch", () => {
        expect(PulseGridValueLogic.keyboardStart(60)).toBe(48)
        expect(PulseGridValueLogic.keyboardStart(66)).toBe(48)
    })
    it("is kept inside 0..127", () => {
        expect(PulseGridValueLogic.keyboardStart(0)).toBe(0)
        expect(PulseGridValueLogic.keyboardStart(5)).toBe(0)
        expect(PulseGridValueLogic.keyboardStart(127)).toBe(108)
    })
    it("ends on the B of the octave over, or at 127", () => {
        expect(PulseGridValueLogic.keyboardRange(60)).toEqual({first: 48, last: 83})
        expect(PulseGridValueLogic.keyboardRange(5)).toEqual({first: 0, last: 23})
        expect(PulseGridValueLogic.keyboardRange(127)).toEqual({first: 108, last: 127})
    })
})

describe("PulseGridValueLogic.keyShapes", () => {
    const shapes = PulseGridValueLogic.keyShapes(60, 71)
    it("stands seven white keys side by side in an octave", () => {
        expect(shapes.filter(key => !key.black).map(key => key.left)).toEqual([0, 1, 2, 3, 4, 5, 6])
        expect(PulseGridValueLogic.whiteCount(60, 71)).toBe(7)
    })
    it("puts a black key across the border after its white neighbour", () => {
        const black = shapes.filter(key => key.black)
        expect(black.map(key => key.pitch)).toEqual([61, 63, 66, 68, 70])
        expect(black.map(key => key.left + key.width / 2)).toEqual([1, 2, 4, 5, 6])
    })
})
