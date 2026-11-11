import {BoxEditing, BoxGraph} from "@opendaw/lib-box"
import {Editing, Optional} from "@opendaw/lib-std"
import {InstrumentCompositeBox} from "@opendaw/studio-boxes"
import {PulseGridAnswer, PulseGridDevice, PulseGridDocs, PulseGridRequests} from "@opendaw/studio-adapters"
import type {StudioService} from "@/service/StudioService"
import {PulseGridContext} from "./PulseGridContext"

// What an agent asks of a PulseGrid in this open project, run on the live project (docs: AGENT_WIRE.md section 2).
// NitroBridge fetches the entries and posts the answers; this runs one and tells the screen.

// One entry of the wire. Its other fields (schema, created_at, ...) are not needed here.
export type PulseGridLiveEntry = {
    id: string
    author: {identity: string, name: string}
    note: string | null
    request: unknown
}

// Where a message goes when no window of that PulseGrid is open: NitroBridge's status chip.
export type PulseGridChip = (text: string, tone: "ok" | "error") => void

export type PulseGridAttempt = {
    answer: PulseGridAnswer
    // the composite of the answer's track, when it names one
    composite: Optional<InstrumentCompositeBox>
    // ids of the lanes whose content differs after the request (a new lane counts)
    changed: ReadonlyArray<string>
}

export namespace PulseGridAgentInbox {
    type Lanes = Map<string, string>

    const lanesOf = (composite: InstrumentCompositeBox): Lanes => {
        const lanes: Lanes = new Map()
        PulseGridDevice.find(composite).ifSome(device =>
            PulseGridDocs.read(device).lanes.forEach(lane => lanes.set(lane.id, JSON.stringify(lane))))
        return lanes
    }

    // The pure part: runs the request and reports what changed. Never throws; an error that is not a refusal
    // answers ok false and is logged.
    export const attempt = (graph: BoxGraph, editing: Editing, request: unknown): PulseGridAttempt => {
        try {
            const before = new Map(PulseGridRequests.tracks(graph).map(({id, composite}) => [id, lanesOf(composite)]))
            const answer = PulseGridRequests.handle(graph, editing as BoxEditing, request) // the handler only uses `modify`
            const id = answer.track?.id
            const track = id === undefined ? undefined : PulseGridRequests.tracks(graph).find(track => track.id === id)
            if (track === undefined) {return {answer, composite: undefined, changed: []}}
            const changed: Array<string> = []
            if (answer.ok && "results" in answer) {
                const was = before.get(track.id) ?? new Map()
                lanesOf(track.composite).forEach((json, laneId) => {
                    if (was.get(laneId) !== json) {changed.push(laneId)}
                })
            }
            return {answer, composite: track.composite, changed}
        } catch (error) {
            console.error("PulseGrid agent request failed", error)
            const message = error instanceof Error ? error.message : String(error)
            return {answer: {ok: false, error: `the editor failed: ${message}`}, composite: undefined, changed: []}
        }
    }

    // Runs the entry on the live project, shows the author's note (or the refusal) to Joi and answers.
    export const run = (service: StudioService, entry: PulseGridLiveEntry, chip: PulseGridChip): PulseGridAnswer => {
        const {project: {boxGraph, editing}} = service
        const {answer, composite, changed} = attempt(boxGraph, editing, entry.request)
        try {
            const {name} = entry.author
            const window = composite === undefined ? undefined : PulseGridContext.opened(composite)
            if (answer.ok && "results" in answer) {
                const text = `${name}: ${entry.note ?? "changed the PulseGrid"}`
                if (window === undefined) {chip(text, "ok")} else {
                    window.notice.setValue({kind: "info", text})
                    if (changed.length > 0) {window.flash.setValue(changed)}
                }
            } else if (!answer.ok && entry.note !== null) {
                const text = `${name}: ${answer.error}`
                if (window === undefined) {chip(text, "error")} else {window.notice.setValue({kind: "error", text})}
            }
        } catch (error) {
            console.error("PulseGrid agent notice failed", error)
        }
        return answer
    }
}
