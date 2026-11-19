import {afterEach, describe, expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {AudioData, WavFile} from "@opendaw/lib-dsp"
import {PulseGridLibrary} from "@/ui/devices/instruments/PulseGridDeviceEditor/PulseGridLibrary"

const limitFetch = vi.fn()
vi.mock("@opendaw/lib-runtime", async original => ({
    ...await original<typeof import("@opendaw/lib-runtime")>(), network: {limitFetch}
}))
const {OpenSampleAPI} = await import("./OpenSampleAPI")

// When does the tab decide that openDAW's sample library is not allowed on this site? Only after two requests in a
// row failed without reaching the server while a `no-cors` probe of the same URL answered (CORS refused it).
const fresh = () => new (OpenSampleAPI as unknown as new () => InstanceType<typeof OpenSampleAPI>)()
const index = {version: 1, folders: [{name: "Drums", samples: []}]}
const answer = (json: () => Promise<unknown>) => ({ok: true, status: 200, statusText: "OK", json})
const corsRefused = () => Promise.reject(new TypeError("Failed to fetch"))
const probe = vi.fn()
vi.stubGlobal("fetch", probe)

afterEach(() => {
    limitFetch.mockReset()
    probe.mockReset()
    PulseGridLibrary.connect(undefined)
})

describe("OpenSampleAPI, a site the library does not allow", () => {
    it("a body that is not JSON is retried and never probed", async () => {
        limitFetch.mockResolvedValueOnce(answer(() => Promise.reject(new SyntaxError("Unexpected token <"))))
            .mockResolvedValueOnce(answer(async () => index))
        const api = fresh()
        expect((await api.tree()).folders.map(folder => folder.name)).toEqual(["Drums"])
        expect(api.notAllowed).toBe(false)
        expect(probe).not.toHaveBeenCalled()
    })
    it("one refused request with an answering probe is a blip: the next attempt loads the library", async () => {
        limitFetch.mockImplementationOnce(corsRefused).mockResolvedValueOnce(answer(async () => index))
        probe.mockResolvedValue({type: "opaque"})
        const api = fresh()
        expect((await api.tree()).folders).toHaveLength(1)
        expect(api.notAllowed).toBe(false)
    })
    it("a probe that fails is a network problem: retry", async () => {
        limitFetch.mockImplementationOnce(corsRefused).mockImplementationOnce(corsRefused)
            .mockResolvedValueOnce(answer(async () => index))
        probe.mockResolvedValueOnce({type: "opaque"}).mockRejectedValueOnce(new TypeError("offline"))
        const api = fresh()
        expect((await api.tree()).folders).toHaveLength(1)
        expect(api.notAllowed).toBe(false)
    })
    it("two refused requests in a row with answering probes: empty library, a cloud sample is refused at once", async () => {
        limitFetch.mockImplementation(corsRefused)
        probe.mockResolvedValue({type: "opaque"})
        const api = fresh()
        expect(await api.tree()).toEqual({version: 1, folders: []})
        expect(api.notAllowed).toBe(true)
        expect(limitFetch).toHaveBeenCalledTimes(2)
        await expect(api.get(UUID.parse("0f6c7d1e-1111-4222-8333-444455556666")))
            .rejects.toThrow(OpenSampleAPI.NotAllowed)
    })
})

// A sound of the team library (Nitro): checked after the built-in drums and before openDAW's cloud.
describe("OpenSampleAPI, the team library", () => {
    const teamUuid = "7b0aaacd-69a8-483a-87fe-186dbef1c704"
    const cloudUuid = "0f6c7d1e-1111-4222-8333-444455556666"
    const wav = () => {
        const audio = AudioData.create(48000, 4800, 1)
        audio.frames[0].fill(0.25)
        return WavFile.encodeFloats(audio)
    }
    const connect = () => PulseGridLibrary.connect({
        sampleUrl: uuid => `/nitro-api/projects/key/pulsegrid/library/samples/${uuid}`,
        index: async () => [{
            id: "p", name: "P", source: "", kits: [],
            sounds: [{uuid: teamUuid, name: "Kick 01", folder: "P", role: "Kick", seconds: 0.1}]
        }],
        putSample: vi.fn(), putPack: vi.fn(), removePack: vi.fn()
    })

    it("a library uuid loads from the library route and is decoded", async () => {
        connect()
        const bytes = wav()
        probe.mockResolvedValue({ok: true, status: 200, statusText: "OK", arrayBuffer: async () => bytes})
        const progress = vi.fn()
        const [audio, sample] = await fresh().load(UUID.parse(teamUuid), progress)
        expect(probe).toHaveBeenCalledWith(`/nitro-api/projects/key/pulsegrid/library/samples/${teamUuid}`)
        expect(limitFetch).not.toHaveBeenCalled()
        expect(audio.numberOfFrames).toBe(4800)
        expect(audio.sampleRate).toBe(48000)
        expect(sample).toMatchObject({uuid: teamUuid, name: "Kick 01", duration: 0.1, sample_rate: 48000, origin: "openDAW"})
        expect(progress).toHaveBeenCalledWith(1)
    })
    it("get answers from the manifest without any request", async () => {
        connect()
        expect(await fresh().get(UUID.parse(teamUuid))).toMatchObject({uuid: teamUuid, name: "Kick 01", duration: 0.1})
        expect(probe).not.toHaveBeenCalled()
        expect(limitFetch).not.toHaveBeenCalled()
    })
    it("an unknown uuid falls through to openDAW's own path", async () => {
        connect()
        limitFetch.mockResolvedValue(answer(async () => ({version: 1, folders: [{name: "Drums", samples: [
            {uuid: cloudUuid, name: "Cloud Kick", bpm: 0, duration: 1, sample_rate: 44100}]}]})))
        expect(await fresh().get(UUID.parse(cloudUuid))).toMatchObject({uuid: cloudUuid, name: "Cloud Kick", origin: "openDAW"})
        expect(probe).not.toHaveBeenCalled()
    })
    it("outside Nitro the library check makes no request", async () => {
        limitFetch.mockResolvedValue(answer(async () => ({version: 1, folders: []})))
        probe.mockResolvedValue({ok: false, status: 404, statusText: "Not Found", json: async () => ({})})
        await expect(fresh().get(UUID.parse(cloudUuid))).rejects.toThrow()
        expect(probe).not.toHaveBeenCalledWith(expect.stringContaining("/nitro-api/"))
    })
})
