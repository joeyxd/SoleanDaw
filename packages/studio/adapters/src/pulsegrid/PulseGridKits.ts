import {int} from "@opendaw/lib-std"
import {PulseGridDoc, PulseGridLaneDoc, PulseGridOp, PulseGridSoundInput} from "./PulseGridTypes"

// Starter kits and starter beats: plain data, turned into ordinary ops, so the screen and an agent load them
// the same way. The samples are openDAW's cloud library (assets.opendaw.studio/samples/index.json, folder
// openDAW/One Shots), named by uuid, name and duration, so nothing is fetched to build a lane.

export type PulseGridRole = "Kick" | "Snare" | "Clap" | "Hat" | "Perc"
export type PulseGridSample = {uuid: string, name: string, duration: number}
export type PulseGridKit = {id: string, name: string, sounds: Readonly<Record<PulseGridRole, PulseGridSample>>}
// A beat is 16 steps per role, written as the cells of a grid line (SPEC.md, section 4).
export type PulseGridBeat = {
    id: string, name: string, swing: number, lines: Readonly<Partial<Record<PulseGridRole, string>>>
}

type Entry = [uuid: string, name: string, duration: number]
const kit = (id: string, name: string, ...entries: [Entry, Entry, Entry, Entry, Entry]): PulseGridKit => {
    const [kick, snare, clap, hat, perc] = entries.map(([uuid, name, duration]) => ({uuid, name, duration}))
    return {id, name, sounds: {Kick: kick, Snare: snare, Clap: clap, Hat: hat, Perc: perc}}
}

export namespace PulseGridKits {
    // The five drums a kit fills, the colour a new lane of that drum gets, and the lane names that mean it.
    export const Roles: ReadonlyArray<{role: PulseGridRole, hue: int, match: RegExp}> = [
        {role: "Kick", hue: 181, match: /kick|bass ?drum|\bbd\b/i},
        {role: "Snare", hue: 300, match: /snare|\bsd\b/i},
        {role: "Clap", hue: 36, match: /clap/i},
        {role: "Hat", hue: 60, match: /hat|\bhh\b/i},
        {role: "Perc", hue: 77, match: /perc|clave|rim|cow|shaker|cabasa|conga|tamb/i}
    ]

