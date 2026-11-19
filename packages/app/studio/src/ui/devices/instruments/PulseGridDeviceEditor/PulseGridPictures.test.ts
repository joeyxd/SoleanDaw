import {describe, expect, it} from "vitest"
import {PulseGridKits} from "@opendaw/studio-adapters"
import {PulseGridPictureKind, PulseGridPictures} from "./PulseGridPictures"

type Lane = Parameters<typeof PulseGridPictures.of>[0]
const lane = (label: string | null, name = "Lane", kind: Lane["kind"] = "drum"): Lane =>
    ({name, kind, sound: label === null ? null : {label}})

const byLabel: ReadonlyArray<[PulseGridPictureKind, ReadonlyArray<string>]> = [
    ["marimba", ["Marimba"]],
    ["vibraphone", ["Vibraphone", "Vibes"]],
    ["xylophone", ["Xylophone"]],
    ["bells", ["Glockenspiel", "Celesta", "Glass Bell", "Tubular Bells", "Bell", "Bells", "Chime"]],
    ["steeldrum", ["Steel Drum"]],
    ["timpani", ["Timpani"]],
    ["kalimba", ["Kalimba"]],
    ["bass", ["Slap Bass", "Solid Bass", "Synth Bass", "Fretless Bass"]],
    ["keys", ["Soft Rhodes", "Bright Rhodes", "Harpsichord", "Piano", "Organ", "Clavinet", "E.Piano"]],
    ["brass", ["Brass Section", "Trumpet", "Horn", "Sax"]],
    ["guitar", ["Nylon Guitar", "Guitar"]],
    ["lead", ["Square Lead", "Bright Lead", "Pad", "Strings", "Synth", "Lead"]],
    ["kick", ["FM Bass Drum", "Bass Drum", "Kick", "BD", "TR-808 Bass Drum", "909 Bassdrum"]],
    ["snare", ["FM Snare", "Snare", "Snare Drum", "SD", "Rim Shot", "Rimshot", "TR-808 Snare Drum"]],
    ["clap", ["Clap", "Hand Clap", "CP", "TR-808 Hand Clap"]],
    ["hat", ["Closed Hi-Hat", "Closed Hat", "Hi-Hat", "HiHat", "Hat", "CH", "TR-707 Hihat Closed High"]],
    ["openhat", ["Open Hi-Hat", "Open Hat", "OH"]],
    ["tom", ["Low Tom", "Mid Tom", "High Tom", "Tom"]],
    ["cymbal", ["Crash", "Ride", "Cymbal"]],
    ["cowbell", ["Cowbell", "TR-707 Cowbell"]],
    ["shaker", ["Maracas", "Shaker", "Tambourine", "Cabasa"]],
    ["perc", ["Conga", "Bongo", "Clave", "Claves", "Percussion"]]
]

describe("PulseGridPictures.of by the sound's label", () => {
    byLabel.forEach(([kind, labels]) => labels.forEach(label => {
        it(`"${label}" is ${kind}`, () => {
            expect(PulseGridPictures.of(lane(label))).toBe(kind)
            expect(PulseGridPictures.of(lane(label.toUpperCase(), "Lane", "melodic"))).toBe(kind)
        })
    }))

    it("a bass DRUM is never bass, a cowbell never bells, an open hat never the closed one", () => {
        expect(PulseGridPictures.of(lane("Bass Drum"))).not.toBe("bass")
        expect(PulseGridPictures.of(lane("Cowbell"))).not.toBe("bells")
        expect(PulseGridPictures.of(lane("Open Hat"))).not.toBe("hat")
    })

    it("the label wins over the name", () => {
        expect(PulseGridPictures.of(lane("Marimba", "Kick", "melodic"))).toBe("marimba")
    })

    it("words are whole: no kind from the middle of a word", () => {
        expect(PulseGridPictures.of(lane("Chant"))).toBe("perc")
        expect(PulseGridPictures.of(lane("Bassoon", "Lane", "melodic"))).toBe("lead")
    })
})

describe("PulseGridPictures.of falls back", () => {
    it("to the lane's name when the label decides nothing", () => {
        expect(PulseGridPictures.of(lane("Sample 01", "Kick"))).toBe("kick")
        expect(PulseGridPictures.of(lane("Sample 01", "Hi-Hat"))).toBe("hat")
    })

    it("to the lane's name when there is no sound", () => {
        expect(PulseGridPictures.of(lane(null, "Bass", "melodic"))).toBe("bass")
        expect(PulseGridPictures.of(lane(null, "Percussion"))).toBe("perc")
    })

    it("to perc for a drum lane and lead for a melodic lane when nothing decides", () => {
        expect(PulseGridPictures.of(lane("Sample 01", "Lane 7", "drum"))).toBe("perc")
        expect(PulseGridPictures.of(lane(null, "Lane 7", "melodic"))).toBe("lead")
        expect(PulseGridPictures.of(lane("", "", "melodic"))).toBe("lead")
    })
})

describe("PulseGridPictures.of for the nine kits", () => {
    const generic = /clave/i
    PulseGridKits.All.forEach(kit => Object.values(kit.sounds).forEach(sample => {
        it(`${kit.name}: "${sample.name}" has a picture of its own by its label alone`, () => {
            const kind = PulseGridPictures.of(lane(sample.name, "Lane 7"))
            if (generic.test(sample.name)) {
                expect(kind).toBe("perc")
            } else {
                expect(kind).not.toBe("perc")
            }
        })
    }))

    it("each role of a kit gets its own drum", () => {
        PulseGridKits.All.forEach(({sounds}) => {
            expect(PulseGridPictures.of(lane(sounds.Kick.name))).toBe("kick")
            expect(PulseGridPictures.of(lane(sounds.Snare.name))).toBe("snare")
            expect(PulseGridPictures.of(lane(sounds.Clap.name))).toBe("clap")
            expect(PulseGridPictures.of(lane(sounds.Hat.name))).toBe("hat")
        })
    })
})

describe("PulseGridPictures", () => {
    it("lists 22 unique kinds", () => {
        expect(PulseGridPictures.Kinds).toHaveLength(22)
        expect(new Set(PulseGridPictures.Kinds).size).toBe(22)
    })

    it("every kind that a rule can give is listed", () => {
        const given = byLabel.map(([kind]) => kind)
        expect(new Set(given)).toEqual(new Set(PulseGridPictures.Kinds))
    })

    it("a picture's url is a file of public/pulsegrid/pictures, from the site root", () => {
        expect(PulseGridPictures.url("kick")).toBe("/pulsegrid/pictures/kick.webp")
        PulseGridPictures.Kinds.forEach(kind => expect(PulseGridPictures.url(kind)).toMatch(/^\/pulsegrid\/pictures\/[a-z]+\.webp$/))
    })
})
