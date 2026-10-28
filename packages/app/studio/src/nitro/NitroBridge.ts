// SPDX-License-Identifier: AGPL-3.0-or-later
// Nitro adapter: this tab opens one Nitro project, keeps its edit lease and saves revisions to Nitro.
import {Nullable, Option, RuntimeNotifier, tryCatch} from "@opendaw/lib-std"
import {ProjectBundle} from "@opendaw/studio-core"
import type {StudioService} from "@/service/StudioService"
import {NitroGenerate} from "@/nitro/NitroGenerate"

type Session = { key: string, revision: number, service: StudioService, writable: boolean, saving: boolean }

const LeaseMillis = 10_000
const StorageKey = "nitro-daw-project"
const WriteHeaders = {"x-nitro-daw": "1"}
// The exact source this editor is built from: upstream openDAW plus the Nitro overlay (AGPL section 13).
const SourceUrl = "https://github.com/joeyxd/SoleanDaw/tree/nitro/daw"

let session: Nullable<Session> = null
let label: Nullable<HTMLElement> = null

const route = (key: string, path: string = ""): string => `/nitro-api/projects/${encodeURIComponent(key)}${path}`

// The editor rewrites the address as it navigates, so this tab remembers its project for a reload.
const projectKey = (): Nullable<string> => {
    const asked = new URLSearchParams(location.search).get("nitro")
    const stored = tryCatch(() => {
        if (asked !== null) {sessionStorage.setItem(StorageKey, asked)}
        return sessionStorage.getItem(StorageKey)
    })
    return stored.status === "success" ? stored.value : asked
}

const show = (text: string, tone: "ok" | "busy" | "error"): void => {
    if (label === null) {
        const chip = document.createElement("div")
        chip.style.cssText = "position:fixed;right:12px;bottom:28px;z-index:9999;padding:4px 10px;border-radius:10px;" +
            "display:flex;gap:8px;font:12px system-ui,sans-serif;pointer-events:none;background:#16202c;border:1px solid #2c3e50"
        label = document.createElement("span")
        const source = document.createElement("a")
        source.href = SourceUrl
        source.target = "_blank"
        source.rel = "noopener"
        source.textContent = "Source"
        source.style.cssText = "pointer-events:auto;color:#8fb8d1"
        chip.append(label, source)
        document.body.appendChild(chip)
    }
    label.textContent = text
    label.style.color = tone === "ok" ? "#8fd18f" : tone === "busy" ? "#d1c48f" : "#e08a8a"
}

const fail = (message: string): void => {
    show(`Nitro · ${message}`, "error")
    RuntimeNotifier.info({headline: "Nitro", message}).finally()
}

const renew = async (): Promise<void> => {
    if (session === null || !session.writable) {return}
    const response = await fetch(route(session.key, "/lease"), {method: "PUT", headers: WriteHeaders}).catch(() => null)
    // A dropped request is retried at the next beat; the lease outlives two of them.
    if (response === null || response.ok || response.status >= 500) {return}
    session.writable = false
    fail("This tab lost the edit lease. Reopen the project from Nitro to keep editing.")
}

const release = (): void => {
    if (session === null || !session.writable) {return}
    session.writable = false
    fetch(route(session.key, "/lease"), {method: "DELETE", headers: WriteHeaders, keepalive: true}).catch(() => null)
}

export namespace NitroBridge {
    export const active = (): boolean => session !== null

    export const install = async (service: StudioService): Promise<void> => {
        const key = projectKey()
        // Every visitor sees the source link, with or without a Nitro project.
        if (key === null) {return show("Nitro DAW", "ok")}
        show("Nitro · opening…", "busy")
        // The first open took the lease; a reload released it on the way out and takes it back here.
        const lease = await fetch(route(key, "/lease"), {method: "POST", headers: WriteHeaders}).catch(() => null)
        if (lease !== null && lease.status === 423) {return fail("This project is open in another DAW tab. Close it, then reload.")}
        const detail = await fetch(route(key)).catch(() => null)
        if (detail === null || !detail.ok) {return fail("This project could not be opened. Open it again from Nitro.")}
        const {revision, title} = await detail.json() as { revision: number, title: string }
        const bundle = await fetch(route(key, `/bundle?revision=${revision}`)).catch(() => null)
        if (bundle === null || !bundle.ok) {return fail("The project bundle could not be loaded.")}
        const profile = await ProjectBundle.decode(service, await bundle.arrayBuffer())
        service.projectProfileService.setValue(Option.wrap(profile))
        session = {key, revision, service, writable: true, saving: false}
        document.title = `${title} · Nitro DAW`
        setInterval(() => renew().finally(), LeaseMillis)
        window.addEventListener("pagehide", release)
        Reflect.set(window, "nitroDaw", {save, status: () => ({...session, service: undefined})})
        show(`Nitro · ${title} · revision ${revision}`, "ok")
        NitroGenerate.attach(service, key)
    }

    export const save = async (): Promise<void> => {
        if (session === null) {return}
        const current = session
        if (!current.writable) {return fail("This tab no longer holds the edit lease.")}
        if (current.saving) {return}
        const optProfile = current.service.projectProfileService.getValue()
        if (optProfile.isEmpty()) {return}
        const profile = optProfile.unwrap()
        current.saving = true
        show("Nitro · saving…", "busy")
        try {
            profile.project.editing.mark()
            const bytes = await ProjectBundle.encode(profile, () => {})
            const response = await fetch(route(current.key, `/revisions?expected_revision=${current.revision}`), {
                method: "PUT", headers: {...WriteHeaders, "content-type": "application/zip"}, body: bytes
            })
            if (response.status === 409) {return fail("Nitro has a newer revision of this project. Reopen it from Nitro.")}
            if (response.status === 423) {
                current.writable = false
                return fail("This tab lost the edit lease. Reopen the project from Nitro.")
            }
            if (!response.ok) {return fail("Nitro did not accept the save. Try again.")}
            const {revision, unchanged} = await response.json() as { revision: number, unchanged?: boolean }
            current.revision = revision
            profile.project.editing.markSaved()
            show(`Nitro · revision ${revision}${unchanged === true ? " · no changes" : " · saved"}`, "ok")
        } finally {
            current.saving = false
        }
    }
}
