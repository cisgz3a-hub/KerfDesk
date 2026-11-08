# Pro loop audit v1: laser and CNC output, judged by an independent machine model

**Requested by** the maintainer on 2026-11-08: audit the software in sections as a professional laser
and CNC developer, back every claim with a verified source, fix what is confirmed, and loop again
without stopping; include a loop on the 3D CNC area that says how well it is developed and what
still needs to be built. Where a choice was open, LightBurn's documented behaviour decides for laser,
and Vectric's (VCarve / Aspire) for CNC.

**Tree.** Branch `devin/audit-loops-20261108` from `origin/main` `5f09e1110`.

## Method

[rolling-v2 METHOD.md](../2026-10-21-rolling-v2/METHOD.md) applies (anchors, severity with the
2026-10-23 and 2026-10-27 clarifications, pinned citations, novelty check), with one change:
findings are fixed in the same loop, so a finding's evidence is a repro that fails before the fix and
passes after it. Finding IDs are `P<loop>-P<severity>-<n>`.

### The independent judge

Every loop drives the real path (`createProject` → `emitGcode`, or `compileCncJob` →
`cncGrblStrategy.emit`) and judges the emitted G-code with code that imports nothing from the app
(`audit/loop-v1/oracle.ts`, kept out of the repository):

- **Laser:** a GRBL 1.1 interpreter. `$32=1`: G0 never fires, M4 scales S by feed, M3 is constant.
  `$32=0`: the output stays at S under M3/M4 on every motion, G0 included
  ([gnea/grbl `laser_mode.md` @ `bfb67f0c7963`](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/laser_mode.md):
  "a `G0` rapid motion mode … will never turn on and always disable the laser", fetched 2026-11-08).
  It reports lit rapids, S above `$30`, G1 without F, the final spindle state, burn length per run,
  burn bounds and lit dwells.
- **CNC 3D:** a ball drop-cutter that stamps every feed move every 0.02 mm onto a 0.05 mm grid and
  compares the carved surface with the analytic design and with the sampled pixel surface.

## Areas (run order)

| Loop | Area | Scope | Status |
|---|---|---|---|
| 1 | Laser G-code core | power scale against `$30`/`$31`, M3/M4 per dialect, `$32=0` rapids, air assist, controlled travel, origin corners, overspeed, kerf | [done](L1-laser-gcode-core.md) — clean |
| 2 | Raster engraving | row placement, tone mapping (Grayscale min/max), dither duty per algorithm, Negative, scan angle, Dot Width Correction | [done](L2-raster.md) — clean |
| 3 | Vector cut and fill | inner-first order, kerf side for outers, holes and islands, multi-pass order, tabs, leads, overcut, perforation, fill styles | [done](L3-vector.md) — 1 P3 noted |
| 6 | 3D CNC | relief roughing and finishing on depth maps and STLs, rest finishing, maturity against Vectric Aspire | [done](L6-cnc-3d.md) — 1 P2 and 1 P3 fixed; gap list |
| 4 | Time estimate | estimate against an independent planner model | [done](L4-time-estimate.md) — clean |
| 5 | CNC 2D output | profile, pocket, drill, Z safety and feeds through the oracle | [done](L5-cnc-2d.md) — clean |
| 7 | Bidirectional scan offset | row shift against LightBurn's rule, its seven twins | [done](L7-scan-offset.md) — 1 P2, held for the maintainer |

Loop 6 ran before 4 and 5 because the maintainer asked for it by name and because it held the only
open P2 left in CNC output (rolling-v2 16-P2-1).

## Overlap with other work

Rolling audit v10 (PR #1613, fixes #1614–#1620) and v11 (PR #1621: licensing, remote, Electron,
camera, import/export, relief and design generators, Inspector, AI, browser build) are open. This
round stays on emitted laser and CNC output and the CAM geometry behind it, and does not audit their
diffs.
