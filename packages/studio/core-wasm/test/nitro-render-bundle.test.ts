import {expect, it} from "vitest"

const bundle = process.env.NITRO_RENDER_BUNDLE

it.skipIf(bundle === undefined)("renders a Nitro project bundle to WAV", async () => {
    const {NITRO_RENDER_ASSETS, NITRO_RENDER_LIBRARY, NITRO_RENDER_OUT, NITRO_RENDER_SECONDS} = process.env
    if (bundle === undefined || NITRO_RENDER_OUT === undefined) {
        throw new Error("Set NITRO_RENDER_BUNDLE and NITRO_RENDER_OUT")
    }
    const {renderBundle} = await import("./helpers/render-bundle")
    const result = await renderBundle({
        bundle,
        assets: NITRO_RENDER_ASSETS,
        library: NITRO_RENDER_LIBRARY,
        out: NITRO_RENDER_OUT,
        seconds: NITRO_RENDER_SECONDS === undefined ? undefined : Number(NITRO_RENDER_SECONDS)
    })
    expect(result.seconds_rendered).toBeGreaterThan(0)
    expect(result.samples.resolved + result.samples.unresolved.length).toBe(result.samples.total)
    console.log(JSON.stringify(result))
}, 60000)
