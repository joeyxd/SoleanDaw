import {BoxGraph, Field} from "@opendaw/lib-box"
import {int, Option, UUID} from "@opendaw/lib-std"
import {AudioFileBox, InstrumentCompositeBox, InstrumentCompositeCellBox, PulseGridBox, PulseGridLaneDeviceBox} from "@opendaw/studio-boxes"
import {IconSymbol, Pointers} from "@opendaw/studio-enums"
import {InstrumentFactories} from "../factories/InstrumentFactories"
import {TubularPreset} from "../devices/instruments/Tubular/TubularPreset"
import {PulseGridDevice, PulseGridLane} from "./PulseGridDevice"
import {PulseGridError, PulseGridSoundInput} from "./PulseGridTypes"

export type PulseGridLaneSpec = {
    name: string, kind: "drum" | "melodic", sound: PulseGridSoundInput,
    pitch?: int
    group?: int
    hue?: int
}

// Tubular Classics, by openDAW, CC0 (public/tubular/cartridges/Tubular_Classics.syx).
// Decoded once with Dx7Sysex.decode; unpacked 155-byte DX7 voices, OP6 first.
const synthBass = [
    99,68,64,68,99,50,0,0,39,0,30,0,0,0,0,6,68,0,1,0,7,99,64,50,64,99,82,58,0,39,0,0,0,0,0,0,2,85,0,1,0,9,
    99,66,60,66,99,62,0,0,39,0,30,0,0,0,0,5,72,0,1,0,7,99,64,50,64,99,84,60,0,39,0,0,0,0,0,0,2,95,0,1,0,7,
    99,66,58,66,99,66,0,0,39,0,30,0,0,0,0,5,78,0,0,0,7,99,64,50,64,99,84,60,0,39,0,0,0,0,0,0,2,99,0,0,0,7,
    99,99,99,99,50,50,50,50,4,7,1,35,0,0,0,1,0,3,24,83,121,110,116,104,32,66,97,115,115
]
const marimba = [
    99,75,74,75,99,30,0,0,39,0,0,0,0,0,0,7,56,0,1,0,7,99,66,58,65,99,55,0,0,39,0,0,0,0,0,0,3,58,0,4,0,7,
    99,70,64,68,99,40,0,0,39,0,50,0,0,0,0,6,64,0,10,0,7,99,65,48,62,99,78,0,0,39,0,30,0,0,0,0,3,84,0,1,0,8,
    99,68,62,68,99,45,0,0,39,0,40,0,0,0,0,6,70,0,4,0,7,99,65,47,62,99,80,0,0,39,0,30,0,0,0,0,3,99,0,1,0,7,
    99,99,99,99,50,50,50,50,4,4,1,35,0,0,0,1,0,3,24,77,97,114,105,109,98,97,32,32,32
]

