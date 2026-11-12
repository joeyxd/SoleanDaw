# PulseGrid model: document, operations, text

One document, one set of operations, two hands. The screen and an agent read the same document and change it with
the same operations; the screen has no other way in. The types are in `PulseGridTypes.ts`.

## 1. What a PulseGrid is in the box graph

An `InstrumentCompositeBox` whose cells carry a `PulseGridLaneDeviceBox` in their MIDI-effect chain. The head is
the `PulseGridBox` that the lane of the first cell (lowest cell index) points at. The lanes are the cells whose
lane device points at that head, ordered by cell index. Cells without such a lane device are not lanes. A
composite with no lane device is not a PulseGrid.

A lane's name is the label of its lane device. Its sound is the instrument of its cell. Its colour is `hue`,
degrees 0..359 on the colour wheel.

A drum lane plays every note at the lane pitch. With a sampler whose root key is 60 (C3), lane pitch 60 plays the
sample as recorded, 62 two semitones up: the lane pitch is the drum's tuning. A melodic lane plays each note's
own pitch; its lane pitch is only where a new note lands when none is given.

## 2. Counting and units

Everything a person or an agent reads or writes counts from 1: steps 1..64, scenes 1..16, lanes 1..n. Variations
are the letters A to D. Only the stored bytes count from 0, and `PulseGridNotes` is the only place that converts.

| value | unit in the document, the ops and the text | stored as |
|---|---|---|
| probability, humanize (head and lane), groove, accent amount | percent 0..100 | float 0..1 |
| note chance | percent 0..100 | byte 0..100 |
| swing | 50..75 | the same |
| velocity | 1..127 | byte |
| note length | quarter steps 1..255, 4 is one step | byte (unsigned) |
| note offset | 1/100 of a step, -99..99 | byte (signed) |
| gain | dB | the same |
| pan | -100 (left) to 100 (right) | float -1..1 |
| pitch | MIDI 0..127, named as the DAW names it (`MidiKeys.toFullString`: 60 is C3) | byte |

Percents and pan read from a float are rounded to two decimals, so 0.35 reads 35 and not 34.99999.

The key is written by its name (`C`, `F#`), the scale by its id: `major`, `natural-minor`, `harmonic-minor`,
`melodic-minor`, `dorian`, `phrygian`, `lydian`, `mixolydian`, `locrian`, `pentatonic-major`, `pentatonic-minor`,
`blues`, `whole-tone`, `diminished`, `augmented` (`PulseGridScales.All`, in the order they are stored as 0 to
14). Reading also takes `minor` for `natural-minor`, the scale's number, and any case. Section 8 says what key
and scale do.

The slot of a pattern in the lane's `patterns` array is `(scene - 1) * 4 + variation index` (A is 0).
The effective length of a pattern is its own length, or the head's length when its own length is 0.

## 3. Notes in bytes (`PulseGridNotes`)

Eight bytes per note, at most 128 notes, sorted by step, then pitch: step - 1, offset (signed), length (unsigned),
pitch, velocity, chance, flags (bit 0 accent), repeats. Reading never fails on stored data: an incomplete last
record is dropped and values out of range are clamped. Writing sorts and refuses more than 128 notes.

## 4. Text

### A pattern line, grid form

    kick |x--- x--- x--- x---|
    hat/8 |x-x- 5-X-| 3:%50 7:l2

`<name>[/<own length>] |<cells>| <details>`

- One cell per step of the effective length. A space after every 4 cells and a `|` after every 16 are written
  for the eye; reading ignores spaces and inner `|`. The closing `|` may be missing.
- Cells: `-` no note; `x` a note at velocity 100; `X` the same with accent; `1` to `9` a note at velocity
  digit * 14 (14, 28, ... 126) without accent.
- Details say what a cell cannot. Tokens separated by spaces, each `<step>:<mods>`, mods in any order with no
  space: `v<1..127>` velocity, `%<0..100>` chance, `l<1..255>` length, `o<-99..99>` offset, `r<0..8>` repeats,
  `!` accent, `p<pitch>` pitch (a name such as `C3` or `F#2`, flats `Bb2` are read, or a number).
- A note with no pitch detail is at the lane pitch. A detail for a step without a note is an error.
- The grid form holds at most one note per step.

