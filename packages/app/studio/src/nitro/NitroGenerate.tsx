// SPDX-License-Identifier: AGPL-3.0-or-later
// Nitro AI on the timeline: a clip's menu sends it to a Nitro job, a placeholder clip shows the progress, the result replaces it.
import {createElement} from "@opendaw/lib-jsx"
import {Errors, isAbsent, isDefined, isInstanceOf, Nullable, Option, Optional, RuntimeNotifier, tryCatch, UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {AudioData, PPQN, ppqn, WavFile} from "@opendaw/lib-dsp"
import {
    AudioBounce,
    AudioContentFactory,
    AudioFileBoxFactory,
    MenuItem,
    OfflineEngineRenderer,
    Project,
    Workers
} from "@opendaw/studio-core"
import {AnyRegionBoxAdapter, AudioUnitBoxAdapter, InstrumentFactories, Sample} from "@opendaw/studio-adapters"
import {AudioRegionBox, AudioUnitBox, NoteRegionBox, TrackBox} from "@opendaw/studio-boxes"
import {Dialogs} from "@/ui/components/dialogs"
import type {StudioService} from "@/service/StudioService"

type Task = "generate" | "arrangement" | "accompaniment" | "lyrics" | "vocals"
type Engine = {
    id: string, name: string, licence: string, tasks: Array<Task>, seconds: [number, number],
    needs_source: Array<Task>, about: string, condition: Nullable<string>, admitted: boolean, attested: boolean,
    reason: string, state: string, detail: string
}
type Output = { label: string, media_type: string, seconds: Nullable<number> }
type Line = { section: string, text: string }
type Job = {
    id: string, task: Task, engine: string, engine_name: string, state: string, phase: string,
    progress: Nullable<number>, message: string, eta_seconds: Nullable<number>, elapsed_seconds: number,
    queue_position?: number, outputs: Array<Output>, placement: Nullable<{ region?: string, position?: number }>,
    lines?: Array<Line>, result: Nullable<{ cost_usd?: number, lyrics?: string }>, error: Nullable<string>,
    params: { seconds: number, prompt: string }
}
type Request = {
    task: Task, engine: string, prompt: string, lyrics: string, seconds: number, instrumental: boolean,
    language: string, attest: boolean
}
type Row = {
    element: HTMLElement, message: HTMLElement, bar: HTMLElement, meta: HTMLElement, action: HTMLButtonElement
}
type Tracked = { job: Job, region: Optional<string>, row: Row, landing: boolean, finishedAt: number }

const Tasks: Record<Task, { menu: string, title: string, action: string, prompt: string }> = {
    generate: {menu: "Generate…", title: "Generate music", action: "Generate", prompt: "Style, mood, instruments"},
    arrangement: {
        menu: "Make arrangement…", title: "Make an arrangement from this clip", action: "Arrange",
        prompt: "How the full arrangement should sound"
    },
    accompaniment: {
        menu: "Make accompaniment…", title: "Make an accompaniment for this clip", action: "Accompany",
        prompt: "The band you want around this clip"
    },
    lyrics: {menu: "Make lyrics…", title: "Write lyrics", action: "Write", prompt: "What the song is about"},
    vocals: {menu: "Make vocals…", title: "Make vocals over this clip", action: "Sing", prompt: "The voice you want"}
}
const Order: ReadonlyArray<Task> = ["generate", "arrangement", "accompaniment", "lyrics", "vocals"]
const ActiveStates = new Set(["queued", "running", "cancel_requested"])
const WriteHeaders = {"x-nitro-daw": "1"}
const Placeholder = "⏳"
const Dim = "#8a9bb0"

let attached: Nullable<{ key: string, service: StudioService }> = null
let panel: Nullable<HTMLElement> = null
let polling: Nullable<number> = null
let pollBusy = false
let enginesCache: Nullable<{ at: number, engines: ReadonlyArray<Engine> }> = null
let placeholderSample: Nullable<Promise<{ sample: Sample, audioData: AudioData }>> = null
const tracked = new Map<string, Tracked>()

const route = (path: string): string => `/nitro-api/projects/${encodeURIComponent(attached?.key ?? "")}${path}`

const fetchJson = async <T, >(path: string, init?: RequestInit): Promise<Nullable<T>> => {
    const response = await fetch(route(path), init).catch(() => null)
    if (response === null) {return null}
    if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { detail?: string, error?: string }
        throw new Error(detail.detail ?? detail.error ?? `Nitro answered ${response.status}`)
    }
    return await response.json() as T
}

