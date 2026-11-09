# Rolling audit v11 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

Security findings are listed by class and severity only until their fix merges (AREAS.md, Security).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| W1 | Licensing and Free/Pro gating | origin/main @ 5f09e1110 (refuter 5f09e1110; Node only, memory under every gate) | [W1-licensing-pro-gating.md](W1-licensing-pro-gating.md) | 5 | 1 | 0 | 0 | 4 | 17 |
| W2 | Phone, remote control and MCP | origin/main @ 5f09e1110 (refuter 5f09e1110; Vitest with the real remote adapter and a simulated controller) | [W2-remote-mcp-phone.md](W2-remote-mcp-phone.md) | 5 | 0 | 1 (refuter) | 0 | 4 | 24 |
| W3 | Electron main process and the updater | origin/main @ 5f09e1110 (refuter 5f09e1110; Node with the real main-process modules) | [W3-electron-main-updater.md](W3-electron-main-updater.md) | 2 | 0 | 1 | 1 | 0 | 33 |
| W4 | Camera | origin/main @ 5f09e1110 (refuter 5f09e1110; Node with the real modules) | [W4-camera.md](W4-camera.md) | 4 | 0 | 1 (refuter) | 1 (security) | 2 | 18 |
| W5 | Import and export formats | origin/main @ a3965a77d (refuter a3965a77d; Node with the real importers, headless Chrome 156 for SVG ground truth) | [W5-import-export-formats.md](W5-import-export-formats.md) | 6 (incl. 14-P3-1 re-rated) | 1 | 2 (refuter) | 2 | 1 | 29 |
| W6 | Relief and design generators | origin/main @ a3965a77d (refuter a3965a77d; Node with the real relief compiler and a G-code simulator) | [W6-relief-generators.md](W6-relief-generators.md) | 3 | 0 | 1 (refuter) | 1 | 1 | 26 |
| W7 | G-code Inspector, Run and viewer | origin/main @ a3965a77d (refuter a3965a77d; headless Chrome with a paced simulated GRBL) | [W7-gcode-viewers-inspector.md](W7-gcode-viewers-inspector.md) | 2 | 0 | 1 (refuter) | 0 | 1 | 21 |
| W8 | AI features (the optional desktop assistant) | origin/main @ a3965a77d (refuter a3965a77d; stubbed provider, no real calls) | [W8-ai-features.md](W8-ai-features.md) | 2 | 0 | 0 | 0 | 2 | 7 |
| W9 | Browser build, website and docs drift | origin/main @ b047e7bb6 (refuter b047e7bb6; Chrome 156 power-state and throttling measurements) | [W9-platform-web-docs.md](W9-platform-web-docs.md) | 5 | 0 | 0 | 2 | 3 | 9 |
| **Total (W1–W9)** | | | | **34** | **2** | **7** | **7** | **18** | **184** |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| W2-P2-1 (P1, refuter) | W2 | **A phone or MCP Resume of a paused CNC job gives none of the PC's spin-up warning.** For a FluidNC router at `$32=0` the PC says the bit is fed through the cut while the spindle is still speeding up and to prefer ABORT JOB; the phone/MCP status offers Resume with no reason or text, Resume sends `~`, the receipt says "Resumed." and the bit, stopped in the kerf, is fed along the cut at cutting speed while the spindle spins up from rest (stalled or broken bit, torn edge, possible lost steps). The Start review has no FluidNC `spinup_ms` line. P1 by effect (meta M3-P3-5) and by J3-P2-3: the only warning is on a PC screen the phone operator does not see; GRBL at `$32=1`/unknown (warned at Start) and GRBL `$32=0` (Pause lifts, firmware waits 4 s) stay P2. FluidNC `spinup_ms` default cited from earlier audits, not re-fetched | **READ** (main): `cncResumeAdvisoryNotice` (`cnc-pause-resume-policy.ts`) is used only by `JobRunControls.tsx` and `LiveMotionBar.tsx`; the remote path `machine-owned-operation.ts:30` (`resume_job`) → `machine-actions.ts`, `machine-execution.ts` never reads it. Refuter REPRO (Vitest, real remote adapter, registry and store, simulated FluidNC banner: `zz-w2r/resume.json`) | fixed by #1644 |
| W3-P1-1 | W3 | **A renderer crash mid-job leaves an `M3` beam or a spindle on, and main sends no stop.** On a network machine main still holds the live socket but writes nothing (no `0x18`, `!` or `M5`), refuses a reconnect for 15 s, then closes it, still without a stop; the forced close on quit also writes nothing. GRBL, grblHAL and FluidNC keep `M3` lit with no timeout (Marlin fan-output too); a latched Fire leaves the beam on in any power mode. The crash prompt says only that the machine "may still finish moves it already received". On USB main has no port handle, so there only the prompt is at fault. Partly known as v2 04-P3-20/23 (P3); P1 by the v6 K1-P1-3 precedent (a lit stop) | **READ** (main): `renderer-crash-recovery.ts:62-75` (the crash handler only asks to reload), `main.ts:414` (the other `render-process-gone` hook releases the licence admission only); no route sends a stop on the network session. Auditor and refuter REPRO (Node, real bridge, crash-recovery and session code: 0 bytes after the crash, socket closed at 14.8 s) | fixed by #1628 (merged 2026-11-09) |
| W3-P2-1 | W3 | **Windows shutdown with the laser lit at Idle neither waits nor sends `M5`.** The window reports `busy:false`, so the session-end guard lets Windows proceed; the ordinary close sends `M5` (`desktop-close-runtime.ts:77-81`) and the update close refuses, but shutdown does neither. Lit at Idle means a file ending in a lit `G1` without `M5`, a Console `G1 F… M3 S…`, or any `M3` at `$32=0`. P2: the operator lit it and LASER ON was showing; shutdown misses the chance to turn it off | Auditor and refuter REPRO (Node, real `session-end-guard.ts` and close runtime) | fixed by #1628 (merged 2026-11-09) |
| W4-P2-1 (P1, refuter) | W4 | **On a rotary with camera placement on, Job Review advises "Choose Absolute Coordinates", and following it burns about 61° around the cylinder from the face the operator set up** (Y 60.9–99.1 → Y 0–38.2; 31.9 mm of surface on a Ø60 piece), with no warning left at Absolute. Neither Preview nor the canvas Frame outline shows Y 0: in all three Start-from modes the outline sits on the placed artwork, so the canvas agrees with the wrong advice. Place Board and the jig have their own wording (ADR-654); the rotary does not. LightBurn recommends Current Position for rotary work, which is the mode that raises the advice | **READ** (main): `start-job-readiness-policy.ts:125-135` (`cameraPlacementStartFromWarning` exempts `place-board` and `jig` only; no rotary check). Auditor and refuter REPRO (Node, real Start builder and rotary transform) | fixed by #1641 |
| W4-P2-2 | W4 | **SECURITY: credential leak into persisted or shared files.** Redacted until fixed (AREAS.md, Security) | Auditor and refuter REPRO; details in the coordinator's scratchpad, not in the repository | fixed by #1649 |
| W5-P1-1 | W5 | **A DXF polyline bulge near zero (about 1e-16 or smaller) turns a straight edge into a large loop.** Only an exact `bulge === 0` is treated as straight; a noise bulge gives a tiny sweep, a huge radius and centre, and floating-point error in the arc points. A 40 × 30 mm plate with a bulge of 2.4e-17 or 1e-17 on one edge compiles 70.4 or 141 mm wide; a bulge of 1e-18 or 1e-19 shrinks the whole design to 29 % or 7.8 % under a false "larger than the bed" notice. The canvas and the burn both use the bad curve; the only message is "Imported 1 path". SVG twin: arcs whose radius is about 1e16 × the chord do the same, where Chromium draws them straight. Such bulges are floating-point noise in exported files; KerfDesk's own export writes 0. Found by the refuter | **READ** (main a3965a77d): `dxf-native-curves.ts:28-49` (`bulgeCurveSegment`: `if (bulge === 0)` only). Refuter REPRO (Node, real importer and compile: `zz-w5r/bulge.out.txt`, `bulgeburn.out.txt`) | fixed by #1636 (merged 2026-11-09) |
| 14-P3-1 (P1, re-rated by the W5 refuter) | W5 | **CSS translations in an SVG are silently ignored, so the artwork imports and burns somewhere else.** `transform: translateX(20px)`, the `translate` property and a style-sheet `translateY` rule are dropped: Chromium places the rectangles at x 20..30, KerfDesk at 0..10, with no note. The canvas shows the wrong place faithfully, but under the 2026-10-27 rule and the J6-P1-1 precedent a visible result is not a warning. Open since rolling v2 (14-P3-1) | **READ** (main): `svg-transform-attribute.ts:51-56` (no `translatex`/`translatey` functions), `svg-clip-presentation.ts:15` (the CSS `translate` property is read for clip paths only). Refuter REPRO (headless Chrome 156 against the real importer: `zz-w5r/browser.out.txt`) | fixed by #1635 (merged 2026-11-09) |
| W5-P2-1 | W5 | **A DXF spanning more than 1,000,000 mm imports silently, then Save and autosave refuse the whole project.** The importer range-checks raw entity coordinates but not what the shift to its corner, INSERTs and splines produce. Save shows an error and offers a recovery copy that will not reopen; the autosave warning blames image size. Earlier work survives (the last good autosave is kept) and deleting the object makes Save work again; work after the import is at risk. P2 by the 13-P2-1 precedent | Auditor and refuter REPRO (real store and worker route); refuter READ `autosave-durable.ts:261-267` | fixed by #1636 (merged 2026-11-09) |
| W5-P2-2 | W5 | **HPGL import has no coordinate range check at all**: strokes 1,025 m apart, or one corrupt 1e12 value, import with no note and then Save and autosave refuse the project, as in W5-P2-1. Found by the refuter | **READ** (main): `hpgl-result.ts:18-31`. Refuter REPRO | fixed by #1636 (merged 2026-11-09) |
| W6-P2-1 (P1, refuter) | W6 | **A relief projection cuts its whole depth in one pass with no tabs, so a closed shape projected through the stock comes free while Job Review lists tabs or a holding floor.** The projection ignores the layer's Cut depth, Depth per pass and Tabs, which the layer card still shows: a 16 × 16 mm square projected 2 mm below a 5 mm relief floor cuts the whole loop at Z−7 through 6.35 mm stock in one pass with no tabs; Job Review says "tabs 4 per shape (6 × 2 mm)", or with 6 mm stock "tabs … skipped: the 5 mm floor holds the part" (false), and counts passes from the ignored settings ("3 passes" for one). A leftover Cut depth also drives a false spoilboard warning. P1 by CNC v1 F3-P1-1 (a part cut free with tabs on and no warning) | **READ** (main): `relief-projection-plan.ts:74-85` (one Z per point: surface minus depth; no step-down, no tabs), `cnc-relief-group.ts:31-32` (depth-per-pass provenance only for roughing), `cnc-through-cut-tab-warnings.ts:86` (reads the ignored Cut depth). Auditor and refuter REPRO (Node, real compiler: `zz-w6r/`) | fixed by #1643 |
| W6-P2-2 | W6 | **Where the roughing bit cannot enter, the finishing ball cuts the region full width and full depth.** An 8 × 5 mm channel with a 1/4" rough and a 1/8" ball finish: roughing emits nothing there, and the ball slots it 5 mm deep at F1000 (13.86 mm²/mm against 4.80 for a roughing pass; a 40.4 mm slot when the channel runs along the rows), about 3× the app's own 0.5 × D depth guide. Job Review can read "relief roughing 3 levels to 4.5 mm" though the channel was not roughed. P2 by the meta audit's full-width-slot precedent | **READ** (main): `compile-cnc-relief.ts:109`. Auditor and refuter REPRO (G-code simulator) | fixed by #1643 |
| W7-P2-1 (P1, refuter) | W7 | **Running a large outside G-code file freezes the window on every Run dialog redraw, and Abort waits behind it.** The dialog rebuilds the whole-file review in its render with no memo: 1.0–1.4 s per render at 500k lines (3.0 s at 1M). It re-renders on every controller, motion, connection and streamer status change, and stays open after Start until recovery retirement finishes, so the block lands at the start of a beam-on stream every time: an `M4` photo engrave at 500k lines blocked 3.4–4.3 s after the first line and Abort (Ctrl+.) reached the controller 539 and 661 ms late (a press at a block start would wait 1.2–2.4 s). During a Frame, Abort reached the controller 5.9 s late and a Frame jog was written 662 ms after the press. P1 by S1-P2-1 and S4-P2-3 | **READ** (main): `RunGcodeFileDialog.tsx:104-124` (`prepareExternalRun` → `reviewExternalProgram` inline in render; only the cheap values above it use `useMemo`), `use-command-store-state.ts:30-35`, `use-gcode-inspector-slot.tsx:27-28`, `laser-start-arming-completion.ts:50-56`. Refuter REPRO (Chrome CPU profile, paced simulated GRBL: `zz-w7r/out-500k.json`, `out-abort.json`) | fixed by #1639 |
| W9-P2-1 | W9 | **In the browser build a background or minimised tab loses the job's keep-awake, and nothing tells the user.** The screen wake lock (ADR-117's only browser keep-awake) is released when the tab is hidden: in Chrome 156 the OS power state drops from `0x2` to `0x0`, and a new request while hidden is refused. The app never asks while hidden, so the "Keep-awake unavailable" notice ADR-117 requires never shows. No other code keeps the PC awake, and Windows does not count serial traffic as activity, so the PC can idle-sleep and stop the stream; under GRBL `M3` the beam stays lit over the stopped head. Background throttling does not starve the worker-driven stream (measured over 7 minutes hidden). P1 if Chrome holds no power request while a Web Serial port is open; that link is unproven (`zz-w9r/power-state.ps1` settles it on a real job) | **READ** (main): `use-active-job-wake-lock.ts:92` (returns before the request while hidden, skipping `warnUnavailableOnce`). Auditor REPRO (Vitest), refuter Chrome 156 power-state measurement | fixed by #1640 |
| W9-P2-2 | W9 | **Firefox and Safari users are told their work is safe in the browser's autosave, with no way to get it out.** Every Save and Export goes through the file picker, which throws there; there is no download fallback; `persist()` is only asked after a save that cannot succeed; Safari deletes a site's stored data after 7 days of use without a visit (WebKit policy, re-fetched), and Chrome cannot read another browser's autosave, so the "open KerfDesk in Chrome or Edge" advice cannot move the work. P2: the opening banner says the browser cannot save files | Auditor and refuter READ (the save, export and persist paths) | fixed by #1640 |

