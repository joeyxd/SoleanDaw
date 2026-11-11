import {InstrumentCompositeBox} from "@opendaw/studio-boxes"
import {StudioService} from "@/service/StudioService"

// The open PulseGrid windows, one per PulseGrid, living as long as the instrument and the project.
// Stub: ticket T-1111-03 builds it. The signatures are fixed.
export namespace PulseGridWindows {
    export const isOpen = (_composite: InstrumentCompositeBox): boolean => false
    export const open = (_service: StudioService, _composite: InstrumentCompositeBox): void => {}
    export const close = (_composite: InstrumentCompositeBox): void => {}
}
