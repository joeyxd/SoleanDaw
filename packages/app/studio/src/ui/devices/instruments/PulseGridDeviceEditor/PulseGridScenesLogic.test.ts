import {describe, expect, it} from "vitest"
import {PulseGridScenesLogic as Logic} from "./PulseGridScenesLogic"

describe("PulseGridScenesLogic", () => {
    it("labels an unnamed scene with its number", () => {
        expect(Logic.label(3, "")).toBe("Scene 3")
        expect(Logic.label(3, "   ")).toBe("Scene 3")
        expect(Logic.label(3, " Chorus ")).toBe("Chorus")
    })
    it("wraps the arrows inside the scenes that exist", () => {
        expect(Logic.wrap(1, -1, 4)).toBe(4)
        expect(Logic.wrap(4, 1, 4)).toBe(1)
        expect(Logic.wrap(2, 1, 4)).toBe(3)
        expect(Logic.wrap(1, 1, 1)).toBe(1)
        expect(Logic.wrap(1, -1, 1)).toBe(1)
        expect(Logic.wrap(16, 1, 16)).toBe(1)
    })
    it("offers + New Scene below 16 scenes and Delete above one", () => {
        expect(Logic.canAdd(1)).toBe(true)
        expect(Logic.canAdd(15)).toBe(true)
        expect(Logic.canAdd(16)).toBe(false)
        expect(Logic.canDelete(1)).toBe(false)
        expect(Logic.canDelete(2)).toBe(true)
    })
    describe("dropTarget", () => {
        // four rows of height 40, middles at 20, 60, 100, 140
        const middles = [20, 60, 100, 140]
        it("is the row's own place while the pointer stays near it", () => {
            expect(Logic.dropTarget(middles, 2, 60)).toBe(2)
            expect(Logic.dropTarget(middles, 2, 45)).toBe(2)
            expect(Logic.dropTarget(middles, 2, 75)).toBe(2)
            expect(Logic.dropTarget(middles, 1, 5)).toBe(1)
            expect(Logic.dropTarget(middles, 4, 500)).toBe(4)
        })
        it("moves down past the middle of the next row", () => {
            expect(Logic.dropTarget(middles, 1, 101)).toBe(3)
            expect(Logic.dropTarget(middles, 1, 500)).toBe(4)
        })
        it("moves up past the middle of the previous row", () => {
            expect(Logic.dropTarget(middles, 4, 59)).toBe(2)
            expect(Logic.dropTarget(middles, 4, -10)).toBe(1)
        })
        it("is 1 for a single row", () => {
            expect(Logic.dropTarget([20], 1, 300)).toBe(1)
        })
    })
    it("reads the step of the position only while it runs", () => {
        expect(Logic.stepOf(0, true)).toBe(0)
        expect(Logic.stepOf(239, true)).toBe(0)
        expect(Logic.stepOf(240, true)).toBe(1)
        expect(Logic.stepOf(5000, false)).toBe(-1)
    })
    it("marks a row in-song only with the song on and the transport running", () => {
        expect(Logic.inSongScene(true, true, {scene: 3})).toBe(3)
        expect(Logic.inSongScene(false, true, {scene: 3})).toBeUndefined()
        expect(Logic.inSongScene(true, false, {scene: 3})).toBeUndefined()
        expect(Logic.inSongScene(true, true, null)).toBeUndefined()
        expect(Logic.inSongScene(true, true, undefined)).toBeUndefined()
    })
    it("says when to show the notices", () => {
        expect(Logic.addedNotice(false)).toBe("Added to the song. Switch to Song to hear it.")
        expect(Logic.addedNotice(true)).toBeUndefined()
    })
    it("says the song is empty only while Song is on and the song has no entry", () => {
        expect(Logic.emptySong(true, 0)).toBe(true)
        expect(Logic.emptySong(true, 2)).toBe(false)
        expect(Logic.emptySong(false, 0)).toBe(false)
        expect(Logic.songSummary(true, 0)).toBe(" · song, empty")
        expect(Logic.songSummary(true, 2)).toBe(" · song")
        expect(Logic.songSummary(false, 0)).toBe("")
    })
})
