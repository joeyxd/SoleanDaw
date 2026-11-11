//! The PULSEGRID LANE MIDI-effect device: a stateful PULL SOURCE that PLAYS A STORED STEP PATTERN in time with
//! the transport. It is the first device in a PulseGrid composite cell (instrument <- lane <- nothing): the
//! instrument pulls it, and it needs no upstream notes to make sound. For `[from, to)` it works out which 16th
//! steps (240 pulses, PPQN 960) can put a note into the range and emits those notes. There is no TS twin: the
//! design is `daw/pulsegrid/PLAN.md` sections 3 and 4.
//!
//! The data lives in boxes, not here. The shared settings sit on the `PulseGridBox` (the target of the device's
//! `grid` pointer at `[10]`): length `[10]`, swing `[11]`, groove `[12]`, probability `[13]`, humanize `[14]`,
//! scene `[15]`, variation `[16]`, accent-amount `[19]`. The lane's own fields sit on the device box: kind `[11]`,
//! pitch `[12]`, probability `[13]`, humanize `[14]`, accent `[15]`, armed `[18]`, seed `[19]` (int), and the 64 pattern slots at
//! `[30, slot, 1]` (length override, int) and `[30, slot, 2]` (notes, bytes; 8 bytes a note). All of them are
//! plain field observations (see `device-zeitgeist`), delivered to `field_changed`; nothing here is automated.
//!
//! Determinism is the hard rule. A note's position, pitch and velocity are a pure function of the absolute step
//! and the note's index in its pattern, with every random number drawn from a `Mulberry32` seeded by
//! (lane seed, absolute step, note index) and never by call order. So a block pulled twice, or a bar cut into
//! blocks of any size, gives the same notes, and an offline render matches what was heard.
//!
//! A scene or variation edit waits for the next pattern boundary (a multiple of the head length). The slot a
//! pattern cycle plays is decided once, when the first block that reaches the cycle's start is processed. To make
//! that safe no note may land before its own cycle starts, so a humanized or offset note is held at the boundary.
//! While the transport is stopped the pending choice is simply taken, so it applies at once on the next start.
//!
//! Exports: `kind()` (midi effect), `state_size()`, `init(...)`, `field_changed(...)`, `map_parameter(...)`,
//! `process_events(...)`.

#![cfg_attr(target_family = "wasm", no_std)]

#[cfg(target_family = "wasm")]
use core::panic::PanicInfo;
use abi::{EventRecord, FieldValue, EVENT_NOTE_OFF, EVENT_NOTE_ON};
use math::random::Mulberry32;

#[cfg(target_family = "wasm")]
#[panic_handler]
fn panic(info: &PanicInfo) -> ! {
    abi::panic_to_host(info) // deposit the message in the engine's panic buffer, then trap (never a silent hang)
}

// WASM CONTRACT: mirrors `PPQN` (Quarter = 960): one 16th step is 240 pulses, a "quarter step" (the note length
// unit of the 8-byte record, 4 = one step) is 60 pulses, and the swing delay is measured in a 480-pulse 8th.
const STEP: f64 = 240.0;
const QUARTER_STEP: f64 = 60.0;
const EIGHTH: f64 = 480.0;

// WASM CONTRACT: field keys. Head fields are observed THROUGH the `grid` pointer (key 10 on the lane device box),
// so their paths are `[10, key]`. Lane fields are `[key]`. A pattern slot is `[30, slot, 1]` / `[30, slot, 2]`.
// These are a contract with the `PulseGridBox` / `PulseGridLaneDeviceBox` schemas: change only with a version bump.
const GRID_POINTER: u16 = 10;
const HEAD_KEYS: [u16; 8] = [10, 11, 12, 13, 14, 15, 16, 19]; // length swing groove probability humanize scene variation accent-amount
const LANE_KEYS: [u16; 7] = [11, 12, 13, 14, 15, 18, 19]; // kind pitch probability humanize accent armed seed
const PATTERNS_KEY: u16 = 30;
const PATTERN_LENGTH_KEY: u16 = 1;
const PATTERN_NOTES_KEY: u16 = 2;

// WASM CONTRACT: the 8-byte note record, byte by byte (PLAN section 3). Byte 7 (repeats) is stored but every note
// plays once for now.
const NOTE_BYTES: usize = 8;
const NOTE_STEP: usize = 0; // 0..63
const NOTE_OFFSET: usize = 1; // signed, 1/100 of a step
const NOTE_LENGTH: usize = 2; // quarter steps, 1..255
const NOTE_PITCH: usize = 3; // 0..127, ignored by a drum lane
const NOTE_VELOCITY: usize = 4; // 1..127
const NOTE_CHANCE: usize = 5; // 0..100
const NOTE_FLAGS: usize = 6; // bit 0 accent
const FLAG_ACCENT: u8 = 1;