const post = <T, >(path: string, body: unknown): Promise<Nullable<T>> => fetchJson<T>(path, {
    method: "POST", headers: {...WriteHeaders, "content-type": "application/json"}, body: JSON.stringify(body)
})

const engines = async (): Promise<ReadonlyArray<Engine>> => {
    if (isDefined(enginesCache) && Date.now() - enginesCache.at < 15_000) {return enginesCache.engines}
    const answer = await fetchJson<{ engines: Array<Engine> }>("/engines")
    const list = answer?.engines ?? []
    enginesCache = {at: Date.now(), engines: list}
    return list
}

const clock = (seconds: number): string => {
    const whole = Math.max(0, Math.round(seconds))
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

const meter = (progress: Nullable<number>): string => {
    if (isAbsent(progress)) {return "▱▱▱▱▱▱▱▱▱▱"}
    const filled = Math.round(Math.max(0, Math.min(1, progress)) * 10)
    return "▰".repeat(filled) + "▱".repeat(10 - filled)
}

const describe = (job: Job): string => {
    if (job.state === "queued") {
        const ahead = job.queue_position ?? 0
        return ahead > 0 ? `Waiting in line, ${ahead} ahead` : "Waiting in line"
    }
    const percent = isDefined(job.progress) ? ` ${Math.round(job.progress * 100)}%` : ""
    const left = isDefined(job.eta_seconds) && job.eta_seconds > 0 ? ` · about ${clock(job.eta_seconds)} left` : ""
    return `${job.message}${percent}${left}`
}

const clipName = (job: Job): string => `${job.engine_name} · ${Tasks[job.task].title.replace(/ (from|for|over) this clip$/, "")}`

const placeholderLabel = (job: Job): string =>
    `${Placeholder} ${clipName(job)} · ${meter(job.progress)} ${describe(job)}`

const findRegion = (project: Project, uuid: Nullable<string> | undefined): Option<AudioRegionBox | NoteRegionBox> => {
    if (!isDefined(uuid)) {return Option.None}
    const bytes = UUID.parse(uuid)
    return project.boxGraph.findBox(bytes).flatMap(box =>
        isInstanceOf(box, AudioRegionBox) || isInstanceOf(box, NoteRegionBox) ? Option.wrap(box) : Option.None)
}

// Progress labels change outside the undo history: a running job must not add undo steps.
const relabel = (project: Project, uuid: Nullable<string> | undefined, text: string): void => {
    findRegion(project, uuid).ifSome(box => {
        if (box.label.getValue() === text || project.boxGraph.inTransaction()) {return}
        project.boxGraph.beginTransaction()
        box.label.setValue(text)
        project.boxGraph.endTransaction()
    })
}

const trackOf = (box: AudioRegionBox | NoteRegionBox): Option<TrackBox> =>
    box.regions.targetVertex.flatMap(vertex => isInstanceOf(vertex.box, TrackBox) ? Option.wrap(vertex.box) : Option.None)

const renderClip = async (project: Project, region: AnyRegionBoxAdapter, sampleRate: number,
                          maxSeconds: number): Promise<Nullable<AudioData>> => {
    if (!AudioBounce.isBounceable(region)) {return null}
    const job = AudioBounce.collectJobs([region], false, false).at(0)
    if (!isDefined(job)) {return null}
    const copy = project.copy()
    AudioBounce.prepareCopy(copy, job)
    const full = AudioBounce.renderSpan(project, job, false, sampleRate)
    const span = {...full, numFrames: Math.min(full.numFrames, Math.round(maxSeconds * sampleRate))}
    const renderer = await OfflineEngineRenderer.create(copy,
        Option.wrap(AudioBounce.exportConfiguration(job, "pre-fader")), sampleRate)
    const result = await Promises.tryCatch((async () => {
        await renderer.waitForLoading()
        renderer.setPosition(job.start)
        await renderer.play()
        await renderer.waitForLoading()
        return AudioBounce.renderFrames(count => renderer.step(count), span, sampleRate)
    })())
    renderer.terminate()
    return result.status === "resolved" ? result.value : null
}

const notesOf = (project: Project, region: AnyRegionBoxAdapter): Nullable<Array<{
    pitch: number, start: number, duration: number, velocity: number
}>> => {
    if (region.type !== "note-region") {return null}
    const {tempoMap} = project
    const from = region.loopOffset
    const to = region.loopOffset + region.duration
    return region.optCollection.mapOr(collection => collection.events.asArray()
        .filter(event => event.position >= from && event.position < to)
        .slice(0, 4096)
        .map(event => ({
            pitch: event.pitch,
            start: tempoMap.intervalToSeconds(region.position, region.position + event.position - from),
            duration: Math.max(0.01, tempoMap.intervalToSeconds(region.position + event.position - from,
                region.position + event.position - from + event.duration)),
            velocity: event.velocity
        })), null)
}

const decodeAudio = async (service: StudioService, buffer: ArrayBuffer): Promise<AudioData> => {
    const decoded = tryCatch(() => WavFile.decodeFloats(buffer))
    if (decoded.status === "success") {return decoded.value}
    const audioBuffer = await service.sampleService.audioContext.decodeAudioData(buffer.slice(0))
    const audioData = AudioData.create(audioBuffer.sampleRate, audioBuffer.length, audioBuffer.numberOfChannels)
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        audioData.frames[channel].set(audioBuffer.getChannelData(channel))
    }
    return audioData
}

