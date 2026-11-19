import {int} from "@opendaw/lib-std"
import {AudioData} from "@opendaw/lib-dsp"
import {PulseGridError} from "./PulseGridTypes"

// The built-in drums (SPEC.md, section 12): 4 kits x 6 sounds that our own code makes, so a lane can play on any
// site with nothing to download. Pure math on arrays: no DOM, no WebAudio, no network. The same uuid and rate give
// the same samples every time (noise comes from a seeded generator, never Math.random).

export type PulseGridDrumRole = "Kick" | "Snare" | "Clap" | "Hat" | "Open Hat" | "Perc"
export type PulseGridDrum = {uuid: string, name: string, kit: string, role: PulseGridDrumRole, duration: number}

type Voice = {rate: int, frames: int, rand: () => number}
const TwoPi = Math.PI * 2
const FadeOut = 0.005
const Peak = 0.9

// mulberry32: a small seeded generator, 0 <= value < 1
const mulberry32 = (seed: int): () => number => {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
const seedOf = (text: string): int => {
    let hash = 2166136261
    for (let index = 0; index < text.length; index++) {hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)}
    return hash >>> 0
}

// One RBJ biquad (direct form 1): a band-pass (constant 0 dB peak) or a high-pass.
const biquad = (kind: "bandpass" | "highpass", frequency: number, q: number, rate: int,
                input: Float64Array): Float64Array => {
    const w = TwoPi * Math.min(frequency, rate * 0.45) / rate
    const cos = Math.cos(w)
    const alpha = Math.sin(w) / (2 * q)
    const b0 = kind === "bandpass" ? alpha : (1 + cos) / 2
    const b1 = kind === "bandpass" ? 0 : -(1 + cos)
    const b2 = kind === "bandpass" ? -alpha : (1 + cos) / 2
    const a0 = 1 + alpha
    const a1 = -2 * cos
    const a2 = 1 - alpha
    const out = new Float64Array(input.length)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let index = 0; index < input.length; index++) {
        const x0 = input[index]
        const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
        out[index] = y0
        x2 = x1
        x1 = x0
        y2 = y1
        y1 = y0
    }
    return out
}

const fill = ({frames, rate}: Voice, make: (t: number, index: int) => number): Float64Array => {
    const out = new Float64Array(frames)
    for (let index = 0; index < frames; index++) {out[index] = make(index / rate, index)}
    return out
}
const noise = (voice: Voice): Float64Array => fill(voice, () => voice.rand() * 2 - 1)
const square = (frequency: number, t: number): number => Math.sin(TwoPi * frequency * t) >= 0 ? 1 : -1
const decay = (t: number, tau: number): number => Math.exp(-t / tau)

// Kick: a sine whose pitch falls from `start` to `end`, a short click, then a soft clip.
const kick = (voice: Voice, [end, start, pitchTau, ampTau, click]: ReadonlyArray<number>): Float64Array => {
    const clicks = Math.round(0.002 * voice.rate)
    let phase = 0
    return fill(voice, (t, index) => {
        phase += TwoPi * (end + (start - end) * decay(t, pitchTau)) / voice.rate
        const hit = index < clicks ? click * (voice.rand() * 2 - 1) * (1 - index / clicks) : 0
        return Math.tanh(1.2 * (Math.sin(phase) * decay(t, ampTau) + hit))
    })
}

// Snare: two sines and high-passed noise, the noise about 60% of the mix.
const snare = (voice: Voice, [low, high, toneTau, cutoff, noiseTau]: ReadonlyArray<number>): Float64Array => {
    const air = biquad("highpass", cutoff, 0.7, voice.rate, noise(voice))
    return fill(voice, (t, index) =>
        0.4 * (Math.sin(TwoPi * low * t) + Math.sin(TwoPi * high * t)) * 0.5 * decay(t, toneTau) +
        0.6 * air[index] * decay(t, noiseTau))
}

// Clap: band-passed noise in four bursts 11 ms apart, the last one with a long tail.
const clap = (voice: Voice, [centre, q, tail]: ReadonlyArray<number>): Float64Array => {
    const body = biquad("bandpass", centre, q, voice.rate, noise(voice))
    return fill(voice, (t, index) => {
        let envelope = 0
        for (const start of [0, 0.011, 0.022, 0.033]) {if (t >= start) {envelope += decay(t - start, 0.006)}}
        if (t >= 0.033) {envelope += 0.6 * decay(t - 0.033, tail)}
        return body[index] * envelope
    })
}

// Hat: six square waves, band-passed, then high-passed. Closed and open differ only in how long they ring.
const hat = (voice: Voice, [stretch, cutoff, tau]: ReadonlyArray<number>): Float64Array => {
    const metal = fill(voice, t => [205.3, 304.4, 369.6, 522.7, 540, 800].reduce((sum, f) => sum + square(f * stretch, t), 0))
    const bright = biquad("highpass", cutoff, 0.7, voice.rate, biquad("bandpass", 3400, 1, voice.rate, metal))
    return fill(voice, (t, index) => bright[index] * decay(t, tau))
}