const SLOTS: usize = 64; // scene (16) x variation (4); slot = scene * 4 + variation
const MAX_NOTES: usize = 128;
const MAX_STEPS: i32 = 64;
const MAX_RETAINED: usize = 256; // emitted notes awaiting their note-off
const MAX_LIVE: usize = 32; // live keys passed through an armed lane and still down
const PULL_SCRATCH: usize = 256;

// Index layout of the observed-field id table: head fields, lane fields, then a length and a notes id per slot.
const HEAD_AT: usize = 0;
const LANE_AT: usize = HEAD_AT + HEAD_KEYS.len();
const LENGTH_AT: usize = LANE_AT + LANE_KEYS.len();
const NOTES_AT: usize = LENGTH_AT + SLOTS;
const FIELD_COUNT: usize = NOTES_AT + SLOTS;

// The scan window. A step's note can land later than its step start (swing up to 120 pulses, humanize 60, a
// positive offset byte up to 305) or earlier (humanize 60, a negative offset up to 305). Looking back 500 and
// forward 400 pulses from the block therefore finds every note that falls into it.
const LOOK_BACK: f64 = 500.0;
const LOOK_AHEAD: f64 = 400.0;
const HUMANIZE_PULSES: f64 = 60.0;
const HUMANIZE_VELOCITY: f64 = 0.2;
const LANE_SEED: u32 = 0x5075_6C73; // "Puls", mixed with the lane's identity seed
const GENERATED_ID: u32 = 0x8000_0000; // generated note ids live above 2^31, away from upstream ids

#[derive(Clone, Copy)]
struct Pattern {
    length: i32, // 0 follows the head
    count: u32,
    notes: [u8; MAX_NOTES * NOTE_BYTES]
}

#[derive(Clone, Copy)]
struct Retained {
    id: u32,
    pitch: u32,
    complete: f64
}

/// The lane's per-instance state (engine-allocated, zeroed, seeded in `init`). The first block mirrors the
/// observed head fields, the second the lane's own fields, then the 64 pattern slots (about 66 KB). The runtime
/// block is the pattern-cycle bookkeeping (which slot the current and the previous cycle play) and the emitted
/// notes awaiting their note-off.
pub struct LaneState {
    length: i32,
    swing: f32,
    groove: f32,
    probability: f32,
    humanize: f32,
    scene: i32,
    variation: i32,
    accent_amount: f32,
    kind: i32,
    pitch: i32,
    lane_probability: f32,
    lane_humanize: f32,
    accent: bool,
    armed: bool,
    seed: i32,
    patterns: [Pattern; SLOTS],
    cycle: i64, // pattern cycle `active_slot` belongs to; -1 = none decided yet
    active_slot: usize,
    previous_slot: usize, // what the cycle before `cycle` played, for notes that spill over the boundary
    retained: [Retained; MAX_RETAINED],
    retained_count: u32,
    live: [Retained; MAX_LIVE], // passed-through live note-ons still waiting for their upstream note-off
    live_count: u32,
    next_id: u32,
    ids: [u32; FIELD_COUNT]
}

/// Put the box defaults in a (zeroed) state: length 16, swing 50, groove 0, probability 1, humanize 0, scene A1,
/// accent-amount 0.5, a drum lane on pitch 60 with accents on and not armed. Every pattern is empty.
pub fn defaults(state: &mut LaneState) {
    state.length = 16;
    state.swing = 50.0;
    state.groove = 0.0;
    state.probability = 1.0;
    state.humanize = 0.0;
    state.scene = 0;
    state.variation = 0;
    state.accent_amount = 0.5;
    state.kind = 0;
    state.pitch = 60;
    state.lane_probability = 1.0;
    state.lane_humanize = 0.0;
    state.accent = true;
    state.armed = false;
    state.seed = 0;
    state.cycle = -1;
}