const silentSample = (service: StudioService): Promise<{ sample: Sample, audioData: AudioData }> => {
    if (isDefined(placeholderSample)) {return placeholderSample}
    const audioData = AudioData.create(48000, 48000, 1)
    placeholderSample = service.sampleService.importFile({
        name: "Nitro placeholder", bpm: service.project.timelineBox.bpm.getValue(),
        arrayBuffer: WavFile.encodeFloats(audioData)
    }).then(sample => ({sample, audioData}))
    return placeholderSample
}

const lyricsAround = (project: Project, from: ppqn, to: ppqn): string => {
    const lines: Array<{ position: ppqn, text: string }> = []
    project.rootBoxAdapter.audioUnits.adapters()
        .filter(unit => unit.label.startsWith("Lyrics"))
        .forEach(unit => unit.tracks.values().forEach(track => track.regions.collection.asArray()
            .filter(region => region.position < to && region.complete > from && region.label.length > 0 &&
                !region.label.startsWith(Placeholder))
            .forEach(region => lines.push({position: region.position, text: region.label}))))
    return lines.sort((left, right) => left.position - right.position).map(line => line.text).join("\n")
}

const field = (label: string, input: HTMLElement, hint?: HTMLElement): HTMLElement => (
    <label style={{display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px"}}>
        <span style={{color: Dim}}>{label}</span>
        {input}
        {hint ?? ""}
    </label>
)

const ask = async (task: Task, list: ReadonlyArray<Engine>, clip: {
    seconds: number, label: string, track: string, bpm: number, lyrics: string
}): Promise<Nullable<Request>> => {
    const usable = list.filter(engine => engine.tasks.includes(task))
    if (usable.length === 0) {
        await RuntimeNotifier.info({headline: "Nitro AI", message: "No engine on this Desk can do that yet."})
        return null
    }
    const preferred = usable.find(engine => engine.admitted && engine.state === "ready") ??
        usable.find(engine => engine.admitted) ?? usable[0]
    const engineField: HTMLSelectElement = (
        <select className="default">
            {usable.map(engine => (
                <option value={engine.id} disabled={!engine.admitted}>
                    {`${engine.name}${engine.admitted ? engine.state === "ready" ? "" : ` (${engine.state.replace("_", " ")})` : " (not for this Desk)"}`}
                </option>
            ))}
        </select>
    )
    engineField.value = preferred.id
    const about: HTMLElement = (<p style={{margin: "0", fontSize: "11px", color: Dim, lineHeight: "1.4"}}/>)
    const attestField: HTMLInputElement = (<input type="checkbox"/>)
    const attestText: HTMLElement = (<span/>)
    const attestRow: HTMLElement = (
        <label style={{display: "flex", gap: "8px", fontSize: "11px", alignItems: "flex-start"}}>
            {attestField}{attestText}
        </label>
    )
    const range = (): [number, number] => usable.find(engine => engine.id === engineField.value)?.seconds ?? [5, 240]
    const lyricsDefault = task === "vocals" || task === "generate" ? clip.lyrics : ""
    const promptField: HTMLTextAreaElement = (
        <textarea className="default" rows={3} placeholder={Tasks[task].prompt} maxLength={1200}/>
    )
    const lyricsField: HTMLTextAreaElement = (
        <textarea className="default" rows={task === "vocals" ? 7 : 4} maxLength={6000}
                  placeholder={"[verse]\nFirst line\nSecond line\n[chorus]\n…"}/>
    )
    lyricsField.value = lyricsDefault
    const initialSeconds = task === "generate" ? 30 : task === "arrangement" ? Math.max(60, Math.round(clip.seconds))
        : Math.round(clip.seconds)
    const secondsField: HTMLInputElement = (<input type="number" className="default" step="1" style={{width: "90px"}}/>)
    const languageField: HTMLInputElement = (<input type="text" className="default" placeholder="English" maxLength={32}/>)
    const instrumentalField: HTMLInputElement = (<input type="checkbox"/>)
    const chips: HTMLElement = (<div style={{display: "flex", flexWrap: "wrap", gap: "6px"}}/>)
    const showChips = (suggestions: ReadonlyArray<string>): void => {
        chips.replaceChildren(...suggestions.map(suggestion => (
            <button type="button" onclick={() => {promptField.value = suggestion}}
                    style={{
                        fontSize: "11px", padding: "3px 8px", borderRadius: "10px", cursor: "pointer",
                        background: "#1d2a38", color: "#cfe0ee", border: "1px solid #2c3e50"
                    }}>{suggestion}</button>
        )))
    }
    const ideas: HTMLButtonElement = (
        <button type="button" style={{
            fontSize: "11px", padding: "3px 8px", borderRadius: "10px", cursor: "pointer",
            background: "transparent", color: "#8fb8d1", border: "1px dashed #2c3e50"
        }}>Ideas from Max</button>
    )
    ideas.onclick = () => {
        ideas.disabled = true
        ideas.textContent = "Asking Max…"
        post<{ suggestions: Array<string> }>("/suggest", {
            task, context: {clip: clip.label, track: clip.track, bpm: Math.round(clip.bpm), prompt: promptField.value}
        }).then(answer => showChips(answer?.suggestions ?? []), () => undefined)
            .finally(() => {
                ideas.disabled = false
                ideas.textContent = "Ideas from Max"
            })
    }
    post<{ suggestions: Array<string> }>("/suggest", {task}).then(answer => showChips(answer?.suggestions ?? []),
        () => undefined)
    const update = (): void => {
        const engine = usable.find(candidate => candidate.id === engineField.value) ?? preferred
        const [low, high] = engine.seconds
        secondsField.min = String(low)
        secondsField.max = String(high)
        const current = Number(secondsField.value || initialSeconds)
        secondsField.value = String(Math.min(high, Math.max(low, Math.round(current))))
        const status = engine.state === "ready" ? "" : ` Now: ${engine.detail || engine.state.replace("_", " ")}.`
        about.textContent = `${engine.about}${engine.admitted ? "" : ` ${engine.reason}.`}${status}`
        const needsAttest = engine.licence === "conditional" && !engine.attested
        attestRow.classList.toggle("hidden", !needsAttest)
        attestText.textContent = `I confirm: ${engine.condition ?? ""}.`
    }
    secondsField.value = String(initialSeconds)
    engineField.onchange = update
    update()
    const lyricsWanted = task === "vocals" || task === "generate" || task === "arrangement"
    const content: HTMLElement = (
        <div style={{display: "flex", flexDirection: "column", gap: "10px", width: "min(500px, 80vw)"}}>
            {field("Engine", engineField, about)}
            {attestRow}
            {field(task === "lyrics" ? "Theme" : "Prompt", promptField, chips)}
            <div style={{display: "flex", gap: "8px", alignItems: "center"}}>{ideas}</div>
            {lyricsWanted ? field(task === "vocals" ? "Lyrics to sing" : "Lyrics (optional)", lyricsField) : ""}
            <div style={{display: "flex", gap: "16px", alignItems: "flex-end", flexWrap: "wrap"}}>
                {field("Seconds", secondsField)}
                {task === "lyrics" || task === "vocals" || task === "generate" ? field("Language", languageField) : ""}
                {task === "generate" || task === "arrangement" ? (
                    <label style={{display: "flex", gap: "6px", fontSize: "12px", alignItems: "center"}}>
                        {instrumentalField}<span>Instrumental</span></label>) : ""}
            </div>
            <p style={{margin: "0", fontSize: "11px", color: Dim}}>
                {`The result lands on a new track at this clip, labelled with its engine. Clip: ${clip.label || "untitled"}, ${clock(clip.seconds)}.`}
            </p>
        </div>
    )
    const answer = await Promises.tryCatch(Dialogs.show({
        headline: Tasks[task].title, content, okText: Tasks[task].action, growWidth: true
    }))
    if (answer.status === "rejected") {
        if (Errors.isAbort(answer.error)) {return null}
        throw answer.error
    }
    const [low, high] = range()
    return {
        task, engine: engineField.value, prompt: promptField.value.trim(), lyrics: lyricsWanted ? lyricsField.value.trim() : "",
        seconds: Math.min(high, Math.max(low, Number(secondsField.value) || initialSeconds)),
        instrumental: instrumentalField.checked, language: languageField.value.trim(), attest: attestField.checked
    }
}

const ensurePanel = (): HTMLElement => {
    if (isDefined(panel)) {return panel}
    const style = document.createElement("style")
    style.textContent = "@keyframes nitro-busy{from{background-position:0 0}to{background-position:40px 0}}"
    document.head.appendChild(style)
    panel = document.createElement("div")
    panel.style.cssText = "position:fixed;right:12px;bottom:60px;z-index:9999;width:320px;display:flex;" +
        "flex-direction:column;gap:8px;font:12px system-ui,sans-serif;color:#dfe8f0"
    document.body.appendChild(panel)
    return panel
}

const createRow = (job: Job): Row => {
    const message: HTMLElement = (<div style={{color: "#b9c7d4"}}/>)
    const bar: HTMLElement = (<div style={{height: "100%", width: "0", background: "#4f9fd8", transition: "width .4s"}}/>)
    const meta: HTMLElement = (<div style={{color: Dim, fontSize: "11px"}}/>)
    const action: HTMLButtonElement = (
        <button type="button" style={{
            background: "none", border: "none", color: "#8fb8d1", cursor: "pointer", fontSize: "11px"
        }}/>
    )
    const element: HTMLElement = (
        <div style={{
            background: "#16202c", border: "1px solid #2c3e50", borderRadius: "8px", padding: "8px 10px",
            display: "flex", flexDirection: "column", gap: "6px", boxShadow: "0 4px 14px rgba(0,0,0,.35)"
        }}>
            <div style={{display: "flex", justifyContent: "space-between", gap: "8px"}}>
                <b>{clipName(job)}</b>{action}
            </div>
            {message}
            <div style={{height: "6px", background: "#0e151d", borderRadius: "3px", overflow: "hidden"}}>{bar}</div>
            {meta}
        </div>
    )
    ensurePanel().appendChild(element)
    return {element, message, bar, meta, action}
}

const paint = (item: Tracked): void => {
    const {job, row} = item
    const {bar, action} = row
    const active = ActiveStates.has(job.state)
    const indeterminate = active && isAbsent(job.progress)
    bar.style.width = indeterminate ? "100%" : `${Math.round((job.state === "succeeded" ? 1 : job.progress ?? 0) * 100)}%`
    bar.style.background = job.state === "failed" || job.state === "outcome_unknown" ? "#d06a6a"
        : indeterminate ? "repeating-linear-gradient(45deg,#2b5a7d 0 10px,#4f9fd8 10px 20px)" : "#4f9fd8"
    bar.style.backgroundSize = indeterminate ? "40px 100%" : ""
    bar.style.animation = indeterminate ? "nitro-busy 1s linear infinite" : ""
    const text = item.landing ? "Placing it on the timeline…" : job.state === "succeeded"
        ? "Done, on the timeline" : job.state === "failed" ? `Failed: ${job.error ?? job.message}`
            : job.state === "cancelled" ? "Cancelled" : job.state === "outcome_unknown" ? job.message : describe(job)
    row.message.textContent = text
    const cost = isDefined(job.result?.cost_usd) ? ` · about $${job.result.cost_usd.toFixed(3)}` : ""
    row.meta.textContent = `${clock(job.elapsed_seconds)} elapsed${cost}`
    action.textContent = active ? "Cancel" : "Close"
    action.onclick = () => {
        if (ActiveStates.has(job.state)) {
            post(`/jobs/${job.id}/cancel`, {}).catch(console.warn)
        } else {
            row.element.remove()
            tracked.delete(job.id)
        }
    }
}

// A placeholder made its own track; the track goes too unless something else was put on it.
const removePlaceholder = (project: Project, job: Job): void => {
    findRegion(project, job.placement?.region).ifSome(box => project.editing.modify(() => {
        const unit = trackOf(box).flatMap(track => track.target.targetVertex)
            .flatMap(vertex => isInstanceOf(vertex.box, AudioUnitBox) ? Option.wrap(vertex.box) : Option.None)
        const others = unit.mapOr(audioUnit => project.boxAdapters.adapterFor(audioUnit, AudioUnitBoxAdapter)
            .tracks.values().flatMap(track => track.regions.collection.asArray())
            .filter(region => !UUID.equals(region.uuid, box.address.uuid)).length, 0)
        if (unit.nonEmpty() && others === 0) {
            project.api.deleteAudioUnit(unit.unwrap())
        } else {
            box.delete()
        }
    }))
}

const landAudio = async (service: StudioService, job: Job): Promise<void> => {
    const {project} = service
    const output = job.outputs.find(item => item.label === "audio") ?? job.outputs[0]
    const response = await fetch(route(`/jobs/${job.id}/outputs/${output.label}`))
    if (!response.ok) {throw new Error("the generated audio could not be downloaded")}
    const buffer = await response.arrayBuffer()
    const audioData = await decodeAudio(service, buffer)
    const name = clipName(job)
    const sample = await service.sampleService.importFile({
        name, bpm: project.timelineBox.bpm.getValue(), arrayBuffer: WavFile.encodeFloats(audioData)
    })
    const modifier = await AudioFileBoxFactory.createModifier(Workers.Transients, project.boxGraph, audioData,
        UUID.parse(sample.uuid), sample.name)
    const placed = project.editing.modify(() => {
        const existing = findRegion(project, job.placement?.region)
        const position = existing.mapOr(box => box.position.getValue(), job.placement?.position ?? 0)
        const track = existing.flatMap(trackOf).unwrapOrElse(() => {
            const {audioUnitBox, trackBox} = project.api.createInstrument(InstrumentFactories.Tape, {name})
            project.api.placeAudioUnit(audioUnitBox, 0)
            return trackBox
        })
        existing.ifSome(box => box.delete())
        const region = AudioContentFactory.createNotStretchedRegion({
            boxGraph: project.boxGraph, targetTrack: track, audioFileBox: modifier(), sample, position, name
        })
        project.trackUserCreatedSample(UUID.parse(sample.uuid))
        return UUID.toString(region.address.uuid)
    })
    await post(`/jobs/${job.id}/placed`, placed.mapOr<{ region?: string }>(uuid => ({region: uuid}), {}))
}

const landLyrics = async (service: StudioService, job: Job): Promise<void> => {
    const {project} = service
    const lines = job.lines ?? []
    const {nominator, denominator} = project.timelineBox.signature
    const bar = PPQN.fromSignature(nominator.getValue(), denominator.getValue())
    project.editing.modify(() => {
        const existing = findRegion(project, job.placement?.region)
        const start = existing.mapOr(box => box.position.getValue(), job.placement?.position ?? 0)
        const track = existing.flatMap(trackOf).unwrapOrElse(() => {
            const {audioUnitBox, trackBox} = project.api.createInstrument(InstrumentFactories.Vaporisateur, {name: "Lyrics"})
            audioUnitBox.mute.setValue(true)
            return trackBox
        })
        existing.ifSome(box => box.delete())
        lines.forEach((line, index) => project.api.createNoteRegion({
            trackBox: track, position: start + index * bar, duration: bar, name: line.text,
            hue: line.section.startsWith("chorus") ? 200 : line.section.startsWith("bridge") ? 280 : 30
        }))
    })
    await post(`/jobs/${job.id}/placed`, {})
}

const land = async (item: Tracked): Promise<void> => {
    if (isAbsent(attached) || item.landing) {return}
    const {service} = attached
    item.landing = true
    paint(item)
    const result = await Promises.tryCatch(item.job.task === "lyrics"
        ? landLyrics(service, item.job) : landAudio(service, item.job))
    item.landing = false
    if (result.status === "rejected") {
        console.warn(result.error)
        item.job = {...item.job, state: "failed", error: "The result is kept in Nitro but could not be placed here"}
    }
    item.finishedAt = Date.now()
    paint(item)
}

const poll = async (): Promise<void> => {
    if (isAbsent(attached) || pollBusy) {return}
    pollBusy = true
    await refresh(attached.service.project).finally(() => {pollBusy = false})
}

const refresh = async (project: Project): Promise<void> => {
    const open = Array.from(tracked.values()).filter(item => ActiveStates.has(item.job.state))
    for (const item of open) {
        const fresh = await fetchJson<Job>(`/jobs/${item.job.id}`).catch(() => null)
        if (isAbsent(fresh)) {continue}
        item.job = {...fresh, placement: {...fresh.placement, region: item.region}}
        if (ActiveStates.has(fresh.state)) {
            relabel(project, item.region, placeholderLabel(fresh))
        } else if (fresh.state === "succeeded") {
            await land(item)
        } else {
            removePlaceholder(project, item.job)
            item.finishedAt = Date.now()
        }
        paint(item)
    }
    tracked.forEach((item, id) => {
        if (item.finishedAt > 0 && item.job.state === "succeeded" && Date.now() - item.finishedAt > 8000) {
            item.row.element.remove()
            tracked.delete(id)
        }
    })
    if (Array.from(tracked.values()).every(item => !ActiveStates.has(item.job.state)) && isDefined(polling)) {
        clearInterval(polling)
        polling = null
    }
}

const follow = (job: Job): Tracked => {
    const item: Tracked = {job, region: job.placement?.region, row: createRow(job), landing: false, finishedAt: 0}
    tracked.set(job.id, item)
    paint(item)
    if (isAbsent(polling)) {polling = window.setInterval(() => {poll().catch(console.warn)}, 1000)}
    return item
}

type PlaceholderClip = { unit: AudioUnitBox, box: AudioRegionBox | NoteRegionBox }

const placeLyricsPlaceholder = (project: Project, position: ppqn, duration: ppqn, index: number,
                                title: string): Option<PlaceholderClip> => project.editing.modify(() => {
    const {audioUnitBox, trackBox} = project.api.createInstrument(InstrumentFactories.Vaporisateur, {name: "Lyrics"})
    project.api.placeAudioUnit(audioUnitBox, index)
    audioUnitBox.mute.setValue(true)
    const box = project.api.createNoteRegion({trackBox, position, duration: Math.max(PPQN.Bar, duration), name: title})
    return {unit: audioUnitBox, box}
})

const placeAudioPlaceholder = async (service: StudioService, position: ppqn, index: number,
                                     title: string, name: string, seconds: number): Promise<Option<PlaceholderClip>> => {
    const {project} = service
    const {sample, audioData} = await silentSample(service)
    const modifier = await AudioFileBoxFactory.createModifier(Workers.Transients, project.boxGraph, audioData,
        UUID.parse(sample.uuid), sample.name)
    return project.editing.modify(() => {
        const {audioUnitBox, trackBox} = project.api.createInstrument(InstrumentFactories.Tape, {name})
        project.api.placeAudioUnit(audioUnitBox, index)
        const box = AudioContentFactory.createNotStretchedRegion({
            boxGraph: project.boxGraph, targetTrack: trackBox, audioFileBox: modifier(), sample, position, name: title
        })
        box.duration.setValue(seconds)
        box.loopDuration.setValue(1)
        box.mute.setValue(true)
        return {unit: audioUnitBox, box}
    })
}

// A reload drops a placeholder that was never saved; a running job gets a new one so the timeline still shows it.
const replace = async (service: StudioService, job: Job): Promise<Job> => {
    const position = job.placement?.position ?? 0
    const placeholder = job.task === "lyrics"
        ? placeLyricsPlaceholder(service.project, position, PPQN.Bar, 0, placeholderLabel(job))
        : await placeAudioPlaceholder(service, position, 0, placeholderLabel(job),
            `${job.engine_name} · ${Tasks[job.task].action}`, job.params.seconds)
    return placeholder.mapOr(({box}) => ({...job, placement: {...job.placement, region: UUID.toString(box.address.uuid)}}), job)
}

const start = async (service: StudioService, region: AnyRegionBoxAdapter, task: Task): Promise<void> => {
    const {project} = service
    const {tempoMap} = project
    const clipSeconds = tempoMap.intervalToSeconds(region.position, region.complete)
    const trackLabel = region.trackBoxAdapter.mapOr(track =>
        project.boxAdapters.adapterFor(track.audioUnit, AudioUnitBoxAdapter).label, "")
    const list = await engines()
    const request = await ask(task, list, {
        seconds: clipSeconds, label: region.label, track: trackLabel, bpm: project.timelineBox.bpm.getValue(),
        lyrics: lyricsAround(project, region.position, region.complete)
    })
    if (isAbsent(request)) {return}
    const engine = list.find(candidate => candidate.id === request.engine)
    if (task === "vocals" && request.lyrics.length === 0) {
        return RuntimeNotifier.info({headline: "Nitro AI", message: "Write or paste the lyrics to sing first."})
    }
    if (task !== "vocals" && request.prompt.length === 0) {
        return RuntimeNotifier.info({headline: "Nitro AI", message: "Describe what you want in the prompt first."})
    }
    const wantsSource = isDefined(engine) && engine.id === "acestep-1.5" && task !== "lyrics"
    const inputs: Array<{ label: string, sha256: string, seconds: number }> = []
    if (wantsSource) {
        const progress = RuntimeNotifier.progress({headline: "Nitro AI", message: "Preparing the clip…"})
        const sampleRate = service.sampleService.audioContext.sampleRate
        const audioData = await renderClip(project, region, sampleRate, (engine?.seconds[1] ?? 240) + 1)
        progress.message = "Sending the clip to Nitro…"
        const uploaded = isDefined(audioData) ? await fetch(route("/inputs"), {
            method: "POST", headers: WriteHeaders, body: WavFile.encodeFloats(audioData)
        }).then(response => response.ok ? response.json() as Promise<{ sha256: string }> : null, () => null) : null
        progress.terminate()
        if (isAbsent(audioData) || isAbsent(uploaded)) {
            return RuntimeNotifier.info({headline: "Nitro AI", message: "The clip could not be prepared for the engine."})
        }
        inputs.push({label: "source", sha256: uploaded.sha256, seconds: audioData.numberOfFrames / audioData.sampleRate})
    }
    const engineName = engine?.name ?? request.engine
    const title = `${Placeholder} ${engineName} · ${Tasks[task].title.replace(/ (from|for|over) this clip$/, "")} · starting`
    const index = region.trackBoxAdapter.mapOr(track => track.audioUnit.index.getValue() + 1, 0)
    const placeholder = task === "lyrics"
        ? placeLyricsPlaceholder(project, region.position, region.duration, index, title)
        : await placeAudioPlaceholder(service, region.position, index, title, `${engineName} · ${Tasks[task].action}`,
            request.seconds)
    if (placeholder.isEmpty()) {return}
    const {unit, box} = placeholder.unwrap()
    const submitted = await Promises.tryCatch(post<Job>("/jobs", {
        task, engine: request.engine, prompt: request.prompt, lyrics: request.lyrics, seconds: request.seconds,
        instrumental: request.instrumental, language: request.language, bpm: project.timelineBox.bpm.getValue(),
        attest: request.attest, inputs, notes: notesOf(project, region) ?? undefined,
        source: {
            kind: region.type === "note-region" ? "notes" : "audio", label: region.label.slice(0, 200),
            track_label: trackLabel.slice(0, 200), position: region.position, seconds: clipSeconds
        },
        placement: {
            region: UUID.toString(box.address.uuid), unit: UUID.toString(unit.address.uuid), position: region.position
        },
        idempotency_key: `k${UUID.toString(box.address.uuid).replaceAll("-", "").slice(0, 32)}`
    }))
    if (submitted.status === "rejected" || isAbsent(submitted.value)) {
        project.editing.modify(() => project.api.deleteAudioUnit(unit))
        const message = submitted.status === "resolved" ? "Nitro could not be reached."
            : submitted.error instanceof Error ? submitted.error.message : String(submitted.error)
        return RuntimeNotifier.info({headline: "Nitro AI", message})
    }
    enginesCache = null
    relabel(project, UUID.toString(box.address.uuid), placeholderLabel(submitted.value))
    follow(submitted.value)
}

export namespace NitroGenerate {
    export const attach = (service: StudioService, key: string): void => {
        attached = {key, service}
        resume().catch(console.warn)
    }

    // After a reload: keep following running jobs, and land finished ones whose placeholder is still on the timeline.
    const resume = async (): Promise<void> => {
        if (isAbsent(attached)) {return}
        const {service} = attached
        const {project} = service
        const answer = await fetchJson<{ items: Array<Job> }>("/jobs").catch(() => null)
        for (const job of answer?.items ?? []) {
            const placeholder = findRegion(project, job.placement?.region)
            const waiting = placeholder.mapOr(box => box.label.getValue().startsWith(Placeholder), false)
            if (ActiveStates.has(job.state)) {
                follow(placeholder.isEmpty() ? await replace(service, job) : job)
            } else if (job.state === "succeeded" && waiting) {
                await land(follow(job))
            } else if (waiting) {
                removePlaceholder(project, job)
            }
        }
    }

    export const menu = (service: StudioService, region: AnyRegionBoxAdapter): MenuItem =>
        MenuItem.default({label: "Nitro AI", separatorBefore: true, hidden: isAbsent(attached)})
            .setRuntimeChildrenProcedure(parent => parent.addMenuItem(...Order.map(task =>
                MenuItem.default({label: Tasks[task].menu})
                    .setTriggerProcedure(() => {
                        start(service, region, task).catch(error => {
                            console.warn(error)
                            RuntimeNotifier.info({headline: "Nitro AI", message: String(error?.message ?? error)}).finally()
                        })
                    }))))
}
