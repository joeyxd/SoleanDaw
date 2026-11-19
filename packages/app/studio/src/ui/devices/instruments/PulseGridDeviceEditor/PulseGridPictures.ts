// Which picture a lane shows. Pure: the sound's label decides first, then the lane's name, then the lane's kind.
// The words are compared whole and without case, so "TR-808 Bass Drum" is the words tr, bass, drum.

export type PulseGridPictureKind =
    | "kick" | "snare" | "clap" | "hat" | "openhat" | "tom" | "cymbal" | "cowbell" | "shaker" | "perc"
    | "bass" | "keys" | "lead" | "brass" | "guitar" | "marimba" | "vibraphone" | "xylophone" | "bells"
    | "steeldrum" | "timpani" | "kalimba"

type Words = ReadonlySet<string>
type Rule = {kind: PulseGridPictureKind, test: (words: Words) => boolean}

const any = (...names: Array<string>) => (words: Words): boolean => names.some(name => words.has(name))
const all = (...names: Array<string>) => (words: Words): boolean => names.every(name => words.has(name))

// Order matters: the first rule that fits wins, so the narrow one stands above the wide one (a bass DRUM above
// bass, open hat above hat, cowbell above bells, steel drum above everything with "drum").
const Rules: ReadonlyArray<Rule> = [
    {kind: "steeldrum", test: (words) => all("steel", "drum")(words) || any("steeldrum", "steelpan")(words)},
    {kind: "openhat", test: (words) => (words.has("open") && any("hat", "hats", "hihat", "hh")(words)) || words.has("oh")},
    {kind: "hat", test: any("hat", "hats", "hihat", "hihats", "hh", "ch")},
    {kind: "kick", test: (words) => any("kick", "kicks", "bd", "bassdrum")(words) || all("bass", "drum")(words)},
    {kind: "snare", test: any("snare", "snares", "sd", "rim", "rimshot")},
    {kind: "clap", test: any("clap", "claps", "cp")},
    {kind: "tom", test: any("tom", "toms")},
    {kind: "cymbal", test: any("crash", "ride", "cymbal", "cymbals")},
    {kind: "cowbell", test: (words) => any("cowbell", "cowbells")(words) || all("cow", "bell")(words)},
    {kind: "shaker", test: any("maracas", "shaker", "shakers", "tambourine", "cabasa", "tamb")},
    {kind: "perc", test: any("conga", "bongo", "clave", "claves", "percussion", "perc")},
    {kind: "marimba", test: any("marimba")},
    {kind: "vibraphone", test: any("vibraphone", "vibes", "vibraharp")},
    {kind: "xylophone", test: any("xylophone", "xylo")},
    {kind: "bells", test: any("glockenspiel", "celesta", "bell", "bells", "chime", "chimes", "tubular")},
    {kind: "timpani", test: any("timpani", "timp")},
    {kind: "kalimba", test: any("kalimba")},
    {kind: "bass", test: any("bass", "fretless")},
    {kind: "keys", test: any("piano", "rhodes", "organ", "clavinet", "harpsichord", "keys", "wurlitzer")},
    {kind: "brass", test: any("brass", "trumpet", "horn", "horns", "sax", "trombone")},
    {kind: "guitar", test: any("guitar", "gtr")},
    {kind: "lead", test: any("lead", "pad", "strings", "synth")}
]

export namespace PulseGridPictures {
    export const Kinds: ReadonlyArray<PulseGridPictureKind> = [
        "kick", "snare", "clap", "hat", "openhat", "tom", "cymbal", "cowbell", "shaker", "perc",
        "bass", "keys", "lead", "brass", "guitar", "marimba", "vibraphone", "xylophone", "bells",
        "steeldrum", "timpani", "kalimba"
    ]

    // "TR-808 Bass Drum" -> tr bass drum; "HiHat" -> hi hat; "E.Piano" -> e piano
    const wordsOf = (text: string): Words => {
        const spaced = text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z]+/g, " ").trim()
        return new Set(spaced === "" ? [] : spaced.split(" "))
    }

    const decide = (text: string | undefined): PulseGridPictureKind | undefined =>
        text === undefined ? undefined : Rules.find(rule => rule.test(wordsOf(text)))?.kind

    export const of = (lane: {name: string, kind: "drum" | "melodic", sound: {label: string} | null}): PulseGridPictureKind =>
        decide(lane.sound?.label) ?? decide(lane.name) ?? (lane.kind === "drum" ? "perc" : "lead")

    // Files of APP/public, served from the site root like /images and /tubular.
    export const url = (kind: PulseGridPictureKind): string => `/pulsegrid/pictures/${kind}.webp`
}
