//! Native tests of the PulseGrid lane core: `process` is driven directly, the way `tests/arp.rs` drives the arp.

use abi::{BlockFlags, EventRecord, EVENT_NOTE_OFF, EVENT_NOTE_ON};
use device_pulsegrid_lane::{defaults, process, LaneState};

const PLAY: u32 = BlockFlags::TRANSPORTING;
const BAR: f64 = 3840.0;

/// One event as the tests compare it: position, kind, pitch, velocity (ids are allowed to differ).
type Ev = (f64, u32, u32, f32);

fn lane() -> Box<LaneState> {
    let mut state: Box<LaneState> = Box::new(unsafe { std::mem::zeroed() });
    defaults(&mut state);
    state
}

/// One 8-byte note record.
fn note(step: u8, length: u8, pitch: u8, velocity: u8, chance: u8, flags: u8) -> [u8; 8] {
    [step, 0, length, pitch, velocity, chance, flags, 0]
}

fn pattern(notes: &[[u8; 8]]) -> Vec<u8> {
    notes.concat()
}

/// Notes on the given steps, one step long, velocity 100, chance 100.
fn on_steps(steps: &[u8]) -> Vec<u8> {
    pattern(&steps.iter().map(|step| note(*step, 4, 60, 100, 100, 0)).collect::<Vec<_>>())
}

fn pull(state: &mut LaneState, from: f64, to: f64, flags: u32, input: &[EventRecord]) -> Vec<EventRecord> {
    let blank = EventRecord {position: 0.0, offset: 0, kind: 0, id: 0, pitch: 0, velocity: 0.0, cent: 0.0, duration: 0.0};
    let mut out = vec![blank; 4096];
    let written = process(state, from, to, flags, input, &mut out);
    out.truncate(written);
    out
}

fn evs(records: &[EventRecord]) -> Vec<Ev> {
    records.iter().map(|record| (record.position, record.kind, record.pitch, record.velocity)).collect()
}

/// Render `[0, total)` in blocks of `block` pulses.
fn render(state: &mut LaneState, total: f64, block: f64, flags: u32) -> Vec<Ev> {
    let mut all = Vec::new();
    let mut from = 0.0;
    while from < total {
        let to = (from + block).min(total);
        all.extend(evs(&pull(state, from, to, flags, &[])));
        from = to;
    }
    all
}

fn ons(events: &[Ev]) -> Vec<&Ev> {
    events.iter().filter(|event| event.1 == EVENT_NOTE_ON).collect()
}

fn offs(events: &[Ev]) -> Vec<&Ev> {
    events.iter().filter(|event| event.1 == EVENT_NOTE_OFF).collect()
}

fn positions(events: &[&Ev]) -> Vec<f64> {
    events.iter().map(|event| event.0).collect()
}

#[test]
fn four_on_the_floor() {
    let mut state = lane();
    state.set_pitch(36);
    state.set_pattern_notes(0, &on_steps(&[0, 4, 8, 12]));
    let events = render(&mut state, 2.0 * BAR, 2.0 * BAR, PLAY);
    let hits = ons(&events);
    assert_eq!(positions(&hits), vec![0.0, 960.0, 1920.0, 2880.0, 3840.0, 4800.0, 5760.0, 6720.0]);
    assert!(hits.iter().all(|event| event.2 == 36), "a drum lane plays the lane pitch");
}

#[test]
fn notes_need_no_input_but_need_the_transport() {
    let mut state = lane();
    state.set_pattern_notes(0, &on_steps(&[0, 4, 8, 12]));
    let playing = pull(&mut state, 0.0, BAR, PLAY, &[]);
    assert_eq!(playing.iter().filter(|event| event.kind == EVENT_NOTE_ON).count(), 4);
    let mut stopped = lane();
    stopped.set_pattern_notes(0, &on_steps(&[0, 4, 8, 12]));
    assert!(pull(&mut stopped, 0.0, BAR, 0, &[]).is_empty(), "no transport, no notes");
}

