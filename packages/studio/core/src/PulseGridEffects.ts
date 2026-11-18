import {BoxGraph, IndexedBox} from "@opendaw/lib-box"
import {panic} from "@opendaw/lib-std"
import {PulseGridEffectMaker} from "@opendaw/studio-adapters"
import {EffectFactories} from "./EffectFactories"
import {EffectFactory} from "./EffectFactory"
import {Project} from "./project"

// The audio effects a PulseGrid lane can be given by an op (addEffect, SPEC.md section 10), made with SoleanDaw's
// own factories. The model package cannot import those, so every host that runs PulseGrid ops (the window, the
// agent inbox, the DAW sidecar) passes this maker in PulseGridOpsEnv.
// Left out: the composites (nested chains do not fit a lane's panel), Wclap (an external plugin) and Sink.
// Every factory listed reads only `boxGraph` from the project it is given.
export namespace PulseGridEffects {
    const Listed: ReadonlyArray<keyof typeof EffectFactories.AudioNamed> = [
        "Compressor", "Gate", "Maximizer", "Revamp", "Crusher", "Fold", "Waveshaper", "Delay", "Reverb",
        "DattorroReverb", "Convolver", "Tidal", "StereoTool", "Autotune", "Vocoder", "NeuralAmp", "Werkstatt"
    ]

    const nameOf = (factory: EffectFactory): string => factory.boxName.replace(/DeviceBox$/, "")

    export const maker = (boxGraph: BoxGraph): PulseGridEffectMaker => {
        const factories = new Map(Listed.map(key => {
            const factory: EffectFactory = EffectFactories.AudioNamed[key]
            return [nameOf(factory), factory] as const
        }))
        return {
            names: [...factories.keys()],
            create: (name, host, index) => {
                const factory = factories.get(name) ?? panic(`PulseGridEffects: no effect named ${name}`)
                factory.create({boxGraph} as unknown as Project, host, IndexedBox.insertOrder(host, index))
            }
        }
    }

    // The factory behind a name of `maker(...).names`, for the screen's icons and labels.
    export const factoryOf = (name: string): EffectFactory | undefined =>
        Listed.map(key => EffectFactories.AudioNamed[key] as EffectFactory).find(factory => nameOf(factory) === name)
}
