import {afterEach, describe, expect, it, vi} from "vitest"
import {AudioData} from "@opendaw/lib-dsp"
import {PulseGridLibrary} from "./PulseGridLibrary"
import {PulseGridPackGroup} from "./PulseGridPackFiles"
import {PulseGridPackEnv, PulseGridPackRun} from "./PulseGridPackRun"

// The import with a fake Nitro and a fake decoder: what is uploaded, what is saved, and the one line at the end.
const file = (path: string, level: number) =>
    ({path, read: async () => new Uint8Array([level]).buffer as ArrayBuffer})
const group = (...files: ReadonlyArray<ReturnType<typeof file>>): PulseGridPackGroup =>
    ({zip: "Mine.zip", source: "Mine.zip", files})

const setup = (put: (uuid: string) => Promise<{ok: true} | {ok: false, message: string}> = async () => ({ok: true})) => {
    let active = 0
    let most = 0
    const putSample = vi.fn(async (uuid: string) => {
        most = Math.max(most, ++active)
        await new Promise(resolve => setTimeout(resolve, 5))
        active--
        return put(uuid)
    })
    const putPack = vi.fn(async () => ({ok: true as const}))
    PulseGridLibrary.connect({
        sampleUrl: uuid => uuid, index: async () => [], putSample, putPack, removePack: vi.fn()
    })
    const said: Array<string> = []
    const env: PulseGridPackEnv = {
        decode: async buffer => {
            const level = new Uint8Array(buffer)[0]
            if (level === 0) {throw new Error("cannot decode")}
            const audio = AudioData.create(44100, 4410, 1)
            audio.frames[0].fill(level / 100)
            return audio
        },
        say: (text, kind) => said.push(`${kind}: ${text}`)
    }
    return {env, putSample, putPack, said, most: () => most}
}

afterEach(() => PulseGridLibrary.connect(undefined))

describe("PulseGridPackRun.start", () => {
    it("uploads the sounds four at a time, saves the pack and says one line", async () => {
        const {env, putSample, putPack, said, most} = setup()
        const files = ["Kick", "Snare", "Hat", "Clap", "Perc 1", "Perc 2", "Kick 2"].map((name, index) =>
            file(`${name}.wav`, index + 1))
        await PulseGridPackRun.start(env, Promise.resolve([group(...files, file("broken.mp3", 0), file("same.wav", 1),
            file("notes.txt", 5), file("__MACOSX/Kick.wav", 9))]))
        expect(said).toEqual(["info: Mine: 1 kits, 7 sounds, 1 skipped"])
        expect(putSample).toHaveBeenCalledTimes(8) // the repeated file is sent too (Nitro answers stored false)
        expect(most()).toBe(4)
        const [pack] = putPack.mock.calls[0] as unknown as [{id: string, name: string, source: string, sounds: Array<{uuid: string}>}]
        expect(pack).toMatchObject({id: "mine", name: "Mine", source: "Mine.zip"})
        expect(pack.sounds).toHaveLength(7)
        expect(pack.sounds.every(sound => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sound.uuid)))
            .toBe(true)
    })
    it("the same kick in two kit folders is one sound, and both folders still make a kit", async () => {
        const {env, putPack, said} = setup()
        await PulseGridPackRun.start(env, Promise.resolve([group(
            file("Mine/A/Kick.wav", 1), file("Mine/A/Snare.wav", 2), file("Mine/A/Hat.wav", 3),
            file("Mine/B/Kick.wav", 1), file("Mine/B/Clap.wav", 4), file("Mine/B/Hat.wav", 5))]))
        expect(said).toEqual(["info: Mine: 2 kits, 5 sounds"])
        const [pack] = putPack.mock.calls[0] as unknown as [{sounds: Array<{uuid: string}>, kits: Array<{name: string, sounds: Record<string, string>}>}]
        expect(pack.sounds).toHaveLength(5)
        expect(pack.kits.map(kit => kit.name)).toEqual(["A", "B"])
        expect(pack.kits[0].sounds.Kick).toBe(pack.kits[1].sounds.Kick)
    })
    it("a failed upload says why and does not save the pack", async () => {
        const {env, putPack, said} = setup(async () => ({ok: false, message: "the team library is full"}))
        await PulseGridPackRun.start(env, Promise.resolve([group(file("Kick.wav", 1), file("Snare.wav", 2))]))
        expect(said).toEqual(["error: Mine: upload failed, the team library is full"])
        expect(putPack).not.toHaveBeenCalled()
    })
    it("outside Nitro it only says to open the project from Nitro", async () => {
        PulseGridLibrary.connect(undefined)
        const said: Array<string> = []
        await PulseGridPackRun.start({decode: vi.fn(), say: text => said.push(text)}, Promise.resolve([]))
        expect(said).toEqual(["Open this project from Nitro to import packs"])
    })
})
