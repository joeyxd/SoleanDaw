// Loads the REAL engine.wasm AND every device side-module (delay, gate, vaporisateur, playfield slot, …) the
// same way the AudioWorklet does (engine-processor.ts), so a test can drive the actual DSP graph — not the
// bare engine with an empty device table. Reuse this for any test that needs real devices / composites.
// The loading itself lives in node/load-engine.ts (shared with the Nitro render); this keeps the tests' view of it.

import type {LiveStreamBroadcaster} from "@opendaw/lib-fusion"
import * as path from "node:path"
import {readFileSync} from "node:fs"
import {createRequire} from "node:module"
import {FullEngine, loadEngine} from "../../node/load-engine"

export type {FullEngine}

const ENGINE_DIR = path.resolve(__dirname, "../../dist/wasm")

export const loadFullEngine = (sampleRate = 48000,
                               onScriptMessage: (uuid: string, message: string) => void = () => {},
                               broadcaster: () => LiveStreamBroadcaster | null = () => null): Promise<FullEngine> =>
    loadEngine({
        engineDir: ENGINE_DIR, sampleRate, onScriptMessage, broadcaster,
        // In node the NeuralAmp binary comes from the package.
        namWasm: async () => {
            const namWasmPath = createRequire(path.join(__dirname, "load-full-engine.ts")).resolve("@opendaw/nam-wasm/nam.wasm")
            const bytes = readFileSync(namWasmPath)
            // A node Buffer can sit at an offset inside a pooled ArrayBuffer; hand over exactly the file's bytes.
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        }
    })