const fail: (message: string) => never = message => {throw new PulseGridError(message)}
const text = (name: string, value: unknown): void => {
    if (typeof value !== "string") {fail(`${name} ${String(value)} is not allowed: expected a string`)}
}
const integer = (name: string, value: number, min: int, max: int): void => {
    if (!Number.isInteger(value) || value < min || value > max) {
        fail(`${name} ${String(value)} is not allowed: expected an integer ${min}..${max}`)
    }
}
const validateSound = (graph: BoxGraph, sound: PulseGridSoundInput): void => {
    if (sound === null || typeof sound !== "object") {fail("sound must be Nano or Tubular")}
    if (sound.label !== undefined) {text("sound label", sound.label)}
    if (sound.instrument === "Nano") {
        const sample = sound.sample
        if (sample === null || typeof sample !== "object") {fail("Nano requires a sample")}
        if (typeof sample.uuid !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sample.uuid)) {
            fail(`sample uuid ${String(sample.uuid)} is not allowed: expected a UUID`)
        }
        text("sample name", sample.name)
        if (typeof sample.duration !== "number" || !Number.isFinite(sample.duration) || sample.duration <= 0) {
            fail(`sample duration ${String(sample.duration)} is not allowed: expected positive seconds`)
        }
        graph.findBox(UUID.parse(sample.uuid)).ifSome(box => {
            if (!(box instanceof AudioFileBox)) {fail(`sample uuid ${sample.uuid} is already used by ${box.name}`)}
        })
    } else if (sound.instrument === "Tubular") {
        if (sound.voice === undefined) {return}
        const voice = sound.voice
        if (voice === null || typeof voice !== "object") {fail("Tubular voice must have a name and patch")}
        text("voice name", voice.name)
        if (!Array.isArray(voice.patch) || voice.patch.length !== 155 ||
            !Array.from(voice.patch).every(value => Number.isInteger(value) && value >= 0 && value <= 127)) {
            fail("voice patch is not allowed: expected 155 integers 0..127")
        }
    } else {fail(`instrument ${String((sound as {instrument?: unknown}).instrument)} is not allowed: expected Nano or Tubular`)}
}
const validateSpec = (graph: BoxGraph, spec: PulseGridLaneSpec): void => {
    if (spec === null || typeof spec !== "object") {fail("lane must be an object")}
    text("lane name", spec.name)
    if (spec.kind !== "drum" && spec.kind !== "melodic") {fail(`kind ${spec.kind} is not allowed: expected drum or melodic`)}
    integer("pitch", spec.pitch ?? 60, 0, 127)
    integer("group", spec.group ?? (spec.kind === "drum" ? 0 : 1), -2147483648, 2147483647)
    integer("hue", spec.hue ?? 0, 0, 359)
    validateSound(graph, spec.sound)
}
const current = (device: PulseGridDevice): PulseGridDevice => PulseGridDevice.find(device.composite).unwrap()
const member = (device: PulseGridDevice, lane: PulseGridLane): void => {
    if (!device.lanes.some(other => other.device === lane.device && other.cell === lane.cell)) {
        fail("lane does not belong to this PulseGrid")
    }
}
const cellsOf = (composite: InstrumentCompositeBox): Array<InstrumentCompositeCellBox> =>
    composite.cells.pointerHub.incoming().map(({box}) => box)
        .filter((box): box is InstrumentCompositeCellBox => box instanceof InstrumentCompositeCellBox)
        .sort((a, b) => a.index.getValue() - b.index.getValue())
const indexCells = (cells: ReadonlyArray<InstrumentCompositeCellBox>): void =>
    cells.forEach((cell, index) => cell.index.setValue(index))
const makeSound = (cell: InstrumentCompositeCellBox, sound: PulseGridSoundInput) => {
    const graph = cell.graph
    if (sound.instrument === "Nano") {
        const {uuid, name, duration} = sound.sample
        const file = graph.findBox<AudioFileBox>(UUID.parse(uuid)).unwrapOrElse(() =>
            AudioFileBox.create(graph, UUID.parse(uuid), box => {
                box.fileName.setValue(name)
                box.endInSeconds.setValue(duration)
            }))
        return InstrumentFactories.Nano.create(graph, cell.instrument, sound.label ?? name, IconSymbol.NanoWave, file)
    }
    const box = InstrumentFactories.Tubular.create(graph, cell.instrument, "Tubular", IconSymbol.Tubular)
    if (sound.voice !== undefined) {TubularPreset.apply(box, new Uint8Array(sound.voice.patch))}
    box.label.setValue(sound.label ?? sound.voice?.name ?? "Tubular")
    return box
}
const makeLane = (composite: InstrumentCompositeBox, head: PulseGridBox, spec: PulseGridLaneSpec,
                  seeds: Set<int>): PulseGridLane => {
    const graph = composite.graph
    const cell = InstrumentCompositeCellBox.create(graph, UUID.generate(), box => box.composite.refer(composite.cells))
    let seed = new DataView(UUID.generate().buffer).getUint32(0) & 0x7fffffff
    while (seed === 0 || seeds.has(seed)) {seed = (seed + 1) & 0x7fffffff}
    seeds.add(seed)
    const device = PulseGridLaneDeviceBox.create(graph, UUID.generate(), box => {
        box.host.refer(cell.midiEffects)
        box.grid.refer(head)
        box.index.setValue(0)
        box.label.setValue(spec.name)
        box.kind.setValue(spec.kind === "drum" ? 0 : 1)
        box.pitch.setValue(spec.pitch ?? 60)
        box.group.setValue(spec.group ?? (spec.kind === "drum" ? 0 : 1))
        box.hue.setValue(spec.hue ?? 0)
        box.seed.setValue(seed)
    })
    return {cell, device, instrument: Option.wrap(makeSound(cell, spec.sound))}
}