// The setters are the only way the observed fields reach the state (the tests and `apply_field` both use them).
impl LaneState {
    pub fn set_length(&mut self, steps: i32) {
        let steps = steps.clamp(1, MAX_STEPS);
        if steps != self.length {
            self.length = steps;
            self.cycle = -1; // the cycle grid moved: decide the next cycle afresh
        }
    }
    pub fn set_swing(&mut self, percent: f32) { self.swing = percent.clamp(50.0, 75.0); }
    pub fn set_groove(&mut self, groove: f32) { self.groove = groove.clamp(0.0, 1.0); }
    pub fn set_probability(&mut self, probability: f32) { self.probability = probability.clamp(0.0, 1.0); }
    pub fn set_humanize(&mut self, humanize: f32) { self.humanize = humanize.clamp(0.0, 1.0); }
    pub fn set_scene(&mut self, scene: i32) { self.scene = scene.clamp(0, 15); }
    pub fn set_variation(&mut self, variation: i32) { self.variation = variation.clamp(0, 3); }
    pub fn set_accent_amount(&mut self, amount: f32) { self.accent_amount = amount.clamp(0.0, 1.0); }
    pub fn set_kind(&mut self, kind: i32) { self.kind = kind; }
    pub fn set_pitch(&mut self, pitch: i32) { self.pitch = pitch.clamp(0, 127); }
    pub fn set_lane_probability(&mut self, probability: f32) { self.lane_probability = probability.clamp(0.0, 1.0); }
    pub fn set_lane_humanize(&mut self, humanize: f32) { self.lane_humanize = humanize.clamp(0.0, 1.0); }
    pub fn set_accent(&mut self, on: bool) { self.accent = on; }
    pub fn set_armed(&mut self, armed: bool) { self.armed = armed; }
    pub fn set_seed(&mut self, seed: i32) { self.seed = seed; }

    /// A pattern's own length in steps; 0 (or less) follows the head.
    pub fn set_pattern_length(&mut self, slot: usize, steps: i32) {
        if slot < SLOTS {
            self.patterns[slot].length = steps.clamp(0, MAX_STEPS);
        }
    }

    /// A pattern's notes: whole 8-byte records, at most 128 (a longer or ragged tail is ignored).
    pub fn set_pattern_notes(&mut self, slot: usize, bytes: &[u8]) {
        if slot < SLOTS {
            let count = (bytes.len() / NOTE_BYTES).min(MAX_NOTES);
            self.patterns[slot].notes[..count * NOTE_BYTES].copy_from_slice(&bytes[..count * NOTE_BYTES]);
            self.patterns[slot].count = count as u32;
        }
    }
}

fn as_int(value: FieldValue) -> i32 {
    let FieldValue::Int(number) = value else { panic!("field must be an int") };
    number
}

fn as_float(value: FieldValue) -> f32 {
    let FieldValue::Float(number) = value else { panic!("field must be a float") };
    number
}

fn as_bool(value: FieldValue) -> bool {
    let FieldValue::Bool(flag) = value else { panic!("field must be a bool") };
    flag
}

/// Seed a (zeroed) state with the box defaults and declare every field observation. Kept separate from the
/// `init` export so tests can seed a state directly (the export takes a `u32` pointer, which truncates on a
/// 64-bit native test build).
pub fn seed(state: &mut LaneState) {
    defaults(state);
    for (index, key) in HEAD_KEYS.iter().enumerate() {
        state.ids[HEAD_AT + index] = abi::observe_field(&[GRID_POINTER, *key]);
    }
    for (index, key) in LANE_KEYS.iter().enumerate() {
        state.ids[LANE_AT + index] = abi::observe_field(&[*key]);
    }
    for slot in 0..SLOTS {
        state.ids[LENGTH_AT + slot] = abi::observe_field(&[PATTERNS_KEY, slot as u16, PATTERN_LENGTH_KEY]);
        state.ids[NOTES_AT + slot] = abi::observe_field(&[PATTERNS_KEY, slot as u16, PATTERN_NOTES_KEY]);
    }
}

/// Apply a delivered field by the id `observe_field` returned. Wrong variants panic, like the other devices.
pub fn apply_field(state: &mut LaneState, id: u32, value: FieldValue) {
    let Some(index) = state.ids.iter().position(|known| *known == id) else { return };
    match index {
        0 => state.set_length(as_int(value)),
        1 => state.set_swing(as_float(value)),
        2 => state.set_groove(as_float(value)),
        3 => state.set_probability(as_float(value)),
        4 => state.set_humanize(as_float(value)),
        5 => state.set_scene(as_int(value)),
        6 => state.set_variation(as_int(value)),
        7 => state.set_accent_amount(as_float(value)),
        8 => state.set_kind(as_int(value)),
        9 => state.set_pitch(as_int(value)),
        10 => state.set_lane_probability(as_float(value)),
        11 => state.set_lane_humanize(as_float(value)),
        12 => state.set_accent(as_bool(value)),
        13 => state.set_armed(as_bool(value)),
        14 => state.set_seed(as_int(value)),
        _ if index < NOTES_AT => state.set_pattern_length(index - LENGTH_AT, as_int(value)),
        _ => {
            let FieldValue::Bytes(bytes) = value else { panic!("pattern notes must be bytes") };
            state.set_pattern_notes(index - NOTES_AT, bytes);
        }
    }
}

