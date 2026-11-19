import {
    asDefined,
    DefaultObservableValue,
    isDefined,
    Lazy,
    panic,
    Procedure,
    RuntimeNotifier,
    tryCatch,
    unitValue,
    UUID
} from "@opendaw/lib-std"
import {network, Promises} from "@opendaw/lib-runtime"
import {PulseGridDrums, Sample, SampleMetaData} from "@opendaw/studio-adapters"
import {SampleAPI} from "@opendaw/studio-core"
import {AccessKey} from "./AccessKey"
import {base64Credentials, OpenDAWHeaders} from "./OpenDAWHeaders"
import {SampleIndex} from "./SampleIndex"
import {z} from "zod"
import {AudioData, WavFile} from "@opendaw/lib-dsp"
import {PulseGridLibrary} from "@/ui/devices/instruments/PulseGridDeviceEditor/PulseGridLibrary"

const SampleError = z.object({error: z.string()})

const AttemptTimeout = 10_000
const RetryInterval = 1_000
// The built-in PulseGrid drums have no file anywhere: our own code makes them, at this rate.
const BuiltInRate = 44100
const BuiltInBpm = 120

// Standard openDAW samples (considered to be non-removable)
export class OpenSampleAPI implements SampleAPI {
    static readonly ApiRoot = "https://api.opendaw.studio/samples"
    static readonly FileRoot = "https://assets.opendaw.studio/samples"
    static readonly IndexFile = `${OpenSampleAPI.FileRoot}/index.json`

    static readonly NotAllowed = "openDAW's sample library cannot be used on this site"

    @Lazy
    static get(): OpenSampleAPI {return new OpenSampleAPI()}

    readonly #memoized: () => Promise<SampleIndex> = Promises.memoizeAsync(() =>
        this.#fetchIndex().then(json => SampleIndex.schema.parse(json)))
    #notAllowed: boolean = false

    private constructor() {}

    // True once this tab has learned that assets.opendaw.studio is up but does not let this site read it (CORS).
    get notAllowed(): boolean {return this.#notAllowed}

    // Like IndexFetch.fetchIndex (a silent request is aborted after 10 s, then tried again every second), with one
    // difference: when a request fails without reaching the server, the same URL is probed with `no-cors`.
    // A probe that answers (an opaque response) means the server is up and this site may not read it. Two such
    // attempts in a row make the library empty for this tab, and nothing is tried again. A probe that fails, a
    // timeout, or any answer of the server (a bad status, a body that is not JSON) is a network problem: retry.
    async #fetchIndex(): Promise<unknown> {
        const url = OpenSampleAPI.IndexFile
        let refused = 0
        for (; ;) {
            let reached = false
            try {
                const response = await network.limitFetch(`${url}?v=${Date.now()}`, {
                    ...OpenDAWHeaders, cache: "no-cache", signal: AbortSignal.timeout(AttemptTimeout)
                })
                reached = true
                refused = 0
                if (response.ok) {return await response.json()}
                console.debug(`[ProjectLoad] index '${url}' failed: ${response.status} ${response.statusText}`)
            } catch (reason) {
                console.debug(`[ProjectLoad] index '${url}' failed: ${reason}`)
                const silent = reason instanceof DOMException && (reason.name === "TimeoutError" || reason.name === "AbortError")
                const opaque = !silent && !reached && await fetch(url, {
                    mode: "no-cors", signal: AbortSignal.timeout(AttemptTimeout)
                }).then(() => true, () => false)
                refused = opaque ? refused + 1 : 0
                if (refused >= 2) {
                    console.debug(`[ProjectLoad] ${OpenSampleAPI.NotAllowed}`)
                    this.#notAllowed = true
                    return {version: 1, folders: []}
                }
            }
            await new Promise(resolve => setTimeout(resolve, RetryInterval))
        }
    }

