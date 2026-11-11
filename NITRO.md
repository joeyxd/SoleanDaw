# SoleanDaw: Nitro's DAW

This repository began as a fork of [openDAW](https://github.com/andremichelle/openDAW) by André Michelle
and contributors, and is licensed AGPL-3.0-or-later like the original (see `LICENSE`). Since
November 2026 it is developed on its own. Nitro builds its DAW from this repository and nothing
else: the editor it serves and the service that edits projects without a browser both come from one
commit of it, so they always know the same boxes and devices. This is the public corresponding
source of both.

| Branch | Contents |
| --- | --- |
| `nitro/daw` | The trunk and default branch: what is shipped |
| `nitro/<name>` | Work in progress; it joins `nitro/daw` when it ships |
| `vendor/base` | The openDAW commit this repository last took whole (`9b0ca9a9`, 26 Oct 2026), unchanged, with its full history |

The commit production is built from is named in Nitro's `daw/studio-service/Dockerfile`
(`SOLEANDAW_COMMIT`) and recorded in its `daw/UPSTREAM.json`. The served editor links that exact
commit (Source, in the Nitro chip on every page) and reports it at `/healthz`.

## What Nitro added

- `packages/app/studio/src/nitro/`: `NitroBridge.ts` opens the project Nitro ticketed for this tab,
  keeps its edit lease, shows the status chip and takes an agent's PulseGrid requests into the open
  tab. `boot.ts` starts it; `service/ProjectProfileService.ts` sends Save to Nitro as the next
  project revision when the tab opened a Nitro project. Save As still makes a local copy.
- `VisitorReporter.ts` and `errors/ErrorHandler.ts` skip the visit beacon and the error-log upload
  to openDAW's servers in the Nitro build (`VITE_NITRO=1`).
- **Nitro AI** in a clip's right-click menu (`NitroGenerate.tsx`,
  `ui/timeline/tracks/audio-unit/regions/RegionContextMenu.ts`): generate, make an arrangement, an
  accompaniment, lyrics or vocals from the clip; Split into instruments…, Get MIDI…, Get the sounds…,
  Sounds like this…. The clip is rendered in the browser and sent to Nitro, which runs the job on
  its own GPU workers; results land as new tracks, editable instrument clips or loaded samplers.
- **PulseGrid**, a step sequencer that is one instrument on one track: the lane device
  (`crates/stock-devices/device-pulsegrid-lane`), its boxes, the model and its text form
  (`packages/studio/adapters/src/pulsegrid`, with `SPEC.md`), the scripting facade and the window
  (`packages/app/studio/src/ui/devices/instruments/PulseGridDeviceEditor`).

## Taking changes from openDAW

openDAW is not merged in. A fix or a feature we want is picked, one commit at a time:

    git remote add upstream https://github.com/andremichelle/openDAW.git   # once
    git fetch upstream
    git switch -c nitro/pick-<what> nitro/daw
    git cherry-pick -x <upstream commit>     # -x writes where it came from into the message

Then build and test as for any change (a pick that touches boxes or devices needs the full turbo
build and the core-wasm tests), merge into `nitro/daw`, and move `SOLEANDAW_COMMIT` in Nitro.
`vendor/base` moves only if this repository is ever rebased whole onto a newer openDAW.

openDAW's own documentation is in `README.md`. Its author offers a commercial licence by email;
this repository uses the AGPL instead.
