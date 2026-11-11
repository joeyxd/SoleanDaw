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