    async tree(): Promise<SampleIndex> {return this.#memoized()}

    async all(): Promise<ReadonlyArray<Sample>> {return SampleIndex.flatten(await this.#memoized())}

    async get(uuid: UUID.Bytes): Promise<Sample> {
        const uuidAsString = UUID.toString(uuid)
        const drum = PulseGridDrums.find(uuidAsString)
        if (isDefined(drum)) {
            return Object.freeze({uuid: uuidAsString, name: drum.name, bpm: BuiltInBpm, duration: drum.duration,
                sample_rate: BuiltInRate, origin: "openDAW" as const})
        }
        // The team's kit packs (Nitro only): after the built-in drums, before openDAW's cloud.
        const team = await PulseGridLibrary.find(uuidAsString)
        if (isDefined(team)) {
            return Object.freeze({uuid: uuidAsString, name: team.sound.name, bpm: BuiltInBpm,
                duration: team.sound.seconds, sample_rate: BuiltInRate, origin: "openDAW" as const})
        }
        const known = (await this.all()).find(sample => sample.uuid === uuidAsString)
        if (isDefined(known)) {return known}
        if (this.#notAllowed) {return panic(OpenSampleAPI.NotAllowed)}
        const url = `${OpenSampleAPI.ApiRoot}/get.php?uuid=${uuidAsString}`
        const response = await Promises.retry(() => network.limitFetch(url, OpenDAWHeaders))
        if (!response.ok) {
            return panic(`Sample not found: ${uuidAsString}`)
        }
        const json = await response.json()
        const failure = SampleError.safeParse(json)
        if (failure.success) {
            return panic(failure.data.error)
        }
        const sample = Sample.parse(json)
        return Object.freeze({...sample, origin: "openDAW"})
    }

    async load(uuid: UUID.Bytes, progress: Procedure<unitValue>): Promise<[AudioData, Sample]> {
        console.debug(`load ${UUID.toString(uuid)}`)
        const drum = PulseGridDrums.render(UUID.toString(uuid), BuiltInRate)
        if (isDefined(drum)) {
            progress(1)
            return [drum, await this.get(uuid)]
        }
        const uuidAsString = UUID.toString(uuid)
        const team = await PulseGridLibrary.find(uuidAsString)
        if (isDefined(team)) {
            const response = await fetch(team.url)
            if (!response.ok) {
                return panic(`Failed to fetch sample ${uuidAsString}: ${response.status} ${response.statusText}`)
            }
            const audioData = WavFile.decodeFloats(await response.arrayBuffer())
            progress(1)
            return [audioData, {
                uuid: uuidAsString, bpm: BuiltInBpm, name: team.sound.name,
                duration: audioData.numberOfFrames / audioData.sampleRate, sample_rate: audioData.sampleRate,
                origin: "openDAW"
            }]
        }
        return this.get(uuid)
            .then(({uuid, name, bpm}) => Promises.retry(() => network
                .limitFetch(`${OpenSampleAPI.FileRoot}/${uuid}`, OpenDAWHeaders))
                .then(response => {
                    if (!response.ok) {
                        return panic(`Failed to fetch sample ${uuid}: ${response.status} ${response.statusText}`)
                    }
                    const total = parseInt(response.headers.get("Content-Length") ?? "0")
                    let loaded = 0
                    return new Promise<ArrayBuffer>((resolve, reject) => {
                        const reader = asDefined(response.body, "No body in response").getReader()
                        const chunks: Array<Uint8Array> = []
                        const nextChunk = ({done, value}: ReadableStreamReadResult<Uint8Array>) => {
                            if (done) {
                                resolve(new Blob(chunks as Array<BlobPart>).arrayBuffer())
                            } else {
                                chunks.push(value)
                                loaded += value.length
                                progress(loaded / total)
                                reader.read().then(nextChunk, reject)
                            }
                        }
                        reader.read().then(nextChunk, reject)
                    })
                })
                .then(arrayBuffer => {
                    const audioData = WavFile.decodeFloats(arrayBuffer)
                    return [audioData, {
                        uuid,
                        bpm,
                        name,
                        duration: audioData.numberOfFrames / audioData.sampleRate,
                        sample_rate: audioData.sampleRate,
                        origin: "openDAW"
                    }] as [AudioData, Sample]
                }))
    }

    async upload(arrayBuffer: ArrayBuffer, metaData: SampleMetaData): Promise<void> {
        const progress = new DefaultObservableValue(0.0)
        const dialog = RuntimeNotifier.progress({headline: "Uploading", progress})
        const formData = new FormData()
        Object.entries(metaData).forEach(([key, value]) => formData.set(key, String(value)))
        const accessKey = AccessKey.get().unwrap("Cannot upload without access-key.")
        formData.set("key", accessKey)
        formData.append("file", new Blob([arrayBuffer]))
        console.log("upload data", Array.from(formData.entries()), arrayBuffer.byteLength)
        const xhr = new XMLHttpRequest()
        xhr.upload.addEventListener("progress", (event: ProgressEvent) => {
            if (event.lengthComputable) {
                progress.setValue(event.loaded / event.total)
            }
        })
        xhr.onreadystatechange = () => {
            if (xhr.readyState === 4) {
                dialog.terminate()
                if (xhr.status === 200) {
                    RuntimeNotifier.notify({message: "Upload complete.", icon: "Checkbox"})
                } else {
                    const {status, value} =
                        tryCatch(() => JSON.parse(xhr.responseText).message ?? "Unknown error message")
                    console.warn(status === "success" ? value : xhr.responseText)
                    RuntimeNotifier.notify({message: "Upload failed.", icon: "Warning"})
                }
            }
        }
        xhr.open("POST", `${OpenSampleAPI.ApiRoot}/upload.php`, true)
        xhr.setRequestHeader("Authorization", `Basic ${base64Credentials}`)
        xhr.send(formData)
    }

    allowsUpload(): boolean {return false}
}
