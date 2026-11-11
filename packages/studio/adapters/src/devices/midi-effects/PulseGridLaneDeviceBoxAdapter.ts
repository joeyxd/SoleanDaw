import {Pointers} from "@opendaw/studio-enums"
import {Observer, Subscription, UUID} from "@opendaw/lib-std"
import {Address, BooleanField, Int32Field, PointerField, StringField} from "@opendaw/lib-box"
import {PulseGridLaneDeviceBox} from "@opendaw/studio-boxes"
import {DeviceHost, Devices, MidiEffectDeviceAdapter} from "../../DeviceAdapter"
import {BoxAdaptersContext} from "../../BoxAdaptersContext"
import {AudioUnitBoxAdapter} from "../../audio-unit/AudioUnitBoxAdapter"
import {PulseGridBoxAdapter} from "../../pulsegrid/PulseGridBoxAdapter"

export class PulseGridLaneDeviceBoxAdapter implements MidiEffectDeviceAdapter {
    readonly type = "midi-effect"
    readonly accepts = "midi"
    readonly manualUrl = ""

    readonly #context: BoxAdaptersContext
    readonly #box: PulseGridLaneDeviceBox

    constructor(context: BoxAdaptersContext, box: PulseGridLaneDeviceBox) {
        this.#context = context
        this.#box = box
        this.grid()
    }

    get box(): PulseGridLaneDeviceBox {return this.#box}
    get uuid(): UUID.Bytes {return this.#box.address.uuid}
    get address(): Address {return this.#box.address}
    get indexField(): Int32Field {return this.#box.index}
    get labelField(): StringField {return this.#box.label}
    get enabledField(): BooleanField {return this.#box.enabled}
    get minimizedField(): BooleanField {return this.#box.minimized}
    get host(): PointerField<Pointers.MIDIEffectHost> {return this.#box.host}

    deviceHost(): DeviceHost {
        return this.#context.boxAdapters
            .adapterFor(this.#box.host.targetVertex.unwrap("no device-host").box, Devices.isHost)
    }

    grid(): PulseGridBoxAdapter {
        return this.#context.boxAdapters
            .adapterFor(this.#box.grid.targetVertex.unwrap("no grid").box, PulseGridBoxAdapter.checkType)
    }

    catchupAndSubscribeGrid(observer: Observer<PulseGridBoxAdapter>): Subscription {
        return this.#box.grid.catchupAndSubscribe(pointer => observer(this.#context.boxAdapters
            .adapterFor(pointer.targetVertex.unwrap("no grid").box, PulseGridBoxAdapter.checkType)))
    }

    audioUnitBoxAdapter(): AudioUnitBoxAdapter {return this.deviceHost().audioUnitBoxAdapter()}

    terminate(): void {}
}