const clave = (voice: Voice, [frequency, tau]: ReadonlyArray<number>): Float64Array =>
    fill(voice, t => Math.sin(TwoPi * frequency * t) * decay(t, tau))
const rim = (voice: Voice, [frequency, tau]: ReadonlyArray<number>): Float64Array =>
    fill(voice, t => (Math.sin(TwoPi * frequency * t) + 0.5 * (voice.rand() * 2 - 1) * decay(t, 0.002)) * decay(t, tau))
const cowbell = (voice: Voice, [centre, tau]: ReadonlyArray<number>): Float64Array => {
    const metal = fill(voice, t => square(540, t) + square(800, t))
    const body = biquad("bandpass", centre, 1, voice.rate, metal)
    return fill(voice, (t, index) => body[index] * decay(t, tau))
}
const shaker = (voice: Voice, [cutoff, tau]: ReadonlyArray<number>): Float64Array => {
    const hiss = biquad("highpass", cutoff, 0.7, voice.rate, noise(voice))
    return fill(voice, (t, index) => hiss[index] * Math.min(t / 0.01, 1) * decay(t, tau))
}

// Each sound: how it is made, then the numbers that tune it. The Analog numbers are the starting points.
type Recipe = {make: (voice: Voice, numbers: ReadonlyArray<number>) => Float64Array, numbers: ReadonlyArray<number>}
const recipe = (make: Recipe["make"], ...numbers: Array<number>): Recipe => ({make, numbers})

const Recipes: Readonly<Record<string, Recipe>> = {
    "Analog Kick": recipe(kick, 48, 165, 0.035, 0.35, 0.3),
    "Punch Kick": recipe(kick, 55, 220, 0.02, 0.16, 0.6),
    "Electro Kick": recipe(kick, 60, 400, 0.012, 0.12, 0.4),
    "Soft Kick": recipe(kick, 45, 110, 0.05, 0.25, 0),
    "Analog Snare": recipe(snare, 180, 330, 0.07, 1500, 0.14),
    "Punch Snare": recipe(snare, 200, 360, 0.09, 1200, 0.12),
    "Electro Snare": recipe(snare, 220, 400, 0.05, 2000, 0.10),
    "Soft Snare": recipe(snare, 160, 290, 0.06, 1000, 0.16),
    "Analog Clap": recipe(clap, 1200, 1.5, 0.09),
    "Punch Clap": recipe(clap, 1000, 1.2, 0.12),
    "Electro Clap": recipe(clap, 1600, 2, 0.07),
    "Soft Clap": recipe(clap, 900, 1, 0.10),
    "Analog Hat": recipe(hat, 1, 7000, 0.035),
    "Punch Hat": recipe(hat, 1, 6000, 0.04),
    "Electro Hat": recipe(hat, 1.2, 7000, 0.03),
    "Soft Hat": recipe(hat, 0.9, 5500, 0.05),
    "Analog Open Hat": recipe(hat, 1, 7000, 0.28),
    "Punch Open Hat": recipe(hat, 1, 6000, 0.25),
    "Electro Open Hat": recipe(hat, 1.2, 7000, 0.22),
    "Soft Open Hat": recipe(hat, 0.9, 5500, 0.34),
    "Analog Perc": recipe(clave, 2500, 0.03),
    "Punch Perc": recipe(rim, 1700, 0.02),
    "Electro Perc": recipe(cowbell, 2600, 0.12),
    "Soft Perc": recipe(shaker, 5000, 0.06)
}

const row = (kit: string, role: PulseGridDrumRole, uuid: string, duration: number): PulseGridDrum =>
    ({uuid, name: `${kit} ${role}`, kit, role, duration: Math.fround(duration)}) // as a sampler box stores it

export namespace PulseGridDrums {
    export const Kits: ReadonlyArray<string> = ["Analog", "Punch", "Electro", "Soft"]
    export const Roles: ReadonlyArray<PulseGridDrumRole> = ["Kick", "Snare", "Clap", "Hat", "Open Hat", "Perc"]

