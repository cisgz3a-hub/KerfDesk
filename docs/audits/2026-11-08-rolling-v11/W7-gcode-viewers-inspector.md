# Rolling audit v11 — G-code viewers, Inspector and Run (W7 `gcode-viewers-inspector`)

- **When:** 2026-11-09   **Tree:** main @ `a3965a77d` (repro tree: scratchpad `j11-main`, an export of that SHA). Main is now `f4d18e348`, which differs only by the Electron-main changes of #1628; nothing in this area changed.
- **Scope:**
  - **G-code Inspector and Run on machine:** `src/ui/gcode-inspector/**` (Run dialog, external-run Frame and Start, readiness, bed and Z-top checks, burn preview, worker), `src/core/external-program/**` (normalizer, review, lit rapids, storage refusals, Z lifts, bit files), `src/core/gcode-view/**` (render model, placement, arcs, Program Health).
  - **Start from line:** `src/ui/laser/StartFromLineControl.tsx`, `start-job-flow.ts:306-327` (`runStartFromLineFlow`), `src/core/controllers/grbl/resume-program.ts`, `laser-resume-reentry.ts`.
  - **Parity twins followed:** project Start (`start-job-flow.ts`, `start-job-readiness-policy.ts`, `cnc-start-advisories.ts`), the Frame builder (`laser-frame-motion-plan.ts`, `cnc-frame-lines.ts`), `confirmCncSetup`, `runStartJob` (`laser-job-actions.ts`).
  - **Governing ADRs:** ADR-630 and Amds 1–8, ADR-255 and Amds 1–3, ADR-425, ADR-432 (resume plane), ADR-364, ADR-485, ADR-491 Amd 3 (Z top), ADR-565, ADR-341 Amd 10.
  - **L8 (merged since 2026-10-21 in these paths):** #1368 `fbe7268df` (G18/G19 arcs in the Frame, ADR-630 Amd 2); `bca30e71d` (Smoothieware `M221 S100` baseline, Amd 3); #1390 `faf9ab2f7` (`$30`/`$32` readiness and lit rapids, Amd 4); #1410 `ca3dbeb79` (shell/file/stored-program refusals, Amd 5); `ac6253ff5` (WCS and Work-Z records dropped, Amd 6); `74178e099` (FluidNC/grblHAL expressions, M1 per firmware, Amd 7); `c9c9331f1` (Start from line numbering); #1473 `d2acacdbe` (connected `$30` in the Run review); #1477 `f730f5b03` (bit files); #1492 `1058af31b` (Z-top lifts); #1567, `839c6d8fb`, `7763eece0`, `cdc92a2fc`, `56384ec68` (small touches: tests, live-progress columns, CSS, timing). Amendment 8 (`G43`/`M61` void Work Z) was read, not re-run.