    export const All: ReadonlyArray<PulseGridKit> = [
        kit("tr-808", "TR-808",
            ["b50f6f4f-d933-400c-a63a-83b3c2f6c8b2", "TR-808 Bass Drum", 3],
            ["0378e25e-6d3f-4db3-a54f-4ae795ca0ff7", "TR-808 Snare Drum", 0.5],
            ["8537b54c-f18a-459f-9f29-a847232a889e", "TR-808 Hand Clap", 2],
            ["bd20b35e-bdde-4dff-860a-a5524d7adbfc", "TR-808 Closed Hi-Hat", 0.25],
            ["210afc07-3e7e-4548-8608-012b82790a31", "TR-808 Claves", 0.25]),
        kit("tr-909", "TR-909",
            ["8bb2c6e8-9a6d-4d32-b7ec-1263594ef367", "909 Bassdrum", 0.5091],
            ["0017fa18-a5eb-4d9d-b6f2-e2ddd30a3010", "909 Snare", 0.2347],
            ["32a6f36f-06eb-4b84-bb57-5f51103eb9e6", "909 Clap", 0.507],
            ["e0ac4b39-23fb-4a56-841d-c9e0ff440cab", "909 Closed Hat", 0.154],
            ["cfee850b-7658-4d08-9e3b-79d196188504", "909 Rimshot", 0.1498]),
        kit("tr-707", "TR-707",
            ["45e1d976-77ac-468a-9be5-66c3b63d0246", "TR-707 Kick 1", 0.0985],
            ["a65a0d6b-da0f-4f2b-b9bc-c02a7ba2662c", "TR-707 Snare 1", 0.1378],
            ["0d345936-3a4b-4542-b710-278bde1e101e", "TR-707 Clap", 0.1601],
            ["922a61a5-cec7-47f8-a49f-305cb67cfe42", "TR-707 Hihat Closed High", 0.1004],
            ["83cfb3ec-f361-42dc-af1d-766f2bb0100d", "TR-707 Cowbell", 0.1495]),
        kit("tr-626", "TR-626",
            ["7d553952-962e-464a-9c92-4749adc5319f", "TR-626 Kick 1", 0.1191],
            ["bf4a7a4b-70b0-4d8d-97ed-c6c2af0c529d", "TR-626 Snare 1", 0.3277],
            ["693d6d32-2532-44fe-b283-b219a113977d", "TR-626 Clap", 0.1823],
            ["f4e8e684-4827-47a3-9d00-cee464100e22", "TR-626 Hihat Closed 1", 0.186],
            ["481e41cd-70db-4a49-961e-5b6f08a76962", "TR-626 Clave", 0.1589]),
        kit("linndrum", "LinnDrum",
            ["1117edb4-dfaa-47d7-87b5-35cf8805e709", "LinnDrum Kick", 0.2027],
            ["810beb5b-7aee-4062-8382-24b0712f9a90", "LinnDrum Snare High", 0.1399],
            ["4bf693f0-8337-4e78-90d5-469bb7a1b115", "LinnDrum Clap", 0.1911],
            ["cd51bc6a-7032-4aed-9cbe-9584d6b9b543", "LinnDrum Hihat Closed High", 0.1469],
            ["6d6d6479-9671-4615-8688-cc602542a534", "LinnDrum Cabasa", 0.0789]),
        kit("dmx", "DMX",
            ["a8e4972f-cc3b-40c7-845e-4489158aa236", "DMX Kick Low", 0.2006],
            ["c3e49a0a-8c7d-457c-b0c9-803e0cf4c717", "DMX Snare Low", 0.1707],
            ["4f68b145-76e0-490d-8c22-dbfef23f1629", "DMX Clap", 0.136],
            ["037a9342-a220-4218-bbe1-5ea599ea4f9b", "DMX Hihat Closed", 0.1683],
            ["fae667fa-c015-4f3d-9111-1e481f5fb2fe", "DMX Rim", 0.1075]),
        kit("drumtraks", "DrumTraks",
            ["c78b82e0-945d-4a85-b300-7dfcec73e36b", "DrumTraks Kick", 0.1053],
            ["b3843b8d-55f2-4c85-ae2b-904c980f96b3", "DrumTraks Snare", 0.1944],
            ["3db7ab36-cce9-48a2-8c61-8bebc165c08e", "DrumTraks Claps", 0.2957],
            ["bf9c5606-cab8-4561-b316-6b76447f9ce3", "DrumTraks Hihat Closed", 0.1415],
            ["529e1e60-1d68-4cd5-bf3e-5b80ada94fa1", "DrumTraks Cowbell", 0.0986]),
        kit("drumulator", "Drumulator",
            ["a4fc3930-cd57-49d5-9c4b-cf6b85c452cc", "Drumulator Kick 1", 0.0918],
            ["be94437c-a42a-4347-81b7-7b6b69c9b352", "Drumulator Snare 1", 0.1699],
            ["252af654-1ac1-4b57-9564-d1e50c437e6f", "Drumulator Claps", 0.2485],
            ["4c2678b9-b606-45ed-aaee-114c88976244", "Drumulator Hihat Closed", 0.181],
            ["07563557-bd42-44fc-a7ad-0bb5d149574a", "Drumulator Clave", 0.1002]),
        kit("r-8", "R-8",
            ["58d6ab5e-c136-40a5-9e69-5c691a326c79", "R-8 Kick 1", 0.2538],
            ["eb22a4cf-6b07-4829-8f8a-c8196d6315f0", "R-8 Snare 1", 0.3011],
            ["12d41b9e-ce80-4b24-a80d-519cbf095acd", "R-8 Clap", 0.171],
            ["d5d2d6d8-cbfa-4f5a-b077-5b60200c6229", "R-8 Hihat Closed 1", 0.2566],
            ["b04e12d2-6e9a-4875-8ea4-b1373c2754ee", "R-8 Shaker", 0.178])
    ]

