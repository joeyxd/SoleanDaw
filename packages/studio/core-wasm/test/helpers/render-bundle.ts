import {createHash} from "node:crypto"
import {mkdirSync, readFileSync, writeFileSync} from "node:fs"
import {dirname, join, resolve} from "node:path"
import JSZip from "jszip"
import {RenderOptions, renderProject, SampleSources} from "../../node/render-project"

// A thin user of node/render-project.ts for a developer's own bundle: the zip is read here, the samples come from a
// content-addressed asset store (<sha[0:2]>/<sha>), and from a library folder (samples/<uuid>.wav).
type BundleRenderOptions = Partial<Omit<RenderOptions, "seconds">> & {
    bundle: string, assets?: string, library?: string, out: string, seconds?: number
}
type AssetEntry = {path: string, sha256: string, bytes: number}

const readIfPresent = (file: string): Buffer | undefined => {
    try {return readFileSync(file)} catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {return undefined}
        throw error
    }
}

export const renderBundle = async (options: BundleRenderOptions) => {
    const zip = await JSZip.loadAsync(readFileSync(options.bundle))
    const projectFile = zip.file("project.od")
    if (projectFile === null) {throw new Error("Nitro bundle is missing project.od")}
    const manifestText = await zip.file("nitro-assets.json")?.async("string")
    const manifest = new Map((manifestText === undefined ? [] as Array<AssetEntry> : JSON.parse(manifestText) as Array<AssetEntry>)
        .map(entry => [entry.path, entry]))
    const samples: SampleSources = {
        bundle: uuid => {
            const asset = manifest.get(`samples/${uuid}/audio.wav`)
            if (asset === undefined || options.assets === undefined) {return undefined}
            const {sha256, bytes} = asset
            if (!/^[a-f0-9]{64}$/.test(sha256)) {throw new Error(`Invalid asset hash for sample ${uuid}`)}
            const wav = readIfPresent(join(options.assets, sha256.slice(0, 2), sha256))
            if (wav === undefined) {return undefined}
            if (wav.length !== bytes || createHash("sha256").update(wav).digest("hex") !== sha256) {
                throw new Error(`Asset contents do not match the manifest for sample ${uuid}`)
            }
            return wav
        },
        library: uuid => options.library === undefined ? undefined : readIfPresent(join(options.library, "samples", `${uuid}.wav`))
    }
    const {wav, report} = await renderProject({
        engineDir: resolve(__dirname, "../../dist/wasm"),
        project: await projectFile.async("arraybuffer"),
        options: {
            track: options.track ?? null, fromBar: options.fromBar ?? 1, toBar: options.toBar ?? null,
            tail: options.tail ?? 0, seconds: options.seconds
        },
        samples
    })
    mkdirSync(dirname(options.out), {recursive: true})
    writeFileSync(options.out, wav)
    return {seconds_rendered: report.seconds, ...report}
}
