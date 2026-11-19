import css from "./PulseGridPicture.sass?inline"
import {createElement} from "@opendaw/lib-jsx"
import {Events, Html} from "@opendaw/lib-dom"
import {PulseGridPictureKind, PulseGridPictures} from "./PulseGridPictures"

const className = Html.adoptStyleSheet(css, "PulseGridPicture")

// One small line icon per picture kind: a 24 x 24 box, a round 1.6 stroke in the current colour, no fill. They stand
// in the lane's head and in the panel when its picture is not there. Each is a few paths, drawn here as text.
const ellipse = (cx: number, cy: number, rx: number, ry: number): string =>
    `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`
const box = (x: number, y: number, w: number, h: number): string => `M${x} ${y}h${w}v${h}h${-w}z`

const Shapes: Readonly<Record<PulseGridPictureKind, ReadonlyArray<string>>> = {
    // a drum seen from the front, with its pedal below
    kick: [ellipse(12, 10.5, 7.5, 7.5), ellipse(12, 10.5, 2.4, 2.4), "M12 18v3.5M8.5 21.5h7"],
    // a short wide drum, its wires and a stick
    snare: [ellipse(12, 10, 9, 3), "M3 10v5.5a9 3 0 0 0 18 0V10", "M7 14l2.5 2.3 2.5-2.3 2.5 2.3 2.5-2.3", "M5 2.5l8 4.5"],
    // two hands meeting, and the burst
    clap: [
        "M3.45 19.3L8.45 8.3A1.7 1.7 0 0 1 11.55 9.7L6.55 20.7A1.7 1.7 0 0 1 3.45 19.3Z",
        "M20.55 19.3L15.55 8.3A1.7 1.7 0 0 0 12.45 9.7L17.45 20.7A1.7 1.7 0 0 0 20.55 19.3Z",
        "M12 2v3M6.5 3.5l1.5 2M17.5 3.5l-1.5 2"
    ],
    // two flat cymbals on a rod, shut
    hat: [ellipse(12, 9.5, 9, 1.7), ellipse(12, 12.2, 9, 1.7), "M12 3.5v4.3", "M12 13.9V21M8 21h8"],
    // the same, the top one lifted
    openhat: [ellipse(12, 6, 9, 1.7), ellipse(12, 13.5, 9, 1.7), "M12 2v2.3M12 7.7v4.1", "M12 15.2V21M8 21h8"],
    // a tall drum on legs
    tom: [ellipse(12, 7.5, 6.5, 2.5), "M5.5 7.5V16a6.5 2.5 0 0 0 13 0V7.5", "M9.5 18.2L8 22M14.5 18.2L16 22", "M12 5V2.5"],
    // one big cymbal with its dome, on a stand
    cymbal: [ellipse(12, 10, 10, 2.8), "M8.5 9.6Q8.5 6.5 12 6.5T15.5 9.6", "M12 12.8V21M8 21h8", "M4 5l2 1.5M20 5l-2 1.5"],
    cowbell: ["M7.5 7h9l3 12h-15z", "M9.5 7V4.5h5V7", "M6.1 12.5h11.8"],
    // two maracas
    shaker: [ellipse(7.5, 8, 4, 4), ellipse(16.5, 8, 4, 4), "M8.5 11.8L11 21M15.5 11.8L13 21",
        "M6.2 7.5h.01M8.4 9.3h.01M15 7h.01M17.2 9h.01"],
    // a conga
    perc: [ellipse(12, 5.5, 6.5, 2), "M5.5 5.5C6 11 7.5 17 8.2 21.5h7.6C16.5 17 18 11 18.5 5.5", "M6.6 12Q12 14.2 17.4 12"],
    // a speaker cone
    bass: [ellipse(12, 12, 9.5, 9.5), ellipse(12, 12, 5, 5), ellipse(12, 12, 1.2, 1.2)],
    // a keyboard
    keys: [box(3, 5, 18, 14), "M6 5v7h3V5M15 5v7h3V5", "M12 5v14M7.5 12v7M16.5 12v7"],
    // a saw wave on its axis
    lead: ["M2.5 17L8 7v10l5.5-10v10L19 7v10h2.5", "M2 21h20"],
    // a trumpet
    brass: ["M14 12l7-7v14z", "M2 12h12", "M6 12v5h5v-5", "M8.5 12V9M7.5 9h2"],
    // an acoustic guitar
    guitar: [ellipse(9, 15, 5.5, 5.5), ellipse(9, 15, 1.5, 1.5), "M13 11L20 4", "M18.5 2.8l2.7 2.7"],
    // four bars, each shorter than the one before
    marimba: [box(2.2, 4, 3, 16), box(7.8, 4, 3, 13), box(13.4, 4, 3, 10), box(19, 4, 3, 7)],
    // plates with a tube hanging under each
    vibraphone: [box(3, 3.5, 4.5, 2) + box(9.8, 3.5, 4.5, 2) + box(16.6, 3.5, 4.5, 2),
        box(3.8, 8.5, 3, 12.5) + box(10.5, 8.5, 3, 9.5) + box(17.2, 8.5, 3, 6.5)],
    // three bars stacked, each shorter than the one above
    xylophone: [box(3, 3.5, 18, 4), box(5, 10, 14, 4), box(7, 16.5, 10, 4)],
    // a bell with its clapper and the ring of it
    bells: ["M5.5 17.5Q7 16 7 11a5 5 0 0 1 10 0Q17 16 18.5 17.5z", ellipse(12, 20.2, 1.6, 1.6), ellipse(12, 4.2, 1.2, 1.2),
        "M3 8.5Q2 11 3 14M21 8.5Q22 11 21 14"],
    // a pan: the head with its notes, a deep rim
    steeldrum: [ellipse(12, 8.5, 9.5, 3.6), "M2.5 8.5V16a9.5 3.6 0 0 0 19 0V8.5",
        ellipse(8, 8.2, 1.6, 1) + ellipse(12, 9.6, 1.6, 1) + ellipse(16, 8.2, 1.6, 1)],
    // a kettle drum with a mallet
    timpani: [ellipse(12, 8, 9, 2.8), "M3 8C3 17 7.5 20.5 12 20.5S21 17 21 8", "M9 22h6M12 20.5V22", "M21 2.5L15.5 6", ellipse(21.4, 2.2, 1.2, 1.2)],
    // a thumb piano: tines over a sound hole
    kalimba: ["M6 3h12q2 0 2 2v14q0 2-2 2H6q-2 0-2-2V5q0-2 2-2z", "M7 6v7M9.5 6v9M12 6v10M14.5 6v9M17 6v7", ellipse(12, 19, 1.1, 1.1)]
}

export namespace PulseGridIcons {
    export const of = (kind: PulseGridPictureKind): SVGElement => (
        <svg className="pg-icon" data-picture={kind} viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            {Shapes[kind].map(d => <path d={d}/>)}
        </svg>
    )
}

// The picture of a kind in a 3:2 box, tinted by the CSS colour --lane of whoever holds it. When the file does not
// load, the box shows the kind's icon instead. The tint waits for the file: over an empty box it would show as a
// plain rectangle of the lane's colour until the picture arrives.
export const PulseGridPicture = ({kind}: {kind: PulseGridPictureKind}): HTMLElement => {
    const image: HTMLImageElement = <img src={PulseGridPictures.url(kind)} alt="" draggable="false"/>
    const box: HTMLElement = <div className={className} data-picture={kind}>{image}</div>
    const ready = () => box.classList.add("ready")
    if (image.complete && image.naturalWidth > 0) {ready()}
    Events.subscribe(image, "load", ready)
    Events.subscribe(image, "error", () => {
        box.classList.add("missing")
        box.replaceChildren(PulseGridIcons.of(kind))
    })
    return box
}
