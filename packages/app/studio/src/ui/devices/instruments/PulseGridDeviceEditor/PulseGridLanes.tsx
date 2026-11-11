import {Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {PulseGridContext} from "./PulseGridContext"

type Construct = {
    lifecycle: Lifecycle
    context: PulseGridContext
}

// The lanes of a PulseGrid: the DRUMS and MELODY frames, the step ruler, one row per lane, the playhead.
// Stub: ticket T-1111-02 builds it. The signature is fixed; the window mounts it as is.
export const PulseGridLanes = ({}: Construct): HTMLElement => (<div/>)