#[test]
fn every_note_on_gets_its_note_off_even_in_a_later_block() {
    let mut state = lane();
    // Step 0: 8 quarter steps (480 pulses). Step 15 (pulse 3600): 16 quarter steps, off at 4560 in the next bar.
    state.set_pattern_notes(0, &pattern(&[note(0, 8, 60, 100, 100, 0), note(15, 16, 60, 100, 100, 0)]));
    let events = render(&mut state, 6000.0, 500.0, PLAY);
    assert_eq!(positions(&ons(&events)), vec![0.0, 3600.0, 3840.0]);
    assert_eq!(positions(&offs(&events)), vec![480.0, 4320.0, 4560.0]);
}

#[test]
fn block_splitting_never_changes_the_notes() {
    let mut state = lane();
    state.set_kind(1);
    state.set_swing(58.0);
    state.set_humanize(0.5);
    state.set_lane_humanize(0.2);
    state.set_probability(0.9);
    state.set_groove(0.5);
    let chances = [100u8, 70, 40, 100, 55, 90, 20, 100, 100, 60, 35, 80, 100, 45, 75, 100];
    let notes: Vec<[u8; 8]> = (0..16u8)
        .map(|step| note(step, 1 + step % 5 * 3, 48 + step * 3, 40 + step * 5, chances[step as usize], step % 3))
        .collect();
    state.set_pattern_notes(0, &pattern(&notes));
    let total = 2.0 * BAR;
    let whole = render(&mut state, total, total, PLAY);
    assert!(ons(&whole).len() > 8, "the pattern plays");
    for pair in whole.windows(2) {
        assert!(pair[0].0 <= pair[1].0, "positions never go back");
    }
    let mut again = lane();
    again.set_kind(1);
    again.set_swing(58.0);
    again.set_humanize(0.5);
    again.set_lane_humanize(0.2);
    again.set_probability(0.9);
    again.set_groove(0.5);
    again.set_pattern_notes(0, &pattern(&notes));
    assert_eq!(render(&mut again, total, total, PLAY), whole, "the same call twice is identical");
    for block in [1.0, 7.0, 13.7, 100.0, 240.0, 500.5, 960.0, 1111.0, BAR] {
        let mut split = lane();
        split.set_kind(1);
        split.set_swing(58.0);
        split.set_humanize(0.5);
        split.set_lane_humanize(0.2);
        split.set_probability(0.9);
        split.set_groove(0.5);
        split.set_pattern_notes(0, &pattern(&notes));
        assert_eq!(render(&mut split, total, block, PLAY), whole, "blocks of {block} differ from one call");
    }
}

#[test]
fn swing_delays_odd_steps_only() {
    let mut state = lane();
    state.set_swing(58.0);
    state.set_pattern_notes(0, &on_steps(&[0, 1, 2, 3]));
    let events = render(&mut state, BAR, BAR, PLAY);
    let at = positions(&ons(&events));
    let expected = [0.0, 278.4, 480.0, 758.4];
    assert_eq!(at.len(), 4);
    for (found, wanted) in at.iter().zip(expected) {
        assert!((found - wanted).abs() < 1e-6, "{found} != {wanted}");
    }
}

fn played_share(state: &mut LaneState, bars: usize) -> f64 {
    let mut played = 0;
    for bar in 0..bars {
        let from = bar as f64 * BAR;
        played += pull(state, from, from + BAR, PLAY, &[]).iter().filter(|event| event.kind == EVENT_NOTE_ON).count();
    }
    played as f64 / (bars * 16) as f64
}

fn all_steps_with_chance(chance: u8) -> Vec<u8> {
    pattern(&(0..16u8).map(|step| note(step, 4, 60, 100, chance, 0)).collect::<Vec<_>>())
}

#[test]
fn chance_rolls_follow_lane_identity_instead_of_kind_or_pitch() {
    let rolls = |seed: i32, kind: i32, pitch: i32| {
        let mut state = lane();
        state.set_seed(seed);
        state.set_kind(kind);
        state.set_pitch(pitch);
        state.set_pattern_notes(0, &all_steps_with_chance(50));
        positions(&ons(&render(&mut state, 32.0 * BAR, 120.0, PLAY)))
    };
    let first = rolls(123, 0, 36);
    assert!(!first.is_empty());
    assert_eq!(first, rolls(123, 0, 72), "pitch must not change chance rolls");
    assert_eq!(first, rolls(123, 1, 72), "kind must not change chance rolls");
    assert_ne!(first, rolls(456, 0, 36), "different lane seeds give different rolls");
}