### A pattern line, list form

    marimba: 1:C3 5:E3l8 9:G3 9:B3v90!
    bass/32: 1:C1l16 17:G0l16

`<name>[/<own length>]: <notes>`, each note `<step>:<pitch><mods>` with the same mods (no `p`). Any number of
notes on a step. An empty pattern is the name and the colon. The colon after a name is followed by a space or
the end of the line; the colon inside a note is followed directly by its pitch. The same note (step and pitch)
twice is an error.

### Which form is written

A drum lane with at most one note on every step is written as a grid, without pitch details: a drum lane plays
its lane pitch whatever is stored. Everything else is written as a list. Reading takes either form on any lane.
Written values: the cell says velocity and accent when it can (`x`, `X`, a digit); every other value that is not
its default (velocity 100, chance 100, length 4, offset 0, repeats 0, no accent) is a detail, in the order
`v % l o r !`. Writing then reading gives back the same notes; on a drum lane the pitch comes back as the lane pitch.

### Length when reading

- No `/n`: the number of cells must be the pattern's effective length; the own length stays as it is. In list
  form every step must be within the effective length.
- With `/n` (1..64): the pattern's own length becomes n; a grid must have n cells.
- A wrong count is an error that names both numbers, never a silent new length.
- `/n` is written whenever the pattern has an own length, also when it equals the head's.

### Names

Written bare when they hold only letters, digits, space and `_ . # + -` and do not start or end with a space;
otherwise in double quotes with `\"` and `\\` escapes. In `setPatternText` the name is optional and ignored.

### The whole PulseGrid (`toText`)

    PulseGrid "Night drive"
    length 16  swing 54  groove 20  probability 100  humanize 0  accent 50  key C  scale natural-minor
    playing scene 1 A
    scenes 1 "Intro"  2 "Drop"
    lanes
      1 kick     drum     C3  Nano "Kick 808"  gain 0  pan 0
      2 hat      drum     D3  Nano "CH 808"    gain -3  pan 20  mute  chance 80
      3 marimba  melodic  C3  Tubular "Marimba"  gain 0  pan 0  fx Delay, Reverb
    scene 1 A
      kick |x--- x--- x--- x---|
      hat |x-x- x-x- x-x- x-x-|
      marimba: 1:C3 5:E3l8
    scene 1 B
      kick |x--- x--- x-x- x---|

- Line 1 the name; line 2 the settings, always all eight, in this order; line 3 what plays; line 4 the named or
  used scenes (left out when there are none).
- `lanes`: one line per lane: position, name, kind, pitch, instrument, its label in quotes, the sample name in
  quotes when there is one and it differs from the label, gain, pan, then only what is not the default: `mute`,
  `solo`, `chance <n>` (lane probability), `humanize <n>`, `no-accent`, `armed`, `off` (lane disabled),
  `fx <names>`. A lane without an instrument says `none` for the instrument.
- Then one block per scene and variation that holds anything, by scene then variation; inside, one pattern line
  per lane that holds notes or an own length there, in lane order. The slot that plays is written first even
  when it is empty (then just its heading).
- Indentation is two spaces; column padding is free.

`parseText` gives back ops: the name and settings lines as `setSetting`, `playing` as `setPlaying`, `scenes` as
`nameScene`, every pattern line as `setPatternText` with its block's scene and variation. The `lanes` block is
read-only and skipped. Unknown lines are errors with their line number.

## 5. Operations

`PulseGridOps.apply` runs inside one transaction, op by op, in order. Each op checks everything before it writes,
so an op that fails writes nothing; the ops after it are not run and are not in the answer. The caller decides
what one undo step is: the screen sends one op per gesture, an agent's batch is one step.