    // Cells: `-` rest, `x` a hit at velocity 100, `X` an accent, `1`..`9` a hit at velocity digit * 14.
    export const Beats: ReadonlyArray<PulseGridBeat> = [
        {id: "four-on-the-floor", name: "Four on the floor", swing: 50, lines: {
            Kick: "x---x---x---x---", Clap: "----x-------x---", Hat: "--x---x---x---x-", Perc: "---5--5----5--5-"}},
        {id: "boom-bap", name: "Boom bap", swing: 58, lines: {
            Kick: "x-----x---x-----", Snare: "----X-------X---", Hat: "x-5-x-5-x-5-x-5-", Perc: "-------4-------4"}},
        {id: "trap", name: "Trap", swing: 50, lines: {
            Kick: "x------x--x-----", Snare: "--------X-------", Clap: "--------x-------",
            Hat: "x-x-x-x-x-x5x5x-", Perc: "---5----------5-"}},
        {id: "electro", name: "Electro", swing: 50, lines: {
            Kick: "x-----x---x--x--", Snare: "----x-------x---", Hat: "x-55x-55x-55x-5x", Perc: "--x-------x-----"}},
        {id: "dembow", name: "Dembow", swing: 50, lines: {
            Kick: "x---x---x---x---", Snare: "---x--x----x--x-", Hat: "5-5-5-5-5-5-5-5-"}},
        {id: "breakbeat", name: "Breakbeat", swing: 54, lines: {
            Kick: "x-x-------xx----", Snare: "----X--4-4--X--4", Hat: "x-x-x-x-x-x-x-x-"}}
    ]

    export const sound = (sample: PulseGridSample): PulseGridSoundInput => ({instrument: "Nano", sample})

    // Which drum lane is which drum. By name first: the lane called Kick is the kick wherever it sits ("Hi-Hat"
    // and "HH" are the hat). Then by what the lane plays: a lane renamed "Boom" that plays "TR-808 Bass Drum"
    // is still the kick. A drum that no lane is named after or plays gets no lane, and a lane that is none of
    // the five drums (a tom) is left alone. Only when nothing is found do the first five drum lanes count in order.
    export const lanesByRole = (doc: PulseGridDoc): Map<PulseGridRole, PulseGridLaneDoc> => {
        const drums = doc.lanes.filter(lane => lane.kind === "drum")
        const found = new Map<PulseGridRole, PulseGridLaneDoc>()
        const free = (lane: PulseGridLaneDoc): boolean => !Array.from(found.values()).includes(lane)
        const plays = (lane: PulseGridLaneDoc): string => `${lane.sound?.label ?? ""} ${lane.sound?.sample?.name ?? ""}`
        for (const text of [(lane: PulseGridLaneDoc) => lane.name, plays]) {
            for (const {role, match} of Roles) {
                if (found.has(role)) {continue}
                const lane = drums.find(lane => free(lane) && match.test(text(lane)))
                if (lane !== undefined) {found.set(role, lane)}
            }
        }
        if (found.size === 0) {
            return new Map(Roles.slice(0, drums.length).map(({role}, index) => [role, drums[index]]))
        }
        return new Map(Roles.flatMap(({role}) => {
            const lane = found.get(role)
            return lane === undefined ? [] : [[role, lane] as const]
        }))
    }

    // Loading a kit changes sounds only: names, patterns, mix and every other lane stay.
    export const kitOps = (doc: PulseGridDoc, kit: PulseGridKit): Array<PulseGridOp> =>
        Array.from(lanesByRole(doc)).map(([role, lane]) =>
            ({op: "setLaneSound", lane: lane.id, sound: sound(kit.sounds[role])}))

    // Loading a beat writes the pattern that plays now, on the drum lanes only, and sets the swing it is meant
    // for. A drum the beat does not use is cleared. The beat keeps its 16 steps under any pattern length.
    export const beatOps = (doc: PulseGridDoc, beat: PulseGridBeat): Array<PulseGridOp> => {
        const length = doc.settings.length === 16 ? 0 : 16
        const ops: Array<PulseGridOp> = [{op: "setSetting", key: "swing", value: beat.swing}]
        for (const [role, lane] of lanesByRole(doc)) {
            const cells = beat.lines[role]
            if (cells === undefined) {
                ops.push({op: "clear", lane: lane.id})
            } else {
                ops.push({op: "setPatternLength", lane: lane.id, length},
                    {op: "setPatternText", lane: lane.id, text: `|${cells}|`})
            }
        }
        return ops
    }
}