#[test]
fn chance_zero_never_and_hundred_always_and_fifty_about_half() {
    let mut never = lane();
    never.set_pattern_notes(0, &all_steps_with_chance(0));
    assert_eq!(played_share(&mut never, 100), 0.0);
    let mut always = lane();
    always.set_pattern_notes(0, &all_steps_with_chance(100));
    assert_eq!(played_share(&mut always, 100), 1.0);
    let mut half = lane();
    half.set_pattern_notes(0, &all_steps_with_chance(50));
    let share = played_share(&mut half, 400);
    assert!(share > 0.35 && share < 0.65, "share {share}");
    let mut second = lane();
    second.set_pattern_notes(0, &all_steps_with_chance(50));
    assert_eq!(played_share(&mut second, 400), share, "a second run plays the same notes");
}

#[test]
fn master_and_lane_probability_multiply_with_the_note_chance() {
    let mut state = lane();
    state.set_pattern_notes(0, &all_steps_with_chance(50));
    state.set_probability(0.5);
    state.set_lane_probability(0.5);
    let share = played_share(&mut state, 400); // 0.5 * 0.5 * 0.5 = 12.5 %
    assert!(share > 0.09 && share < 0.16, "share {share}");
    let mut muted = lane();
    muted.set_pattern_notes(0, &all_steps_with_chance(100));
    muted.set_probability(0.0);
    assert_eq!(played_share(&mut muted, 50), 0.0, "master 0 silences the lane");
    let mut lane_off = lane();
    lane_off.set_pattern_notes(0, &all_steps_with_chance(100));
    lane_off.set_lane_probability(0.0);
    assert_eq!(played_share(&mut lane_off, 50), 0.0, "lane 0 silences the lane");
}

#[test]
fn accent_lifts_velocity_and_a_lane_with_accent_off_ignores_it() {
    let plain = 64.0f32 / 127.0;
    let accented = plain + (1.0 - plain) * 0.5;
    let mut state = lane();
    state.set_pattern_notes(0, &pattern(&[note(0, 4, 60, 64, 100, 1), note(4, 4, 60, 64, 100, 0)]));
    let velocities: Vec<f32> = render(&mut state, BAR, BAR, PLAY).iter().filter(|e| e.1 == EVENT_NOTE_ON).map(|e| e.3).collect();
    assert!((velocities[0] - accented).abs() < 1e-6 && (velocities[1] - plain).abs() < 1e-6, "{velocities:?}");
    state.set_accent(false);
    let velocities: Vec<f32> = render(&mut state, BAR, BAR, PLAY).iter().filter(|e| e.1 == EVENT_NOTE_ON).map(|e| e.3).collect();
    assert!((velocities[0] - plain).abs() < 1e-6, "accent off: {velocities:?}");
}

#[test]
fn groove_quiets_the_weak_steps() {
    let mut state = lane();
    state.set_groove(1.0);
    state.set_pattern_notes(0, &on_steps(&[0, 1, 2, 4]));
    let events = render(&mut state, BAR, BAR, PLAY);
    let velocity: Vec<f32> = ons(&events).iter().map(|event| event.3).collect();
    let full = 100.0f32 / 127.0;
    let wanted = [full, full * 0.4, full * 0.65, full];
    for (found, expected) in velocity.iter().zip(wanted) {
        assert!((found - expected).abs() < 1e-6, "{velocity:?}");
    }
}

fn pitches_at(events: &[Ev]) -> Vec<(f64, u32)> {
    ons(events).iter().map(|event| (event.0, event.2)).collect()
}

#[test]
fn a_scene_edit_waits_for_the_pattern_boundary() {
    let mut state = lane();
    state.set_kind(1);
    state.set_pattern_notes(0, &pattern(&[note(0, 4, 60, 100, 100, 0), note(8, 4, 60, 100, 100, 0)]));
    state.set_pattern_notes(5, &pattern(&[note(0, 4, 72, 100, 100, 0), note(8, 4, 72, 100, 100, 0)])); // scene 1, variation 1
    let first = evs(&pull(&mut state, 0.0, 1920.0, PLAY, &[]));
    state.set_scene(1);
    state.set_variation(1);
    let middle = evs(&pull(&mut state, 1920.0, BAR, PLAY, &[]));
    let next = evs(&pull(&mut state, BAR, 2.0 * BAR, PLAY, &[]));
    assert_eq!(pitches_at(&first), vec![(0.0, 60)]);
    assert_eq!(pitches_at(&middle), vec![(1920.0, 60)], "the old pattern finishes its bar");
    assert_eq!(pitches_at(&next), vec![(BAR, 72), (BAR + 1920.0, 72)], "the new pattern starts on the bar");
}