/// A well-mixed seed for one note: (lane seed, absolute step, note index). The Mulberry32 stream is only started
/// after this mixing, so neighbouring steps and indices do not give correlated streams.
fn note_seed(lane_seed: u32, step: i64, index: u32) -> u32 {
    let mut mixed = lane_seed ^ (step as u32).wrapping_mul(0x9E37_79B1);
    mixed = (mixed ^ (mixed >> 16)).wrapping_mul(0x85EB_CA6B);
    mixed ^= index.wrapping_add(1).wrapping_mul(0xC2B2_AE35);
    mixed = (mixed ^ (mixed >> 13)).wrapping_mul(0x27D4_EB2F);
    mixed ^ (mixed >> 16)
}

/// Write one event; `false` when `out` is full. Callers keep their books by the answer, so a note-on that did not
/// fit is never held and a note-off that did not fit is sent in a later block instead of being lost.
fn emit(out: &mut [EventRecord], count: &mut usize, record: EventRecord) -> bool {
    let fits = *count < out.len();
    if fits {
        out[*count] = record;
        *count += 1;
    }
    fits
}

fn note_off(id: u32, pitch: u32, position: f64) -> EventRecord {
    EventRecord {position, offset: 0, kind: EVENT_NOTE_OFF, id, pitch, velocity: 0.0, cent: 0.0, duration: 0.0}
}

/// Release every note of `held` at `from` (stop, a transport jump, or a disarm for the live keys). A note whose
/// off did not fit stays held for the next block.
fn release_held(held: &mut [Retained], held_count: &mut u32, from: f64, out: &mut [EventRecord], count: &mut usize) {
    let mut kept = 0;
    for index in 0..*held_count as usize {
        let note = held[index];
        if !emit(out, count, note_off(note.id, note.pitch, from)) {
            held[kept] = note;
            kept += 1;
        }
    }
    *held_count = kept as u32;
}

/// Release every retained note whose scheduled end is `< to`, at that end (or at `from`, for an off that did not
/// fit in an earlier block).
fn release_completed(state: &mut LaneState, from: f64, to: f64, out: &mut [EventRecord], count: &mut usize) {
    let mut index = 0;
    while index < state.retained_count as usize {
        let retained = state.retained[index];
        if retained.complete < to && emit(out, count, note_off(retained.id, retained.pitch, retained.complete.max(from))) {
            state.retained[index] = state.retained[state.retained_count as usize - 1];
            state.retained_count -= 1;
        } else {
            index += 1;
        }
    }
}

/// The pattern slot a pattern cycle plays. The first time a cycle is asked for (its start is inside the block
/// being processed) it takes the scene / variation as they are NOW; asking again, or for the cycle before,
/// gives the same answer. So an edit lands at a cycle start and never in the middle of one.
fn slot_for_cycle(state: &mut LaneState, cycle: i64) -> usize {
    if cycle > state.cycle {
        state.previous_slot = state.active_slot;
        state.active_slot = (state.scene * 4 + state.variation) as usize;
        state.cycle = cycle;
        state.active_slot
    } else if cycle == state.cycle {
        state.active_slot
    } else {
        state.previous_slot
    }
}

