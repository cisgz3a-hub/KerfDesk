# E2 — link-route parity (C2 fix verification)

**Question.** After #1751, #1753, #1763, #1818, #1823 and #1762, does every rule that must hold on every output route now reach the Moshiboard USB, Ruida (`.rd` and UDP) and K40 (`.egv` and USB) routes? Can a new link store still skip the shared choke points?

**Tree.** `origin/main` @ `52c545886` (#1827), read-only export `j34-main`. Every fix PR is an ancestor (`418d7cdb2` #1823, `d7e55dd71` #1818, `350bf307d` #1763, `9378658e9` #1762, `b4270beec` #1751, `8fd1b07c1` #1753). All anchors below are `src/…` on that tree.

**Method (lenses L10, L12, L3 twin routes).**
- **Own matrix harness** (`zz-e2/lib.mts`, `m1-matrix.mts`). The same small jobs go through each route's real entry point:
  - G-code: `prepareOutput` → `emitPreparedGcode` + `detectMachineJobWarnings`;
  - Save `.rd`: `emitPreparedRdWithJobWarnings`, as `handleSaveRd` calls it;
  - Ruida UDP: `prepareRuidaNetworkJob(linkJobRequest(…))`;
  - Moshi: `prepareMoshiUsbJob(…)`;
  - Save `.egv`: `emitPreparedEgvWithJobWarnings`;
  - K40 USB: `prepareLihuiyuUsbJob(…, head)`.
- **Decoding.** Output is decoded with this harness's own G-code reader and Ruida byte reader (C35 coordinates, `C9 02` speed records), the repo's `decodeMoshiProgram`, and the repo's `LhyDecoder`. Each K40 move is tagged with the speed code in force, read back with `lhySpeedFromCode`. The dose comes from this file's own `k = mm/turn ÷ (π·D)` model.
- **Store level** (`m2-link-stores.mts`). Each store runs on the repo's simulators (`LihuiyuSimulator` behind the real CH341 opener, `MoshiSimulator`, `RuidaUdpSimulator`), driven by `currentLinkJobRequest()` from the real app store.
- **Enforcement** (`m4-enforcement.mts`). The registration guard's logic is replayed over a copy of `src/ui/state` with mock fourth stores.
- **C2 repros.** All C2 repros were re-pointed at `j34-main`. Scripts whose call shape changed got an `-e2` copy with a shim that maps the old call onto the new API exactly as the new panels call it.
- **Not used:** hardware, live services, pnpm, building, Vitest or a browser.

## Headline

The five fixes hold on the routes they named:
- **The same job now gives the same output on every route.** The canvas scope and anchor, Fill and Image scan offset, Dot width, the overscan laser-off run-up, and kerf/Fill job warnings agree on all six routes. "After completed job" advances on all three link stores (serial 7 → 8 on the simulators).
- **Ruida UDP and K40 USB match their Save twins byte for byte** (Absolute and User Origin, scope on).
- **Every always-mounted guard now sees the K40, Moshiboard and Ruida:** Ctrl+., the job bar, close/Update, session end, tab close, project drop, Machine Setup save, crash ABORT, wake lock, autosave, the unsaved prompt and `refuseDuringJob`.

Every C2 D1/D2/D4/D6 P1 and P2 in scope is fixed on `main`.

What is left is a **K40 copy of the Moshi fixes that copied the mechanism but not the disclosures**:
- **E2-P1-1.** On a Y-port rotary the K40 rounds every burn to whole mm/s, as a Moshiboard must. It does not say what that does to the dose. Round-the-part strokes burn at 17–127 % of the set dose (40–80 % at 120–600 mm/min on an Ø80 glass), with no dose note. The Moshiboard route announces the same band, and K40 speed codes do not need whole mm/s in the first place.
- **E2-P2-1.** The K40 panel shows its job warnings only once Start is sending, the D1-P2-1 shape that #1753 fixed for Moshi and Ruida.
- **E2-P2-2.** The K40 Y-rotary row check is missing. 100 image rows burn as 63 machine rows on an Ø80 glass, while the Moshi route warns on the identical grid.
- **E2-P2-3.** The K40 power note does not name burned tabs.

Structurally, registration is enforced only by a directory-name regex, and the link job request and the job warnings are still opt-in per route. The open JCZ branch (#1725) shows a fourth store skipping all three.

## Rule × route matrix (C2 → now)

Cells: ✓ = the route passes through the shared rule (choke point or a planner shared with G-code); MISSING; n/a = the route refuses the case or has no such output. "C2" gives the cell in D2/D6 (`dcca5b8c4` / `d7e55dd71`); "now" is `52c545886`. "G-code" means grbl 1.1, grblHAL, FluidNC, Marlin and Smoothieware. Their lit geometry hash is identical (`2aed4210`, R7 re-run), as are the rotary F, tab and Fill shares and the Fill reverse sweep.

| # | Rule | G-code (5) | Save `.rd` | Ruida UDP | Moshi USB | Save `.egv` | K40 USB | Evidence (now) |
|---|---|---|---|---|---|---|---|---|
| 1 | Output scope "Selected artwork only" | ✓ → ✓ | ✓ → ✓ | **MISSING (D2-P1-1)** → ✓ `ruida-network-job.ts:37` | **MISSING (D2-P1-1)** → ✓ `moshi-usb-job.ts:36` | ✓ → ✓ | **MISSING (D6-P1-1)** → ✓ `lihuiyu-usb-job.ts:49`, panel `LihuiyuUsbDetails.tsx:80` | M1 T1: every route lights X 20–40 only; Q1-e2 through the real store: Moshi 4 cut steps X 10–40, Ruida 4 records |
| 1b | Anchor from selected artwork | ✓ → ✓ | ✓ → ✓ | MISSING → ✓ | n/a (Absolute only, `moshi-usb-job.ts:33`) | ✓ → ✓ | MISSING → ✓ | M1 T1b: scope off + anchor on gives X 0–100 on all five placed routes; R1-e2 Save/USB hashes equal (`3d76856`) |
| 2 | Rotary surface feed (Y port) | ✓ → ✓ | **MISSING (D2-P1-2)** → ✓ speed classes (#1762, `emit-rd.ts:98`) | MISSING → ✓ (bytes = Save) | copy ✓, announced band → same | **MISSING (D6-P1-2)** → copy, whole mm/s, **band not announced: E2-P1-1** (`lhy-encoder.ts:180`) | same as Save `.egv` | M1 T2, M3(a). G-code 100.1–103.8 %; `.rd` 101.5–101.6 %; Moshi and K40 identical doses (31.8–127 %), only Moshi announces them |
| 3 | Scan offset, Fill (layer + device table) | ✓ → ✓ | n/a (refused) | n/a | **MISSING (D2-P1-3)** → ✓ `moshi-fill-plan.ts:40` | **MISSING (D6-P1-3)** → ✓ `lhy-motion-plan.ts:109` | same | M1 T3: reverse sweep 69.80→49.80 (G-code) / 69.80→49.81 (Moshi, K40), layer and table; Q3-e2 Moshi bytes change with offset |
| 4 | Scan offset, Image | ✓ → ✓ | n/a | n/a | **MISSING (D1-P1-2)** → ✓ `moshi-raster-plan.ts:60` | **MISSING (D6-P1-3)** → ✓ `lhy-motion-plan.ts:142,153` | same | M1 T4: rows 33.30..47.30 / 32.70..46.70 on all three; Q6r Moshi bytes change |
| 5 | Dot width (Image) | ✓ → ✓ | n/a | n/a | **MISSING (D1-P1-2)** → ✓ | **MISSING (D6-P1-3)** → ✓ `lhy-motion-plan.ts:147` | same | M1 T4: lit 33.10–46.90 on all three |
| 6 | Overscan run-up laser-off | ✓ → ✓ | n/a | n/a | **burns run-up (D1-P1-1)** → ✓ | ✓ (no raster before) → ✓ shared planner | same | M1 T4 (overscan 5): lit X 33–47 only; Q1b-e2: "burned outside the dark pixels: 0.0 mm" |
| 7 | Power the route cannot express (tabs, lighter layers, grey, air) | n/a (expressed) | ✓ (tab share 16 % of 80 %, Q8) | ✓ | **MISSING (D2-P2-2)** → ✓ `moshi-power-notes.ts:18` names tabs, mixed layers, air | generic per-layer knob note → same; **tabs not named: E2-P2-3**; no air note (E2-P3-3) | same | M1 T5 |
| 8 | Shared job warnings (`detectMachineJobWarnings`) | ✓ → ✓ | **MISSING (D2-P2-1)** → ✓ `rd-job-warnings.ts:19` | MISSING → ✓ | MISSING → ✓ `moshi-usb-job.ts:50` | **MISSING (D6-P2-1)** → ✓ `egv-job-warnings.ts:24` | MISSING → ✓ | M1 T6: kerf-closed slot and kerf-side-assumed, 1 matching warning on all six; worker `.rd` path also wraps (`output-preparation.ts:108`) |
| 9 | Warnings shown before Start | ✓ (Job Review) | ✓ (toast on save) | **after send (D1-P2-1)** → ✓ from Frame (`ruida-network-store.ts:199`) | **after send (D1-P2-1)** → ✓ from Frame (`moshi-usb-store.ts:203`) | ✓ toast | **only at Start: E2-P2-1** (`lihuiyu-usb-store.ts:243`) | M2(a): Moshi 1, Ruida 1 after Frame; K40 0 after Frame |
| 10 | Variable advance "After completed job" | ✓ | ✓ (export advance) | **MISSING (D2-P2-3)** → ✓ `ruida-network-store.ts:295` | **MISSING (D2-P2-3)** → ✓ `moshi-usb-store.ts:226` | ✓ (export advance) | **MISSING (D6-P2-1)** → ✓ `lihuiyu-usb-store.ts:309` | M2(b): serial 7 → 8 on K40, Moshi and Ruida simulators |
| 11 | Bed bounds and no-go (advisory) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | M1 T7/T7b; K40 repeats identical lines (E2-P3-3) |
| 12 | Rotary row-step check (Fill/Image on Y) | Start ✓ (Job Review) | n/a | n/a | **MISSING (Z4-P2-1)** → ✓ `moshi-usb-job.ts:53` | **MISSING: E2-P2-2** | **MISSING: E2-P2-2** | M3(b): 63 burned rows for 100 on both; Moshi warns, K40 0 |
| 13 | Frame permit (NN 21) | ✓ coordinate identity | n/a | bbox only (D2-P3-1) → same | bbox only → same | n/a | bbox only (`lihuiyu-usb-store.ts:265-270`) | READ; KNOWN D2-P3-1 still open |
| 14 | Ctrl+. | ✓ | n/a | **MISSING (D1-P2-5)** → ✓ | **MISSING** → ✓ (Q3-e2 estop written) | n/a | **MISSING (D4-P1-1)** → ✓ during Frame/Start/pause; **no-op while homing/jogging: E2-P3-1** | `use-job-shortcuts.ts:99-100`; A1 re-run: K40 job → phase stopping, reset sent |
| 15 | Job bar (Live Motion, link) | ✓ | n/a | MISSING → ✓ | MISSING → ✓ | n/a | MISSING → ✓ (ABORT MOTION no-op while homing/jogging: E2-P3-1) | `LinkMachineWorkBar.tsx:28,52`, mounted `App.tsx:131` |
| 16 | Close / Update | ✓ | n/a | MISSING (D1-P2-3) → ✓ | MISSING → ✓ | n/a | MISSING (D4-P1-1) → ✓ | `desktop-close-runtime.ts:37,83`; R9 and A1 re-runs: Update reply `cancelled` |
| 17 | Windows session end | ✓ | n/a | ✓ | ✓ | n/a | MISSING → ✓ | `desktop-session-end.ts:60`; R2 (D4r) re-run `jobWouldBeCutOff = true` |
| 18 | Browser tab close (unload stop) | ✓ | n/a | ✓ | ✓ | n/a | MISSING → ✓ | `desktop-close-controller.ts:231-235` via snapshot `active`; D4r R2: 1 board reset on `beforeunload` |
| 19 | Project drop / restore | ✓ | n/a | ✓ | ✓ | n/a | MISSING → ✓ | `dropped-project-open.ts:23`, `restore-local-snapshot.ts:75`; A1: `jobActive = true` |
| 20 | Machine Setup save | ✓ | n/a | ✓ | ✓ | n/a | MISSING → ✓ | `use-machine-setup-save.ts:54,60` (READ) |
| 21 | Crash-screen ABORT | ✓ | n/a | **MISSING (D4-P2-2)** → ✓ | MISSING → ✓ | n/a | MISSING → ✓ | `crash-recovery.tsx:30,44`; A4 re-run: `isMotionLive = true`, ABORT present; D4r R2 K40 `true` |
| 22 | Wake lock | ✓ | n/a | **MISSING (D4-P2-1)** → ✓ | MISSING → ✓ | n/a | MISSING → ✓ | `use-active-job-wake-lock.ts:47,58`; A3 re-run: Moshi and K40 hold 1 |
| 23 | Autosave job gate | ✓ | n/a | **MISSING (D6-P2-2)** → ✓ | MISSING → ✓ | n/a | MISSING → ✓ | `use-autosave.ts:113-115` (READ; D6r R2's own gate model is stale) |
| 24 | Unsaved "Leave site?" prompt | ✓ | n/a | ✓ | **wrong order (D4-P2-3)** → ✓ | n/a | ✓ | `use-unsaved-changes-guard.ts:42`; D4r R3: prompt false while a link job runs |
| 25 | `app-dialogs` `refuseDuringJob` | ✓ | n/a | **laser only (D6-P3-4)** → ✓ | → ✓ | n/a | → ✓ | `app-dialogs.ts:30` |
| 26 | Guided first job | ✓ | n/a | **never moves on (D6-P2-3)** → ✓ | → ✓ | n/a | → ✓ | `use-first-job-signals.ts:35-36,52,64-68` (READ; the D6r R5 harness reads the old signals) |
| 27 | Laser finish position | ✓ | MISSING (D2-P3-3) → same | same | same | MISSING | MISSING | READ: no `laserFinish` under `io/rd`, `io/moshi`, `io/egv`, `core/controllers` |
| 28 | Twin byte identity | — | Save = UDP ✓ | ✓ | n/a (no file) | Save stream = USB ✓ | ✓ | M1 T8: `.rd` `e9c2c504` = UDP (Absolute), `fd1969ba` (User Origin); `.egv` stream `c503d7c8` = USB, `03d76856` |

Rows 2–12 of C2's table that were already ✓ (start power, compile-integrity refusals, A/Z refusal, origin corner, layer order, leads, Focus Test refusal, tab geometry) were not re-driven beyond the jobs above. Nothing in the fixes touched them.

## Enforcement check

| Question | Answer | Evidence |
|---|---|---|
| Is `LinkMachineSource` derived from something that forces registration? | **Partly.** The type comes from a hand-kept `as const` list (`link-machine-work.ts:17,19`), not from the stores. The only check is a source-text test (`link-machine-work-sources.test.ts:16-31`). It looks for `<dir>/<dir>-store.ts` under folders ending in `-usb` or `-network`, then regex-matches `reportLinkMachineWork('…'`. | M4 replay over mock fourth stores: `galvo-link/…` and `jcz-serial/…` **pass unreported**. `jcz-usb/galvo-usb-store.ts` (the #1725 layout) fails only on ENOENT. A `jcz-usb-store.ts` that "reports" in a comment is counted as reporting. |
| Is the link job request a required parameter? | **No.** Each builder picks its own signature; the three current ones take a `LinkJobRequest` by convention. Each store's job type has `completed?` optional (`lihuiyu-usb-types.ts:40`, `moshi-usb-types.ts:28`, `ruida-network-store.ts:57`), so a job built without a request compiles and silently skips the variable advance. | READ. #1725's `prepareGalvoUsbJob(project, placement)` compiles with `lmcPreparationOptions({})`: no scope. |
| Are job advisories computed in core behind `PreparedOutput`? | **No.** They are still per route, in three UI-side calls: `rd-job-warnings.ts:19`, `egv-job-warnings.ts:24` and inline `moshi-usb-job.ts:50`. The core `emitPrepared*` functions return without them: R5 and Q4 re-run on `emitRdFile` and `emitPreparedMoshiJob` still give 0. The route test (`link-job-routes.test.ts`) lists the three existing routes by name. | READ + R5/Q4 re-runs. #1725's `galvo-usb-job.ts` calls no `detectMachineJobWarnings`. |
| Mock fourth store | Done as a Node replay of the guard (no Vitest), over a copy of `src/ui/state` (deleted after). No compile check exists to fail. | `out/m4-enforcement.txt` |

**JCZ (#1725, OPEN, head `b80bd0f05`).** If merged as it stands, its route skips every link choke point:
- the request: it takes `(project, placement)`;
- the scope: it uses `lmcPreparationOptions({})`;
- the job warnings and `completed`;
- the registry: `galvo-usb-store.ts` never calls `reportLinkMachineWork`.

The branch already holds #1818's sources test, which fails it only because `jcz-usb/jcz-usb-store.ts` does not exist. Its CI is red, including "Unit tests (1/4)". Renaming the folder to anything not ending in `-usb` would pass the guard. Out of scope here except as this note.

## Findings

### E2-P1-1 — K40 Y-port rotary: every burn is rounded to whole mm/s, and the dose that results is never announced (Moshi announces the same band)

- **Where:**
  - `src/core/controllers/lihuiyu/lhy-encoder.ts:158-161,180` (`matchedMmPerSec` returns `Math.max(1, Math.round(feed / 60))`);
  - `src/io/egv/egv-advisories.ts:177-182` (the only rotary note: "change speed N times … the head stops");
  - the twin is `src/core/controllers/moshi/moshi-job-encoder.ts:173` ("strokes burn between X % and Y % of the set dose").
- **Anchor:**
  - ADR-127 Amd 2 (the layer Speed is the speed on the part);
  - ADR-703 Amd 1 D3 ("as G-code and the Moshiboard match it");
  - twins D6-P1-2, D2-P1-2, Z3-P1-2 (all P1).
- **Evidence:** **REPRO** `m3-k40-rotary.mts` → `out/m3-k40-rotary.txt`; `m1-matrix.mts` T2. Decoded `.egv` speed codes, own k model. Dose on 20 mm strokes round the part:

  | Chuck 40 mm/turn | Set mm/min | G-code | Moshi (announced) | K40 `.egv` / USB (not announced) |
  |---|---|---|---|---|
  | Ø80 glass (k 0.159) | 120 | 100.5 % | 31.8 % | **31.8 %** |
  | Ø80 | 200 | 102.7 % | 53.1 % | **53.1 %** (X strokes 111 %) |
  | Ø80 | 300 / 600 | 101.6 / 100.5 % | 79.6 % | **79.6 %** |
  | Ø80 | 900 | 100.2 % | 119.4 % | **119.4 %** |
  | Ø150 bowl (k 0.085) | 120 / 300 / 900 | ~101 % | 17.0 / 42.4 / 127.3 % | **17.0 / 42.4 / 127.3 %** |

  - The K40 advisories are the knob note and "on the rotary its strokes change speed 3 times … the head stops at each change". Nothing names a dose.
  - Rotary Setup says only "sets each stroke's speed … in whole mm/s" (`RotarySetupHost.tsx:24-27`).
  - A K40 speed code takes fractional mm/s: non-rotary layers already send `group.speed / 60` unrounded (`lhy-encoder.ts:145`), and `lhySpeedCode` accepts any positive float. So the rounding copies a Moshiboard limit the K40 does not have.
  - The C2 harnesses that still report 15.9 % (D6r R1-e2, D2r Q2-e2) assume one speed code per layer. Read per move, the K40 runs 2.000 mm/s on the Y strokes, which is 79.6 %, not 15.9 %. D6-P1-2 itself is fixed.
- **Scenario:** a K40 owner engraves a name round a tumbler on a chuck at 300–600 mm/min. The vertical strokes get 80 % of the energy of the horizontal ones, and at 120–200 mm/min only 32–53 %. On a wider bowl it is 17–42 %. Letters come out uneven or faint. Nothing tells them; the Moshi route would.
- **Severity:** P1. Silent wrong dose on the part (METHOD §3, no reach clause), in the class of D6-P1-2 and Z3-P1-2. The coordinator may weigh the Rotary Setup "whole mm/s" line as a partial announcement; it never states a dose, so it is not "a clear warning … before the output".
- **Announced?** No dose text. A generic "whole mm/s" sentence appears in Rotary Setup.
- **Novelty:** New, introduced by #1823's port of the Moshi rule.
- **Fix direction:**
  - drop the whole-mm/s rounding on the K40 and send `feed / 60` as it is (the speed code is continuous);
  - or reuse Moshi's `rotaryDose` band and advisory, ideally as one core "rotary feed runs + dose band" helper that both encoders call (D2 recommendation 4);
  - add a decoded test at 120–600 mm/min on k ≈ 0.16, not only the k = 2 rectangle in `lhy-route-planners.test.ts`.

### E2-P2-1 — The K40 panel shows the job's warnings only once Start is sending (D1-P2-1's K40 twin)

- **Where:**
  - `src/ui/state/lihuiyu-usb/lihuiyu-usb-store.ts:240-246` sets `advisories: frame ? [] : job.advisories`, and the Frame finish keeps them empty (`:296-307`);
  - the panel lists `board.advisories` only (`LihuiyuUsbDetails.tsx:62-68`);
  - the registry and bar get the same empty list during the Frame.
  - The twins set them from the Frame on: `moshi-usb-store.ts:201-203`, `ruida-network-store.ts:198-199` ("The job's warnings show from its Frame on (code quality audit C2 D1-P2-1)").
- **Anchor:** D1-P2-1 (P2), fixed by #1753 for Moshi and Ruida. ADR-705 Amd 3. Rule 7 / ADR-228 (findings inform before output).
- **Evidence:** **REPRO** `m2-link-stores.mts` → `out/m2-link-stores.txt`, part (a). The same project has a part past the bed.
  - The K40 job carries 3 advisories ("X out of bed" ×2, knob note).
  - After a completed Frame the store holds **0**.
  - Moshi after Frame: 1. Ruida after Frame: 1.
- **Scenario:** a K40 job with a kerf slot that closed up ("will NOT be cut") or art past the bed. The operator Frames, sees no warning, and presses Start. The warning appears as the packets stream.
- **Severity:** P2, as D1-P2-1.
- **Announced?** No.
- **Novelty:** New; the K40 was not in D1-P2-1's fix.
- **Fix direction:** set `advisories: job.advisories` for the Frame as Moshi and Ruida do, and keep them after the Frame finishes. Better, put "advisories shown from Frame" into a shared link-run helper so a fourth store inherits it.

### E2-P2-2 — K40 Y-rotary Fill and Image rows land on whole 1/1000 in steps with no row check (Z4-P2-1's K40 twin)

- **Where:** `src/ui/state/lihuiyu-usb/lihuiyu-usb-job.ts:65` (advisories: export plus job warnings only). The Moshi job adds `detectRotaryRowGridWarnings(project, prepared.job, MOSHI_ROW_GRID)` (`moshi-usb-job.ts:53`). Save `.egv` (`save-egv-action.ts`) has no row check either.
- **Anchor:** ADR-315 Amd 1–3, ADR-705 Amd 2 (v14 Z4-P2-1, P2).
- **Evidence:** **REPRO** `m3-k40-rotary.mts` part (b). A 10 × 10 mm dark image at 10 lines/mm on the Creality chuck:

  | Rotary | Route | Burned rows (of 100) | Surface gap | Row advisories |
  |---|---|---|---|---|
  | Ø80 (k 0.159) | Moshi | 63 | 0.160 mm | 1 |
  | Ø80 (k 0.159) | K40 `.egv` / USB | 63 | 0.160 mm | **0** |
  | Ø150 (k 0.085) | Moshi | 34 | 0.299 mm | 1 |
  | Ø150 (k 0.085) | K40 `.egv` / USB | 34 | 0.299 mm | **0** |

  - Rows that land on an occupied machine row burn twice.
  - `detectRotaryRowGridWarnings` run on the same K40 job with the K40's grid (39.3701 per mm, equal to `MOSHI_ROW_GRID`) returns the warning ("one K40 position … turns the part 0.1596 mm, and the 0.1000 mm line interval is 0.63 steps").
- **Scenario:** a K40 photo or Fill round a glass bands, and some rows burn twice. The Moshi route would have said so and offered intervals that fit.
- **Severity:** P2, as Z4-P2-1 (a disclosure; the program commands the rows it can).
- **Announced?** No.
- **Novelty:** New (K40 twin).
- **Fix direction:** call `detectRotaryRowGridWarnings` with a `K40_ROW_GRID` from inside `emitPreparedEgvWithJobWarnings`, so Save `.egv` gets it too. Long term, the route's position grid belongs in a driver capability that the shared advisory step reads.

### E2-P2-3 — The K40 power note does not name burned tabs (D2-P2-2's K40 twin)

- **Where:** `src/io/egv/egv-advisories.ts:168-175`. It gives one note for every layer whose part power is below 100 %. The Moshi twin `moshi-power-notes.ts:21-30` names the tabs.
- **Anchor:** ADR-494 burned tabs; D2-P2-2 (P2), fixed for Moshi by #1763.
- **Evidence:** **REPRO** `m1-matrix.mts` T5.
  - Tabs at 20 % on an 80 % or a **100 %** layer burn 160.02 of 160 mm lit at the knob's power.
  - The only text is "The M2 board has no software power control … so layer L runs below 100 % burn at the knob's power", even for a layer set to 100 %.
  - The Moshi route says the tabs "burn at the machine's dial power and cut through. Set the tab power to 0 %".
- **Scenario:** a K40 user sets burned tabs to hold parts. Every tab cuts through, and parts drop mid-job. The note reads as the usual knob reminder, and for a 100 % layer it is wrong about which layer is below 100 %.
- **Severity:** P2, by D2-P2-2's precedent (a generic, not tab-specific, note). The coordinator may lower it to P3, since this note is per job and names the layer.
- **Announced?** Generically.
- **Novelty:** New (K40 twin).
- **Fix direction:** one capability-driven "power this route cannot express" note shared by Moshi and K40 (D2 recommendation 5). Name tab spans separately from layer power.

### E2-P3-1 — Ctrl+. and the link bar's ABORT MOTION do nothing while the K40 homes or jogs

- **Where:**
  - the K40 reports `homing` and `jogging` as link work (`lihuiyu-usb-store.ts:397-404`), but its `abort` returns at once unless the phase is framing, running or paused (`:356-360`);
  - Ctrl+. picks `link.abort` (`use-job-shortcuts.ts:99-100`) and prevents the default;
  - the bar shows "ABORT MOTION" (`LinkMachineWorkBar.tsx:52`).
- **Evidence:** **REPRO** `m2-link-stores.mts` (c). During a 10 mm jog and during Home, Ctrl+. is handled, the phase does not change, the bar's abort is a no-op, and **0** board resets are sent.
- **Severity:** P3. Jogs are 1 or 10 mm, and Home is one command, so there is little motion left to stop. But a stop control that silently does nothing breaks the "Abort always works" expectation, and the Moshi abort does cover homing.
- **Fix direction:** either send the reset (`I`) in homing and jogging too, or stop reporting an `abort` for activities the store cannot stop.

### E2-P3-2 — A new link store can still skip the registry, the link job request and the job warnings

- **Where:**
  - `link-machine-work-sources.test.ts:16-31`, keyed on the folder name;
  - `link-machine-work.ts:17`, a hand list;
  - `completed?` optional in all three job types;
  - job warnings at three UI call sites (`rd-job-warnings.ts:19`, `egv-job-warnings.ts:24`, `moshi-usb-job.ts:50`).
- **Evidence:** **REPRO** `m4-enforcement.mts` (see the enforcement check). READ of #1725's `galvo-usb-job.ts` and `galvo-usb-store.ts`.
- **Severity:** P3 (structural). It is what let D4-P1-1 and D6-P1-1 happen, and #1725 shows it is about to happen again.
- **Fix direction:**
  - a `LinkStoreModule` registry type that every link store must export, with the source list derived from it;
  - the store's `start` taking a `LinkJob` whose `completed` and `advisories` are required and built only by one `buildLinkJob(request, emit)` helper that runs `detectMachineJobWarnings`;
  - or, closer to D2 recommendation 2, compute the warnings in core inside every `emitPrepared*`.
  - Widen the test to every `src/ui/state/*/*-store.ts` that imports a transport.

### E2-P3-3 — The K40 copies of per-route helpers: a third preflight adapter that repeats identical lines, and no air note

- **Where:**
  - `io/egv/egv-preflight.ts:17-47` is a third copy of `rd-preflight.ts` and `moshi-preflight.ts` (D2-P3-2). Relabelling "Line N" as "Layer L" turns distinct findings into identical strings: M1 T7 shows "Layer L: X out of bed: 310.007" twice on Save `.egv` and K40 USB. Both lists use the text as the React key (`LihuiyuUsbDetails.tsx:65`, `LinkMachineWorkBar.tsx:44`).
  - Moshi gained an air-assist note (`moshi-power-notes.ts:46`); the K40 has none (D2-P3-3's twin).
- **Severity:** P3.
- **Fix direction:** D2 recommendation 7, one `runMotionPreflight(project, steps, frame)` that de-duplicates; the air note joins the shared capability notes.

### E2-P3-4 — Header comments still describe a two-link world

- **Where:**
  - `link-job-request.ts:2` ("The Moshi USB and Ruida network panels build …");
  - `LinkMachineWorkBar.tsx:2` ("a Moshiboard over USB or a Ruida over the network");
  - `link-machine-work.ts:2-3`.

  The K40 uses all three.
- **Severity:** P3 (D6-P3-6 class: comments that would tell a reviewer the K40 is not covered).
- **Fix direction:** name the K40, or better, "every link store in `LINK_MACHINE_SOURCES`".

## KNOWN — status of every C2 item in scope

| C2 item | Fix | Status on `52c545886` | Evidence |
|---|---|---|---|
| D1-P1-1 Moshi raster burns run-up | #1751 | **Fixed** | Q1/Q1b-e2: 0.0 mm burned outside dark pixels at overscan 5; R1: overscan 2 burns art only |
| D1-P1-2 Moshi raster Dot width + scan offset | #1751 | **Fixed** | Q6r: bytes change; M1 T4 matches G-code |
| D1-P2-1 Moshi/Ruida warnings only after send | #1753 | **Fixed** for Moshi and Ruida; **K40 twin open: E2-P2-1** | R4: warnings after Frame; M2(a) |
| D1-P2-2 Ruida fast Frame never counts | #1753 | **Fixed** | R5 and Q2-e2: 250/380 ms Frames finish and Start sends ("short frame" message) |
| D1-P2-3 close/Update/drop/Setup ignore links | #1753 (+#1818 for K40) | **Fixed** | R9: Update `cancelled` during a Moshi job; A1: same for K40; READ Setup save |
| D1-P2-5 no always-reachable Abort | #1753 (+#1818) | **Fixed** for jobs and Frames; K40 home/jog gap **E2-P3-1** | Q3-e2: Ctrl+. writes the estop; A1: K40 `stopping`, reset sent |
| D1-P3-1 Moshi Connect leak | #1751 | **Fixed** | R10, Q5-e2: device closed |
| D2-P1-1 scope on Moshi/Ruida UDP | #1763 | **Fixed** | M1 T1/T1b; Q1-e2 through the real store |
| D2-P1-2 `.rd`/UDP rotary feed | #1762 | **Fixed** (dose 101.5–101.6 %; E1 covered the bands) | M1 T2; UDP bytes = Save |
| D2-P1-3 Moshi Fill scan offset | #1763 | **Fixed** | Q3-e2: Moshi program `c266924e4e` with 0.6 mm vs `cd1a595315` without; M1 T3 |
| D2-P2-1 job warnings on `.rd`/UDP/Moshi | #1763 | **Fixed** (still per route: E2-P3-2) | M1 T6; Q4-e2: UDP 1, Moshi 1 |
| D2-P2-2 Moshi tabs/score power | #1763 | **Fixed** for Moshi; **K40 twin E2-P2-3** | Q6-e2; M1 T5 |
| D2-P2-3 variable advance on Moshi/Ruida | #1763 | **Fixed** | M2(b): 7 → 8 on both (Q5-e2 still shows 7 because its hand-built job carries no `completed`; harness artefact) |
| D2-P3-1 bbox-only Frame permits | — | **Open**, and the K40 has the same shape | READ `lihuiyu-usb-store.ts:265-270` |
| D2-P3-2 rule copies | #1763 (Fill runway) | **Fill runway fixed** (shared `planFillSweeps`); preflight adapter now **3 copies** (E2-P3-3) | READ |
| D2-P3-3 silent no-ops | #1763 (Moshi air) | **Moshi air note added**; laser finish still dropped on `.rd`/UDP/Moshi/K40; K40 air silent | READ |
| D2-P3-5 Ruida rotary note | #1762 | Fixed (E1) | — |
| D4-P1-1 K40 invisible to guards | #1818 | **Fixed** | A1, D4r R2: registry, Ctrl+., drop guard, Update, session end, crash, keep-awake, unload all see the K40 |
| D4-P2-1 keep-awake | #1818 | **Fixed** | A3: Moshi and K40 hold 1 |
| D4-P2-2 crash ABORT | #1818 | **Fixed** | A4: `isMotionLive = true`, ABORT present |
| D4-P2-3 unsaved prompt order | #1818 | **Fixed** | D4r R3: no prompt during a link job |
| D4-P3-1 K40 link not closed on failure | #1818/#1823 | **Fixed** | A2, D4r R4: `close()` called once, device closed |
| D6-P1-1 K40 USB scope | #1823 | **Fixed** | M1 T1/T1b/T8; D6r R1-e2 (Save and USB hash `3d76856`) |
| D6-P1-2 K40 rotary feed | #1823 | **Fixed in mechanism** (2 speed codes, Y strokes matched); **new E2-P1-1** on the rounding | M1 T2, M3 |
| D6-P1-3 K40 scan offset / Dot width | #1823 | **Fixed** | K2: `.egv` `b26680f5` → `811b37ea` with offset; D6r R1-e2 Image hashes change; M1 T3/T4 |
| D6-P2-1 K40 warnings + variable advance | #1823 | **Fixed** | M1 T6; M2(b) 7 → 8 |
| D6-P2-2 autosave gate | #1823 | **Fixed** | READ `use-autosave.ts:113-115` (D6r R2's harness models the old gate; not a re-measure) |
| D6-P2-3 guided first job | #1823 | **Fixed** (READ) | `use-first-job-signals.ts:35-36,52`; D6r R5(b) reads the old signals |
| D6-P3-4 `refuseDuringJob` | #1823 | **Fixed** | `app-dialogs.ts:30` |
| D6-P3-6 lying comments | #1823 | **Fixed** for the three named; three more stale headers in **E2-P3-4** | READ |
| D4-P3-2, D4-P3-3, D1-P2-4, D6-P3-1/2/3/5/7/8 | — | Out of E2's scope (E1/E3 or non-link) | — |

## Refuted

- **"D6-P1-2 still burns 15.9 %"**, which the re-run D6r R1-e2 and D2r Q2-e2 print. Both harnesses apply the layer's first speed code to every burn. Per-move decoding shows 2.000 mm/s on the Y strokes of the K40 and `187.92` mm/min `.rd` records. The real doses are 79.6 % (K40, E2-P1-1) and 101.6 % (`.rd`).
- **"D2-P2-1 still 0 advisories on Save `.rd`"** (Q4-e2, R5). Those harnesses call the core `emitRdFile` / `emitPreparedRdFile`. The app's Save `.rd`, its worker path and UDP all go through `emitPreparedRdWithJobWarnings` and carry the warning (M1 T6). This feeds E2-P3-2 as structure, not as a defect.
- **The K40 45° rotary dose** (M5): the decoder splits a diagonal into stair-step pieces, so no per-piece dose is claimed for diagonals on the K40.
- **k > 1 "roller" rows in M3** use a k model that is wrong for a roller (the object turns with the roller's diameter, not its own). All three routes agree there, so no finding.

## Verified clean

- **Scope and anchor parity** on all six routes; Moshi correctly refuses non-Absolute placement.
- **Byte identity:** Ruida UDP = Save `.rd`, and K40 USB stream = Save `.egv` stream (two placements, scope on).
- **Fill and Image parity** with G-code on Moshi and K40: scan offset (layer and table), Dot width, overscan laser-off.
- **G-code family:** five dialects give lit hash `2aed4210` (R7 re-run). G-code, `.rd` and Moshi split the scan offset ±half; the K40 matches.
- **Job warnings** on all six routes (kerf closed-up, kerf-side-assumed); bed and no-go on all six.
- **Variable advance** on all three link stores, not after a Frame (M2; `lihuiyu-usb-store.ts:309` runs only for `job`).
- **Every machine-work guard** listed in rows 14–26 sees all three link stores.
- **`.rd` tab share** 16 % of 80 % (Q8); **Ruida wrap limit** and bed advisories (Q8).

## Not verified

- Hardware, for any route: K40 speed-code timing and diagonal speed; whether a K40 speed change really stops the head; Ruida rotary semantics.
- Vitest and a browser: none run. Panel rendering (the duplicate React keys of E2-P3-3, and the K40 panel before Start) is READ plus store state.
- The guided first job, the autosave gate and Machine Setup save are READ only. Their C2 harnesses model the old reads.
- `main-is-green` on #1725 reports "main is red … on ce6b843". That is E3's area and not checked here.
- C2 rows 3, 6, 8, 19–24 of D2's table (start power, compile refusals, A/Z refusal, origin, layer order, leads, tab geometry) were not re-driven.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-e2\`. Run with `node --no-experimental-webstorage --import ./register.mjs <file>` from that folder (or from the sub-folder for the C2 copies).

| File | Covers | Output |
|---|---|---|
| `register.mjs`, `ts-resolve.mjs` | Loader from `zz-d6r`, pointed at `j34-main` | — |
| `lib.mts` | Builders; own G-code and Ruida readers; Moshi and K40 decode with speeds; one runner per route | — |
| `m0-smoke.mts` | Route smoke test | console |
| `m1-matrix.mts` | T1 scope/anchor, T2 rotary dose, T3 Fill offset, T4 Image, T5 power notes, T6 job warnings, T7 bed/no-go, T8 twin bytes | `out/m1-matrix.txt` |
| `m2-link-stores.mts` | Store level: warnings at Frame (E2-P2-1), variable advance, K40 home/jog abort (E2-P3-1) | `out/m2-link-stores.txt` |
| `m3-k40-rotary.mts` | E2-P1-1 dose table, E2-P2-2 rows | `out/m3-k40-rotary.txt` |
| `m4-enforcement.mts` | Registration-guard replay over mock fourth stores (the `mut` copy was deleted after) | `out/m4-enforcement.txt` |
| `m5-k40-diag.mts` | K40 diagonal decode (refuted note) | `out/m5-k40-diag.txt` |
| `zz-d1\`, `zz-d1r\`, `zz-d2\`, `zz-d2r\`, `zz-d4\`, `zz-d4r\`, `zz-d6\`, `zz-d6r\` | C2 repros re-pointed at `j34-main`. `*-e2.mts` are shimmed copies for the changed `prepare*Job` signature. Some store scripts end on a hanging window-close `prepare()` (exit 124) after printing their results | `<dir>\out\` |

No security findings.

```json
{
  "area": "E2",
  "tree": "52c545886",
  "findings": [
    {"id": "E2-P1-1", "severity": "P1", "title": "K40 Y-rotary rounds every burn to whole mm/s; dose 17-127 % round the part, unannounced (Moshi announces the band)", "where": ["src/core/controllers/lihuiyu/lhy-encoder.ts:180", "src/io/egv/egv-advisories.ts:177-182"], "evidence": "REPRO m3-k40-rotary.mts, m1-matrix.mts T2", "novelty": "new (introduced by #1823)"},
    {"id": "E2-P2-1", "severity": "P2", "title": "K40 panel shows job warnings only once Start is sending (D1-P2-1 twin)", "where": ["src/ui/state/lihuiyu-usb/lihuiyu-usb-store.ts:243"], "evidence": "REPRO m2-link-stores.mts (a)", "novelty": "new (K40 twin)"},
    {"id": "E2-P2-2", "severity": "P2", "title": "K40 Y-rotary Fill/Image rows on the 1/1000 in grid with no row check (Z4-P2-1 twin): 63 rows for 100", "where": ["src/ui/state/lihuiyu-usb/lihuiyu-usb-job.ts:65"], "evidence": "REPRO m3-k40-rotary.mts (b)", "novelty": "new (K40 twin)"},
    {"id": "E2-P2-3", "severity": "P2", "title": "K40 power note does not name burned tabs; says a 100 % layer runs below 100 % (D2-P2-2 twin)", "where": ["src/io/egv/egv-advisories.ts:168-175"], "evidence": "REPRO m1-matrix.mts T5", "novelty": "new (K40 twin)"},
    {"id": "E2-P3-1", "severity": "P3", "title": "Ctrl+. and link bar ABORT MOTION are no-ops while the K40 homes or jogs", "where": ["src/ui/state/lihuiyu-usb/lihuiyu-usb-store.ts:356-360,397-404"], "evidence": "REPRO m2-link-stores.mts (c)", "novelty": "new"},
    {"id": "E2-P3-2", "severity": "P3", "title": "A new link store can skip registry (folder-name regex), link job request (optional completed) and job warnings (per-route UI calls); #1725 does", "where": ["src/ui/state/link-machine-work-sources.test.ts:16-31", "src/ui/state/link-machine-work.ts:17"], "evidence": "REPRO m4-enforcement.mts; READ #1725", "novelty": "new (structural)"},
    {"id": "E2-P3-3", "severity": "P3", "title": "Third preflight adapter copy repeats identical advisories (React keys on text); K40 has no air note", "where": ["src/io/egv/egv-preflight.ts:17-47"], "evidence": "REPRO m1-matrix.mts T7; READ", "novelty": "extends D2-P3-2 / D2-P3-3"},
    {"id": "E2-P3-4", "severity": "P3", "title": "Header comments of link-job-request, LinkMachineWorkBar and link-machine-work omit the K40", "where": ["src/ui/state/link-job-request.ts:2", "src/ui/laser/LinkMachineWorkBar.tsx:2", "src/ui/state/link-machine-work.ts:2"], "evidence": "READ", "novelty": "new (D6-P3-6 class)"}
  ],
  "known_status": {
    "fixed": ["D1-P1-1", "D1-P1-2", "D1-P2-1 (Moshi/Ruida)", "D1-P2-2", "D1-P2-3", "D1-P2-5", "D1-P3-1", "D2-P1-1", "D2-P1-2", "D2-P1-3", "D2-P2-1", "D2-P2-2 (Moshi)", "D2-P2-3", "D4-P1-1", "D4-P2-1", "D4-P2-2", "D4-P2-3", "D4-P3-1", "D6-P1-1", "D6-P1-2 (mechanism)", "D6-P1-3", "D6-P2-1", "D6-P2-2", "D6-P2-3", "D6-P3-4", "D6-P3-6"],
    "open": ["D2-P3-1", "D2-P3-2 (preflight copies)", "D2-P3-3 (laser finish)"]
  },
  "refuted": ["D6r/D2r harness 15.9 % rotary dose (single-speed assumption)", "Save .rd 0 advisories (harness calls core emitRdFile)", "K40 45° dose (decoder stair-steps)", "roller k model"],
  "jcz_1725": "open; as written skips scope, link job request, job warnings, completion and registry; guard fails only by ENOENT on the folder layout",
  "counts": {"raised": 8, "P1": 1, "P2": 3, "P3": 4, "known": 3}
}
```

Auditor counts: raised 8, P1 1, P2 3, P3 4, known 3

## Refuter (2026-11-12)

**Tree and harness.** Same read-only export `j34-main` (`origin/main` @ `52c545886`). Own scripts in `zz-e2r\`, run with `node --no-experimental-webstorage --import ./register.mjs <file>` (loader copied from `zz-e2`). The auditor's `lib.mts` was read for API shape only; nothing imports it.
- **Own `.egv` reader** (`egv.mts`): own LHYMicro-GL tokeniser (directions, `M` diagonals, `D`/`U`, `z` / 3-digit / `|x` / letter distances, `S1E`/`S1P`/`FNSE-`). It also has its own speed formula for `CV` codes on M2 with suffix C (value = 65536 − (1010·T + 8), T in ms per 1/1000 in). It does not use the repo's `LhyDecoder` or `lhySpeedFromCode`.
- **Own G-code reader** for the parity runs, and **own chuck model** k = mm/turn ÷ (π·D). Dose = set surface speed ÷ actual surface speed, where actual = machine stroke length ÷ step time, scaled by hypot(dx, dy/k) ÷ machine length.
- **Stores:** the real K40 and Moshi stores on the repo simulators (`LihuiyuSimulator` behind `lihuiyuUsbOpener`, `MoshiSimulator`), driven from the real app store with `currentLinkJobRequest()`. The K40 panel (`src/ui/lihuiyu-usb/LihuiyuUsbDetails.tsx`) and `useFirstJobSignals` were rendered with `react-dom/client` in jsdom.
- **Registration guard:** its logic is replayed over mock `state` trees, built from the three real store files plus one mock fourth store.
- **Not used:** hardware, real USB, serial or network; live services (`gh` was not queried); pnpm; building; Vitest; a browser.

### Verdicts

| Finding | Verdict | Evidence (own) |
|---|---|---|
| E2-P1-1 | **CONFIRMED, P1** | R1, R6 |
| E2-P2-1 | **CONFIRMED, P2** | R2 (store and rendered panel) |
| E2-P2-2 | **CONFIRMED, P2** (Fill too, not only Image) | R3 |
| E2-P2-3 | **CONFIRMED, P2** | R4 |
| E2-P3-1 | **CONFIRMED, P3** | R7 (c) |
| E2-P3-2 | **CONFIRMED, P3** | R5; `git show b80bd0f05` |
| E2-P3-3 | **CONFIRMED, P3** | R2 (React duplicate-key warning), R4 (no air note) |
| E2-P3-4 | **CONFIRMED, P3** | READ |

**E2-P1-1: CONFIRMED P1.**
- **Own decode (R1).** Stock K40 M2 profile (maxFeed 8400), with a letter "H" made of separate strokes.
  - Ø80 / 40 mm per turn (k 0.159): Y strokes run 1.000 / 1.000 / 2.000 / 3.000 mm/s at 120 / 300 / 600 / 1200 mm/min. That is **31.8 / 79.6 / 79.6 / 106.1 %** of the set dose. X strokes stay at 100 %.
  - Ø150 (k 0.085): **17.0 / 42.4 / 84.9 / 84.9 / 106.1 %** at 120 / 300 / 600 / 1200 / 3000 mm/min.
  - At 3000 mm/min or more on Ø80 the dose is within 0.5 %.
  - The auditor's figures match. The ≥ 100 % side (106 % at 1200 mm/min) was not in its table.
  - Save `.egv` and K40 USB streams are byte-identical.
  - The Moshi twin of the same job says: "strokes burn between 80 % and 100 % of the set dose …".
- **The K40 says nothing at all here.** With separate strokes, `rotarySpeedChanges` counts only changes made inside program mode (`lhy-encoder.ts:160`, `writer.inProgram`). So for this job even the "change speed N times" note is absent. Save `.egv` and USB advisories: none.
  - When that note does appear, it reads "to keep the surface speed" (`egv-advisories.ts:34`). That reassures; it does not warn.
- **Is the rounding needed? No.**
  - Own read-back of `lhySpeedCode` (M2, suffix C): 0.4, 0.5, 0.796, 1.25, 1.59, 2.5 and 5 mm/s all come back within 0.01 %. 10 mm/s comes back within 0.02 %, and 50 and 100 mm/s within 0.2 %.
  - A flat layer at 125 mm/min decodes at 2.0833 mm/s, so the encoder already sends fractional mm/s (`lhy-encoder.ts:145`).
  - ADR-703 Amendment 1, Decision 3, gives no K40 reason. It says only that each burn runs "at the whole mm/s … as G-code and the Moshiboard match it", and G-code does not round.
  - Rounding does reduce the number of distinct speed codes (head stops), but no document gives that as the reason.
- **Correction to the fix direction.** The speed code is not continuous all the way down. Below 0.3915 mm/s the code's value clamps to 0 (`lhy-speed-code.ts:90`), and asking for 0.2 / 0.3 / 0.318 mm/s all give 0.3915 mm/s (R1). So dropping the rounding still leaves an under-dose at slow rotary speeds:
  - Ø80 at 120 mm/min wants 0.318 mm/s: about 81 %;
  - Ø150 at 120 mm/min wants 0.17 mm/s: about 43 %.
  - Either fix needs a dose note for the floor (see the new E2-P1-2).
- **Does Rotary Setup's "whole mm/s" sentence count as an announcement? No.**
  - It is shown in a setup dialog, not before output.
  - It states the mechanism, not a dose. It says KerfDesk "sets each stroke's speed for the part's surface" (`RotarySetupHost.tsx:24-27`), which tells the operator the dose is kept.
  - Under METHOD §3 (G6 clarification), the app must name the specific mismatch before output.

**E2-P2-1: CONFIRMED P2.** Real store plus the rendered panel (R2):
- The job carries 2 advisories ("X out of bed" ×2).
- Before the Frame, during the Frame and after a completed Frame: 0 in the store, 0 in the registry, and **0 `<li>` in the panel's "Job warnings" list**.
- They appear only at Start ("running": 2 items).
- The Moshi store holds the job's 1 advisory after its Frame.
- No other K40 surface shows them before Start: the panel calls `board.start` directly, with no Job Review.

**E2-P2-2: CONFIRMED P2.** Own reader (R3), counting distinct machine-Y burn rows for 100 surface rows at 0.1 mm:
- Ø80: **63 Image and 63 Fill**. Theory gives 0.627 steps per row, so about 63.
- Ø150: **34 and 34**.
- K40 USB is the same stream. The K40 has no row text; the Moshi twin warns on both Image and Fill ("… is 0.63 steps").
- Fill was not in the auditor's evidence; it has the same gap.

**E2-P2-3: CONFIRMED P2.** Own reader (R4), 40 mm square with 4 × 3 mm tabs at 20 %:
- The groups are `cut@100, cut@20(tab 20)` and `cut@80, cut@16(tab 20)`.
- **Lit 160.02 of 160 mm**, so the tabs burn at the knob's power.
- The only text is the generic knob note, which says layer L "runs below 100 %" even when L is set to 100 %.
- With tabs at 100 % plus air: no text at all.
- Moshi names the tabs in both cases.

Kept at P2, not P3: the note is per job and names the layer, but for a 100 % layer it is wrong about which power is below 100 %, and it never says the tabs cut through. Not P1: it does tell the operator that layer L's sub-100 % burns run at the knob.

**E2-P3-1: CONFIRMED P3.** Own run (R7 c):
- During a 10 mm jog and during Home, the registry reports `jogging` / `homing`.
- Ctrl+. calls `preventDefault`, but the phase does not change.
- `work.abort()` is a no-op, and **0 board resets** are sent.
- Motion is at most 10 mm or one `IPP`, so P3 stands.

**E2-P3-2: CONFIRMED P3.** Own guard replay (R5) of `link-machine-work-sources.test.ts:16-31`:
- The baseline passes.
- **These pass with a fourth store that never reports:**
  - `galvo-link/galvo-link-store.ts`;
  - `jcz-serial/jcz-serial-store.ts`;
  - `galvo-usb-store.ts` directly under `state/`;
  - `jcz-usb/jcz-usb-store.ts` whose only "call" is in a comment, with its id added to the list.
- `jcz-usb/galvo-usb-store.ts` (the #1725 layout, confirmed with `git show b80bd0f05`) fails only on ENOENT.
- `jcz-usb/jcz-usb-store.ts` that does not report fails, as intended.
- A real store that moves its `reportLinkMachineWork` call into a helper file fails falsely.
- At `b80bd0f05`, `galvo-usb-store.ts` has no `reportLinkMachineWork`, and `galvo-usb-job.ts` calls `prepareOutput(project, lmcPreparationOptions({}))` with no `detectMachineJobWarnings`.
- `LinkJobRequest.completed` is required in the request type (`link-job-request.ts:21`), but each job type's copy is optional. The auditor's point stands.

**E2-P3-3: CONFIRMED P3.**
- R2 shows `"Layer L: X out of bed: 315.011 (bed position)"` twice in one job.
- Rendering the K40 panel raised React's "Encountered two children with the same key" warning.
- R4 shows no air note on the K40 while Moshi gives one.

**E2-P3-4: CONFIRMED P3** (READ).
- `link-job-request.ts:2-3`: "The Moshi USB and Ruida network panels".
- `LinkMachineWorkBar.tsx:2`: "a Moshiboard over USB or a Ruida over the network".
- `link-machine-work.ts:2`: names ADR-697 and ADR-705 only.

### Matrix spot-checks (own decode)

| Cell | Result | Evidence |
|---|---|---|
| Row 5, K40 Image Dot width | ✓ | R8: 4 mm dark band at X 43–47; G-code lit 43.100..46.900 with 0.2 mm; K40 43.104..46.888 (1/1000 in grid) |
| Row 4, K40 Image scan offset ±half | ✓ | R8: G-code → 43.2..47.2 / ← 42.8..46.8; K40 → 43.205..47.193 / ← 42.799..46.812; combined case also matches |
| Row 6, K40 Image overscan laser-off | ✓ | R8: lit span unchanged with 3 mm overscan |
| Row 1b, Moshi anchor | n/a, correct | R8: Moshi refuses User Origin and Current Position with `MOSHI_ABSOLUTE_ONLY` |
| Row 1b/28, K40 User Origin + anchor | ✓ | R8: front-left and center, USB stream = Save `.egv`; lit box placed relative to the head as anchored |
| Row 1, UDP scope (Frame too) | ✓ | R6: with scope "B only", the UDP footprint = Save `.rd` footprint (X 200–230 mm, B only) and the bytes are equal; K40 footprint also shrinks to B (150.01–180.01 mm) |
| Row 23, autosave job gate | ✓, driven | R7: `activeLinkMachineWork() !== null`, the link half of `use-autosave.ts:113-115`, is false when idle, true during the K40 Frame and job, false after. The snapshot function itself is not exported, so it was not called. The gate also holds during a Frame, jog or Home, which is harmless. |
| Row 26, guided first job | ✓, driven | R7: hook rendered against the K40 store. Before connect `connected` is false; after connect true; after the Frame `framedReady` is true and `jobStarted` false (a Frame is not a job); during the job `jobStarted` is true and stays latched |
| Row 10, variable advance | ✓ | R2: K40 completed job serial 41 → 42; K40 abort mid-job and unplug mid-job stay put; Moshi abort mid-job stays put |

No ✓ cell checked was wrong.

### New findings

**E2-P1-2: a K40 layer slower than 23.49 mm/min burns at 23.49 mm/min, unannounced (the K40 twin of ADR-705 Amd 5's said Moshi speed steps).**
- **Where:**
  - `src/core/controllers/lihuiyu/lhy-speed-code.ts:90` (`Math.max(0, 65536 − (m·T + b))` clamps the code at the board's slowest period);
  - `src/io/egv/egv-advisories.ts` has no speed note.
  - The layer Speed input allows 1 mm/min (`src/ui/layers/CutSettingsCommonFields.tsx:43`, `min={1}`).
- **Anchor:**
  - ADR-127 Amd 2 (the layer Speed is the speed);
  - twin: ADR-705 Amendment 5 / O8-P2-1 (the Moshi flat-bed speed step is said).
  - The Moshi route at 12 and 20 mm/min says "0.2 mm/s runs at 1 mm/s (20 % of the set dose)" and "0.33 mm/s … (33 %)".
- **Evidence:** **REPRO** `r9-k40-slow.mts` → `out/r9-k40-slow.txt`, own reader. Set 6 / 12 / 20 mm/min gives a decoded burn of 23.49 mm/min each, a dose of **26 / 51 / 85 %**, with no speed text. 23.5 mm/min and above are exact.
- **Scenario:** a K40 owner sets a very slow cut or a deep mark below 23.5 mm/min. The board runs it up to 4× faster, at a quarter to 85 % of the energy, and nothing says so.
- **Severity:** P1 by METHOD §3: silent wrong dose, and there is no reach clause. Reach is very narrow: only layer speeds under 23.5 mm/min on a K40. The Moshi precedent O8-P2-1 was rated P2, so the coordinator should reconcile the two.
- **Announced?** No.
- **Novelty:** New. `docs/audits` on `main` and in this worktree have no match for the floor. Open PRs were not queried.
- **Fix direction:** one K40 speed note shared with E2-P1-1's dose band: below 0.3915 mm/s, name the speed the board runs and the dose. Or refuse speeds the board cannot run, as a range check in `groupRefusal`.

### Probes with no gap (new-gap search)

- **Z and A rotary** on Save `.egv`, K40 USB and Moshi are all refused, with "The rotary is set to the Z axis, which KerfDesk cannot write for a lihuiyu controller…" and the same for A and for Moshi (R6).
- **K40 passes (3), Fill cross-hatch, Fill at 45°, and 2 passes with a 90° angle step:** lit lengths and direction splits match G-code within 0.15 % (1/1000 in rounding) (R6).
- **Ruida network Frame scope** follows "Selected artwork only" (R6).
- **The variable advance does not fire on abort or unplug** (R2).

### Not verified

- Hardware for any route. In particular, whether the K40's 0.3915 mm/s floor and the speed code's timing hold on a real M2 board.
- MeerK40t's own low-speed handling (`fix_lows`). The source was not fetched, so any claim that MeerK40t floors at the same value is UNVERIFIED.
- The K40 M3-pwm stream: the own reader does not parse `AT1` binary packets, so M3-pwm rows were not decoded. That profile expresses power anyway.
- The autosave snapshot function itself (not exported); only its link input was driven.
- Machine Setup save, Update/close, session end and crash ABORT (rows 16–22) were not re-driven.
- Whether #1725 is still open or has moved past `b80bd0f05`: no `gh` query.
- Vitest and a browser: none run.

### Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-e2r\`.

| File | Covers | Output |
|---|---|---|
| `register.mjs`, `ts-resolve.mjs` | Loader (copied from `zz-e2`, pointed at `j34-main`) | — |
| `egv.mts` | Own LHYMicro-GL reader and speed formula | — |
| `r1-k40-rotary.mts` | E2-P1-1 doses, speed-code resolution and floor, flat fractional speed, USB = Save, Moshi text | `out/r1-k40-rotary.txt`, `.json` |
| `r2-k40-store.mts` | E2-P2-1 (store and rendered panel), E2-P3-3 duplicate keys, variable advance on complete, abort and unplug | `out/r2-k40-store.txt` (stderr `out/r2.err`) |
| `r3-k40-rows.mts` | E2-P2-2, Image and Fill, Ø80 and Ø150 | `out/r3-k40-rows.txt` |
| `r4-k40-tabs.mts` | E2-P2-3, E2-P3-3 air | `out/r4-k40-tabs.txt` |
| `r5-guard-replay.mjs` | E2-P3-2 guard replay (mock tree created and deleted inside `zz-e2r`) | `out/r5-guard-replay.txt` |
| `r6-new-gaps.mts` | Z/A refusal, passes, cross-hatch, 45°, angle step, Ruida and K40 Frame scope | `out/r6-new-gaps.txt` |
| `r7-k40-guards.mts` | Guided first job hook, autosave gate input, E2-P3-1 | `out/r7-k40-guards.txt` |
| `r8-spot.mts` | Dot width, scan offset, overscan, Moshi placement, K40 User Origin anchors | `out/r8-spot.txt` |
| `r9-k40-slow.mts` | E2-P1-2 plus the Moshi twin | `out/r9-k40-slow.txt` |

```json
{
  "area": "E2",
  "role": "refuter",
  "tree": "52c545886",
  "verdicts": [
    {"id": "E2-P1-1", "verdict": "CONFIRMED", "severity": "P1", "evidence": "REPRO r1 (own .egv reader, own k): 31.8/79.6/79.6/106.1 % at 120/300/600/1200 mm/min on D80; K40 says nothing for separate strokes; lhySpeedCode resolves fractional mm/s to <0.2 %; ADR-703 Amd 1 D3 gives no K40 reason; Rotary Setup line is not an announcement", "note": "fix direction must also cover the 0.3915 mm/s code floor"},
    {"id": "E2-P2-1", "verdict": "CONFIRMED", "severity": "P2", "evidence": "REPRO r2: 0 store advisories and 0 rendered panel items before/during/after Frame, 2 at Start; Moshi 1 after Frame"},
    {"id": "E2-P2-2", "verdict": "CONFIRMED", "severity": "P2", "evidence": "REPRO r3: 63/100 (D80) and 34/100 (D150) rows on Image and Fill; K40 0 row texts; Moshi warns"},
    {"id": "E2-P2-3", "verdict": "CONFIRMED", "severity": "P2", "evidence": "REPRO r4: tabs at 20 % burn 160.02/160 mm; only generic knob note, wrong for a 100 % layer; none for 100 % tabs"},
    {"id": "E2-P3-1", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO r7: Ctrl+. handled, 0 resets during jog and Home"},
    {"id": "E2-P3-2", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO r5: 4 non-reporting layouts pass; #1725 layout fails only on ENOENT; git show b80bd0f05"},
    {"id": "E2-P3-3", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO r2 (React duplicate-key warning), r4 (no air note)"},
    {"id": "E2-P3-4", "verdict": "CONFIRMED", "severity": "P3", "evidence": "READ"}
  ],
  "new": [
    {"id": "E2-P1-2", "severity": "P1", "title": "K40 layer speeds below 23.49 mm/min run at 23.49 mm/min (26-85 % dose), unannounced; Moshi twin announces its floor", "where": ["src/core/controllers/lihuiyu/lhy-speed-code.ts:90", "src/io/egv/egv-advisories.ts", "src/ui/layers/CutSettingsCommonFields.tsx:43"], "evidence": "REPRO r9-k40-slow.mts", "novelty": "new; precedent O8-P2-1 (Moshi, rated P2) for the coordinator to reconcile"}
  ],
  "spot_checks": {"K40 Image Dot width": "ok", "K40 Image scan offset": "ok", "K40 overscan": "ok", "Moshi anchor (n/a, refuses)": "ok", "K40 User Origin anchors USB=Save": "ok", "UDP scope incl. Frame footprint": "ok", "autosave gate input (driven)": "ok", "guided first job (driven)": "ok", "variable advance (complete/abort/unplug)": "ok"},
  "no_gap_probes": ["Z/A rotary refused on K40 and Moshi", "K40 passes", "K40 cross-hatch", "K40 Fill 45 deg", "K40 pass angle step", "Ruida network Frame scope"],
  "counts": {"raised": 9, "refuted": 0, "P1": 2, "P2": 3, "P3": 4, "known": 3}
}
```

Refuter counts: raised 9, refuted 0, P1 2, P2 3, P3 4, known 3