#[test]
fn a_scene_edit_while_stopped_applies_at_once() {
    let mut state = lane();
    state.set_kind(1);
    state.set_pattern_notes(0, &pattern(&[note(0, 4, 60, 100, 100, 0), note(8, 4, 60, 100, 100, 0)]));
    state.set_pattern_notes(4, &pattern(&[note(0, 4, 72, 100, 100, 0), note(8, 4, 72, 100, 100, 0)])); // scene 1, variation 0
    assert_eq!(pitches_at(&evs(&pull(&mut state, 0.0, 960.0, PLAY, &[]))), vec![(0.0, 60)]);
    pull(&mut state, 960.0, 1000.0, 0, &[]); // the transport stops
    state.set_scene(1);
    let resumed = evs(&pull(&mut state, 1000.0, 2000.0, PLAY, &[]));
    assert_eq!(pitches_at(&resumed), vec![(1920.0, 72)], "mid-bar, the new scene is already in");
}

#[test]
fn a_pattern_can_be_shorter_than_the_head() {
    let mut state = lane();
    state.set_pattern_length(0, 4);
    state.set_pattern_notes(0, &on_steps(&[0, 5]));
    let events = render(&mut state, BAR, BAR, PLAY);
    assert_eq!(positions(&ons(&events)), vec![0.0, 960.0, 1920.0, 2880.0], "four steps loop, step 5 never comes");
}

#[test]
fn a_melodic_lane_plays_each_notes_own_pitch_and_chords_together() {
    let mut state = lane();
    state.set_kind(1);
    state.set_pitch(10);
    state.set_pattern_notes(0, &pattern(&[
        note(0, 4, 60, 100, 100, 0), note(0, 4, 64, 100, 100, 0), note(0, 4, 67, 100, 100, 0), note(4, 4, 62, 100, 100, 0)
    ]));
    let events = render(&mut state, BAR, BAR, PLAY);
    assert_eq!(pitches_at(&events), vec![(0.0, 60), (0.0, 64), (0.0, 67), (960.0, 62)]);
}

#[test]
fn upstream_notes_pass_only_when_armed() {
    let live = [
        EventRecord {position: 100.0, offset: 0, kind: EVENT_NOTE_ON, id: 5, pitch: 70, velocity: 0.8, cent: 0.0, duration: 100.0},
        EventRecord {position: 200.0, offset: 0, kind: EVENT_NOTE_OFF, id: 5, pitch: 70, velocity: 0.0, cent: 0.0, duration: 0.0}
    ];
    let mut state = lane();
    assert!(pull(&mut state, 0.0, 960.0, 0, &live).is_empty(), "not armed: dropped (stopped)");
    assert!(pull(&mut state, 0.0, 960.0, PLAY, &live).is_empty(), "not armed: dropped (playing)");
    state.set_armed(true);
    let passed = evs(&pull(&mut state, 0.0, 960.0, 0, &live));
    assert_eq!(passed, vec![(100.0, EVENT_NOTE_ON, 70, 0.8), (200.0, EVENT_NOTE_OFF, 70, 0.0)]);
}

#[test]
fn a_transport_jump_or_a_stop_releases_held_notes() {
    let mut state = lane();
    state.set_pattern_notes(0, &pattern(&[note(0, 64, 60, 100, 100, 0)])); // 3840 pulses long
    let started = pull(&mut state, 0.0, 500.0, PLAY, &[]);
    assert_eq!(started.len(), 1);
    let jumped = pull(&mut state, 500.0, 600.0, PLAY | BlockFlags::DISCONTINUOUS, &[]);
    assert_eq!(jumped.len(), 1);
    assert_eq!((jumped[0].kind, jumped[0].position, jumped[0].id), (EVENT_NOTE_OFF, 500.0, started[0].id));
    assert!(pull(&mut state, 600.0, 700.0, PLAY, &[]).is_empty(), "nothing is left to release");

    let mut stopping = lane();
    stopping.set_pattern_notes(0, &pattern(&[note(0, 64, 60, 100, 100, 0)]));
    let started = pull(&mut stopping, 0.0, 500.0, PLAY, &[]);
    let stopped = pull(&mut stopping, 500.0, 600.0, 0, &[]);
    assert_eq!((stopped.len(), stopped[0].kind, stopped[0].id), (1, EVENT_NOTE_OFF, started[0].id));
}