- **KNOWN, not re-raised (per the brief):** V7-P3-1 (no "Before you start" block on Inspector Run, recovery resume, Start from line, camera target engrave); V9-P3-2 (Intel graphics travel overdraw against ADR-425).
- **Lenses run:**
  - **L9 (parity with Start):** every Job Review / preflight item of a project Start, laser and CNC, checked against the Run review and the external Frame and Start.
  - **L3 (twins):** the Frame envelope against an independent reading of GRBL arcs (G17/G18/G19 orientation, G91, G20, R and I/J/K); the Inspector's opened-file view against the Run review's stock-GRBL reading; burn preview against GRBL laser power; review text against the controller it is connected to.
  - **L4:** malformed numbers (exponent, `+`, leading/trailing dot, double sign, `NaN`, `Infinity`, hex, 400-digit words), binary and UTF-16 input, nested and unclosed comments, controller-specific words (G5, G51, G7, G64, M62, G65, G81 with `L`, G2 `P`, G90.1, G43.1, `#` and `[ ]`).
  - **L6 / large files:** the Run dialog's main-thread work at 500k and 1M lines.
  - **L8:** as listed in Scope.
  - **L2:** no new source was fetched. Ground-truth claims reuse the GRBL sources pinned in ADR-630's amendments and earlier reports; grblHAL claims are anchored on KerfDesk's own ADR text or marked UNVERIFIED.
  - **L1, L7:** light (ADR-630 clauses; the own-output gate's coverage).
- **Repros:** Node 25 with the real TypeScript modules through the esbuild transform hook (`zz-w7/register.mjs`, `ts-resolve.mjs`, copied from `zz-w4`). Run from scratchpad `zz-w7/` with `node --import ./register.mjs <script>.mts`.
  - `chain.mts`: the Run dialog's own chain (normalize with the connected controller's baseline → `inspectGcodeText` with `deviceInspectionContext`, `boundsFromStart` and the head position → `reviewExternalProgram` with Program Health's findings → `prepareExternalRun`), plus `view()` for the opened-file Inspector.
  - `b1.mts` → `b1.out.txt` (controller-specific words), `b2.mts` → `b2.out.txt` (status of the v2 findings), `b3.mts` → `b3.out.txt` (arc planes, expressions, M6), `b4.mts` → `b4.out.txt` (malformed numbers), `p34.mts` → `p34.out.txt`, `sfl.mts` → `sfl.out.txt` (Start from line), `big.mts` → `big.out.txt` / `big1m.out.txt` (large-file timing).
  - Focused Vitest in `j11-main` with `--maxWorkers=1` at 2.7 GB available: `external-run-arc-planes.test.ts`, `src/core/external-program/**`, `resume-program.test.ts`, `resume-program.transform.test.ts`, `external-run.controller-readiness.store.test.ts`, `external-run-z-top.test.ts`: 13 files, 238 passed.
  - No browser was run.
- **Counts:** 2 raised → 0 refuted (auditor; refuter PENDING) → P1 0 / P2 1 / P3 1. KNOWN: 21 earlier findings in the status table (v2 26: 10 raised + 11 KNOWN), of which 3 are fixed, 4 partly fixed, 10 still open, 4 not re-checked. No security finding.

## Headline

**The external Run is now a careful sender.** Since rolling v2 the Run review gained the controller readiness checks, lit-rapid naming, shell/file refusals, expression refusals, Z-top lifts and arcs in every plane. Against an independent reading of GRBL the Frame outline held for G17/G18/G19 arcs in both senses, G91 with G20, R and I/J/K forms, and helices; every controller-specific word KerfDesk does not model (G5, G51, G7, G64, M62, A, `L`, G90.1, G43.1) is named as "not in this review or the Frame outline"; every malformed number either matches GRBL's reading or is warned as a block stock GRBL rejects. On the L9 lens no project-Start guard that would stop a harmful burn is missing from Run: the CNC Frame itself refuses without a current Work Z zero, and the workholding attestation names probe hardware. Start from line rebuilds units, distance, WCS, feed mode, plane, air, spindle mode, feed and position correctly on KerfDesk-shaped raster and arc output, with the beam off until a burn move.

**The one ordinary-user defect is speed.** The Run dialog re-runs the whole review of the program on the UI thread on every render, unmemoized: 1.5 s at 500k lines and 3.0 s at 1M lines. One of those renders lands as the head starts its Frame motion, so a stop pressed in the first seconds of a large file's Frame waits for it (W7-P2-1). The other new item is wording: the Run review tells grblHAL and FluidNC operators that M6 and canned cycles stop with an error, which describes stock GRBL only (W7-P3-1).

## Findings

### W7-P2-1 — The Run dialog rebuilds the whole review on the UI thread on every render (1.5 s per 500k lines), including when the head starts its Frame

- **Where:**
  - `src/ui/gcode-inspector/RunGcodeFileDialog.tsx:104-124`: `prepareExternalRun(…, (gcode) => reviewExternalProgram(gcode, …))` runs inline in `InspectExternalRun`'s render, with no `useMemo`. `prepareExternalRun` calls the review every time (`prepare-external-run.ts:31`).
  - `src/core/external-program/external-program-review.ts:130-176`: `reviewExternalProgram` scans the whole sent program several times on the calling thread: `grblReviewText` splits and checks every line (`:197-207`), `commandsIn` re-scans every line (`:255-274`), `externalProgramZLifts` splits it again (`program-z-lifts.ts:35-50`).
  - What re-renders `InspectExternalRun`: `useLiveRunStart()` (`RunGcodeFileDialog.tsx:74`), whose selector `startKey` returns null whenever the controller is not Idle (`use-external-program.ts:72-73`); the pinned start (`:75-77`), set when Frame is clicked (`RunGcodeFileControls.tsx:68`); the Frame record (`:73`); and the parent's `arming` state set at Start (`RunGcodeFileDialog.tsx:38`, `RunGcodeFileControls.tsx:87`).
- **Anchor:**
  - **Contract:** ADR-630 "What is sent": the normalized bytes "are parsed and timed again by the cancellable Inspector worker", and "A large file is normalized a slice of lines at a time so the dialog stays responsive" (`docs/decisions/ADR-630-run-external-gcode-file.md:19`). The normalizer yields every 20,000 lines (`use-external-program.ts:20,35`) and the parse is in the worker, but the review of the same bytes then runs whole on the UI thread, repeatedly.
  - **Twin / precedent:** performance S1-P2-1 (a whole-program rebuild on the main thread during a job delayed Abort by 1.2–1.4 s; refuter raised it to P1) and S1-P2-2 (Start preparation blocking 1–5 s), both fixed by moving or slicing the work. The Run dialog was not in that audit.
- **Scenario:** A LightBurn photo engrave or a Fusion 3D finish saved as a 500k-line file (14 MB) is opened and **Run on machine…** is chosen.
  1. Each time the head comes to rest somewhere new, the worker re-reads the program (2.2 s off-thread), then the dialog renders and the review blocks the UI for about 1.5 s.
  2. **Frame** is clicked: the pinned start re-renders the dialog (1.5 s block), then the Frame's jogs begin. At the first status report in `Jog`, `startKey` turns null, `useLiveRunStart` changes, and the dialog renders again: another 1.5 s block while the head is moving. A stop pressed then (ABORT on the Live Motion bar, the Frame's only stop) is handled only after it. When the head returns to Idle and when the Frame record arrives, two more blocks follow.
  3. **Start** sets `arming` on the parent, which re-renders the dialog again: a further block while Start prepares the controller.
  At 1M lines (29 MB) each block is about 3.0 s.
