import {BoxEditing, BoxGraph} from "@opendaw/lib-box"
import {int, isDefined, UUID} from "@opendaw/lib-std"
import {InstrumentCompositeBox} from "@opendaw/studio-boxes"
import {PulseGridDevice} from "./PulseGridDevice"
import {PulseGridDocs} from "./PulseGridDocs"
import {PulseGridOps} from "./PulseGridOps"
import {PulseGridText} from "./PulseGridText"
import {PulseGridError, PulseGridOp, PulseGridOpResult} from "./PulseGridTypes"

// What an agent asks of the PulseGrids of a project, answered the same way wherever the project is: open in
// Joi's tab (the tab runs this on its live project) or saved on the server (the DAW sidecar runs it headless).
// SPEC.md section 7. Everything that crosses the wire is plain JSON.

// Exactly one of `read`, `ops` and `text`.
export type PulseGridRequest = {
    // the PulseGrid's track: its name (case does not matter) or its id; left out when the project has one PulseGrid
    track?: string
    read?: true // answer the whole PulseGrid as text (PulseGridText.toText)
    ops?: ReadonlyArray<PulseGridOp>
    text?: string // lines of the toText grammar, read by parseText; pattern lines sit under a "scene <n> <V>" heading
}

// A PulseGrid of the project: its track's id (the audio unit's uuid) and name, and its composite.
export type PulseGridTrack = {id: string, name: string, composite: InstrumentCompositeBox}

export type PulseGridAnswer =
    | {ok: true, track: {id: string, name: string}, text: string} // read
    | {ok: true, track: {id: string, name: string}, results: ReadonlyArray<PulseGridOpResult>} // every op ran
    // Nothing changed. `op` is the position (from 1) of the op that was refused, when one was.
    | {ok: false, track?: {id: string, name: string}, op?: int, error: string}

export namespace PulseGridRequests {
    export const MaxOps = 64
    export const MaxText = 32 * 1024

    // Every PulseGrid in the graph that sits on a track, in no particular order.
    export const tracks = (graph: BoxGraph): Array<PulseGridTrack> => graph.boxes()
        .filter((box): box is InstrumentCompositeBox => box instanceof InstrumentCompositeBox)
        .flatMap(composite => {
            const unit = composite.host.targetVertex.unwrapOrUndefined()?.box
            if (!isDefined(unit) || PulseGridDevice.find(composite).isEmpty()) {return []}
            return [{id: UUID.toString(unit.address.uuid), name: composite.label.getValue(), composite}]
        })

    // The request's shape, checked; a refusal says what was given and what is allowed.
    export const parse = (raw: unknown): PulseGridRequest => {
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
            throw new PulseGridError("a request is an object with one of read, ops or text")
        }
        const request = raw as Record<string, unknown>
        const unknown = Object.keys(request).filter(key => !["track", "read", "ops", "text"].includes(key))
        if (unknown.length > 0) {throw new PulseGridError(`field ${unknown[0]} is not allowed; expected track, read, ops or text`)}
        const kinds = ["read", "ops", "text"].filter(key => request[key] !== undefined)
        if (kinds.length !== 1) {throw new PulseGridError(`a request carries exactly one of read, ops or text, not ${kinds.length}`)}
        if (request.track !== undefined && (typeof request.track !== "string" || request.track.length === 0 ||
            request.track.length > 128)) {throw new PulseGridError("track is a name or an id of 1 to 128 characters")}
        if (request.read !== undefined && request.read !== true) {throw new PulseGridError("read is true")}
        if (request.ops !== undefined && (!Array.isArray(request.ops) || request.ops.length < 1 ||
            request.ops.length > MaxOps)) {throw new PulseGridError(`ops is a list of 1 to ${MaxOps} ops`)}
        if (request.text !== undefined && (typeof request.text !== "string" || request.text.trim().length === 0 ||
            request.text.length > MaxText)) {throw new PulseGridError(`text is 1 to ${MaxText} characters`)}
        return request as PulseGridRequest
    }

    // The PulseGrid a request names.
    export const pick = (tracks: ReadonlyArray<PulseGridTrack>, track?: string): PulseGridTrack => {
        if (tracks.length === 0) {throw new PulseGridError("the project has no PulseGrid; add one first")}
        const names = tracks.map(({name}) => `"${name}"`).join(", ")
        if (track === undefined) {
            if (tracks.length === 1) {return tracks[0]}
            throw new PulseGridError(`the project has ${tracks.length} PulseGrids (${names}); name one with track`)
        }
        const byId = tracks.find(({id}) => id === track.toLowerCase())
        if (isDefined(byId)) {return byId}
        const byName = tracks.filter(({name}) => name.toLowerCase() === track.toLowerCase())
        if (byName.length === 1) {return byName[0]}
        if (byName.length > 1) {throw new PulseGridError(`${byName.length} PulseGrids are named "${track}"; name one by its id`)}
        throw new PulseGridError(`no PulseGrid is named "${track}"; the PulseGrids are ${names}`)
    }

    // The ops a request carries: its own, or its text read by parseText.
    export const opsOf = (request: PulseGridRequest): ReadonlyArray<PulseGridOp> => {
        if (isDefined(request.ops)) {return request.ops}
        const {ops, errors} = PulseGridText.parseText(request.text ?? "")
        if (errors.length > 0) {throw new PulseGridError(errors.join("; "))}
        if (ops.length === 0) {throw new PulseGridError("text holds no line that changes anything")}
        if (ops.length > MaxOps) {throw new PulseGridError(`text makes ${ops.length} ops; at most ${MaxOps}`)}
        return ops
    }

    // Runs one request against the project's live graph. A request that changes anything is one undo step, and
    // all or nothing: when any op is refused, every op before it is taken back and the answer names the op.
    // Only PulseGridError becomes a refusal; any other error is a bug and travels on.
    export const handle = (graph: BoxGraph, editing: BoxEditing, raw: unknown): PulseGridAnswer => {
        let track: PulseGridTrack | undefined
        const named = () => isDefined(track) ? {track: {id: track.id, name: track.name}} : {}
        try {
            const request = parse(raw)
            track = pick(tracks(graph), request.track)
            const {composite} = track
            if (request.read === true) {
                return {ok: true, ...named(), text: PulseGridText.toText(PulseGridDocs.read(PulseGridDevice.find(composite).unwrap()))} as PulseGridAnswer
            }
            const ops = opsOf(request)
            // A refusal throws out of the transaction, so the graph rolls it back and no undo step is made.
            const results = editing.modify(() => {
                const results = PulseGridOps.apply(composite, ops)
                if (results.length !== ops.length || results.some(result => !result.ok)) {throw new Refused(results)}
                return results
            }).unwrapOrElse(() => [])
            return {ok: true, ...named(), results} as PulseGridAnswer
        } catch (error) {
            if (error instanceof Refused) {
                const at = error.results.findIndex(result => !result.ok)
                const result = error.results[at]
                return {ok: false, ...named(), op: (at >= 0 ? at : error.results.length) + 1,
                    error: isDefined(result) && !result.ok ? result.error : "the batch did not run to its end"}
            }
            if (!(error instanceof PulseGridError)) {throw error}
            return {ok: false, ...named(), error: error.message}
        }
    }

    class Refused extends Error {
        constructor(readonly results: ReadonlyArray<PulseGridOpResult>) {super("refused")}
    }
}