#[test]
fn a_disarm_releases_live_keys_still_down() {
    let key_down = EventRecord {position: 100.0, offset: 0, kind: EVENT_NOTE_ON, id: 5, pitch: 70, velocity: 0.8, cent: 0.0, duration: 0.0};
    let key_up = EventRecord {position: 1000.0, offset: 0, kind: EVENT_NOTE_OFF, id: 5, pitch: 70, velocity: 0.0, cent: 0.0, duration: 0.0};
    let mut state = lane();
    state.set_armed(true);
    assert_eq!(pull(&mut state, 0.0, 960.0, 0, &[key_down]).len(), 1);
    assert!(pull(&mut state, 960.0, 970.0, 0, &[]).is_empty(), "a stop does not end a key that is still down");
    state.set_armed(false);
    let released = pull(&mut state, 970.0, 1920.0, 0, &[key_up]);
    assert_eq!(released.len(), 1, "its own note-off is dropped, the lane sends one instead");
    assert_eq!((released[0].kind, released[0].id, released[0].position), (EVENT_NOTE_OFF, 5, 970.0));
    assert!(pull(&mut state, 1920.0, 2880.0, 0, &[]).is_empty(), "released once");
}

fn scene_event(kind: u32, id: u32, slot: u32, position: f64, duration: f64) -> EventRecord {
    EventRecord {position, offset: 0, kind, id, pitch: slot, velocity: 0.8, cent: 0.0, duration}
}

/// A scene note as the unit's note source sends it: a note-on with its duration and the note-off at its end.
fn scene(id: u32, slot: u32, start: f64, duration: f64) -> [EventRecord; 2] {
    [scene_event(EVENT_NOTE_ON, id, slot, start, duration), scene_event(EVENT_NOTE_OFF, id, slot, start + duration, 0.0)]
}

/// A pattern of sixteen one-step notes whose pitch says which step played: `base + step`.
fn ramp(base: u8) -> Vec<u8> {
    pattern(&(0..16u8).map(|step| note(step, 4, base + step, 100, 100, 0)).collect::<Vec<_>>())
}

fn song_lane() -> Box<LaneState> {
    let mut state = lane();
    state.set_song(true);
    state.set_kind(1);
    state.set_pattern_notes(1, &ramp(40));
    state.set_pattern_notes(2, &ramp(60));
    state
}

/// Like `render`, but every upstream event goes to the block its position falls in.
fn render_song(state: &mut LaneState, input: &[EventRecord], total: f64, block: f64) -> Vec<Ev> {
    let mut all = Vec::new();
    let mut from = 0.0;
    while from < total {
        let to = (from + block).min(total);
        let here: Vec<EventRecord> = input.iter().filter(|event| event.position >= from && event.position < to).copied().collect();
        all.extend(evs(&pull(state, from, to, PLAY, &here)));
        from = to;
    }
    all
}

#[test]
fn song_off_leaves_scene_notes_alone() {
    let mut state = lane();
    state.set_armed(true);
    state.set_pattern_notes(0, &on_steps(&[0, 4, 8, 12]));
    let input = [scene_event(EVENT_NOTE_ON, 7, 10, 100.0, 100.0), scene_event(EVENT_NOTE_OFF, 7, 10, 200.0, 0.0)];
    let events = evs(&pull(&mut state, 0.0, BAR, PLAY, &input));
    assert_eq!(positions(&ons(&events)), vec![0.0, 100.0, 960.0, 1920.0, 2880.0], "the pitch-10 note passes, the pattern plays");
    assert_eq!(ons(&events).iter().filter(|event| event.2 == 10).count(), 1);
    assert_eq!(offs(&events).iter().filter(|event| event.2 == 10).count(), 1);
}

#[test]
fn song_on_with_no_scene_note_rests() {
    let mut state = song_lane();
    assert!(render_song(&mut state, &[], 2.0 * BAR, BAR).is_empty());
}

