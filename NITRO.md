# SoleanDaw: openDAW as Nitro's DAW editor

This repository is a fork of [openDAW](https://github.com/andremichelle/openDAW) by André Michelle
and contributors, licensed AGPL-3.0-or-later like the original (see `LICENSE`). It is the public
corresponding source of the DAW editor Nitro serves on its own origin.

| Branch | Contents |
| --- | --- |
| `vendor/base` | The reviewed upstream commit, unchanged, with its full history |
| `nitro/daw` | `vendor/base` plus the Nitro overlay, committed: the exact source of the served editor |

The overlay is two Nitro files in `packages/app/studio/src/nitro/`, this file, and eight small edits:

- `boot.ts` starts the adapter, which opens the project Nitro ticketed for this tab, keeps its edit
  lease and shows a status chip with a link to this source.
- `service/ProjectProfileService.ts` sends Save to Nitro as the next project revision when the tab
  opened a Nitro project. Save As still makes a local copy.
- `VisitorReporter.ts` and `errors/ErrorHandler.ts` skip the visit beacon and the error-log upload
  to openDAW's servers in the Nitro build (`VITE_NITRO=1`).
- `ui/timeline/tracks/audio-unit/regions/RegionContextMenu.ts` adds **Nitro AI** to a clip's
  right-click menu: generate, make an arrangement, an accompaniment, lyrics or vocals from the clip
  (`NitroGenerate.tsx`). The clip is rendered in the browser and sent to Nitro, which runs the job
  on its own GPU workers; a placeholder clip shows the job's progress until the result lands on a
  new track named for the engine that made it.

Nitro keeps the overlay in `daw/studio-fork` and applies it to the pinned upstream commit when it
builds the editor image; every edit is anchored and the build stops if upstream moves an anchor.
This branch is that result committed, so it always matches what is served. The served editor
reports the upstream commit and the overlay hash at `/healthz`.

openDAW's own documentation is in `README.md`. Its author offers a commercial licence by email;
this fork uses the AGPL instead.