/// Play the notes of absolute step `g` that land in `[from, to)`.
fn play_step(state: &mut LaneState, g: i64, from: f64, to: f64, out: &mut [EventRecord], count: &mut usize) {
    let cycle_steps = state.length as i64;
    let cycle = g / cycle_steps;
    let cycle_start = (cycle * cycle_steps) as f64 * STEP;
    if cycle_start >= to {
        return; // not reached yet; nothing of this cycle can land before its start
    }
    let slot = slot_for_cycle(state, cycle);
    let pattern_steps = if state.patterns[slot].length > 0 { state.patterns[slot].length as i64 } else { cycle_steps };
    let pattern_step = g % pattern_steps;
    let lane_seed = LANE_SEED ^ state.seed as u32;
    let humanize = (state.humanize as f64 + state.lane_humanize as f64).min(1.0);
    let chance_scale = state.probability as f64 * state.lane_probability as f64;
    let swing_delay = if g % 2 == 1 { (state.swing as f64 - 50.0) / 100.0 * EIGHTH } else { 0.0 };
    // Groove thins out the weaker steps of the beat: the downbeat full, the 8th and the 16ths quieter.
    let groove = state.groove as f64;
    let step_gain = if g % 4 == 0 { 1.0 } else if g % 2 == 0 { 1.0 - 0.35 * groove } else { 1.0 - 0.6 * groove };
    for index in 0..state.patterns[slot].count as usize {
        let mut record = [0u8; NOTE_BYTES];
        record.copy_from_slice(&state.patterns[slot].notes[index * NOTE_BYTES..(index + 1) * NOTE_BYTES]);
        if record[NOTE_STEP] as i64 != pattern_step {
            continue;
        }
        // All three numbers are always drawn, so each is keyed by (lane, step, index) alone.
        let mut random = Mulberry32::new(note_seed(lane_seed, g, index as u32));
        let roll = random.uniform_f64();
        let time_roll = random.uniform_f64();
        let velocity_roll = random.uniform_f64();
        if !(roll < record[NOTE_CHANCE].min(100) as f64 / 100.0 * chance_scale) {
            continue;
        }
        let offset = (record[NOTE_OFFSET] as i8) as f64 / 100.0 * STEP;
        let jitter = (time_roll * 2.0 - 1.0) * humanize * HUMANIZE_PULSES;
        let mut position = g as f64 * STEP + swing_delay + offset + jitter;
        if position < cycle_start {
            position = cycle_start;
        }
        if !(position >= from && position < to) || (state.retained_count as usize) >= MAX_RETAINED {
            continue;
        }
        let mut velocity = record[NOTE_VELOCITY].clamp(1, 127) as f64 / 127.0;
        velocity *= 1.0 + (velocity_roll * 2.0 - 1.0) * humanize * HUMANIZE_VELOCITY;
        if state.accent && record[NOTE_FLAGS] & FLAG_ACCENT != 0 {
            velocity += (1.0 - velocity) * state.accent_amount as f64;
        }
        velocity = (velocity * step_gain).clamp(1.0 / 127.0, 1.0);
        let pitch = if state.kind == 1 { record[NOTE_PITCH] as u32 } else { state.pitch as u32 };
        let duration = record[NOTE_LENGTH].max(1) as f64 * QUARTER_STEP;
        let id = GENERATED_ID | (state.next_id & 0x7FFF_FFFF);
        state.next_id = state.next_id.wrapping_add(1);
        if emit(out, count, EventRecord {
            position, offset: 0, kind: EVENT_NOTE_ON, id, pitch, velocity: velocity as f32, cent: 0.0, duration
        }) {
            state.retained[state.retained_count as usize] = Retained {id, pitch, complete: position + duration};
            state.retained_count += 1;
        }
    }
}

// Note-ON before note-OFF at an equal position (as the arpeggiator does), then by pitch so the order never
// depends on the order notes were found in.
fn lifecycle_rank(record: &EventRecord) -> u8 {
    if record.kind == EVENT_NOTE_OFF { 1 } else { 0 }
}

/// Produce one block's events for `[from, to)`: the notes the pattern puts in the range, the note-offs that come
/// due, and (when the lane is armed) the upstream events passed through. Stopped transport generates nothing and
/// releases what is held; a DISCONTINUOUS jump releases it too and starts the pattern afresh at `from`. Returns
/// the count of position-sorted events written.
pub fn process(state: &mut LaneState, from: f64, to: f64, flags: u32, input: &[EventRecord], out: &mut [EventRecord]) -> usize {
    let mut count = 0;
    let transporting = flags & abi::BlockFlags::TRANSPORTING != 0;
    if flags & abi::BlockFlags::DISCONTINUOUS != 0 || !transporting {
        release_held(&mut state.retained, &mut state.retained_count, from, out, &mut count);
        state.cycle = -1; // the next block that plays decides its slot from the scene as it is then
    }
    if transporting {
        let first = ((from - LOOK_BACK).max(0.0) / STEP) as i64;
        let last = ((to + LOOK_AHEAD) / STEP) as i64;
        for g in first..=last {
            play_step(state, g, from, to, out, &mut count);
        }
    }
    release_completed(state, from, to, out, &mut count);
    if !state.armed {
        // Disarmed with live keys still down: end them here, because their own note-offs are dropped from now on.
        // A stop or a jump does not end them: the key is still held, and its note-off comes from upstream.
        release_held(&mut state.live, &mut state.live_count, from, out, &mut count);
    } else {
        for record in input {
            if record.kind == EVENT_NOTE_ON {
                if (state.live_count as usize) < MAX_LIVE && emit(out, &mut count, *record) {
                    state.live[state.live_count as usize] = Retained {id: record.id, pitch: record.pitch, complete: 0.0};
                    state.live_count += 1;
                }
            } else if emit(out, &mut count, *record) && record.kind == EVENT_NOTE_OFF {
                if let Some(at) = state.live[..state.live_count as usize].iter().position(|held| held.id == record.id) {
                    state.live_count -= 1;
                    state.live[at] = state.live[state.live_count as usize];
                }
            }
        }
    }
    out[..count].sort_unstable_by(|left, right| {
        left.position.partial_cmp(&right.position).unwrap_or(core::cmp::Ordering::Equal)
            .then(lifecycle_rank(left).cmp(&lifecycle_rank(right)))
            .then(left.pitch.cmp(&right.pitch))
    });
    count
}

