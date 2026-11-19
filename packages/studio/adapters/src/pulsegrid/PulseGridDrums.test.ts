import {describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {AudioUnitBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {PulseGridCatalog} from "./PulseGridCatalog"
import {PulseGridDevice} from "./PulseGridDevice"
import {PulseGridDocs} from "./PulseGridDocs"
import {PulseGridDrums} from "./PulseGridDrums"
import {PulseGridFactory, PulseGridLaneSpec} from "./PulseGridFactory"
import {PulseGridKits} from "./PulseGridKits"
import {PulseGridOps} from "./PulseGridOps"
import {PulseGridOp} from "./PulseGridTypes"

const Rate = 44100

// Energy per frequency of the first 16384 frames (zero-padded), by a plain radix-2 FFT: returns the power per bin.
const spectrum = (frames: Float32Array): Float64Array => {
    const size = 16384
    const re = new Float64Array(size)
    const im = new Float64Array(size)
    frames.slice(0, size).forEach((value, index) => {re[index] = value})
    for (let i = 1, j = 0; i < size; i++) {
        let bit = size >> 1
        for (; j & bit; bit >>= 1) {j ^= bit}
        j ^= bit
        if (i < j) {[re[i], re[j]] = [re[j], re[i]]}
    }
    for (let length = 2; length <= size; length <<= 1) {
        const angle = -2 * Math.PI / length
        for (let start = 0; start < size; start += length) {
            for (let k = 0; k < length / 2; k++) {
                const wr = Math.cos(angle * k), wi = Math.sin(angle * k)
                const a = start + k, b = a + length / 2
                const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr
                re[b] = re[a] - xr
                im[b] = im[a] - xi
                re[a] += xr
                im[a] += xi
            }
        }
    }
    return re.map((value, index) => value * value + im[index] * im[index]).slice(0, size / 2)
}
const hertz = (bin: number): number => bin * Rate / 16384

describe("PulseGridDrums", () => {
    it("has 4 kits x 6 sounds named <Kit> <Sound>, with v4-shaped unique uuids", () => {
        expect(PulseGridDrums.All.length).toBe(24)
        expect(PulseGridDrums.Kits).toEqual(["Analog", "Punch", "Electro", "Soft"])
        for (const drum of PulseGridDrums.All) {
            expect(drum.name).toBe(`${drum.kit} ${drum.role}`)
            expect(drum.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        }
        expect(new Set(PulseGridDrums.All.map(drum => drum.uuid)).size).toBe(24)
        expect(new Set(PulseGridDrums.All.map(drum => drum.name)).size).toBe(24)
    })

    it("finds by uuid and by name, and renders nothing for an uuid that is not ours", () => {
        const kick = PulseGridDrums.byName("  analog KICK ")!
        expect(kick.name).toBe("Analog Kick")
        expect(PulseGridDrums.find(kick.uuid)).toBe(kick)
        expect(PulseGridDrums.byName("TR-808 Bass Drum")).toBeUndefined()
        expect(PulseGridDrums.render("b50f6f4f-d933-400c-a63a-83b3c2f6c8b2", Rate)).toBeUndefined()
    })

    describe.each(PulseGridDrums.All)("$name", drum => {
        const audio = PulseGridDrums.render(drum.uuid, Rate)!

        it("is finite mono audio, peaking between 0.5 and 0.95, as long as its duration says", () => {
            expect(audio.numberOfChannels).toBe(1)
            expect(audio.sampleRate).toBe(Rate)
            const frames = audio.frames[0]
            expect(frames.length).toBe(audio.numberOfFrames)
            expect(frames.every(Number.isFinite)).toBe(true)
            const peak = frames.reduce((max, value) => Math.max(max, Math.abs(value)), 0)
            expect(peak).toBeGreaterThan(0.5)
            expect(peak).toBeLessThan(0.95)
            expect(Math.abs(audio.numberOfFrames / Rate - drum.duration)).toBeLessThan(0.001)
            expect(Math.abs(frames[frames.length - 1])).toBe(0)
        })

        it("renders the same samples every time", () => {
            const again = PulseGridDrums.render(drum.uuid, Rate)!
            expect(Array.from(again.frames[0])).toEqual(Array.from(audio.frames[0]))
        })

        it("rings out: the last tenth of it is far below its peak", () => {
            const frames = audio.frames[0]
            const tail = frames.slice(Math.floor(frames.length * 0.9))
            expect(tail.reduce((max, value) => Math.max(max, Math.abs(value)), 0)).toBeLessThan(0.05)
        })
    })

    it("keeps a kick low and a hat high", () => {
        for (const drum of PulseGridDrums.All.filter(drum => drum.role === "Kick")) {
            const power = spectrum(PulseGridDrums.render(drum.uuid, Rate)!.frames[0])
            const strongest = power.indexOf(Math.max(...power))
            expect(hertz(strongest)).toBeLessThan(150)
        }
        for (const drum of PulseGridDrums.All.filter(drum => drum.role === "Hat" || drum.role === "Open Hat")) {
            const power = spectrum(PulseGridDrums.render(drum.uuid, Rate)!.frames[0])
            const above = power.reduce((sum, value, bin) => hertz(bin) > 4000 ? sum + value : sum, 0)
            expect(above / power.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0.5)
        }
    })

    it("makes different sounds for different rates but each one the same every time", () => {
        const uuid = PulseGridDrums.All[1].uuid
        const low = PulseGridDrums.render(uuid, 22050)!
        expect(low.numberOfFrames).toBeLessThan(PulseGridDrums.render(uuid, Rate)!.numberOfFrames)
        expect(Array.from(PulseGridDrums.render(uuid, 22050)!.frames[0])).toEqual(Array.from(low.frames[0]))
    })
})

describe("PulseGridKits with the built-in drums", () => {
    it("starts with the four built-in kits, then the nine cloud kits", () => {
        expect(PulseGridKits.All.length).toBe(13)
        expect(PulseGridKits.All.slice(0, 4).map(kit => kit.name)).toEqual(["Analog", "Punch", "Electro", "Soft"])
        expect(PulseGridKits.All.filter(kit => kit.builtin).length).toBe(4)
        expect(PulseGridKits.All[4].name).toBe("TR-808")
        expect(PulseGridKits.All.slice(4).some(kit => kit.builtin)).toBe(false)
    })

    it("fills the five roles of every built-in kit with that kit's own drums", () => {
        for (const kit of PulseGridKits.All.slice(0, 4)) {
            for (const {role} of PulseGridKits.Roles) {
                const sample = kit.sounds[role]
                expect(sample.name).toBe(`${kit.name} ${role}`)
                expect(PulseGridDrums.find(sample.uuid)?.name).toBe(sample.name)
                expect(sample.duration).toBe(PulseGridDrums.find(sample.uuid)!.duration)
            }
        }
    })

    it("lists the built-in drums first, as PulseGrid drums by kit, only when asked", () => {
        const withDrums = PulseGridCatalog.items(undefined, undefined, true)
        expect(PulseGridCatalog.items(undefined, undefined)).toEqual([])
        expect(withDrums.length).toBe(24)
        expect(withDrums[0]).toMatchObject({name: "Kick", folder: ["PulseGrid drums", "Analog"], kind: "drum"})
        expect(PulseGridCatalog.find(withDrums, {tab: "drums", query: "punch snare"}).map(item => item.source))
            .toEqual([{type: "sample", sample: PulseGridKits.All[1].sounds.Snare}])
        expect(PulseGridCatalog.sound(withDrums[0])).toEqual({instrument: "Nano", sample: PulseGridKits.All[0].sounds.Kick})
    })
})

describe("PulseGrid {drum}", () => {
    const fixture = (specs: ReadonlyArray<PulseGridLaneSpec> = PulseGridFactory.DefaultKit) => {
        const {boxGraph: graph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} =
            ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
        graph.beginTransaction()
        const unit = AudioUnitBox.create(graph, UUID.generate(), box => {
            box.collection.refer(rootBox.audioUnits)
            box.output.refer(primaryAudioBusBox.input)
            box.index.setValue(1)
        })
        const composite = PulseGridFactory.create(graph, unit.input, "Test grid", specs)
        graph.endTransaction()
        const read = () => PulseGridDocs.read(PulseGridDevice.find(composite).unwrap())
        const apply = (...ops: ReadonlyArray<PulseGridOp>) => {
            graph.beginTransaction()
            try {return PulseGridOps.apply(composite, ops, {})} finally {graph.endTransaction()}
        }
        return {graph, read, apply}
    }

    it("makes the default drum lanes play the Analog kit, built in", () => {
        const lanes = fixture().read().lanes.filter(lane => lane.kind === "drum")
        expect(lanes.map(lane => lane.sound?.sample?.name)).toEqual(
            ["Analog Kick", "Analog Snare", "Analog Clap", "Analog Hat", "Analog Perc"])
        lanes.forEach(lane => expect(PulseGridDrums.find(lane.sound!.sample!.uuid)).toBeDefined())
    })

    it("is taken by addLane and setLaneSound, and the lane reads back by that name", () => {
        const f = fixture()
        const results = f.apply(
            {op: "addLane", name: "Open", kind: "drum", sound: {drum: "Soft Open Hat"}},
            {op: "setLaneSound", lane: 1, sound: {drum: "punch kick"}},
            {op: "setLaneSound", lane: 2, sound: {drum: "Electro Snare", label: "Zap"}})
        expect(results.filter(result => !result.ok)).toEqual([])
        const lanes = f.read().lanes
        expect(lanes.length).toBe(8)
        expect(lanes[7].sound).toMatchObject({instrument: "Nano", label: "Soft Open Hat",
            sample: {uuid: PulseGridDrums.byName("Soft Open Hat")!.uuid, name: "Soft Open Hat"}})
        expect(lanes[0].sound).toMatchObject({label: "Punch Kick", sample: {name: "Punch Kick"}})
        expect(lanes[1].sound).toMatchObject({label: "Zap", sample: {name: "Electro Snare"}})
    })

    it("refuses an unknown name listing the kit names, and changes nothing", () => {
        const f = fixture()
        const before = f.read()
        const boxes = f.graph.boxes().length
        for (const op of [{op: "addLane", name: "Bad", kind: "drum", sound: {drum: "Metal Kick"}},
            {op: "setLaneSound", lane: 1, sound: {drum: "Kick"}},
            {op: "setLaneSound", lane: 1, sound: {drum: 7}}] as ReadonlyArray<PulseGridOp>) {
            const [result] = f.apply(op)
            expect(result.ok).toBe(false)
            expect(result.ok ? "" : result.error).toContain("kits: Analog, Punch, Electro, Soft")
        }
        expect(f.read()).toEqual(before)
        expect(f.graph.boxes().length).toBe(boxes)
    })

    it("is taken by the factory too, when a PulseGrid is made from lane specs", () => {
        const lanes = fixture([{name: "K", kind: "drum", sound: {drum: "Soft Kick"}}]).read().lanes
        expect(lanes.map(lane => lane.sound?.sample?.name)).toEqual(["Soft Kick"])
    })
})