export namespace PulseGridFactory {
    export const DefaultKit: ReadonlyArray<PulseGridLaneSpec> = [
        {name: "Kick", kind: "drum", hue: 181, sound: {instrument: "Nano", sample: {
            uuid: "b50f6f4f-d933-400c-a63a-83b3c2f6c8b2", name: "TR-808 Bass Drum", duration: 3}}},
        {name: "Snare", kind: "drum", hue: 300, sound: {instrument: "Nano", sample: {
            uuid: "0378e25e-6d3f-4db3-a54f-4ae795ca0ff7", name: "TR-808 Snare Drum", duration: 0.5}}},
        {name: "Clap", kind: "drum", hue: 36, sound: {instrument: "Nano", sample: {
            uuid: "8537b54c-f18a-459f-9f29-a847232a889e", name: "TR-808 Hand Clap", duration: 2}}},
        {name: "Hat", kind: "drum", hue: 60, sound: {instrument: "Nano", sample: {
            uuid: "bd20b35e-bdde-4dff-860a-a5524d7adbfc", name: "TR-808 Closed Hi-Hat", duration: 0.25}}},
        {name: "Perc", kind: "drum", hue: 77, sound: {instrument: "Nano", sample: {
            uuid: "210afc07-3e7e-4548-8608-012b82790a31", name: "TR-808 Claves", duration: 0.25}}},
        {name: "Synth", kind: "melodic", hue: 301, sound: {instrument: "Tubular", voice: {name: "Synth Bass", patch: synthBass}}},
        {name: "Marimba", kind: "melodic", hue: 35, sound: {instrument: "Tubular", voice: {name: "Marimba", patch: marimba}}}
    ]

    export const create = (graph: BoxGraph, host: Field<Pointers.InstrumentHost | Pointers.AudioOutput>,
                           name: string, lanes?: ReadonlyArray<PulseGridLaneSpec>): InstrumentCompositeBox => {
        text("name", name)
        if (!Array.isArray(lanes) || lanes.length === 0) {fail("PulseGrid requires at least one lane")}
        lanes.forEach(spec => validateSpec(graph, spec))
        const composite = InstrumentFactories.InstrumentComposite.create(graph, host, name, IconSymbol.Stack)
        const head = PulseGridBox.create(graph, UUID.generate(), box => box.label.setValue(name))
        const seeds = new Set<int>()
        indexCells(lanes.map(spec => makeLane(composite, head, spec, seeds).cell))
        return composite
    }

    export const addLane = (device: PulseGridDevice, spec: PulseGridLaneSpec, at?: int): PulseGridLane => {
        device = current(device)
        validateSpec(device.composite.graph, spec)
        const position = at === undefined ? device.lanes.length + 1 : at
        integer("at", position, 1, device.lanes.length + 1)
        const cells = cellsOf(device.composite)
        const index = position > device.lanes.length ? cells.length : cells.indexOf(device.lanes[position - 1].cell)
        const lane = makeLane(device.composite, device.head, spec, new Set(device.lanes.map(lane => lane.device.seed.getValue())))
        cells.splice(index, 0, lane.cell)
        indexCells(cells)
        return lane
    }

    export const removeLane = (device: PulseGridDevice, lane: PulseGridLane): void => {
        device = current(device)
        member(device, lane)
        if (device.lanes.length === 1) {fail("Cannot remove the last lane; PulseGrid requires at least one lane")}
        lane.cell.delete()
        indexCells(cellsOf(device.composite))
    }

    export const moveLane = (device: PulseGridDevice, lane: PulseGridLane, to: int): void => {
        device = current(device)
        member(device, lane)
        integer("to", to, 1, device.lanes.length)
        const cells = cellsOf(device.composite)
        const target = cells.indexOf(device.lanes[to - 1].cell)
        cells.splice(cells.indexOf(lane.cell), 1)
        cells.splice(target, 0, lane.cell)
        indexCells(cells)
    }

    export const setLaneSound = (device: PulseGridDevice, lane: PulseGridLane, sound: PulseGridSoundInput): void => {
        member(current(device), lane)
        validateSound(device.composite.graph, sound)
        lane.cell.instrument.pointerHub.incoming().forEach(({box}) => box.delete())
        makeSound(lane.cell, sound)
    }
}