## Round result (2026-11-09)

All nine areas went through an auditor, a fresh refuter and a coordinator check in main's code (`5f09e1110`, then `a3965a77d`, then `b047e7bb6`).

**Totals.**
- 34 findings raised and 2 refuted, leaving P1 7 / P2 7 / P3 18.
- One P1 is a v2 P3 the W5 refuter re-rated: 14-P3-1.
- 184 earlier findings were rechecked and are still open or partly open (KNOWN).
- One finding is a security issue. It is listed by class only until its fix merges.

The refuters raised six findings to P1: W2-P2-1, W4-P2-1, W6-P2-1, W7-P2-1, W5-P1-1 and 14-P3-1. In each case the refuter reproduced what the auditor had only reasoned about.

**Earlier audits.** Almost every P1 and P2 from rolling v2, v3 and v5 in these areas is now fixed on main:
- licensing: 02-P2-1 and 02-P2-2;
- remote: H8-P1-1, H8-P1-2 and most of 01;
- camera: every earlier camera P1 and P2;
- importers: 13-P1-1, 21-P1-1, J6-P1-1, L7-P1-1 and L7-P1-2.

What remains is a large P3 backlog, about 180 items, listed per area in each report.

### P1 and P2

| ID | What | Fix |
|---|---|---|
| W2-P2-1 (P1) | A phone or MCP Resume of a paused CNC job gives none of the PC's spin-up warning (FluidNC router at `$32=0`) | fixed by #1644 |
| W3-P1-1 | A renderer crash mid-job leaves an `M3` beam or spindle on; main sent no stop | fixed by #1628 |
| W3-P2-1 | Windows shutdown with the laser lit at Idle sent no `M5` | fixed by #1628 |
| W4-P2-1 (P1) | On a rotary, the camera advice to choose Absolute Coordinates burns about 61° around the cylinder | fixed by #1641 |
| W4-P2-2 | Security: credential leak into persisted or shared files (redacted) | fixed by #1649 |
| W5-P1-1 | A near-zero DXF bulge turns a straight edge into a large loop or shrinks the design | fixed by #1636 (merged 2026-11-09) |
| 14-P3-1 (P1) | CSS translations in SVG are silently ignored, so artwork burns elsewhere | fixed by #1635 |
| W5-P2-1 | A DXF spanning more than 1,000,000 mm imports silently, then the project cannot be saved | fixed by #1636 (merged 2026-11-09) |
| W5-P2-2 | HPGL import has no coordinate range check | fixed by #1636 (merged 2026-11-09) |
| W6-P2-1 (P1) | A relief projection cuts its whole depth in one pass with no tabs, while Job Review lists tabs | fixed by #1643 |
| W6-P2-2 | Where roughing cannot enter, the finishing ball slots full depth | fixed by #1643 |
| W7-P2-1 (P1) | The Run dialog re-reviews a large external file on every redraw; Abort was measured 0.54–5.9 s late | fixed by #1639 |
| W9-P2-1 | A background browser tab loses the job's keep-awake silently (P1 if Chrome holds no power request for an open serial port) | fixed by #1640 |
| W9-P2-2 | Firefox and Safari work lives only in an evictable autosave with no way out | fixed by #1640 |

