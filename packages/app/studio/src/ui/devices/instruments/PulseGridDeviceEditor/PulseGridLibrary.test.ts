import {afterEach, describe, expect, it, vi} from "vitest"
import {PulseGridCatalogItem} from "@opendaw/studio-adapters"
import {PulseGridLibrary as Library, PulseGridLibraryLink} from "./PulseGridLibrary"

const wire = {
    id: "808-heat", name: "808 Heat", source: "808 Heat.zip", created_at: 1,
    sounds: [
        {uuid: "u-kick", name: "Kick 01", folder: "808 Heat/Kicks", role: "Kick", seconds: 0.5},
        {uuid: "u-snare", name: "Snare 01", folder: "808 Heat/Snares", role: "Snare", seconds: 0.25},
        {uuid: "u-hat", name: "Hat 01", folder: "808 Heat", role: "Hat", seconds: 0.1},
        {uuid: "u-odd", name: "Odd", folder: "", role: "Weird", seconds: 1},
        {uuid: "u-bad", name: "No length", folder: "", role: null, seconds: 0}
    ],
    kits: [
        {name: "808 Heat", sounds: {Kick: "u-kick", Snare: "u-snare", Clap: "u-snare", Hat: "u-hat", Perc: "u-hat"}},
        {name: "Broken", sounds: {Kick: "u-kick", Snare: "u-snare", Clap: "u-snare", Hat: "u-hat", Perc: "gone"}},
        {name: "Short", sounds: {Kick: "u-kick"}}
    ]
}

const link = (answer: () => Promise<ReadonlyArray<unknown> | undefined>) => ({
    sampleUrl: (uuid: string) => `/nitro-api/projects/k/pulsegrid/library/samples/${uuid}`,
    index: vi.fn(answer), putSample: vi.fn(), putPack: vi.fn(), removePack: vi.fn()
}) satisfies PulseGridLibraryLink

afterEach(() => Library.connect(undefined))

describe("PulseGridLibrary", () => {
    it("without a Nitro session nothing is loaded and nothing is found", async () => {
        expect(Library.active()).toBe(false)
        expect(await Library.ready()).toEqual([])
        expect(await Library.find("u-kick")).toBeUndefined()
    })
    it("loads the index once, keeps what is valid, and finds a sound by uuid with its url", async () => {
        const nitro = link(async () => [wire, "junk", {id: 1}])
        Library.connect(nitro)
        expect((await Library.ready()).map(pack => pack.id)).toEqual(["808-heat"])
        await Library.ready()
        await Library.find("u-kick")
        expect(nitro.index).toHaveBeenCalledTimes(1)
        expect(Library.packs()[0].sounds.map(sound => sound.uuid)).toEqual(["u-kick", "u-snare", "u-hat", "u-odd"])
        expect(Library.packs()[0].sounds[3].role).toBeNull()
        expect(await Library.find("u-snare")).toEqual({
            sound: {uuid: "u-snare", name: "Snare 01", folder: "808 Heat/Snares", role: "Snare", seconds: 0.25},
            url: "/nitro-api/projects/k/pulsegrid/library/samples/u-snare"
        })
        expect(await Library.find("elsewhere")).toBeUndefined()
    })
    it("a lookup waits for the index that is still loading", async () => {
        let open: (items: ReadonlyArray<unknown>) => void = () => {}
        Library.connect(link(() => new Promise(resolve => {open = resolve})))
        const found = Library.find("u-hat")
        open([wire])
        expect((await found)?.sound.name).toBe("Hat 01")
    })
    it("refresh asks again and tells the listeners; an index Nitro did not answer is empty and not kept", async () => {
        let answer: ReadonlyArray<unknown> | undefined = undefined
        const nitro = link(async () => answer)
        Library.connect(nitro)
        const told = vi.fn()
        Library.subscribe(told)
        expect(await Library.ready()).toEqual([])
        answer = [wire]
        expect((await Library.refresh()).length).toBe(1)
        expect(nitro.index).toHaveBeenCalledTimes(2)
        expect(told).toHaveBeenCalledTimes(1)
    })
    it("after a failed index the next lookup asks again (once the retry pause has passed)", async () => {
        vi.useFakeTimers({toFake: ["Date"]})
        try {
            let answer: ReadonlyArray<unknown> | undefined = undefined
            const nitro = link(async () => answer)
            Library.connect(nitro)
            expect(await Library.find("u-kick")).toBeUndefined()
            expect(nitro.index).toHaveBeenCalledTimes(1)
            answer = [wire]
            expect(await Library.find("u-kick")).toBeUndefined() // inside the pause: no second request
            expect(nitro.index).toHaveBeenCalledTimes(1)
            vi.setSystemTime(Date.now() + 6000)
            expect((await Library.find("u-kick"))?.sound.name).toBe("Kick 01")
            expect(nitro.index).toHaveBeenCalledTimes(2)
        } finally {
            vi.useRealTimers()
        }
    })
    it("a pack's kits become window kits; one with a sound the pack lacks is left out", async () => {
        Library.connect(link(async () => [wire]))
        const [pack] = await Library.ready()
        const kits = Library.kitsOf(pack)
        expect(kits.map(kit => kit.name)).toEqual(["808 Heat"])
        expect(kits[0].id).toBe("lib:808-heat/808 Heat")
        expect(kits[0].sounds.Kick).toEqual({uuid: "u-kick", name: "Kick 01", duration: 0.5})
    })
    it("the sound browser gets a folder per pack under Team packs, placed after the built-in drums", async () => {
        Library.connect(link(async () => [wire]))
        const packs = await Library.ready()
        const item = (id: string, folder: Array<string>): PulseGridCatalogItem => ({
            id, name: id, category: "drums", folder, kind: "drum",
            source: {type: "sample", sample: {uuid: id, name: id, duration: 1}}
        })
        const base = [item("a", ["PulseGrid drums", "Lo-Fi"]), item("b", ["openDAW", "One Shots"]),
            {...item("v", []), category: "synths" as const}]
        const merged = Library.withTeam(base, packs)
        expect(merged.map(entry => entry.id))
            .toEqual(["a", "sample:u-kick", "sample:u-snare", "sample:u-hat", "sample:u-odd", "b", "v"])
        expect(merged[1].folder).toEqual(["Team packs", "808 Heat", "Kicks"])
        expect(merged[3].folder).toEqual(["Team packs", "808 Heat"])
        expect(merged[4].folder).toEqual(["Team packs", "808 Heat"])
        expect(Library.withTeam(base, [])).toBe(base)
    })
})
