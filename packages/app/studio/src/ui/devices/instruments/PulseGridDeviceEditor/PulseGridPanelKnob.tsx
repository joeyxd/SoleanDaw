import {Exec, Lifecycle, Option, Terminable} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Dragging, Events} from "@opendaw/lib-dom"
import {PulseGridMapping} from "./PulseGridPanelLogic"

// A knob that turns in SoleanDaw's own mapping (a decay is exponential, a level is decibels) and prints SoleanDaw's
// own text. PulseGridDial counts in a straight line and prints its own number, so it cannot do either. The gesture
// is the dial's: `set` while it moves, `commit` once at the end, `revert` when it is cancelled.
// Styles are the panel's (PulseGridPanel.sass).
type Construct = {
    lifecycle: Lifecycle
    label: string
    mapping: PulseGridMapping
    get: () => number
    // the value to write for a place on the knob (0..1); the caller keeps it in range
    valueAt: (unit: number) => number
    set: (value: number) => void
    commit: Exec
    revert: Exec
    subscribe: (refresh: Exec) => Terminable
}

const Reach = 150 // pixels of drag over the whole knob

export const PulseGridPanelKnob = ({
    lifecycle, label, mapping, get, valueAt, set, commit, revert, subscribe
}: Construct): HTMLElement => {
    const value: HTMLElement = <span className="value" data-value=""/>
    const ring: HTMLElement = <span className="ring" aria-hidden="true"/>
    const element: HTMLElement = (
        <div className="knob" tabIndex={0} role="spinbutton" aria-label={label} data-knob={label}
             title={`${label}: drag up or down`}>
            {ring}
            <span className="label">{label}</span>
            {value}
        </div>
    )
    let gestureChanged = false
    let active = true
    const abort = new AbortController()
    const refresh = (): void => {
        const current = get()
        const text = mapping.print(current)
        value.textContent = text
        ring.style.setProperty("--pg-turn", `${Math.max(0, Math.min(1, mapping.x(current))) * 270}deg`)
        element.setAttribute("aria-valuenow", String(current))
        element.setAttribute("aria-valuetext", text)
    }
    const apply = (unit: number): boolean => {
        const next = valueAt(unit)
        if (!Number.isFinite(next) || next === get()) {return false}
        set(next)
        refresh()
        return true
    }
    let dragging = false
    lifecycle.ownAll(
        subscribe(refresh),
        Dragging.attach(element, event => {
            const start = mapping.x(get())
            const y = event.clientY
            gestureChanged = false
            dragging = true
            return Option.wrap({
                abortSignal: abort.signal,
                update: (event: Dragging.Event) => {
                    if (apply(start + (y - event.clientY) / (event.shiftKey ? Reach * 4 : Reach))) {gestureChanged = true}
                },
                cancel: () => {
                    dragging = false
                    if (!active) {return}
                    if (gestureChanged) {revert()}
                    gestureChanged = false
                    refresh()
                },
                approve: () => {
                    dragging = false
                    if (gestureChanged) {commit()}
                    gestureChanged = false
                }
            })
        }),
        Events.subscribe(element, "keydown", event => {
            const delta = event.key === "ArrowUp" || event.key === "ArrowRight" ? 0.02
                : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -0.02 : 0
            if (delta === 0 || dragging) {return} // a key during a drag would mark the drag halfway
            event.preventDefault()
            event.stopPropagation()
            // a whole-number parameter may need a few presses' worth of turn to reach its next value
            const from = mapping.x(get())
            for (let times = 1; times <= 50; times++) {
                if (apply(from + delta * times)) {commit(); return}
            }
        }),
        {terminate: () => {
            if (gestureChanged) {commit()}
            active = false
            abort.abort()
        }}
    )
    refresh()
    return element
}
