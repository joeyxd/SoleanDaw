// Loads the REAL engine.wasm AND every device side-module (delay, gate, vaporisateur, playfield slot, ...) the
// same way the AudioWorklet does (engine-processor.ts), in node. The engine directory is a parameter (the
// layout of dist/wasm: engine.wasm and plugins/device_*.wasm, optionally nam.wasm), so the same code runs from
// the fork's tests and from a bundled service (no __dirname). Not part of the browser build: it lives outside src/.

import type {LiveStreamBroadcaster} from "@opendaw/lib-fusion"
import type {AudioData} from "@opendaw/lib-dsp"
import * as path from "node:path"
import {existsSync, readFileSync} from "node:fs"
import {UUID} from "@opendaw/lib-std"
import {ScriptBridges, ScriptEngine} from "../src/script-bridge"
import {NamBridges} from "../src/nam-bridge"
import {WclapBridges} from "../src/wclap/wclap-bridge"
import {linkDevice, registerComposite, registerEffectComposite} from "../src/device-linker"
import {COMPOSITES, EFFECT_COMPOSITES, DEVICES as DEVICE_URLS} from "../src/engine-modules"

// ONE device/composite list for every context: the production tables from engine-modules, with the vite
// URL ("/wasm/plugins/x.wasm") mapped to its place inside the engine directory ("plugins/x.wasm").
const DEVICES: ReadonlyArray<{file: string, boxType: string}> =
    DEVICE_URLS.map(({url, boxType}) => ({file: url.replace(/^\/wasm\//, ""), boxType}))

export type FullEngine = {
    engine: any
    memory: WebAssembly.Memory
    namBridges: NamBridges
    scriptBridges: ScriptBridges
    deviceBuilds(): number
    // Feed a synthetic sample to every load the engine has queued (on seeing an AudioFileBox), so sample-based
    // devices (a Playfield slot) are AUDIBLE in tests. Returns how many it satisfied. The real loader fetches +
    // decodes a file; here we write a fixed 0.5 s 220 Hz mono tone, which is enough to assert real signal. Call
    // it after building the project (and again after any edit that adds a sample).
    // A provider replaces the tone with real PCM and supplies silence for missing samples.
    drainSamples(provider?: (uuid: string) => AudioData | undefined): number
    drainSoundfonts(build: (uuid: string) => ArrayBuffer): number
}

export type LoadEngineOptions = {
    engineDir: string
    sampleRate?: number
    onScriptMessage?: (uuid: string, message: string) => void
    broadcaster?: () => LiveStreamBroadcaster | null
    // The NeuralAmp inference binary; by default engineDir/nam.wasm, and without it NeuralAmp devices pass through.
    namWasm?: () => Promise<ArrayBuffer>
}

export const loadEngine = async ({
                                     engineDir, sampleRate = 48000, onScriptMessage = () => {},
                                     broadcaster = () => null, namWasm
                                 }: LoadEngineOptions): Promise<FullEngine> => {
    const memory = new WebAssembly.Memory({initial: 256})
    const table = new WebAssembly.Table({initial: 512, element: "anyfunc"})
    const engineModule = await WebAssembly.compile(readFileSync(path.join(engineDir, "engine.wasm")))
    const engine = new WebAssembly.Instance(engineModule, {env: {
        memory, __indirect_function_table: table,
        host_perf_now: () => performance.now() * 1000.0 // micros clock for the render profiler
    }}).exports as any
    engine.init(sampleRate)
    // User scripts read the `sampleRate` global (an AudioWorkletGlobalScope built-in); provide it in node so the
    // scriptable devices behave exactly as in the worklet.
    ;(globalThis as any).sampleRate = sampleRate
    // The script bridge runs the scriptable devices' user JavaScript over the shared memory (see script-bridge.ts).
    const scriptBridges = new ScriptBridges(memory, engine as ScriptEngine, sampleRate, onScriptMessage, broadcaster)
    // The nam bridge runs the NeuralAmp devices' nam-wasm inference.
    const namBridges = new NamBridges(memory, namWasm ?? (async () => {
        const file = path.join(engineDir, "nam.wasm")
        if (!existsSync(file)) {throw new Error("nam.wasm is not in the engine directory")}
        const bytes = readFileSync(file)
        // A node Buffer can sit at an offset inside a pooled ArrayBuffer; hand over exactly the file's bytes.
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    }), sampleRate)
    // The wclap bridge hosts CLAP plugins; no node caller loads a bundle, so the loader rejects and the device passes through.
    const wclapBridges = new WclapBridges(memory, sampleRate, {
        loadBundle: () => Promise.reject(new Error("no wclap bundles in node")),
        sendGui: () => {}, sendState: () => {}, sendParams: () => {}, sendParam: () => {}, sendHovered: () => {},
        requestGuiResize: () => {},
        sendStatus: () => {}, requestSave: () => {}, track: () => {}
    })
    const bridgeImports = {...scriptBridges.imports(), ...namBridges.imports(), ...wclapBridges.imports()}

    for (const {file, boxType} of DEVICES) {
        const module = await WebAssembly.compile(readFileSync(path.join(engineDir, file)))
        linkDevice(engine, memory, table, module, boxType, sampleRate, bridgeImports)
    }
    for (const composite of COMPOSITES) {
        registerComposite(engine, memory, composite)
    }
    for (const composite of EFFECT_COMPOSITES) {
        registerEffectComposite(engine, memory, composite)
    }
    const drainSamples: FullEngine["drainSamples"] = (provider): number => {
        let satisfied = 0
        for (; ;) {
            const requestPtr = engine.input_reserve(16)
            const handle = engine.sample_take_request(requestPtr)
            if (handle < 0) {break}
            if (provider !== undefined) {
                const uuid = UUID.toString(new Uint8Array(memory.buffer, requestPtr, 16) as UUID.Bytes)
                const audio = provider(uuid)
                const frames = audio?.numberOfFrames ?? 1
                const channels = audio?.numberOfChannels ?? 1
                const bytesPerChannel = frames * Float32Array.BYTES_PER_ELEMENT
                const pointer = engine.sample_allocate(handle, channels * bytesPerChannel)
                if (pointer === 0) {continue}
                if (audio === undefined) {
                    new Float32Array(memory.buffer, pointer, 1)[0] = 0
                } else {
                    audio.frames.forEach((plane, channel) => {
                        new Float32Array(memory.buffer, pointer + channel * bytesPerChannel, frames).set(plane)
                    })
                    satisfied++
                }
                engine.sample_set_ready(handle, frames, channels, audio?.sampleRate ?? sampleRate)
                continue
            }
            const frameCount = Math.floor(sampleRate * 0.5)
            const channelCount = 1
            const byteLength = frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT
            const pointer = engine.sample_allocate(handle, byteLength)
            const frames = new Float32Array(memory.buffer, pointer, frameCount)
            for (let frame = 0; frame < frameCount; frame++) {
                frames[frame] = 0.5 * Math.sin((2 * Math.PI * 220 * frame) / sampleRate)
            }
            engine.sample_set_ready(handle, frameCount, channelCount, sampleRate)
            satisfied++
        }
        return satisfied
    }
    // Satisfy pending soundfont requests: the test supplies the simplified blob bytes for each requested uuid
    // (mirrors the main-thread SoundfontLoader that builds the blob from the parsed .sf2).
    const drainSoundfonts = (build: (uuid: string) => ArrayBuffer): number => {
        let satisfied = 0
        for (; ;) {
            const requestPtr = engine.input_reserve(16)
            const handle = engine.soundfont_take_request(requestPtr)
            if (handle < 0) {break}
            const uuid = UUID.toString(new Uint8Array(memory.buffer.slice(requestPtr, requestPtr + 16)) as UUID.Bytes)
            const blob = new Uint8Array(build(uuid))
            const pointer = engine.soundfont_allocate(handle, blob.byteLength)
            new Uint8Array(memory.buffer, pointer, blob.byteLength).set(blob)
            engine.soundfont_set_ready(handle)
            satisfied++
        }
        return satisfied
    }
    return {engine, memory, namBridges, scriptBridges, deviceBuilds: () => engine.device_build_count() >>> 0, drainSamples, drainSoundfonts}
}
