import {afterEach, describe, expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"

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