#[test]
fn a_scene_note_chooses_the_slot_from_its_start_to_its_end() {
    let mut state = song_lane();
    // Slot 2 from step 6 (1440) for four steps: it starts mid cycle, so it starts mid pattern.
    let input = scene(1, 2, 1440.0, 960.0);
    let events = render_song(&mut state, &input, BAR, BAR);
    assert_eq!(pitches_at(&events), vec![(1440.0, 66), (1680.0, 67), (1920.0, 68), (2160.0, 69)]);
    // The same notes from a second bar: the step index follows the transport.
    let mut again = song_lane();
    let later = scene(1, 2, BAR + 1440.0, 960.0);
    assert_eq!(pitches_at(&render_song(&mut again, &later, 2.0 * BAR, 700.0)),
        vec![(BAR + 1440.0, 66), (BAR + 1680.0, 67), (BAR + 1920.0, 68), (BAR + 2160.0, 69)]);
}

#[test]
fn two_scene_notes_back_to_back_switch_exactly_at_the_boundary() {
    let mut state = song_lane();
    let input = [scene(1, 1, 0.0, 960.0), scene(2, 2, 960.0, 960.0)].concat();
    let mut sorted = input.clone();
    sorted.sort_by(|left, right| left.position.partial_cmp(&right.position).unwrap());
    let events = render_song(&mut state, &sorted, BAR, BAR);
    assert_eq!(pitches_at(&events), vec![
        (0.0, 40), (240.0, 41), (480.0, 42), (720.0, 43), (960.0, 64), (1200.0, 65), (1440.0, 66), (1680.0, 67)
    ]);
}

#[test]
fn a_scene_note_per_step_plays_the_whole_pattern_without_gap_or_double() {
    let mut state = song_lane();
    let input: Vec<EventRecord> = (0..16u32).flat_map(|step| scene(step + 1, 1, step as f64 * 240.0, 240.0)).collect();
    let events = render_song(&mut state, &input, BAR, 500.0);
    let expected: Vec<(f64, u32)> = (0..16u32).map(|step| (step as f64 * 240.0, 40 + step)).collect();
    assert_eq!(pitches_at(&events), expected);
}

#[test]
fn a_song_note_never_lands_before_its_step_starts() {
    let mut state = song_lane();
    state.set_humanize(1.0);
    state.set_swing(60.0);
    // Every note asks to play 100 hundredths of a step early; humanize jitters it on top.
    state.set_pattern_notes(1, &pattern(&(0..16u8).map(|step| [step, (-100i8) as u8, 4, 40 + step, 100, 100, 0, 0]).collect::<Vec<_>>()));
    let input: Vec<EventRecord> = (0..32u32).flat_map(|step| scene(step + 1, 1, step as f64 * 240.0, 240.0)).collect();
    let events = render_song(&mut state, &input, 2.0 * BAR, 333.0);
    let hits = ons(&events);
    assert_eq!(hits.len(), 32, "every step plays");
    for hit in &hits {
        let step = (hit.2 - 40) as f64;
        let bar_step = step + if hit.0 >= BAR { 16.0 } else { 0.0 };
        assert!(hit.0 >= bar_step * 240.0, "pitch {} landed at {} before its step", hit.2, hit.0);
    }
    assert!(hits.iter().any(|hit| hit.0 == (hit.2 - 40) as f64 * 240.0 + if hit.0 >= BAR { BAR } else { 0.0 }), "some are held at the step start");
}

#[test]
fn block_splitting_never_changes_the_notes_in_song_mode() {
    let make = || {
        let mut state = song_lane();
        state.set_swing(58.0);
        state.set_humanize(0.5);
        state.set_lane_humanize(0.2);
        state.set_probability(0.9);
        state.set_groove(0.5);
        state.set_pattern_length(2, 12);
        state
    };
    let mut input = [
        scene(1, 1, 0.0, 700.0), scene(2, 2, 700.0, 1500.0), scene(3, 1, 2500.0, 240.0), scene(4, 2, 2800.0, 960.0),
        scene(5, 1, BAR + 100.0, 3000.0), scene(6, 2, BAR + 3300.0, 900.0)
    ].concat();
    input.sort_by(|left, right| left.position.partial_cmp(&right.position).unwrap());
    let total = 2.0 * BAR;
    let whole = render_song(&mut make(), &input, total, total);
    assert!(ons(&whole).len() > 12, "the scene plays");
    for pair in whole.windows(2) {
        assert!(pair[0].0 <= pair[1].0, "positions never go back");
    }
    for block in [1.0, 7.0, 13.7, 100.0, 240.0, 500.5, 960.0, 1111.0, BAR] {
        assert_eq!(render_song(&mut make(), &input, total, block), whole, "blocks of {block} differ from one call");
    }
}

