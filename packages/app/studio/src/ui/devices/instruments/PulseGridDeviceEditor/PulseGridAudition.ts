import {int} from "@opendaw/lib-std"
import {PulseGridContext} from "./PulseGridContext"

// Hearing one lane by itself: the Listen tool, a key of the keyboard, the note that was just painted.
//
// STUB. The engine cannot do this yet: a note sent to the PulseGrid's track reaches every lane, and a lane lets
// outside notes through only while it is armed, which is a stored field. The engine ticket fills both functions
// in. Until then nothing sounds, and whoever offers a control that only listens asks `available` first.
export namespace PulseGridAudition {
    // Whether this build can sound one lane without changing the project.
    export const available = (_context: PulseGridContext): boolean => false

    // Sounds the lane's instrument at a pitch now, for a moment. The project does not change.
    export const listen = (_context: PulseGridContext, _laneId: string, _pitch: int, _velocity: int = 100): void => {}
}