**The pattern.** Four of the seven P1s are a guard or warning that one route has and a twin route lacks:
- W2: PC Resume vs phone Resume.
- W4: the Place Board and jig advice vs the rotary.
- W6: layer passes and tabs vs relief projection.
- 14-P3-1: SVG attributes vs CSS.

Two more are failure paths that only a live measurement or an exact repro showed:
- W7: the dialog stays open into the stream.
- W5-P1-1: floating-point noise in a bulge.

### Maintainer decisions open

- **BQ-20:** should Illustrator SVGs import at Illustrator's own size? Today they import at 75 % (14-P2-1).
- **S9-P3-1:** the startup hold.
- **S8-P2-1:** the cut change.
- **S8-P3-3:** whether a 600 × 400 mm sign counts as ordinary.
- **Worker redeploy:** eight Worker-visible changes since 2026-10-21 reach phones only after a redeploy.
- **W9-P2-1:** confirm on a real job with `power-state.ps1`, which is in the coordinator's scratchpad.

### P3s (18) and the KNOWN backlog

Proposed sweeps, one session per group, run after the fix PRs above merge:
- **Licensing gating:** W1-P3-1, -3, -4 and -5.
- **Remote messages:** W2-P3-1 to W2-P3-4.
- **Camera:** W4-P3-1 and W4-P3-2.
- **Importers:** W5-P3-2, plus the 14-P3-x and K items.
- **Relief and box:** W6-P3-1, plus 16-P3-x and 25-P3-x.
- **Inspector:** W7-P3-1, plus the 26-P3-x items.
- **AI:** W8-P3-1 and W8-P3-2.
- **Browser and docs:** W9-P3-1 to W9-P3-3, plus the 19, 22 and 24 items.

The KNOWN items carry over from v2, v3 and v5. Each area report lists them.

### Not verified (memory)

The PC had 0.6–2.7 GB free. Most checks were Node runs of the real modules. Real browsers were used only where the gate allowed: W5, W7, W9, and the W8 tests.

No area could run:
- hardware or a real serial port;
- the packaged Electron app;
- the live Worker, licensing server, update feed or AI provider (by rule).