- **Evidence:** REPRO (compute) + READ (render path).
  - `node --import ./register.mjs big.mts 500000` (`zz-w7/big.out.txt`): normalize 1,181 ms (sliced in the app), worker inspect 2,228 ms, **`reviewExternalProgram` 1,482 ms**, `findLitRapids` 549 ms (memoized per mount), `assertGcodeFitsController` 47 ms.
  - `big.mts 1000000` (`big1m.out.txt`): inspect 4,360 ms, **review 2,973 ms**, lit rapids 1,072 ms.
  - The render path is read, not run in a browser: `startKey` returns null for any non-Idle state, so a `$J=` Frame (`Jog`) changes `useLiveRunStart`'s value and re-renders `InspectExternalRun`; the pinned start keeps the worker source unchanged (`RunGcodeFileDialog.tsx:82-95`), so the render goes straight to the inline review.
- **Severity:** P2. A large program is ordinary (photo engraves and 3D finishing passes reach hundreds of thousands of lines), and the dialog freezes several times per Frame with nothing on screen saying why. The block during the Frame delays a stop of a beam-off move by up to the block's length; that is less than S1-P2-1's beam-on case, so it stays P2. Not verified: whether the Idle→Run status report can reach the still-mounted dialog before Start closes it. `runStartJob` resolves once the first window is sent (`laser-job-actions.ts:169-177`), then `startUntrackedRun` awaits the recovery retirement (`untracked-start-retirement.ts:31-36`) before `onStarted` closes the dialog. If that report wins the race, the same block lands at the start of a beam-on stream from the window; that would make it P1 by S1-P2-1's precedent, and the refuter should measure it in a browser.
- **Novelty:** Not in the performance audit S1 (Preview and Start preparation only) or in any earlier report on ADR-630 (`grep` of `docs/audits` for the Run dialog with "main thread", "UI thread", "freez" or "responsive"). No open PR touches the area.
- **Refuter:** PENDING.
- **Fix direction:** Memoize the review on the program bytes, the inspection result and the context, so a re-render that changes none of them reuses it. Better, run `reviewExternalProgram` in the Inspector worker beside the parse that already happens there, and return the review with the model.

### W7-P3-1 — The Run review tells grblHAL and FluidNC operators that M6 and canned cycles stop with an error, which is stock GRBL's behaviour

- **Where:**
  - `src/core/external-program/external-program-review.ts:123-127`: the M6 warning is always "Stock GRBL does not support M6 and stops with an error there.", whatever the connected controller.
  - `src/core/gcode-view/finding-checks.ts:219-223`: the canned-cycle finding always says "GRBL does not implement canned cycles — this program will not run as-is on a GRBL controller." It reaches the Run review as a warning (`external-program-review.ts:161-163`).
  - `src/ui/gcode-inspector/gcode-inspector-parse.ts:74`: only `grbl-v1.1` gets `stockGrbl`, so for grblHAL and FluidNC the parser expands G81 and frames its holes as moves the controller makes.
- **Anchor:**
  - **Contract:** ADR-630 Amendment 5, "Not in this decision": "grblHAL's `M6` can run a stored `tc.macro`. A tool change is ordinary CNC work, so it stays a review warning" (`ADR-630-amendment-5-refuse-shell-and-file-commands.md:68`). The decision keeps the warning because grblHAL runs M6; the warning's text says the job stops.
  - **Twin:** the parser treats a grblHAL program's G81 as motion it runs (it is framed), while the finding beside it says the program will not run. The per-firmware M1 wording of ADR-630 Amendment 7 (`program-stops.ts:21-24`) is the pattern the M6 text does not follow.
  - **Ground truth:** for grblHAL's `$341` tool-change modes and FluidNC's M6, UNVERIFIED in this audit (no source fetched). Controller audit v4 E3 cites the grblHAL core wiki page "Manual, semi-automatic and automatic tool change" for `$341` modes 0–4 (`docs/audits/2026-10-22-controller-v4/E3-ctl-cnc-routines.md:42`).
- **Scenario:** A grblHAL router opens a Fusion program with `T2 M6`. The Run review says "Stock GRBL does not support M6 and stops with an error there." On grblHAL the tool change runs (by ADR-630 Amd 5), and with a tool-change mode that moves the head, the review does not say the head moves somewhere the Frame did not trace. The same grblHAL program with `G81` drilling gets "this program will not run as-is on a GRBL controller", while the Frame traced the holes as moves that run.
- **Evidence:** REPRO. `b3.mts` (`zz-w7/b3.out.txt`): the `grblhal M6 T2` and `fluidnc M6 T2` cases both get the stock-GRBL M6 text. `b1.mts` (`b1.out.txt`): `grblhal G81 drill` frames X 0..30 and still says the program will not run as-is.
- **Severity:** P3. The words are wrong for two controllers KerfDesk supports, but every case still gets a warning, and the head's tool-change motion goes to the machine's own configured place. Wording drift, not a wrong output.
- **Novelty:** Controller v4 E4 tabled the M6 text as right for stock GRBL (`E4-ctl-external-normalize.md:69`). Meta v1 M4-P3-8 / rolling v3 G4-K-1 cover a grblHAL or FluidNC board behind a GRBL *profile*. This is the correct grblHAL or FluidNC profile.
- **Refuter:** PENDING.
- **Fix direction:** Word the M6 and canned-cycle warnings per controller kind, as `programStopWarnings` does for M1. On grblHAL and FluidNC, say that the controller performs the tool change and its moves are not in the Frame outline.

