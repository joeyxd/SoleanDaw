import {int, Optional, ValueMapping} from "@opendaw/lib-std"
import {PulseGridDoc, PulseGridEffectDoc, PulseGridLaneDoc, PulseGridParamDoc, PulseGridSound} from "@opendaw/studio-adapters"

// What the instrument panel (SPEC.md section 10) works out without touching a box or the DOM.

export type PulseGridPanelTab = "instrument" | "effects" | "mix"

export type PulseGridMapping = {
    x: (value: number) => number // the field's value to a place on the knob, 0..1
    y: (unit: number) => number // a place on the knob to the field's value
    print: (value: number) => string // the text under the knob
}

// What the panel needs of SoleanDaw's parameter adapter (AutomatableParameterFieldAdapter): its two mappings.
export type PulseGridAdapterLike = {
    readonly valueMapping: {x(value: number): number, y(unit: number): number}
    readonly stringMapping: {x(value: number): {value: string, unit: string}}
}

export namespace PulseGridPanelLogic {
    export const Tabs: ReadonlyArray<{key: PulseGridPanelTab, label: string}> = [
        {key: "instrument", label: "Instrument"}, {key: "effects", label: "Effects"}, {key: "mix", label: "Mix"}
    ]

    // The instrument as a word for a person: a Nano plays one sample, a Tubular is an FM voice.
    export const word = (instrument: string): string =>
        instrument === "Nano" ? "Sampler" : instrument === "Tubular" ? "FM synth" : instrument

    // "Kick Drum · Sampler", or why there is nothing to show.
    export const soundLine = (sound: PulseGridSound | null): string =>
        sound === null ? "No instrument" : `${sound.label} · ${word(sound.instrument)}`

    // The lane `offset` places from `current` in document order, wrapping round at both ends. Without a current
    // lane (none picked, or it is gone) the first lane. Undefined when there are no lanes.
    export const neighbour = (ids: ReadonlyArray<string>, current: Optional<string>, offset: int): Optional<string> => {
        if (ids.length === 0) {return undefined}
        const at = current === undefined ? -1 : ids.indexOf(current)
        if (at < 0) {return ids[0]}
        return ids[((at + offset) % ids.length + ids.length) % ids.length]
    }

    export const laneOf = (doc: PulseGridDoc, id: Optional<string>): Optional<PulseGridLaneDoc> =>
        doc.lanes.find(lane => lane.id === id)

    // A parameter of the lane's instrument (`effect` left out) or of its effect `effect` (from 1).
    export const paramOf = (lane: PulseGridLaneDoc, effect: Optional<int>, name: string): Optional<PulseGridParamDoc> =>
        (effect === undefined ? lane.sound?.params : lane.chain.find(entry => entry.index === effect)?.params)
            ?.find(param => param.name === name)

    const isDecibel = (unit: string): boolean => unit.toLowerCase() === "db"

    // The mapping when SoleanDaw has none for the field, from what the document says of it. Without a range the
    // knob is linear over 0..1 (or the value's own size). Seconds and hertz cross decades, so a range whose top is
    // 100 times its bottom or more is exponential; a decibel range that tops at 0 or below is the mixer's curve.
    export const fallback = (param: PulseGridParamDoc): PulseGridMapping => {
        const {min = 0, max = 1} = param
        const range = min < max ? ValueMapping.linear(min, max) : ValueMapping.linear(0, 1)
        const mapping: ValueMapping<number> = min >= max ? range
            : min > 0 && max / min >= 100 ? ValueMapping.exponential(min, max)
                : isDecibel(param.unit) && max <= 0 ? ValueMapping.decibel(min, max - (max - min) / 6, max)
                    : range
        return {x: mapping.x.bind(mapping), y: mapping.y.bind(mapping), print: value => printValue(param, value)}
    }

    // Three significant places for a float, none for an int; the unit after a space ("%" and "" aside).
    export const printValue = (param: PulseGridParamDoc, value: number): string => {
        if (param.type === "int") {return withUnit(String(Math.round(value)), param.unit)}
        const size = Math.abs(value)
        const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2
        const text = Number(value.toFixed(digits)).toString()
        return withUnit(text === "-0" ? "0" : text, param.unit)
    }

    const withUnit = (text: string, unit: string): string =>
        unit === "" ? text : unit === "%" ? `${text}%` : `${text} ${isDecibel(unit) ? "dB" : unit}`

    // SoleanDaw's own mapping and print text for the field when the adapter is there, else the fallback.
    // `scale`: the document gives a fraction stored with the unit "%" as a percent (100), while the adapter maps
    // what is stored (PulseGridDocs.percentScale).
    export const mapping = (param: PulseGridParamDoc, adapter?: PulseGridAdapterLike, scale = 1): PulseGridMapping => {
        if (adapter === undefined) {return fallback(param)}
        const {valueMapping, stringMapping} = adapter
        return {
            x: value => valueMapping.x(value / scale),
            y: unit => valueMapping.y(unit) * scale,
            print: value => {
                const {value: text, unit} = stringMapping.x(value / scale)
                return unit === "" ? text : `${text} ${unit}`
            }
        }
    }

    // The value a turn to `unit` (0..1) writes: the mapping's value, a whole number for an int, inside the range the
    // document gives (the op refuses a value outside it).
    export const valueAt = (param: PulseGridParamDoc, mapping: PulseGridMapping, unit: number): number => {
        const raw = mapping.y(Math.max(0, Math.min(1, unit)))
        const value = param.type === "int" ? Math.round(raw) : raw
        const {min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY} = param
        return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
    }

    // What the panel's body is built from. While it stays the same the body stays, so a knob under the pointer
    // is never replaced in the middle of its drag; numbers that a drag changes are left out on purpose.
    export const structure = (lane: PulseGridLaneDoc, tab: PulseGridPanelTab, open: Optional<int>): string => {
        const names = (params: ReadonlyArray<PulseGridParamDoc>): string => params.map(param => `${param.name}:${param.type}`).join(",")
        switch (tab) {
            case "instrument":
                return `${lane.sound?.instrument}|${lane.sound?.label}|${lane.accent}|${names(lane.sound?.params ?? [])}`
            case "effects":
                return `${open}|` + lane.chain.map((effect: PulseGridEffectDoc) =>
                    `${effect.index}:${effect.name}:${effect.enabled}:${effect.index === open ? names(effect.params) : ""}`).join(";")
            case "mix":
                return `${lane.mix.mute}|${lane.mix.solo}`
        }
    }
}