    // `duration` is where each sound's envelope is 60 dB down (seconds); render makes exactly that many frames.
    export const All: ReadonlyArray<PulseGridDrum> = [
        row("Analog", "Kick", "bfcfb4af-ac29-4b2c-a6e7-f14e62250b77", 2.4177),
        row("Analog", "Snare", "f7a029fc-ef64-4bc9-b818-d41a4dbd99ab", 0.9671),
        row("Analog", "Clap", "bd494595-40fc-4d97-8728-b21a330592b1", 0.6547),
        row("Analog", "Hat", "63a8751b-162f-438d-b720-b1e436351538", 0.2418),
        row("Analog", "Open Hat", "934fc494-3a61-42c8-abc2-455079f830f9", 1.9342),
        row("Analog", "Perc", "e2758544-a2b5-40c9-b464-f891c6fc0779", 0.2072),
        row("Punch", "Kick", "b0bcd306-1527-4014-b6c1-7599116fad55", 1.1052),
        row("Punch", "Snare", "2083794b-6137-48a9-bf38-a1acd9a75c9e", 0.8289),
        row("Punch", "Clap", "fa889d2f-c491-49aa-97c4-595a8827c5be", 0.8619),
        row("Punch", "Hat", "ec52b5c0-e7b2-4e75-9a3b-5605dfb9a5e8", 0.2763),
        row("Punch", "Open Hat", "a2f70f05-a63b-48df-9629-0adbc85058c2", 1.7269),
        row("Punch", "Perc", "afcb9ac6-ca76-4103-9ae5-db9df2f2bb61", 0.1382),
        row("Electro", "Kick", "4063ca64-ddc2-4a34-bd45-05f9ebeb74bf", 0.8289),
        row("Electro", "Snare", "9496b562-8c93-4bd7-9a71-6a9b39e4a4d2", 0.6908),
        row("Electro", "Clap", "79d0d41b-d4e7-4e23-903b-95fb367eca4e", 0.5165),
        row("Electro", "Hat", "79d2d800-e88b-4bb9-a7b8-89ab96b94edf", 0.2072),
        row("Electro", "Open Hat", "316574ae-2337-4ebe-8a01-629ab20a3e7c", 1.5197),
        row("Electro", "Perc", "59f927f9-a8dc-4767-b90a-d5d1e09b187f", 0.8289),
        row("Soft", "Kick", "4e5b0c5d-1d98-4cc5-9739-4020e5d3085e", 1.7269),
        row("Soft", "Snare", "07acd89c-4d35-4cea-8a19-a7c9aa9ad10f", 1.1052),
        row("Soft", "Clap", "b67c8bbd-10fc-44c3-b660-c6c27094630f", 0.7238),
        row("Soft", "Hat", "f0dd1cb7-7009-4790-9760-379be4375096", 0.3454),
        row("Soft", "Open Hat", "4d6aa648-b61c-4ddd-aa6c-0f72849da0cd", 2.3486),
        row("Soft", "Perc", "a352a04e-864e-4c1c-ab63-604a413dc065", 0.4245)
    ]

    export const find = (uuid: string): PulseGridDrum | undefined =>
        All.find(drum => drum.uuid === uuid.toLowerCase())

    // By its name ("Analog Kick"), whatever the case or the spaces around it.
    export const byName = (name: string): PulseGridDrum | undefined => {
        const wanted = name.trim().toLowerCase().replace(/\s+/g, " ")
        return All.find(drum => drum.name.toLowerCase() === wanted)
    }

    export const sample = (name: string): {uuid: string, name: string, duration: number} => {
        const {uuid, name: shown, duration} = byName(name)!
        return {uuid, name: shown, duration}
    }

    // The sound an agent's `{"drum": name}` means, as the sampler input the lane is built from.
    export const input = (name: unknown, label?: string): {
        instrument: "Nano", sample: {uuid: string, name: string, duration: number}, label?: string
    } => {
        const drum = typeof name === "string" ? byName(name) : undefined
        if (drum === undefined) {
            throw new PulseGridError(`drum ${String(name)} is not known; kits: ${Kits.join(", ")}; ` +
                `a drum is a kit and a sound, one of ${Roles.join(", ")}, as in "Analog Kick"`)
        }
        return {instrument: "Nano", sample: {uuid: drum.uuid, name: drum.name, duration: drum.duration},
            ...(label === undefined ? {} : {label})}
    }

    // Mono audio of a built-in drum: its table `duration` long, a 5 ms fade at the end, the loudest sample at 0.9.
    // Undefined when the uuid is not one of ours.
    export const render = (uuid: string, sampleRate: int): AudioData | undefined => {
        const drum = find(uuid)
        if (drum === undefined) {return undefined}
        const frames = Math.max(1, Math.round(drum.duration * sampleRate))
        const {make, numbers} = Recipes[drum.name]
        const raw = make({rate: sampleRate, frames, rand: mulberry32(seedOf(drum.uuid))}, numbers)
        const fade = Math.min(frames, Math.round(FadeOut * sampleRate))
        for (let index = 0; index < fade; index++) {raw[frames - 1 - index] *= index / fade}
        let peak = 0
        for (let index = 0; index < frames; index++) {peak = Math.max(peak, Math.abs(raw[index]))}
        const gain = peak > 0 ? Peak / peak : 0
        const audio = AudioData.create(sampleRate, frames, 1)
        for (let index = 0; index < frames; index++) {audio.frames[0][index] = raw[index] * gain}
        return audio
    }
}
