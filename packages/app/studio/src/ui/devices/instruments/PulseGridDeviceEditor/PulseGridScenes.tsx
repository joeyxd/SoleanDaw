import css from "./PulseGridScenes.sass?inline"
import {int, Lifecycle, Terminator} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {deferNextFrame, Events, Html} from "@opendaw/lib-dom"
import {ContextMenu, MenuItem} from "@opendaw/studio-core"
import {PulseGridActions, PulseGridSceneView, PulseGridView} from "@opendaw/studio-adapters"
import {MenuButton} from "@/ui/components/MenuButton"
import {PulseGridContext} from "./PulseGridContext"
import {PulseGridScenesLogic as Logic} from "./PulseGridScenesLogic"

const className = Html.adoptStyleSheet(css, "PulseGridScenes")

type Construct = {lifecycle: Lifecycle, context: PulseGridContext}

// The scenes column beside the lanes: one row per scene (number, name, a tiny grid of its lanes), the scene that
// plays in violet, the scene the song plays now with a play mark. It reads `context.doc` and writes with
// `context.send`; the transport position is the only thing it reads elsewhere, once per step.
export const PulseGridScenes = ({lifecycle, context}: Construct): HTMLElement => {
    const {engine} = context.service
    const rows = lifecycle.own(new Terminator())
    const list: HTMLElement = <div className="list"/>
    const drop: HTMLElement = <div className="drop"/>
    const state: {key: string, rowOf: Map<int, HTMLElement>, step: int, suppressClick: boolean} = {
        key: "", rowOf: new Map(), step: -1, suppressClick: false
    }

    const nameOf = (scene: int): string => context.doc.getValue().scenes.find(entry => entry.scene === scene)?.name ?? ""

    const paintSong = (): void => {
        const doc = context.doc.getValue()
        const running = engine.isPlaying.getValue()
        const at = doc.song.on && running ? PulseGridView.songAt(doc, engine.position.getValue()) : undefined
        const scene = Logic.inSongScene(doc.song.on, running, at)
        state.step = Logic.stepOf(engine.position.getValue(), doc.song.on && running)
        state.rowOf.forEach((row, number) => row.classList.toggle("in-song", number === scene))
    }
    const follow = lifecycle.own(deferNextFrame(() => {
        const doc = context.doc.getValue()
        const step = Logic.stepOf(engine.position.getValue(), doc.song.on && engine.isPlaying.getValue())
        if (step !== state.step) {paintSong()}
    }))

    // Replaces the name of a row with a text input. Enter or blur sends, Escape cancels, an unchanged name sends nothing.
    const rename = (scene: int): void => {
        const holder = state.rowOf.get(scene)?.querySelector<HTMLElement>(".name")
        if (holder === null || holder === undefined || holder.querySelector("input") !== null) {return}
        const before = nameOf(scene)
        const input: HTMLInputElement = <input className="rename" type="text" aria-label={`Name of scene ${scene}`}/>
        input.value = before
        const state_ = {done: false, armed: false}
        const finish = (send: boolean): void => {
            if (state_.done) {return}
            state_.done = true
            const next = input.value.trim()
            holder.textContent = Logic.label(scene, before)
            if (send && next !== before) {context.send(PulseGridActions.renameScene(scene, next))}
        }
        input.addEventListener("keydown", event => {
            event.stopPropagation()
            if (event.key === "Enter") {finish(true)} else if (event.key === "Escape") {finish(false)}
        })
        input.addEventListener("pointerdown", event => event.stopPropagation())
        input.addEventListener("dblclick", event => event.stopPropagation())
        input.addEventListener("click", event => event.stopPropagation())
        // a closing menu may take the focus back: ignore a blur until the input has settled
        input.addEventListener("blur", () => {if (state_.armed) {finish(true)}})
        holder.replaceChildren(input)
        input.focus()
        input.select()
        setTimeout(() => {
            if (state_.done) {return}
            if (input.ownerDocument.activeElement !== input) {input.focus()}
            state_.armed = true
        }, 30)
    }

    const moveDrag = (row: HTMLElement, scene: int, down: PointerEvent, order: ReadonlyArray<int>): void => {
        const view = row.ownerDocument.defaultView ?? window
        const session = rows.spawn()
        const drag = {active: false, target: scene}
        const middles = (): ReadonlyArray<number> => order.map(number => {
            const rect = state.rowOf.get(number)?.getBoundingClientRect()
            return rect === undefined ? 0 : rect.top + rect.height / 2
        })
        const show = (): void => {
            const others = order.filter(number => number !== scene)
            const anchor = state.rowOf.get(others[Math.min(drag.target - 1, others.length - 1)])
            if (drag.target === scene || anchor === undefined) {
                drop.style.display = "none"
                return
            }
            const edge = drag.target - 1 < others.length ? anchor.offsetTop : anchor.offsetTop + anchor.offsetHeight
            drop.style.top = `${edge - 2}px`
            drop.style.display = "block"
        }
        session.own({
            terminate: () => {
                row.classList.remove("lifting")
                drop.style.display = "none"
            }
        })
        session.ownAll(
            Events.subscribe(view, "pointermove", (event: PointerEvent) => {
                if (!drag.active) {
                    if (Math.abs(event.clientY - down.clientY) < Logic.DragThreshold) {return}
                    drag.active = true
                    state.suppressClick = true
                    row.classList.add("lifting")
                }
                drag.target = Logic.dropTarget(middles(), scene, event.clientY)
                show()
            }),
            Events.subscribe(view, "pointerup", () => {
                session.terminate()
                if (drag.active && drag.target !== scene) {context.send(PulseGridActions.moveScene(scene, drag.target))}
            }),
            Events.subscribe(view, "pointercancel", () => session.terminate()),
            Events.subscribe(view, "keydown", (event: KeyboardEvent) => {
                if (event.key === "Escape") {session.terminate()}
            }))
    }

    const thumbnail = (view: PulseGridSceneView): HTMLElement => (
        <div className="thumb" aria-hidden="true">
            {view.thumbnail.map(lane => (
                <div className="line" style={{
                    gridTemplateColumns: `repeat(${lane.steps.length}, 1fr)`,
                    color: `hsl(${lane.hue} 98% 60%)`
                }}>
                    {lane.steps.flatMap((on, index) => on ? [<span style={{gridColumn: String(index + 1)}}/>] : [])}
                </div>
            ))}
        </div>
    )

    const buildRow = (view: PulseGridSceneView, order: ReadonlyArray<int>, count: int): HTMLElement => {
        const {scene} = view
        const name: HTMLElement = <span className="name">{Logic.label(scene, view.name)}</span>
        const row: HTMLElement = (
            <div className={Html.buildClassList("row", view.playing && "playing")} role="button" tabIndex={0}
                 aria-pressed={String(view.playing)} data-scene={String(scene)}>
                <div className="top">
                    <span className="num">{String(scene)}</span>
                    {name}
                    <span className="mark" aria-hidden="true">▶</span>
                </div>
                {thumbnail(view)}
            </div>
        )
        rows.ownAll(
            Events.subscribe(row, "pointerdown", (event: PointerEvent) => {
                state.suppressClick = false
                if (event.button !== 0 || event.target instanceof HTMLInputElement) {return}
                moveDrag(row, scene, event, order)
            }),
            Events.subscribe(row, "click", () => {
                if (state.suppressClick) {return}
                context.send(PulseGridActions.pickScene(scene))
            }),
            Events.subscribe(row, "dblclick", () => rename(scene)),
            Events.subscribe(row, "keydown", (event: KeyboardEvent) => {
                if (event.target !== row) {return}
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    context.send(PulseGridActions.pickScene(scene))
                } else if (event.key === "F2") {
                    event.preventDefault()
                    rename(scene)
                }
            }),
            ContextMenu.subscribe(row, collector => {
                collector.addItems(
                    MenuItem.default({label: "Rename"}).setTriggerProcedure(() => rename(scene)),
                    MenuItem.default({label: "Duplicate", selectable: Logic.canAdd(count)})
                        .setTriggerProcedure(() => context.send(PulseGridActions.newScene(context.doc.getValue(), scene))),
                    MenuItem.default({label: "Add to song"}).setTriggerProcedure(() => {
                        const results = context.send(PulseGridActions.addSceneToSong(scene, view.variation))
                        const text = Logic.addedNotice(context.doc.getValue().song.on)
                        if (text !== undefined && results.length > 0 && results.every(result => result.ok)) {
                            context.notice.setValue({kind: "info", text})
                        }
                    }))
                if (Logic.canDelete(count)) {
                    collector.addItems(MenuItem.default({label: "Delete"})
                        .setTriggerProcedure(() => context.send(PulseGridActions.removeScene(scene))))
                }
            }))
        return row
    }

    const newButton = (): HTMLElement => (
        <div className="new">
            <MenuButton root={MenuItem.root().setRuntimeChildrenProcedure(parent => {
                const doc = context.doc.getValue()
                parent.addMenuItem(
                    MenuItem.default({label: "Empty scene"})
                        .setTriggerProcedure(() => context.send(PulseGridActions.newScene(context.doc.getValue()))),
                    MenuItem.default({label: `Copy of ${Logic.label(doc.scene, nameOf(doc.scene))}`})
                        .setTriggerProcedure(() => {
                            const now = context.doc.getValue()
                            context.send(PulseGridActions.newScene(now, now.scene))
                        }))
            })} onInit={button => button.dataset.action = "new-scene"}>
                <span>+ New Scene</span>
            </MenuButton>
        </div>
    )

    const render = (): void => {
        const doc = context.doc.getValue()
        const views = PulseGridView.scenes(doc)
        const key = JSON.stringify(views)
        if (key !== state.key) {
            state.key = key
            rows.terminate()
            state.rowOf = new Map()
            const order = views.map(view => view.scene)
            const built = views.map(view => {
                const row = buildRow(view, order, views.length)
                state.rowOf.set(view.scene, row)
                return row
            })
            list.replaceChildren(...built, drop, ...(Logic.canAdd(views.length) ? [newButton()] : []))
        }
        paintSong()
    }

    lifecycle.ownAll(
        context.doc.catchupAndSubscribe(render),
        engine.position.subscribe(follow.request),
        engine.isPlaying.subscribe(follow.request))
    return (
        <div className={className} aria-label="Scenes">
            <div className="heading">SCENES</div>
            {list}
        </div>
    )
}
