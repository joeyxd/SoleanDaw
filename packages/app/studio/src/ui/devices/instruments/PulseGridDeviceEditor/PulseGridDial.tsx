import css from "./PulseGridDial.sass?inline"
import {Exec, Lifecycle, Option, Terminable} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Dragging, Events, Html} from "@opendaw/lib-dom"
import {Surface} from "@/ui/surface/Surface"

const className = Html.adoptStyleSheet(css, "PulseGridDial")

type Construct = {
    lifecycle: Lifecycle
    label: string
    // a fixed unit, or the unit for a value ("1 Step", "16 Steps")
    unit: string | ((value: number) => string)
    min: number
    max: number
    decimals?: number
    step?: number
    // how much one pixel of drag changes the value; left out, 150 pixels cross the whole range
    perPixel?: number
    get: () => number
    set: (value: number) => void
    commit: Exec
    // takes back what `set` did since the gesture began, leaving no undo step
    revert: Exec
    subscribe: (refresh: Exec) => Terminable
}

export const PulseGridDial = ({
    lifecycle, label, unit, min, max, decimals = 0, step = 1, perPixel, get, set, commit, revert, subscribe
}: Construct): HTMLElement => {
    const value: HTMLElement = <span className="value"/>
    const ring: HTMLElement = <span className="ring" aria-hidden="true"/>
    const element: HTMLElement = (
        <div className={className} tabIndex={0} role="spinbutton" aria-label={label}
             title={`${label}: drag vertically or double-click to type`}>
            <span className="readout"><span className="label">{label}</span>{value}</span>
            {ring}
        </div>
    )
    let active = true
    let gestureChanged = false
    const abort = new AbortController()
    const normalize = (next: number): number =>
        Math.max(min, Math.min(max, Number((Math.round(next / step) * step).toFixed(6))))
    const refresh = (): void => {
        const current = get()
        const suffix = typeof unit === "string" ? unit : unit(current)
        value.textContent = `${current.toFixed(decimals)}${suffix === "%" ? "" : " "}${suffix}`
        ring.style.setProperty("--pg-turn", `${Math.max(0, Math.min(1, (current - min) / (max - min))) * 270}deg`)
        element.setAttribute("aria-valuemin", String(min))
        element.setAttribute("aria-valuemax", String(max))
        element.setAttribute("aria-valuenow", String(current))
        element.setAttribute("aria-valuetext", value.textContent)
    }
    const apply = (next: number): boolean => {
        if (!Number.isFinite(next)) {return false}
        const normalized = normalize(next)
        if (normalized === get()) {return false}
        set(normalized)
        refresh()
        return true
    }
    lifecycle.ownAll(
        subscribe(refresh),
        Events.subscribeDblDwn(element, async event => {
            const text = await Surface.get(element).requestFloatingTextInput(event, get().toFixed(decimals))
            if (!active || text.trim() === "") {return}
            const number = Number(text)
            if (!Number.isFinite(number)) {return}
            if (apply(number)) {commit()}
        }),
        Dragging.attach(element, event => {
            const start = get()
            const y = event.clientY
            gestureChanged = false
            return Option.wrap({
                abortSignal: abort.signal,
                update: (event: Dragging.Event) => {
                    const next = normalize(start + (y - event.clientY) * (event.shiftKey ? step : perPixel ?? (max - min) / 150))
                    if (next === get()) {return}
                    gestureChanged = true
                    apply(next)
                },
                cancel: () => {
                    if (!active) {return}
                    if (gestureChanged) {revert()}
                    gestureChanged = false
                    refresh()
                },
                approve: () => {
                    if (gestureChanged) {commit()}
                    gestureChanged = false
                }
            })
        }),
        Events.subscribe(element, "keydown", event => {
            const delta = event.key === "ArrowUp" || event.key === "ArrowRight" ? step
                : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -step : 0
            if (delta === 0) {return}
            event.preventDefault()
            event.stopPropagation()
            if (apply(get() + delta)) {commit()}
        })
    )
    lifecycle.own({terminate: () => {
        if (gestureChanged) {commit()}
        active = false
        abort.abort()
    }})
    refresh()
    return element
}
