import {AudioUnitBox, InstrumentCompositeBox} from "@opendaw/studio-boxes"
import {PulseGridDevice, PulseGridDoc, PulseGridDocs, PulseGridOp, PulseGridOpResult, PulseGridOps, PulseGridText} from "@opendaw/studio-adapters"
import {asInstanceOf, Option, panic} from "@opendaw/lib-std"
import {InstrumentAudioUnit, PulseGrid} from "../Api"
import {AudioUnitImpls} from "./AudioUnits"
import {Context} from "./Context"
import {Guard} from "./Guard"

// The script's hands on a PulseGrid: reads and writes only through the model the editor and the agent share.
export class PulseGridImpl implements PulseGrid {
    static find(context: Context, composite: InstrumentCompositeBox): Option<PulseGridImpl> {
        return PulseGridDevice.find(composite).map(({head}) => context.facade(head, () => new PulseGridImpl(context, composite)))
    }

    readonly #context: Context
    readonly #composite: InstrumentCompositeBox

    private constructor(context: Context, composite: InstrumentCompositeBox) {
        this.#context = context
        this.#composite = composite
    }

    get label(): string {return PulseGridDevice.find(this.#composite).unwrap("PulseGrid has been removed").head.label.getValue()}
    get unit(): InstrumentAudioUnit<"InstrumentComposite"> {
        const box = asInstanceOf(this.#composite.host.targetVertex.unwrap("PulseGrid has no audio unit").box, AudioUnitBox)
        return AudioUnitImpls.wrap(this.#context, box) as unknown as InstrumentAudioUnit<"InstrumentComposite">
    }
    get text(): string {return PulseGridText.toText(this.doc)}
    get doc(): PulseGridDoc {
        return PulseGridDocs.read(PulseGridDevice.find(this.#composite).unwrap("PulseGrid has been removed"))
    }

    apply(ops: ReadonlyArray<PulseGridOp>): ReadonlyArray<PulseGridOpResult> {
        if (!Array.isArray(ops)) {return panic(new TypeError("apply: expected an array of operations"))}
        return this.#context.edit(() => PulseGridOps.apply(this.#composite, ops))
    }

    applyText(text: string): ReadonlyArray<PulseGridOpResult> {
        const {ops, errors} = PulseGridText.parseText(Guard.string(text, "text"))
        if (errors.length > 0) {return panic(new TypeError(`applyText: ${errors.join("; ")}`))}
        return this.apply(ops)
    }
}
