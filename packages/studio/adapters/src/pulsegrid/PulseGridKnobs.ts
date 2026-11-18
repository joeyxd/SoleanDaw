import {PulseGridParamDoc} from "./PulseGridTypes"

// The four big knobs of the instrument panel (map G5): which parameter of the lane's instrument each one moves.
// Each sound decides its own four; an instrument without a row gets its first four float parameters.
// Labels are what Joi and his agents call them; `param` is the field name an op writes (setParam).
// SPEC.md section 10.
export type PulseGridKnob = {label: string, param: string}

export namespace PulseGridKnobs {
    export const Table: Readonly<Record<string, ReadonlyArray<PulseGridKnob>>> = {
        Nano: [
            {label: "Tune", param: "tune"},
            {label: "Decay", param: "release"},
            {label: "Attack", param: "attack"},
            {label: "Level", param: "volume"}
        ],
        Tubular: [
            {label: "Tone", param: "cutoff"},
            {label: "Resonance", param: "resonance"},
            {label: "Tune", param: "tune"},
            {label: "Level", param: "volume"}
        ],
        Vaporisateur: [
            {label: "Cutoff", param: "cutoff"},
            {label: "Resonance", param: "resonance"},
            {label: "Attack", param: "attack"},
            {label: "Release", param: "release"}
        ]
    }

    const capital = (name: string): string =>
        name.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")

    // The knobs of an instrument, keeping only those whose parameter it really has.
    export const of = (instrument: string, params: ReadonlyArray<PulseGridParamDoc>): Array<PulseGridKnob> => {
        const has = new Set(params.map(param => param.name))
        const row = Table[instrument]
        if (row !== undefined) {return row.filter(knob => has.has(knob.param))}
        return params.filter(param => param.type === "float").slice(0, 4)
            .map(param => ({label: capital(param.name), param: param.name}))
    }
}