A slot left out means what plays now (the head's scene and variation). A lane is a position (1 is the top lane),
a name (case does not matter; an error when two lanes share it) or an id.

A length never deletes notes. Notes beyond a pattern's effective length stay stored, do not play, are in the
document, and are not written in text; they come back when the length grows again, as on a hardware sequencer.
Every op works on steps 1 to the effective length and leaves the notes beyond it alone. Only `clear` and
`copyVariation` reach beyond. The limit of 128 notes counts all stored notes of the pattern.

| op | does |
|---|---|
| `setSetting` | one head setting, or `name` |
| `setPlaying` | the scene and or variation that plays |
| `nameScene` | names a scene and marks it used |
| `setLane` | the lane's own fields; changing `pitch` on a drum lane rewrites nothing, the lane plays the new pitch |
| `setLaneMix` | gain (-72..0 dB, the range of the cell's knob), pan, mute, solo of the lane's cell |
| `setStep` | `on` (default true): on a step with notes, sets the given values on every note there; on an empty step, adds one note at the lane pitch with the given values over the defaults. `on: false` removes every note on the step |
| `setNote` | adds the note at (step, pitch), or sets the given values on the one already there. On a drum lane the pitch is the lane pitch and the step holds one note |
| `removeNote` | the note at (step, pitch), or every note on the step without a pitch |
| `setPattern` | replaces the notes (values left out are the defaults, pitch the lane pitch); `length`, when given, sets the own length first |
| `setPatternText` | replaces the notes from a pattern line; `/n` on the line sets the own length first |
| `setPatternLength` | own length 1..64, or 0 to follow the head |
| `clear` | removes every stored note, own length 0 |
| `rotate` | every note moves `steps` later (negative: earlier), wrapping at the effective length |
| `double` | own length becomes twice the effective length (an error above 32); the notes are repeated in the second half, replacing what was stored there |
| `halve` | own length becomes half the effective length rounded down (an error at 1) |
| `euclid` | replaces the notes with `hits` notes spread as evenly as possible over `steps` (default the effective length; another value becomes the own length first), first note on step 1, then moved `rotate` later; velocity default 100 |
| `transpose` | every note of the lane's pattern moves by `semitones`, or by `degrees` of the key and scale (section 8; a note outside the scale lands on the scale with its first degree). Exactly one of the two, a whole number, not 0. An error when any note would leave 0..127, and then nothing moves. Without a lane: every melodic lane. A drum lane named by itself is an error that says its pitch is its tuning (`setLane`) |
| `toScale` | every note of the lane's pattern that is outside the key and scale moves to the nearest pitch inside (the lower one when two are as near); when it lands on a note that is already there, the louder of the two stays. Without a lane: every melodic lane. A drum lane named by itself is an error |
| `copyVariation` | copies every stored note and the own length of every lane (or the given lanes) from one slot to another |
| `addLane`, `removeLane`, `moveLane`, `setLaneSound` | the lanes themselves (`PulseGridFactory`). The last lane cannot be removed |

Scene 1..16, step 1..effective length, and every value within its range in section 2: anything else is an error
that says what was given and what is allowed. Nothing is clamped silently.

### What an op answers

`{ok: true, op, lines}` or `{ok: false, op, error}`. `lines` are the new text of what changed: the pattern line of
each lane pattern it changed, in lane order (with the name; for a slot that does not play now the line starts
with `scene <n> <V> `); the settings line for `setSetting`; the `playing` line for `setPlaying`; the `scenes`
line for `nameScene`; the lane's line of the `lanes` block for `setLane`, `setLaneMix`, `addLane`, `moveLane`
and `setLaneSound`; nothing for `removeLane`.

## 6. What the screen does (`PulseGridActions`, `PulseGridView`, `PulseGridKits`)

The screen has no way of its own to change a PulseGrid. Every control calls one function of `PulseGridActions`
and sends the ops it returns, so whatever a person does on the screen an agent can do with the same ops. A test
lists every action against its ops; a new action does not compile until it is listed there.

| on the screen | action | ops |
|---|---|---|
| the name | `rename` | `setSetting name` |
| Length, Swing, Groove, Probability, Humanize | `setLength`, `setSwing`, `setGroove`, `setProbability`, `setHumanize` | `setSetting` |
| scene arrows and menu | `pickScene` | `setPlaying` |
| variation buttons | `pickVariation` | `setPlaying` |
| variation `+` | `newVariation` | `copyVariation`, `setPlaying` |
| a step, pressed or painted | `setStep` | `setStep` |
| a step's menu: accent, velocity, chance | `setStepValues` | `setStep` |
| M, S | `setMute`, `setSolo` | `setLaneMix` |
| a lane's name | `renameLane` | `setLane` |
| the lane handle | `moveLane` | `moveLane` |
| a lane's menu | `clearLane`, `shiftLane`, `removeLane`, `setLaneSound` | `clear`, `rotate`, `removeLane`, `setLaneSound` |
| Add lane | `addDrumLane` | `addLane` |
| Kit menu | `loadKit`, `loadBeat` | `setLaneSound`; `setSetting`, `setPatternLength`, `setPatternText`, `clear` |
| Key and Scale menus | `setKey`, `setScale` | `setSetting` |
| a key of the keyboard | `setLanePitch` | `setLane` |
| the roll, Paint: a press on an empty place, a drag to the right | `paintNote` | `setNote` |
| the roll, Paint or Select: the right end of a note, dragged | `resizeNote` | `setNote` |
| the roll, Paint: a click on a note; Erase: a press or a drag over notes | `eraseNote` | `removeNote` |
| the roll, Select: picked notes dragged (with Alt: copied) | `moveNotes` | `setPattern` |
| the roll, Select: Delete | `removeNotes` | `removeNote` |
| the velocity, chance and accent rows | `setStepValues` | `setStep` |
| a melodic lane's menu: Octave up, Octave down, Fit to scale | `transposeLane`, `laneToScale` | `transpose`, `toScale` |

Play, stop, the tempo, undo and redo are the DAW's own and are not ops.

`PulseGridView` is what the screen reads from the document so that no component works it out for itself: the
variations to offer (A always, the one that plays, and every one of the playing scene that holds anything), the
first empty variation, the steps of the pattern of a lane that plays now with its effective length, and the
step that plays at a song position (a step is 240 pulses).

One drag is one undo step: the screen sends every change of a drag unmarked and marks once on release.

For melody `PulseGridView` also gives the piano roll of a lane (`roll`), where picked notes land when they are
dragged (`moved`) and the pitches a lane sounds at a song position (`sounding`); section 8.

### Kits and beats

A kit is five samples: Kick, Snare, Clap, Hat, Perc. Loading one changes sounds only. Each drum goes to the
drum lane named after it (`Hi-Hat` and `HH` are the hat), else to the lane that plays it (a lane renamed `Boom`
that plays `TR-808 Bass Drum` is the kick). A drum without such a lane gets none, and a lane that is none of the
five (a tom) keeps its sound. Only when nothing is found do the first five drum lanes take the kit in order.

A beat is 16 cells per drum in the grid form of section 4. Loading one writes the pattern that plays now on
those same lanes, clears the drums it does not use, sets the swing it is meant for, and touches no other lane.
When the sequencer's length is not 16 the lanes get an own length of 16, so the beat stays whole.

A new drum lane lands under the last drum lane and is named after its sample without the machine
(`TR-808 Cowbell` is `Cowbell`), with a number when that name is taken.

## 7. Agents: requests, and where they run (`PulseGridRequests`)

An agent never touches boxes. It sends one request, Nitro carries it to wherever the project is, and the same
function answers it there: `PulseGridRequests.handle(boxGraph, editing, request)`.

| the project is | who runs the request | the change |
|---|---|---|
| open in Joi's tab (the tab holds the edit lease) | the tab, on its live project | lands while it plays, heard at the next pattern boundary; one undo step in his history; saved when he saves |
| not open | the DAW sidecar, headless, on the last saved revision | saved by Nitro as the next revision, with the agent as its author |

### The request

    {"track": "Drums", "ops": [{"op": "setPatternText", "lane": "hat", "variation": "B", "text": "|x-x- x-x- x-x- xxxx|"}]}

Exactly one of `read: true` (answer the whole PulseGrid as `toText`), `ops` (1 to 64 ops of section 5) or `text`
(lines of the `toText` grammar, read by `parseText`; pattern lines sit under a `scene <n> <V>` heading, a settings
line such as `swing 58` stands alone). `track` is the PulseGrid's track: its name (case does not matter) or its id;
it may be left out when the project has one PulseGrid. No other field.

A request that changes anything is one undo step and all or nothing: when any op is refused, nothing changes.

### The answer

    {"ok": true, "track": {"id": "…", "name": "Drums"}, "results": [{"ok": true, "op": "setPatternText", "lines": ["scene 1 B hat |x-x- x-x- x-x- xxxx|"]}]}
    {"ok": true, "track": {…}, "text": "PulseGrid \"Drums\"\nlength 16 …"}
    {"ok": false, "track": {…}, "op": 2, "error": "step 99 is not allowed; expected 1 to 16"}

`results` carry each op's new text lines (section 5, "What an op answers"), so the agent sees what landed without
reading everything again. `op` (from 1) names the refused op; it is absent when the request itself was refused.

### What Nitro adds around it (not part of the request)

- `note`: one line from the agent saying what it did ("busier hats in B"), 1 to 80 characters, required with
  `ops` and `text`. The tab shows `<agent>: <note>` as the window's toast and flashes the lanes that changed.
- Sounds by name: in `addLane` and `setLaneSound` the agent may write `"sound": {"catalog": "sample:<uuid>"}`.
  Nitro looks the id up in its sound catalogue (the One Shots folders of the openDAW sample library) and puts the
  full sound input of section 5 in its place before the request leaves Nitro. The model never sees catalogue ids.

## 8. Melody: key, scale, the piano roll

### What key and scale do

A PulseGrid has one key (`root`) and one scale. They never move a note by themselves and the engine does not
read them. They decide three things: which rows a piano roll shows, what `transpose` by `degrees` moves by, and
where `toScale` puts a note. So changing the scale from major to minor changes the rows; the notes stay where
they are until someone says `toScale` (the lane's menu: Fit to scale).

### The roll (`PulseGridView.roll`)

The piano roll of a lane shows the pattern that plays now. Its rows, from the highest pitch down, are the
pitches of the key and scale from an octave under the lane pitch to an octave over it, and further wherever the
pattern has notes. A note outside the scale has a row of its own, marked as outside, so no note is ever hidden.
Its columns are the steps of the pattern's effective length. A note starts at its step and is as long as its
length says (4 is one step); the part beyond the pattern's end is not drawn.

### What the screen adds for melody

- Every lane opens with its arrow. An open melodic lane shows its roll in place of its step row; an open drum
  lane keeps its step row. Under both sit three rows with one place per step: velocity (a bar, dragged up and
  down), chance (a dot, dragged up and down), accent (a star, pressed). They change every note of the step
  (`setStep`) and are empty where a step has no note. A closed melodic lane stays one row of steps: a press puts
  a note at the lane pitch.
- Four tools, chosen for the whole window. They act in the rolls:
  Paint: a press on an empty place puts a note of one step there, and dragging right before the release makes it
  longer; the right end of a note, dragged, changes its length; a click on a note removes it.
  Erase: a press, or a drag over notes, removes them.
  Select: a press picks a note (Shift adds it to the pick or takes it out), a drag from an empty place picks
  what its box touches, a press on an empty place lets go. Picked notes are dragged to other steps and rows (with
  Alt they are copied), the right end of a picked note changes its length, Delete removes them.
  Listen: a press sounds every note on that step through that lane's instrument alone. In an empty place of a
  roll it sounds the row's pitch. It works while stopped, lasts one step, honours mute and solo, and changes
  nothing. A drum lane always sounds its lane pitch. The lane's MIDI effects do not hear the preview.
  A step row keeps its own gesture under every tool (a press turns the step on or off, a drag paints), except
  under Listen, where a press sounds the notes on the step and changes nothing.
- Lengths set by a drag are whole steps. Finer lengths, offsets and repeats are written as text or ops.
- The keyboard shows the octave of the selected lane's pitch with one under and one over it. Keys of the key
  and scale are lit, the root stands out, the lane pitch is ringed, and while the song plays the keys the
  selected lane sounds light up (`PulseGridView.sounding`). A press on a key sounds it on the selected lane; on a
  melodic lane it also becomes the lane pitch (`setLane`), the note a press on its closed row puts in. A drum
  lane's pitch is its tuning: the keyboard does not change it and a key sounds the lane pitch. A newly painted
  note sounds once too. The sound itself never changes the project.
- Which lanes are open, the tool and the picked notes belong to the screen, not to the document: an agent
  neither sees nor needs them.
