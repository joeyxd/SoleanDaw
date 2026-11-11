import {InstrumentCompositeBox} from "@opendaw/studio-boxes"
import {StudioService} from "@/service/StudioService"
import {Terminator, UUID} from "@opendaw/lib-std"
import {deferNextFrame} from "@opendaw/lib-dom"
import {PulseGridDevice} from "@opendaw/studio-adapters"
import {IconSymbol} from "@opendaw/studio-enums"
import {FloatingWindow, FloatingWindowHandle} from "@/ui/components/FloatingWindow"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridWindow} from "./PulseGridWindow"

export namespace PulseGridWindows {
    const windows = new Map<string, FloatingWindowHandle>()
    const keyOf = (composite: InstrumentCompositeBox): string => UUID.toString(composite.address.uuid)

    export const isOpen = (composite: InstrumentCompositeBox): boolean => windows.has(keyOf(composite))
    export const close = (composite: InstrumentCompositeBox): void => windows.get(keyOf(composite))?.close()

    export const open = (service: StudioService, composite: InstrumentCompositeBox): void => {
        const key = keyOf(composite)
        const existing = windows.get(key)
        if (existing !== undefined) {
            existing.toFront()
            return
        }
        if (!composite.isAttached() || PulseGridDevice.find(composite).isEmpty()) {return}
        const session = new Terminator()
        const context = PulseGridContext.create(session, service, composite)
        const handle = FloatingWindow({
            title: "PulseGrid", icon: IconSymbol.DrumSet,
            width: 1180, height: 660, resizable: true, minWidth: 760, minHeight: 420,
            popoutable: false, onClose: () => session.terminate()
        }, PulseGridWindow({lifecycle: session, context}))
        const checkDevice = session.own(deferNextFrame(() => {
            if (!composite.isAttached() || PulseGridDevice.find(composite).isEmpty()) {handle.close()}
        }))
        session.ownAll(
            composite.subscribeDeletion(() => handle.close()),
            service.projectProfileService.subscribe(() => handle.close()),
            service.project.boxGraph.subscribeToAllUpdates({onUpdate: () => checkDevice.request()}),
            {terminate: () => {windows.delete(key)}}
        )
        windows.set(key, handle)
    }
}