#[test]
fn in_song_mode_a_scene_note_is_never_forwarded_but_a_high_note_passes() {
    let mut state = song_lane();
    state.set_armed(true);
    let input = [
        scene_event(EVENT_NOTE_ON, 7, 10, 100.0, 0.0), scene_event(EVENT_NOTE_ON, 8, 70, 150.0, 0.0),
        scene_event(EVENT_NOTE_OFF, 7, 10, 300.0, 0.0), scene_event(EVENT_NOTE_OFF, 8, 70, 350.0, 0.0)
    ];
    let events = evs(&pull(&mut state, 0.0, 960.0, PLAY, &input));
    let passed: Vec<(f64, u32, u32)> = events.iter().map(|event| (event.0, event.1, event.2)).collect();
    assert_eq!(passed, vec![(150.0, EVENT_NOTE_ON, 70), (350.0, EVENT_NOTE_OFF, 70)]);
    let mut unarmed = song_lane();
    assert!(evs(&pull(&mut unarmed, 0.0, 960.0, PLAY, &input)).iter().all(|event| event.2 != 10 && event.2 != 70));
}

#[test]
fn a_discontinuous_block_forgets_the_scene_until_the_next_scene_note() {
    let mut state = song_lane();
    // A key-like scene note: it never ends by itself.
    let held = scene_event(EVENT_NOTE_ON, 1, 1, 0.0, f64::INFINITY);
    assert_eq!(ons(&evs(&pull(&mut state, 0.0, 960.0, PLAY, &[held]))).len(), 4);
    assert_eq!(ons(&evs(&pull(&mut state, 960.0, 1920.0, PLAY, &[]))).len(), 4, "it keeps governing");
    let jumped = evs(&pull(&mut state, 1920.0, 2880.0, PLAY | BlockFlags::DISCONTINUOUS, &[]));
    assert!(ons(&jumped).is_empty(), "the jump forgot it");
    assert!(ons(&evs(&pull(&mut state, 2880.0, 3840.0, PLAY, &[]))).is_empty(), "and it stays forgotten");
    let next = scene_event(EVENT_NOTE_ON, 2, 2, 4080.0, 480.0);
    let after = evs(&pull(&mut state, 3840.0, 4800.0, PLAY, &[next]));
    assert_eq!(pitches_at(&after), vec![(4080.0, 61), (4320.0, 62)], "steps 17 and 18 play pattern steps 1 and 2 of slot 2");
}

#[test]
fn a_full_out_buffer_never_loses_a_note_off() {
    let mut state = lane();
    state.set_kind(1);
    state.set_pattern_notes(0, &pattern(&[60, 62, 64, 65, 67, 69].map(|pitch| note(0, 4, pitch, 100, 100, 0))));
    let blank = EventRecord {position: 0.0, offset: 0, kind: 0, id: 0, pitch: 0, velocity: 0.0, cent: 0.0, duration: 0.0};
    let mut out = [blank; 4];
    let first = process(&mut state, 0.0, 960.0, PLAY, &[], &mut out);
    let mut started: Vec<u32> = out[..first].iter().filter(|event| event.kind == EVENT_NOTE_ON).map(|event| event.id).collect();
    assert_eq!(started.len(), 4, "four of the six fit; the two that did not are not held");
    let second = process(&mut state, 960.0, 1920.0, PLAY, &[], &mut out);
    let mut ended: Vec<u32> = out[..second].iter().filter(|event| event.kind == EVENT_NOTE_OFF).map(|event| event.id).collect();
    assert!(out[..second].iter().all(|event| event.position == 960.0), "late note-offs go out at the block start");
    started.sort();
    ended.sort();
    assert_eq!(started, ended, "every note that started ends, in the next block when this one was full");
    assert_eq!(process(&mut state, 1920.0, 2880.0, PLAY, &[], &mut out), 0);
}
