import {DefaultObservableValue, RuntimeNotifier, tryCatch} from "@opendaw/lib-std"
import {AudioData, WavFile} from "@opendaw/lib-dsp"
import type {PulseGridContext} from "./PulseGridContext"
import {PulseGridLibrary, PulseGridPackSound} from "./PulseGridLibrary"
import {PulseGridPackGroup} from "./PulseGridPackFiles"
import {PulseGridPackImport} from "./PulseGridPackImport"

// The import of a pack: read each file, decode it, write it as a 32-bit float WAV, upload it under its own id (four
// at a time), then save the pack's manifest (Nitro's daw/pulsegrid/AGENT_WIRE.md, section 8.5). Nothing about the
// PulseGrid changes by itself.

export type PulseGridPackEnv = {
    // Decodes any audio file the browser can read; rejects when it cannot.
    decode(buffer: ArrayBuffer): Promise<AudioData>
    // The one line the user reads at the end, or why it failed.
    say(text: string, kind: "info" | "error"): void
}

type Outcome = {kind: "sound", sound: PulseGridPackSound} | {kind: "skipped"}

let running = false

export namespace PulseGridPackRun {
    // A WAV file is read as it is (its own rate); anything else goes through the browser's audio context.
    export const decoder = (context: {decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>}) =>
        async (buffer: ArrayBuffer): Promise<AudioData> => {
            const wav = tryCatch(() => WavFile.decodeFloats(buffer))
            if (wav.status === "success") {return wav.value}
            const decoded = await context.decodeAudioData(buffer.slice(0))
            const audio = AudioData.create(decoded.sampleRate, decoded.length, decoded.numberOfChannels)
            for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
                audio.frames[channel].set(decoded.getChannelData(channel))
            }
            return audio
        }

    export const environment = (context: PulseGridContext): PulseGridPackEnv => ({
        decode: decoder(context.service.sampleService.audioContext),
        say: (text, kind) => context.notice.setValue({kind, text})
    })

    // Imports the packs one after the other. A second drop while one is running is refused.
    export const start = async (env: PulseGridPackEnv, found: Promise<ReadonlyArray<PulseGridPackGroup>>,
                                today: Date = new Date()): Promise<void> => {
        if (!PulseGridLibrary.active()) {return env.say(PulseGridPackImport.NotInNitro, "error")}
        if (running) {return env.say("A pack is being imported. Wait for it to finish.", "error")}
        running = true
        try {
            const groups = await found
            if (groups.length === 0) {return env.say("No sound files found.", "error")}
            for (const group of groups) {await importGroup(group, env, today)}
        } catch (error) {
            console.warn("PulseGrid pack import failed", error)
            env.say(`Could not read the pack: ${error instanceof Error ? error.message : String(error)}`, "error")
        } finally {
            running = false
        }
    }

    const importGroup = async (group: PulseGridPackGroup, env: PulseGridPackEnv, today: Date): Promise<void> => {
        const kept = group.files.filter(file => PulseGridPackImport.keep(file.path))
        const {name, id, files} = PulseGridPackImport.layout(group.zip, kept.map(file => file.path), today)
        if (kept.length === 0) {return env.say(`${name}: no sound files found`, "error")}
        await PulseGridLibrary.ready()
        const progress = new DefaultObservableValue(0.0)
        const dialog = RuntimeNotifier.progress({headline: `Importing ${name}`, progress})
        const outcomes: Array<Outcome> = []
        let failure: string | undefined
        let next = 0
        let done = 0
        const one = async (index: number): Promise<Outcome> => {
            const {name: fileName, dirs, parents} = files[index]
            const decoded = await kept[index].read().then(buffer => env.decode(buffer)).catch(() => undefined)
            if (decoded === undefined) {return {kind: "skipped"}}
            const channels = decoded.frames.length
            if (!PulseGridPackImport.fits(decoded.numberOfFrames, channels, decoded.sampleRate)) {return {kind: "skipped"}}
            const wav = WavFile.encodeFloats(decoded)
            const uuid = await PulseGridPackImport.uuidOf(wav)
            if (!PulseGridLibrary.has(uuid)) {
                const sent = await PulseGridLibrary.upload(uuid, wav)
                if (!sent.ok) {
                    failure ??= sent.message
                    return {kind: "skipped"}
                }
            }
            return {
                kind: "sound", sound: {
                    uuid, name: PulseGridPackImport.soundName(fileName),
                    folder: PulseGridPackImport.folderOf(name, dirs),
                    role: PulseGridPackImport.roleOf(fileName, parents), seconds: decoded.numberOfFrames / decoded.sampleRate
                }
            }
        }
        const work = async (): Promise<void> => {
            while (failure === undefined && next < files.length) {
                const index = next++
                outcomes[index] = await one(index).catch(() => ({kind: "skipped"}))
                progress.setValue(++done / files.length)
            }
        }
        try {
            await Promise.all(Array.from({length: PulseGridPackImport.Concurrency}, work))
        } finally {
            dialog.terminate()
        }
        if (failure !== undefined) {return env.say(`${name}: upload failed, ${failure}`, "error")}
        // The same bytes in two kit folders (a shared kick) are one sound in the manifest, but each folder keeps it
        // for its own kit, so kits are made from every copy and only the list of sounds is made unique.
        const every = outcomes.flatMap(outcome => outcome.kind === "sound" ? [outcome.sound] : [])
        const seen = new Set<string>()
        const all = every.filter(sound => !seen.has(sound.uuid) && seen.add(sound.uuid) !== undefined)
        const sounds = all.slice(0, PulseGridPackImport.MaxSounds)
        const listed = new Set(sounds.map(sound => sound.uuid))
        const skipped = outcomes.filter(outcome => outcome.kind === "skipped").length + all.length - sounds.length
        if (sounds.length === 0) {return env.say(`${name}: no sound could be read`, "error")}
        const kits = PulseGridPackImport.kits(name, every.filter(sound => listed.has(sound.uuid)))
        const saved = await PulseGridLibrary.savePack({id, name, source: group.source.slice(0, 200), sounds, kits})
        if (!saved.ok) {return env.say(`${name}: ${saved.message}`, "error")}
        env.say(`${name}: ${kits.length} kits, ${sounds.length} sounds${skipped > 0 ? `, ${skipped} skipped` : ""}`, "info")
    }
}
