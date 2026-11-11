import {Address} from "@opendaw/lib-box"
import {AssertType, UUID} from "@opendaw/lib-std"
import {PulseGridBox} from "@opendaw/studio-boxes"
import {BoxAdapter} from "../BoxAdapter"
import {BoxAdaptersContext} from "../BoxAdaptersContext"

export class PulseGridBoxAdapter implements BoxAdapter {
    static readonly checkType: AssertType<PulseGridBoxAdapter> =
        (adapter: unknown): adapter is PulseGridBoxAdapter => adapter instanceof PulseGridBoxAdapter

    readonly #box: PulseGridBox

    constructor(_context: BoxAdaptersContext, box: PulseGridBox) {this.#box = box}

    get box(): PulseGridBox {return this.#box}
    get uuid(): UUID.Bytes {return this.#box.address.uuid}
    get address(): Address {return this.#box.address}

    terminate(): void {}
}