## Status of earlier findings (rolling v2 report 26)

| ID | v2 severity | Status on `a3965a77d` | Evidence |
|---|---|---|---|
| 26 P2-1 (P3) | P3 (latent) | **Still open, still latent.** `Cnc3DPane` is still not mounted (`App.tsx:115` keeps it out); `viewer3d-live-run.ts:51,55` unchanged. | READ |
| 26 P3-1 | P3 | **Partly fixed.** The skipped-motion warning now says "line N of the sent program" (ADR-630 Amd 2 item 4, `external-program-review.ts:227`). Other Program Health warnings in the review still give sent-program line numbers with no qualifier: a file with a two-line comment header and a blank line has its cut at file line 5 and its `M3` at file line 7, and the review says "line 3 … line 5". | REPRO `b2.out.txt` |
| 26 P3-2 | P3 | **Still open.** Opened-file burn preview: `M4 S800 / G1 X10 / M5 / G1 X20 / G1 Y10` burns lines [1,3,4] (0-based) against [1] as a laser; `G1 X10 S800` with no M3 burns [0,1] against []. | REPRO `b2.out.txt` |
| 26 P3-3 | P3 | **Still open** (read): `gcode-inspection-source.ts:100-110` still draws `machineBoundsForDevice` with no `jobOriginOffset`. | READ |
| 26 P3-4 | P3 | **Still open, shape changed.** A 402-digit `I` leaves 1,436 non-finite coordinates in the model; the bounds are now finite. Through the Run chain the arc is dropped with no "could not read" warning, and the review frames a point ("zero XY extent"). Hostile input only. | REPRO `b2.out.txt`, `p34.out.txt` |
| 26 P3-5 | P3 | **Still open in the opened-file view** (`G1 X1 0 F100` → "This does not look like G-code"; with a second move, `junk-line`). The Run review reads the canonical `G1X10`. | REPRO `b2.out.txt` |
| 26 P3-6 | P3 | **Not re-checked** (maintainer decision; no change to `CanvasGcodeView.tsx` since 2026-10-21). | — |
| 26 P3-7 | P3 | **Still open, latent** (read): `use-gcode-inspection.ts:101-114` still rebuilds a blob source without `laser` or `openedFile`. | READ |
| 26 P3-8 | P3 | **Still open:** `own-output-clean.test.ts:97-112` still has one laser cut per strategy and one CNC job. | READ |
| 26 P3-9 | P3 | **Still open in the Inspector's own view** (`G38.2` drawn as rapids, `rapid-plunge`, `rapid-through-material`). The Run review names probes as not in the Frame outline (ADR-630 Amd 1), but on FluidNC it still also lists the false "Rapid plunge below Z0". | REPRO `b2.out.txt`, `b1.out.txt` |
| 26 K-1 (WA-4) | P2 | **Fixed** by #1368 (ADR-630 Amd 2). G18 and G19 arcs, both senses, G91 with G20: the Frame envelope and Z bounds match an independent GRBL reading (`G18 G2 X10 Z0 I5 K0` dips to Z−5, `G3` rises to Z+5, `G19 G2 Y10 Z0 J5 K0` rises to Z+5). | REPRO `b3.out.txt`; Vitest `external-run-arc-planes.test.ts` passes |
| 26 K-2 (PV-3) | P3 | **Partly fixed.** For the Run Frame, `G10`/`G92`/`G28` are placed correctly (ADR-630 Amd 1, `render-model-placement.ts`). Open: the Inspector's own view keeps its old reading (by design, `render-model-placement.ts:5-6`), and `G43.1 Z-5` is still drawn as a rapid to Z−5 even in the Run review, which then warns "Rapid plunge below Z0" (the resume rewriter already treats `G43.1` as axis-consuming, `laser-resume-reentry.ts:65`). | REPRO `b1.out.txt` |
| 26 K-3 | P3 | **Partly fixed.** With stock GRBL connected the Run review skips `G2 X10 Y0 R4.95` and says why; the opened-file view still draws it. | REPRO `b2.out.txt` |
| 26 K-4 (PV-4) | P3 | **Partly fixed.** The Run review on stock GRBL names blocks GRBL rejects whole (`grblBlockRejection`): arc errors, `E`, `X--5`, `NaN`. The opened-file view does not. | REPRO `b4.out.txt` |
| 26 K-5 | P3 | Not re-checked. | — |
| 26 K-6 (09-P2-1) | P2 | **Unchanged in the Inspector** (read): CNC timing still takes `device.maxFeed` (`program-timing-options.ts:49` through `deviceInspectionTiming`). | READ |
| 26 K-7 | P3 | Not re-checked (no desktop run). | — |
| 26 K-8 (05-P3-1) | P3 | **Fixed:** `startUntrackedRun` retires the recovery card once the external program may have reached the controller (`untracked-start-retirement.ts:26-37`, ADR-341 Amd 10). | READ |
| 26 K-9 (18-P3-2) | P3 | **Still open, now warned:** `G28 X100 Y100` after `G0 X10 Y10` frames X 0..10; the review says only that the stored position cannot be traced, not the intermediate point. | REPRO `b1.out.txt` |
| 26 K-10 | P3 | Not re-checked. | — |
| 26 K-11 | P3 | Not re-checked (outside this area's files). | — |

## Refuted

Candidates the auditor dropped before raising:

- *An external CNC Run starts without the project's "No work zero is set" check.* No. The CNC Frame refuses without a current Work Z zero (`cnc-frame-lines.ts:68-70`, `CNC_FRAME_WORK_Z_REQUIRED_MESSAGE`), and Start needs that Frame and checks that the Work Z evidence is unchanged (`start-job-authorization.ts:133-134` through `controllerStartPreparationStillCurrent`).
- *The touch plate left after a probe is not mentioned before an external CNC Start.* Covered: the CNC attestation every CNC Start asks lists "probe hardware, leads" (`cnc-setup-attestation.ts:8`).
- *A CNC external Run on Marlin or Smoothieware.* Refused at Frame (`cnc-frame-lines.ts:65-67`), as project Start says `CNC_REQUIRES_GRBL_MESSAGE`.
- *Rotary on, external program framed with the rotary transform.* The Frame builder applies no rotary transform (`laser-frame-motion-plan.ts:22-80`), and the program runs its raw Y, so the Frame and the run agree.
- *Start from line forgets G17 when resuming at a modal arc-continuation line.* The plane pin scans the tail before `restoreModalMotion` inserts the `G3` (`resume-program.ts:302`; repro `sfl.out.txt`, arcs from line 11). Not reachable: Start from line replays only KerfDesk's own program, whose preamble selects `G17` whenever it writes arcs (ADR-432, lines 100-101) and whose arcs always carry `G2`/`G3`. Dropped as unreachable rather than raised as latent.
- *Malformed numbers frame something GRBL does not run.* Each case matched GRBL or was warned: `X1e2` and `X--5` as blocks stock GRBL rejects, `X0x10` refused as a repeated word (error:25), `X+5`, `X.5`, `X5.` read as GRBL reads them, a NUL refused (`b4.out.txt`).
- *A nested comment `(a (b) c)` sends text the review did not read.* The normalizer ends the comment at the first `)`, as GRBL does, sends `G1X10c)F100`, and the review warns stock GRBL rejects that block.

## Verified clean

- **Run parity with project Start (L9):** `$30`/`$32` readiness in Job Review's words, the lit-rapid scan, the laser acknowledgement under the same condition, the CNC attestation with reduced overrides, Work Z through the CNC Frame, line-length and controller-fit refusals before Frame, bed and no-go outline warnings, Z-top lifts, units, program stops per firmware, the start-mark and Idle blocks (`jogFrameCommandBlockMessage`), the final handoff checks (session, origin, head, machine mode).
- **Frame envelope accuracy:** G17/G18/G19 arcs, both directions, R and I/J/K, helices with `P`, G91 with G20, G53, G92, G10 L20, probes and G28 placements (`b1`, `b3`); all controller-specific words KerfDesk does not model are named as "not in this review or the Frame outline"; `#`/`[ ]` refused on FluidNC and grblHAL; `G65` refused on grblHAL; checksums refused; NUL refused.
- **Start from line (laser, project program):** on a raster mid-row (`X110S300` modal lines), the restored motion word, `M4 S0`, `F1500` and the re-entry `G0 … S0` are right. On G2/G3 arcs with air assist, `G17`, `M8` and `M3 S0` come before the re-entry, and the first arc gets `S500`. A `G4` dwell after `M3` replays at `S0`. CNC is refused before compile and again in the builder (`resume-program.ts:73-75`, `start-job-flow.ts:307-310`). Vitest for `resume-program*.ts` passes.
- **Focused Vitest:** 13 files, 238 tests pass (Repros above).

## Not verified

- **No browser run.** The render-path claim in W7-P2-1 is read, not measured in Chromium or Electron, including whether a status report can re-render the dialog after Start begins streaming. Memory was 2.2–2.7 GB, enough for one headless run, but the app with a simulated controller and a 500k-line file was judged too heavy for this session.
- **Worker out-of-memory** on a very large file (hundreds of MB) was not run: whether the Inspector worker's `onerror` fires or the renderer crashes is still unconfirmed (as in v2).
- **grblHAL and FluidNC ground truth** (M6 under `$341`, canned cycles, G5, G51, G90.1) was not fetched; W7-P3-1 rests on ADR-630 Amd 5 and the twin.
- **Burn preview against `$30`** for opened files (it uses the profile's `maxPowerS`, the Run review the connected `$30`) was read only and not raised.
- **Marlin and Smoothieware external runs** were run only for envelope and refusal shape, not through their simulators.
- K-5, K-7, K-10, K-11 and P3-6 were not re-checked.

```json
[
  {"id":"W7-P2-1","severity":"P2","area":"gcode-viewers-inspector","file":"src/ui/gcode-inspector/RunGcodeFileDialog.tsx","line":104,"anchor":"Contract: ADR-630 'What is sent' (worker parse; slice-at-a-time so the dialog stays responsive); Twin/precedent: perf S1-P2-1, S1-P2-2","evidence":"REPRO (compute) + READ (render path)","verdict":"PENDING","known":false,"summary":"Run dialog re-runs reviewExternalProgram on the UI thread on every render, unmemoized: 1.5 s at 500k lines, 3.0 s at 1M; renders at Frame click, Idle->Jog during the Frame motion, return to Idle, Frame record and Start arming, so a stop pressed early in a large file's Frame waits"},
  {"id":"W7-P3-1","severity":"P3","area":"gcode-viewers-inspector","file":"src/core/external-program/external-program-review.ts","line":126,"anchor":"Contract: ADR-630 Amd 5 'grblHAL's M6 can run a stored tc.macro'; Twin: parser expands G81 for grblHAL/FluidNC (gcode-inspector-parse.ts:74) vs finding-checks.ts:222","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Run review says M6 and canned cycles stop with an error on GRBL even when connected to grblHAL or FluidNC, which run them"},
  {"id":"26-P2-1","severity":"P3","area":"gcode-viewers","file":"src/ui/cnc-viewer3d/viewer3d-live-run.ts","line":55,"anchor":"see v2 26","evidence":"READ","verdict":"STILL OPEN (latent)","known":"26-P2-1","summary":"3D result pane live basis; pane still not mounted"},
  {"id":"26-P3-1","severity":"P3","area":"gcode-viewers","file":"src/core/external-program/external-program-review.ts","line":162,"anchor":"see v2 26","evidence":"REPRO","verdict":"PARTLY FIXED","known":"26-P3-1","summary":"Skipped-motion warning now names sent-program lines; other Program Health warnings still give unqualified sent-program lines"},
  {"id":"26-P3-2","severity":"P3","area":"gcode-viewers","file":"src/ui/gcode-inspector/burn-grid.ts","line":82,"anchor":"see v2 26","evidence":"REPRO","verdict":"STILL OPEN","known":"26-P3-2","summary":"Opened-file burn preview burns after M5 and with no M3"},
  {"id":"26-P3-4","severity":"P3","area":"gcode-viewers","file":"src/core/gcode-view/gcode-render-model-builder.ts","line":263,"anchor":"see v2 26","evidence":"REPRO","verdict":"STILL OPEN (shape changed)","known":"26-P3-4","summary":"Non-finite I leaves non-finite coordinates; Run review drops the arc with no 'could not read' warning"},
  {"id":"26-P3-5","severity":"P3","area":"gcode-viewers","file":"src/core/gcode/word-scan.ts","line":111,"anchor":"see v2 26","evidence":"REPRO","verdict":"STILL OPEN (view only)","known":"26-P3-5","summary":"X1 0 is junk in the opened-file view"},
  {"id":"26-P3-9","severity":"P3","area":"gcode-viewers","file":"src/core/gcode-view/render-model-words.ts","line":314,"anchor":"see v2 26","evidence":"REPRO","verdict":"STILL OPEN","known":"26-P3-9","summary":"G38.2 drawn as rapids; false rapid-plunge also in the Run review"},
  {"id":"26-K-1","severity":"P2","area":"gcode-viewers","file":"src/core/gcode-view/gcode-render-model-builder.ts","line":362,"anchor":"ADR-630 Amd 2","evidence":"REPRO","verdict":"FIXED (#1368)","known":"WA-4","summary":"G18/G19 arcs now framed"},
  {"id":"26-K-2","severity":"P3","area":"gcode-viewers","file":"src/core/gcode-view/render-model-placement.ts","line":5,"anchor":"see v2 26","evidence":"REPRO","verdict":"PARTLY FIXED","known":"PV-3","summary":"Run Frame places G10/G92/G28; view unchanged; G43.1 Z still drawn as a rapid move, also in the Run review"},
  {"id":"26-K-8","severity":"P3","area":"gcode-viewers","file":"src/ui/laser/untracked-start-retirement.ts","line":26,"anchor":"ADR-341 Amd 10","evidence":"READ","verdict":"FIXED","known":"05-P3-1","summary":"External run retires the recovery card"}
]
```

## Refuter (2026-11-09)

Fresh context. Read `AREAS.md`, `LEDGER.md`, METHOD §3–§5 and the performance S1-P2-1 / S4-P2-3 ledger rows, then tried to break each finding on `a3965a77d`.

- **Repros:** scratchpad `zz-w7r/`.
  - Browser: an own export of `a3965a77d` in `zz-w7r/mut` (node_modules junctioned, fflate aliased to the pnpm store as in `zz-v9`), Vite `--mode desktop` on 4897, cached Chrome for Testing 1248, headless, one worker, one spec.
  - Two changes in that copy only: `main.tsx` mounts `StrictMode` only with `?zzstrict`, so a render runs once as in a production build (dev StrictMode would run the review twice per render); and a paced GRBL 1.1 simulator copied from `zz-v8r-door-grbl.js` (`e2e/fixtures/zz-w7r-paced-grbl.js`), which adds wall-clock stamps on every realtime byte and line, and logs a starvation when its planner empties during `Run` with machine time owed. Rate 500 blocks/s, `$J=` blocks cost 0.5 s each so a Frame lasts long enough to press a stop in. App source unchanged.
  - Spec `zz-w7r/mut/e2e/zz-w7r-run-dialog.e2e.ts`. It builds a 500,000-line photo-engrave-shaped program in the page (`M4 S0`, serpentine `G1 X… Y… S…`, 12.6 MB), opens it with **File > Open G-code...**, clicks **Run on machine...**, then **Frame** and **Start**. It records long tasks, a 20 ms heartbeat, laser-store transitions, dialog mount and unmount times, and a CDP CPU profile mapped to wall time by a marker. Ctrl+. (the Abort shortcut, `use-job-shortcuts.ts:40-45`) is fired from Node over CDP at a fixed offset, so the press time does not depend on the page's thread.
  - Outputs: `out-500k.json` and `out-abort.json` (timeline twice, 3 Abort runs), `out-small.json` (20k lines, a control).
  - Node: `sflr.mts` → `sflr.out.txt` (Start from line).
  - Memory before each launch: 3,116, 2,516 and 2,683 MB available.

### W7-P2-1 — SEVERITY CHANGE: P2 → P1 (CONFIRMED, browser REPRO)

**What would make it false:** the review is memoized somewhere upstream; nothing re-renders `InspectExternalRun` once Start has written the first line; or the block is too short to matter.

None of those holds.

**More re-render paths than the auditor listed (READ, then measured).**

- `CommandShell` subscribes to `motionOperation`, `controllerOperation`, `connection` and `streamer.status` through `useAppCommands` (`use-command-store-state.ts:30-35,44-47`).
- Each `CommandShell` render rebuilds `gcodeInspector.element` (`CommandShell.tsx:89,153`) with fresh arrow props (`use-gcode-inspector-slot.tsx:27-28,80-89`). `InspectorHost`, `RunGcodeFileDialog` and `InspectExternalRun` are not memoized, so every such store change re-runs `prepareExternalRun` → `reviewExternalProgram` (`RunGcodeFileDialog.tsx:104-124`).
- On Start, three re-renders follow:
  1. `controllerOperation` → `start-arming` (`laser-job-actions.ts:140-143`);
  2. `streamer` installed;
  3. `controllerOperation` → `null` in `completion.finish()` (`laser-start-arming-completion.ts:50-56`). This runs after `transmitInitialWindow` (`laser-job-actions.ts:169-179`), while `startUntrackedRun` still awaits the IndexedDB retirement before `onStarted` can close the dialog (`untracked-start-retirement.ts:31-36`).
- Then the Idle→Run status report turns `startKey` null (`use-external-program.ts:72-73`), which is a fourth render.
- During a Frame, every `motionOperation` update re-renders, one per Frame segment.

**Browser evidence, 500k lines, production-like single render.** Times are in ms after the Start click; there were two timeline runs.

| | run 1 | run 2 |
|---|---|---|
| First program line (`G17G21G90G94G0`, `M4S0`, first `G1…S…`) reaches the controller | +2,791 | +2,984 |
| UI-thread long tasks after that line, before the Run dialog unmounted | 1,182 ms and 1,169 ms; the task containing the write ran on to +3,795 | 1,360 ms and 1,439 ms; the task containing the write ran on to +4,402 |
| Run dialog unmounts | +6,197, 3.4 s after the first line | +7,263, 4.3 s after it |
| Burn lines (`G1X…`) sent in that time | 43 | 43 |
| Starvation logged by the simulator: machine time with an empty planner in `Run` | 2,264 + 1,189 ms | 2,826 + 1,368 + 1,422 ms |

- The CPU profile puts every one of those tasks inside `InspectExternalRun` → `prepareExternalRun` → `reviewExternalProgram`, about 1.0–1.4 s each.
- The store log shows the renders' causes: `controllerOperation` → null at +2,792 / +2,985, and `Run` at +5,011 / +5,798.
- **Abort during the stream** (`out-abort.json`), Ctrl+. pressed at a fixed offset after Start:

  | Pressed at | First line reached the controller | Press fell inside | Soft reset (0x18) reached the controller |
  |---|---|---|---|
  | +3,320 | +2,863 | a 2,414 ms task | **661 ms** after the press |
  | +4,409 | +2,750 | a 1,163 ms task | **539 ms** after the press |

  The worst case is the full block, 1.2–2.4 s here.
- **Abort during a Frame** (pressed 15.0 s after the Frame click):
  - **The jog cancel (0x85) reached the controller 5,874 ms after the press.**
  - The press fell inside a 5,071 ms task followed by a 1,366 ms one.
  - The Frame's first `$J=` was written 662 ms *after* the press, so a Frame motion began after the operator had asked it to stop.
- **The Frame itself is slowed by the same blocks.** With 500k lines, the first jog went out 13.2 s / 13.1 s after the Frame click, the five 0.5 s jog segments spanned 13.2 s to 42.6 s, and the Frame record arrived 46 s after the click. Long tasks of 1.1–6.7 s sat between segments, and each segment waited for the review that its predecessor's store change triggered.
- **Control (20k lines, `out-small.json`):**
  - review renders 170–350 ms;
  - first line +198 ms after the Start click;
  - the dialog unmounted 92 ms later with no review task in between.
  The post-stream block scales with the file.

**Severity.** By S1-P2-1 (Abort waited 1.2–1.4 s inside a UI block during a job; P1) and S4-P2-3 (125–504 ms; P1 by the coordinator), an Abort delayed 0.54–0.66 s here, with blocks to 2.4 s, while an `M4 … S…` program streams, is **P1**. The auditor's open question is settled: the block lands after the first window is sent, and it lands every time, not by race. Not lowered: no warning reaches the operator, and the block shows no sign on screen.

**Route caveat.** This is the browser's window route: the stream refill runs on the UI thread, so the controller starved (simulator model). On the desktop USB-worker route the refill would continue, but Ctrl+. and ABORT JOB are still handled on the UI thread, so the Abort delay holds. The physical effect of the starvation (M4 dynamic power drops with speed; M3 behaviour at a stall) is UNVERIFIED; no firmware source was fetched. The P1 rests on the delayed Abort alone.

**Fix direction (unchanged, sharpened).**
- Memoizing on `(program, inspection result, context)` removes every one of these blocks, because no input of the review changes during Frame or Start.
- `React.memo` on `InspectorHost`/`RunGcodeFileDialog` alone would not be enough: `arming` and `startKey` still re-render.
- Moving the review into the Inspector worker removes the remaining first-render block.

### W7-P3-1 — CONFIRMED, P3 kept

- `external-program-review.ts:123-127` and `finding-checks.ts:219-223` carry no controller kind.
- `gcode-inspector-parse.ts:74` sets `stockGrbl` only for `grbl-v1.1`, so grblHAL and FluidNC expand G81 and frame the holes while the finding says the program will not run.
- ADR-630 Amd 5 ("Not in this decision", line 68) keeps M6 as a warning because grblHAL can run it.
- Ground truth for grblHAL `$341` and FluidNC M6 / canned cycles: UNVERIFIED (not fetched).
- Every case still warns, and no output is wrong. P3.

### Challenges to "Verified clean"

- **L9 laser-mode / `$32` parity:** holds (READ).
  - External Start calls the same `confirmLaserModeStartEvidence` as project Start (`external-run.ts:225-231`, `laser-mode-start-acknowledgement.ts:15-44`), on a fresh snapshot, with its own prompt citing the Run review.
  - The acknowledgement condition is the same: `$30`/`$32` unverified against the profile's `maxPowerS`.
  - Noted, not raised: that comparison uses the profile's `maxPowerS`, while the external file's S scale is judged against the connected `$30` in the review (`RunGcodeFileDialog.tsx:73`). A mismatch therefore adds an acknowledgement; it never removes one.
- **L9 bed bounds:** holds.
  - Both sides warn, never refuse: `blocking-codes.ts` (out-of-bed is a policy code) and `external-run-bed.ts:1-8`.
  - The external outline is placed with the controller's live machine-minus-work offset, so the comparison is in the same frame as a jog's.
- **L9 origin:** holds (READ).
  - Start re-checks `controllerStartPreparationStillCurrent` against the Frame's controller snapshot, plus head at start (`external-run.ts:183-212`, and again in `assertFinalStartAuthorized`, `:266-273`).
  - An origin change after Frame refuses with `EXTERNAL_FRAME_CHANGED`.
- **Start from line, M4 dynamic power:** holds (REPRO `sflr.out.txt`).
  - With `M4 S600` set once and `G1` lines without S, resuming from lines 7, 8 and 9 gives `M5`, `G0 … S0`, `M4 S0`, `F1500`, then the first burn line with `S600`.
  - With per-line S, `S450` is carried, and a `G0 … S0` stays S0.
- **Start from line, G91 block:** holds. Any `G91` before the resume line refuses with "relative positioning (G91) — resume needs absolute programs" (`resume-program.ts:229`), whether the line is inside the block or after `G90`. A `G91` later in the tail replays as written, which is correct.
- **Start from line, G92:**
  - The "Set origin here" `G92` (outside the program) is covered: a matched run's archived work offset is carried into `prepareRecoverySource` (`manual-restart-source.ts:124-129`, `start-job-source.ts:233-253`). Without a matched run, the live placement is used and named (`manual-restart-source.ts:110-121, 295-297`).
  - `G92` or `G92.1` *inside* the program is neither refused nor replayed (`G92 X0 Y0` after `G0 X50 Y50` becomes a re-entry `G0 X0 Y0 S0` with no `G92`; `sflr.out.txt`). After a reset that cleared the offset, the tail would land 50 mm off.
  - Not reachable today: Start from line replays only the project's own program, and no laser emitter writes `G92` (grep of `src/core`: only `commands.ts` origin commands, probe, autofocus). Recorded as latent, not raised, consistent with the auditor's treatment of the G17 case.

### New findings

None as separate IDs. The `CommandShell` → `InspectorHost` re-render path, the per-segment Frame blocks and the delayed Frame stop are folded into W7-P2-1, which now carries P1.

### Not verified

- **Production build and Electron.** The browser ran the Vite dev build (React development, not minified) with StrictMode off. Per-render review cost (1.0–1.4 s) matched the auditor's Node figure (1.48 s), so a production build should block for similar times. The desktop USB-worker stream route and real Web Serial were not run.
- **1M lines** in the browser (Node: 3.0 s per review).
- **Physical effect of the starvation** under M3 and M4 on stock GRBL, grblHAL and FluidNC.
- **grblHAL and FluidNC M6 and canned-cycle ground truth** (W7-P3-1).

Refuter counts: raised 2, refuted 0, P1 1, P2 0, P3 1, known 21