/// What the host wires this device as (read at load): a MIDI effect (a pull source in the event chain).
#[no_mangle]
pub extern "C" fn kind() -> u32 {
    abi::DEVICE_KIND_MIDI_EFFECT
}

/// Bytes the engine must allocate (zeroed) for one instance's state block.
#[no_mangle]
pub extern "C" fn state_size(_sample_rate: f32) -> u32 {
    core::mem::size_of::<LaneState>() as u32
}

#[no_mangle]
pub extern "C" fn init(state_ptr: u32, _sample_rate: f32) {
    seed(unsafe { &mut *(state_ptr as *mut LaneState) });
}

/// Apply an observed field's value, by the id `observe_field` returned. Driven by the engine's catch-up +
/// subscription (inside a transaction, never during render).
#[no_mangle]
pub extern "C" fn field_changed(state_ptr: u32, id: u32, kind: u32, bits: u32, len: u32) {
    let state = unsafe { &mut *(state_ptr as *mut LaneState) };
    apply_field(state, id, unsafe { FieldValue::from_wire(kind, bits, len) });
}

/// Parity probe (the shared device shape): the lane has no automatable parameter, every id is unknown.
#[no_mangle]
pub extern "C" fn map_parameter(_id: u32, _unit: f32) -> f32 {
    f32::NAN
}

#[no_mangle]
pub extern "C" fn process_events(from: f64, to: f64, flags: u32, state_ptr: u32, out_ptr: u32, max: u32) -> u32 {
    let state = unsafe { &mut *(state_ptr as *mut LaneState) };
    let blank = EventRecord {position: 0.0, offset: 0, kind: 0, id: 0, pitch: 0, velocity: 0.0, cent: 0.0, duration: 0.0};
    let mut scratch = [blank; PULL_SCRATCH];
    // Always pull the upstream (an unarmed lane drops what it gets), so the source behind it keeps its cadence.
    let pulled = abi::pull_events(from, to, flags, &mut scratch);
    let out = unsafe { core::slice::from_raw_parts_mut(out_ptr as *mut EventRecord, max as usize) };
    process(state, from, to, flags, &scratch[..pulled], out) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deliveries_reach_the_state_by_id() {
        let mut state: Box<LaneState> = Box::new(unsafe { core::mem::zeroed() });
        defaults(&mut state);
        for (index, id) in state.ids.iter_mut().enumerate() {
            *id = 100 + index as u32; // native `observe_field` hands out 0 for everything
        }
        apply_field(&mut state, 100 + HEAD_AT as u32 + 1, FieldValue::Float(58.0));
        apply_field(&mut state, 100 + LANE_AT as u32 + 1, FieldValue::Int(36));
        apply_field(&mut state, 100 + LANE_AT as u32 + 6, FieldValue::Int(-123));
        apply_field(&mut state, 100 + LENGTH_AT as u32 + 3, FieldValue::Int(8));
        apply_field(&mut state, 100 + NOTES_AT as u32 + 3, FieldValue::Bytes(&[0, 0, 4, 60, 100, 100, 0, 0, 9]));
        apply_field(&mut state, 999, FieldValue::Int(1)); // an unknown id is ignored
        assert_eq!((state.swing, state.pitch), (58.0, 36));
        assert_eq!(state.seed, -123);
        assert_eq!((state.patterns[3].length, state.patterns[3].count), (8, 1), "a ragged tail byte is dropped");
    }
}
