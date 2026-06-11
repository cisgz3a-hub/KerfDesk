# Audit Fix Verification — 2026-06-10

Independent read-only verification of `FIXES-2026-06-10.md` (the claimed disposition of the
100-finding `AUDIT-2026-06-10.md`) against branch `fix/audit-2026-06-10` at HEAD `b6b8e92`
(32 commits atop real GitHub main `e3da1a1`). The fix log was treated as the artifact under
test: every verdict below was checked against the original audit finding text, the cited
commits (`git show`), and the current tree — not against the fix log's paraphrases.
Selected high-impact verdicts were additionally attacked by adversarial refuters.

**Scope:** 64 of the audit's 100 findings were independently verified by this pass — all
criticals, all highs, all findings with session fix commits, all "fixed upstream" claims,
and all 13 items the fix log lists as open. The ~36 remaining low-priority items the fix
log lists under "still open, no decision needed" (M6, M18/M20, M24, M27, M30, LC1, LC2,
LU1–LU5, LU7, LU8, LU11–LU22, LU25, LU27–LU29, LU32, LU33, LU37) were **not**
independently re-verified here; their open status is taken from the fix log.

---

## 1. Verdict summary

The maintainer's headline — every finding either fixed (upstream or in the 32 session
commits) or honestly listed as open — is **substantially accurate but not fully**. Of the
64 findings verified: 40 are verified-fixed (root cause addressed and pinned by tests), 13
are not-fixed exactly as the fix log itself discloses (accurate disposition, not failures),
and 11 are partial. Within the partials, four were claimed as full fixes but are not
(**H5** — the most material discrepancy, where an adversarial refuter broke the "error:N
is terminal" claim with a realistic end-of-job trace; **H4** — skew transforms still
silently ignored; **M25** and **M26** — half of each finding shipped). The other partials
(C1, C3, H12, H13, M1, M16, M29) match what the fix log honestly described as
partial/mitigation, with specific residuals catalogued below. No silently-fixed items and
no wrong commit attributions were found; eleven adversarial attacks were run against
high-value verdicts and ten survived (one, H5, was downgraded). Suite health claims hold
at HEAD: lint went red→green, 1325 tests / 186 files all pass, perceptual IoU is
bit-identical to the audit baselines.

### Counts (64 findings verified)

| Verdict | Count | Findings |
|---|---|---|
| verified-fixed | 40 | C2, H1, H2, H3, H6, H7, H8, H9, H10, H14, H15, H16, M2, M3, M4, M7, M8, M9, M10, M11, M12, M13, M14, M15, M21, M22, M23, M32, M33, M34, M35, LC4, LU6, LU9, LU10, LU26, LU30, LU31, LU34, LU35 |
| partial | 11 | C1, C3, H4, H5, H12, H13, M1, M16, M25, M26, M29 |
| not-fixed (= accurately disclosed open) | 13 | H11, HD1, M5, M17, M19, M28, M31, M36, M37, M38, M39, LC3, LU23 |
| cannot-verify | 0 | — |

### Still-open findings the fix log itself acknowledges (verified accurate, nothing hidden)

All 13 were independently confirmed still open — the fix log's NOT-fixed lists are honest.

| Finding | Sev | Fix-log disposition | Verified state |
|---|---|---|---|
| H11 | high | potrace provenance — legal/licensing call | Confirmed open: no ADR, no provenance headers, GPL fingerprints (`xprod`, `cyclic`, `dpara`, `ddenom`, `POTRACE_MAX_ALPHA = 4/3`) in `src/core/trace/potrace-*.ts`; still the default Line Art backend (`trace-to-paths.ts:134`) |
| C1 (half) | critical | branch protection on main — maintainer-only GitHub setting | Confirmed: `gh api .../branches/main/protection` returns HTTP 403 ("Upgrade to GitHub Pro or make this repository public") — protection does not exist and cannot be enabled on the current private plan |
| HD1 | high | stash@{0} pause/stop write-failure status — pending decision | Confirmed: stash unapplied and no longer applies cleanly; neither the disputed `'disconnected'` nor the recommended `'errored'` transition is in the tree. **New adjacent risk found** — see §5 |
| M36 | medium | stash-only 0–360 angle dead range | Confirmed: `CutSettingsDialog.tsx:137` still `max={180}`; core folds mod 180 |
| M37 | medium | stash-only PNG re-encode data loss; needs ADR | Confirmed: `import-image-action.ts:32` still stores original bytes; no ADR |
| M38 | medium | stash-only `pnpm audit --audit-level=low` hard gate | Confirmed: no audit gate in any workflow |
| M39 | medium | stash-only deletion of safety comments | Confirmed: the knowledge is alive in the tree (relocated to `laser-job-actions.ts:64-72,94-97`; `IDLE_POLL_DIVISOR` at `laser-store.ts:72`) |
| LU23 | low | stash-only untested helper | Confirmed: `material-library-panel-helpers.ts` exists only in stash@{0}^3; no test anywhere |
| M31 | medium | Playwright smoke layer — maintainer decision | Confirmed: no playwright dependency, config, or e2e dir; suite remains jsdom-only |
| M17 | medium | schema v2 + migrators — file-format decision | Confirmed: `PROJECT_SCHEMA_VERSION` still 1, `MIGRATORS` empty. Nuance: the audit's "validateShape checks five top-level keys" is stale vs real main — the validator is already deep per-field; the version-freeze half stands |
| M19 | medium | dataUrl interning — design remainder | Confirmed: full-res bytes stored verbatim; no interning anywhere |
| M5 | medium | retain-curves / re-flatten — needs ADR | Confirmed: 0.25 mm flattening still baked at import, pre-transform; no compile-time re-flatten |
| M28 | medium | module-level mutable-cache policy | Confirmed: 7+ module-level mutables remain (3 in `src/core`); no lint selector, no ADR |
| LC3 | low | Roboto Apache-2.0 license text must ship | Confirmed: only the four .ttf files in `src/ui/text/fonts/`; About dialog ships no license content |

Also accurate (M16-related, listed under design remainders): the ~5 MB localStorage
autosave ceiling remains; only the failure surfacing landed (upstream).

---

## 2. Suite health on the fix branch

Executed by the health agent at HEAD `b6b8e92` (working tree verified unchanged afterward).

| Check | Audit (pre-fix) | Fix branch @ b6b8e92 | Verdict |
|---|---|---|---|
| `pnpm typecheck` | green | exit 0, no diagnostics | green |
| `pnpm lint` | **RED** — 3 errors (parse error in `scripts/assert-correct-repo.mjs`; complexity 14>12 in `src/core/job/planner.ts` and `src/core/raster/emit-raster.ts`) | exit 0; only a non-fatal eslint-plugin-boundaries v6 deprecation warning | **RED → GREEN, as claimed** |
| `CI=true pnpm test` | baseline claimed 1210 tests / 172 files | **1325 tests / 186 files, 0 failed/skipped**, 35.6 s; no snapshots rewritten | claim holds at HEAD |
| Test-file count (read-only `git ls-tree`) | 172 at e3da1a1 | 186 at HEAD | matches the claimed 172→186 exactly |
| Perceptual harness | 4 files / 41 tests green | 4 files / 41 tests green (identical shape) | green |
| Per-fixture trace IoU (Vite-SSR extraction, Line Art) | solid-square 1.0000; filled-disc 0.9928; ring-annulus 0.9823; plus-stroke 1.0000; square-glyph 1.0000 | **bit-identical to all five audit baselines** | zero fidelity regression on existing fixtures |

**1325/186 claim:** holds exactly at HEAD. **Not verifiable read-only:** (a) the 1210
baseline test *count* at e3da1a1 (would require checkout+run; only the 172 file count was
corroborated from the git tree); (b) "full green at every commit" across all 32 commits —
only HEAD was executed. **Not run** (charter limits): `lint:electron`, `test:coverage`,
`build:web`/`build:desktop`, the deploy workflow. Note the standing caveat: the perceptual
suite covers the Line Art *trace* path only — raster engrave and fill hatch still have no
perceptual fixtures (the fix log concedes this).

---

## 3. Critical/high disposition

### C1 — stale tree / unguarded main — **partial** (as the fix log itself discloses)
- **Evidence:** `e3da1a1` confirmed ancestor of HEAD; local `main` points exactly at
  `e3da1a1`; upstream content the audit flagged absent is present (`DECISIONS.md:1910`
  ADR-039; `src/core/raster/emit-raster.ts:42`). No doc falsely claims main is protected.
- **Residual:** branch protection absent and currently *impossible* on the private plan
  (GitHub 403 — needs Pro or a public repo). The "12-agent re-verification of all 100
  findings" claim is unverifiable from the repo; this pass independently confirms the
  reconcile only for what it examined.

### C2 — raster luma never reoriented for machine origin — **verified-fixed** (attack survived)
- **Evidence:** `compile-job.ts:117,138-172` `orientRasterLumaForMachine` flips rows/columns
  per origin, XORed with mirror and negative-scale flags; hand-checked against
  `origin-transform.ts:49-69` for all five origins (including the subtle center case).
  Existed at e3da1a1 — "fixed upstream" claim true. Pins: `compile-job-raster.test.ts:104`
  (front-left dark-row→machine-back, the audit's requested pin), `:115` (front-right
  column mirror), plus M35/M3 XOR pins and an H15 flip-sensitive snapshot.
- **Refuter:** survived a five-front attack (flip-table vs origin transform, double-flip
  hunt, fixture decoding by hand, rotated-raster bypass — gated by preflight at both Save
  and Start sinks, dither-order commutation).
- **Residual:** center/rear-left/rear-right have no direct per-origin pinning test; no
  raster-vs-vector registration fixture; **no hardware burn** (F.2.f asymmetric-image burn
  remains the decisive check).

### C3 — abandoned job leaves beam energized — **partial** (claim honest)
- **Evidence:** disconnect half upstream-confirmed (`laser-store.ts:281-296` writes
  RT_SOFT_RESET before close, pinned). Unload half in 67807d5: `use-unload-stop.ts:21-35`
  registers beforeunload+pagehide, fire-and-forgets `stopJob()` whose first statement is
  the 0x18 write; chunk enqueue is synchronous; M12 guarantees one wire byte.
- **Residual (three legs):** renderer crash is structurally uncoverable (no JS runs;
  Falcon DTR-on-close behavior unverified — non-negotiable #9 only partially restored);
  unload write delivery through Chromium's serial pipe during teardown is unguaranteed and
  not hardware-verified; mid-job disconnect silently auto-stops with no confirm (ALARM:3
  position loss; LU16 trade-off undecided).

### H1 — G92 user-origin bounds checked in wrong frame — **verified-fixed** (attack survived)
- **Evidence:** upstream at e3da1a1 (`predicates.ts:98-133` motionOffset; fail-closed WCO
  in `job-placement.ts:88-112`); all four physical entry points pass the offset or fail
  closed. Pins incl. the audit's exact canonical-diode regression
  (`start-job-readiness.test.ts:280-333`).
- **Residual:** image-mode + user-origin pinned only by mechanism-sharing, not direct
  assertion; no hardware G92 job.

### H2 — hatch computed in object-local space — **verified-fixed** (attack survived)
- **Evidence:** `compile-job.ts:414-430` maps contours through applyTransform +
  toMachineCoords *before* hatching; physical-mm spacing clamp restored
  (`fill-hatching.ts:59`). The audit's exact prescribed pin exists
  (`compile-job-fill.test.ts:72-91`, scaleY=2 → 1 mm machine gaps). Upstream-confirmed.
- **Residual:** hatch *angle* under rotation/mirror/non-front-left origin not separately
  pinned; no perceptual/golden-image fill verification; 3.8× over-burn consequence
  inferred fixed, not measured.

### H3 — preview toolpath in machine frame (mirrored overlay) — **verified-fixed** (attack survived)
- **Evidence:** 60f82d4 — `preview-scene-frame.ts:18-29` undoes jobOriginOffset then
  applies a true inverse `toSceneCoords` (correctly non-involutive for center). The
  audit's acceptance fixture pinned at `preview-scene-frame.test.ts:130-142` ((10,10) not
  (10,390)); preview==prepared-job parity pinned.
- **Residual:** coordinates-only — never rendered to pixels or compared to the on-canvas
  ghost in a browser; no test asserts raster-sim/vector-overlay coincidence.

### H4 — SVG transform stack ignored — **partial** (fix log overclaims "fixed upstream")
- **Evidence:** upstream parser does accumulate matrix/translate/scale/rotate (incl.
  rotate(deg,cx,cy)) through recursive group descent (`parse-svg.ts:142-218,272-334`),
  pinned for translate×scale.
- **Why partial:** `transformOperation`'s default arm returns IDENTITY — **skewX/skewY are
  still silently ignored**, the same silent-misplacement class the finding describes, and
  the audit's suggested fix explicitly listed skew. rotate()/matrix() paths have **zero**
  tests (grep over svg tests: no `rotate(`/`matrix(`). No Inkscape-style fixture; no
  perceptual import verification.

### H5 — GRBL error:N reported as clean finish — **partial** (DOWNGRADED by refuter)
- **Claimed:** fixed upstream — error:N terminal + ADR-041.
- **Refutation (confirmed by executing the pure state machine on HEAD):** in
  `streamer.ts:170-177` the ok-ack done-transition does not require status 'streaming', so
  after error:N sets 'errored', the ok acks GRBL emits for lines still in its RX buffer
  overwrite 'errored' with **'done'** whenever the error lands in the job's final
  ~120-byte window (last ~8–15 lines — a normal job tail). UI consequence: recovery
  controls hidden, Start re-enabled, progress 100% — exactly the finding's "reports a
  clean finish". ADR-041's terminality claim is false for this window; no test pins
  ok-after-errored.
- **What holds (why not not-fixed):** no further bytes are ever sent after an error
  (`step()` refuses for 'errored'); the persistent controller-error safety notice
  (`laser-line-handler.ts:152-159`) survives the status overwrite and clears only on
  dismiss/reconnect; Stop stays visible in 'errored' mid-job.
- **Other residuals:** banner shows the numeric code but not `describeError`'s text or the
  rejected line; stale `error-codes.ts` "status bar (transient toast)" header survived the
  comment-fix commit; GRBL 0.9 textual errors stall unsurfaced; no hardware error
  injection.

### H6 — jog/home mid-stream corrupts ack accounting — **verified-fixed** (attack survived)
- **Evidence:** 134da06 — JogPad gated on `isActiveJob` (streaming/paused/errored) at
  `LaserWindow.tsx:56`; Home gated upstream. Attack confirmed the menu-bar Home path is
  also gated (`command-registry.ts:376-379` + `runCommand` refusing disabled commands);
  no keyboard jog/home exists; pause/resume/stop/poll send only un-acked realtime bytes.
- **Gap found by attack (non-blocking):** menu `laser.home` is enabled when status ===
  'errored' (menu's activeStreamer excludes 'errored', panel's gate includes it) — cannot
  reproduce H6's harm (stream is terminal; nothing refills), but the menu/panel gates
  should be aligned.
- **Residual:** UI-only gate — store-level `jog()`/`home()` have no active-job guard; the
  no-sender-correlation root mechanism is deferred by design (matches the audit's own
  "longer term" framing). Hardware endpoint never reproduced.

### H7 — center-origin bounds never preflighted / Frame false-rejects — **verified-fixed** (attack survived)
- **Evidence:** `machine-bounds.ts:12-31` centered rect (the audit's exact suggestion)
  feeds both `preflight.ts:207` and `frame-preflight.ts:38-44`; the "Phase B" early
  return is gone. Upstream-confirmed; reject + accept halves pinned at unit/Frame level.
- **Residual:** no end-to-end accept-side runPreflight pin for negative-in-bed center
  coords; fuzz still corner-origin only (separate audit finding); no real center-origin
  hardware.

### H8 — SVG arc-flag tokenizer drops compact arcs — **verified-fixed** (attack survived)
- **Evidence:** 4791330 — grammar-aware `parseArcArgs` (`parse-path-d.ts:107-130`)
  consumes flag positions as single chars; cursor-sync restored. Tests discriminate old
  vs new code (verified by tracing both); the audit's exact input pinned; attack with
  fused signs/exponents/multi-tuple runs all aligned with browser behavior.
- **Residual:** malformed flag chars still stop the scan silently (no error channel —
  pre-existing observation, not the defect); no rendered SVGO-file perceptual comparison.

### H9 — viewBox/unit scaling ignored — **verified-fixed** (attack survived)
- **Evidence:** 9895996 — `svg-units.ts:31-61` per-axis physical/viewBox scale, 96 DPI px,
  unit table per the audit's list; critically the unit scale seeds the transform-stack
  root so geometry moves with bounds. ADR-046 exists (Accepted, 2026-06-10). Five pins
  cover the audit's exact failing cases; float-exactness of assertions hand-verified.
  Attack confirmed no production caller bypasses it and the trace path is unaffected.
- **Residual:** viewBox-only = 1 mm/unit is an ADR-documented LightBurn divergence (no
  import-DPI setting yet); preserveAspectRatio ignored (per-axis stretch — matches the
  audit's own suggested fix); no perceptual comparison vs a real Inkscape/Illustrator
  export.

### H10 — one worker error permanently disables tracing — **verified-fixed** (attack survived)
- **Evidence:** fixed upstream in 78554b4 (`workerFailed` latch removed — zero
  occurrences); kind:'error' is request-scoped; onerror/timeout drain all pendings before
  retiring; fresh Worker constructed on next call; inline fallback for small images.
  Client+test blob-identical between e3da1a1 and HEAD. Pins: same-worker survival and
  reconstruction after fatal error.
- **Residual:** all worker tests use FakeWorker stubs (real Vite worker bundle in a live
  browser unverified); no explicit concurrent-sibling test; module-level mutable state
  remains (M28).

### H11 — potrace provenance (GPL risk) — **not-fixed** (accurately disclosed; maintainer decision)
- See §1 table. The derivation half remains unproven either way (audit confidence 0.65) —
  verifying requires a diff against the GPL potrace C source, unavailable in this pass.
  Stale comment persists: `trace-perceptual.test.ts:10-11` still says "imagetracerjs
  current pin" while Line Art exercises potrace.

### H12 — engrave luma capped at trace resolution — **partial by design** (mitigation, honestly labeled)
- **Evidence:** fb1b614 — Start-time upsample warning computed from the same
  bounds/pixel-extent math compile uses; exemptions match compile exactly; surfaced in the
  Start confirm gate. Pinned.
- **Residual:** the core defect is unfixed by design (cap now 2048 px after upstream
  raise; compile still never consults the full-res dataUrl; canvas still over-promises
  detail). **The warning fires only on Start — the Save G-code path never calls
  `detectJobIntentWarnings`**, so exports carry no warning. No perceptual/hardware check.

### H13 — native dialogs freeze the ack pump mid-burn — **partial**
- **Evidence:** 042dced — job-aware wrappers (alert→toast, confirm/prompt fail closed
  mid-job); all audit-enumerated call sites swapped and verified; Start dialogs
  unreachable mid-stream; pinned incl. an integration gate test.
- **Why partial:** `ErrorBoundary.tsx:95/99` still calls **raw `window.prompt`** — after a
  React render crash mid-burn the stream keeps pumping outside React, the crashed UI has
  no Stop, and the copy-diagnostic prompt can stall the ack pump with the beam at power
  (narrow path; tab-close soft-reset is the remaining software escape). Also: Ctrl+Return
  can fire a native alert during frame/jog motion; no ESLint rule prevents future native
  dialog call sites. jsdom-only verification.

### H14 — fictional CI gates (no-cycle, passWithNoTests) — **verified-fixed** (attack survived)
- **Evidence:** f08fa50 — `import/no-cycle: 'error'` live in the flat config (plugin
  registered; resolver configured; no later override disables it); `--passWithNoTests`
  gone; CI runs both. Upstream CLAUDE.md correction confirmed at e3da1a1. Pinned by
  repo-policy tests.
- **Residual:** pins are string-matching, not functional; `electron/` excluded from the
  root config and its config lacks no-cycle; 9 potrace files still lack sibling tests
  (census half resolved by documented policy, per the audit's own either/or).

### H15 — G-code snapshot corpus doesn't cover the shipped pipeline — **verified-fixed** (attack survived)
- **Evidence:** 37418e3 — `emit-gcode.snapshot.test.ts` snapshots `emitGcode` (verifiably
  the only shipped composition — sole `grblStrategy.emit` caller; Save+Start both route
  through it) for fill-donut+overscan, raster serpentine, mixed M3/M5/M4, user-origin
  (genuinely translated), curves; invariants run across the corpus; .snap content
  hand-verified (hole-band scanline splits, 5 mm overscan, mode ordering). Regression
  detection already demonstrated: later emitter-touching commits caused zero snap churn.
- **Residual:** multi-pass/text/traced-image bytes still unpinned (outside the audit's own
  items a–e; covered by exact-assertion unit tests and shared code paths); legacy Phase-A
  corpus still bypasses prepareOutput; snapshots pin determinism, not fidelity.

### H16 — full pipeline recompiled per pointer-move — **verified-fixed** (attack survived)
- **Evidence:** b87cf3a — 250 ms true trailing debounce on the job estimate
  (`use-job-estimate.ts`); Frame reads state at call time; the audit's FileButtons
  whole-project subscription no longer exists; upstream 4M px raster budget gates before
  decode. Pin proves zero recomputes across 5 rapid mutations via reference equality.
  Attack confirmed preview-mode recompiles cannot coincide with drags (drag start blocked
  in preview mode).
- **Residual:** never profiled (same epistemic status as the finding); the debounced
  estimate still runs synchronously on the main thread when it fires; no live-browser
  drag.

### HD1 — stash pause/stop write-failure semantics — **not-fixed** (accurately disclosed; decision pending)
- **Evidence:** stash@{0} exists, unapplied, no longer applies cleanly (pause/stop moved
  to `laser-job-actions.ts` in the size-cap split). Current tree has pre-stash semantics
  (write-first; failed write keeps the job active — safe).
- **New adjacent risk found by this pass:** `resumeJob`'s refill-failure handler
  (`laser-job-actions.ts:84-88`) sets the streamer to 'disconnected', which removes the
  Stop button via `isActiveJob` while the laser may still be running — the identical
  safety concern HD1 critiques, present in the tree **today**, independent of the stash.

---

## 4. Medium/low disposition

| ID | Sev | Verdict | Evidence pointer (current tree @ b6b8e92) | Residual risk |
|---|---|---|---|---|
| M1 | med | **partial** | ef5b99f; `preflight.ts:216-228` overscan-naming note from exported `DEFAULT_OVERSCAN_MM`; pinned (`preflight-raster.test.ts:139-162`) | Diagnosability half only: overscan still hardcoded 5 mm, no UI control (LightBurn gap); LIGHTBURN-STUDY ledger not updated; note fires on any bounds failure when image output exists |
| M2 | med | verified-fixed | upstream; `estimate-duration.ts:40-97` raster sweeps; image-only jobs 'estimated'; pinned | Magnitude never validated vs a real burn; **newly stale tooltip** `JobControls.tsx:169` "(excludes acceleration overhead)" contradicts the planner |
| M3 | med | verified-fixed | 4571193; negative scale folded into flip XOR (`compile-job.ts:145-151`); canvas/dither/burn agree; pinned both directions | Threshold-dither pins only; error-diffusion sim/burn can differ at pixel level (orientation correct); no hardware/perceptual |
| M4 | med | verified-fixed | fdf540e; shared `isClosedEnough` (`polyline-closure.ts:15-22`) used by Fill and Convert-to-Bitmap; pinned | Third private copy survives in `live-job-estimate.ts:170-177` (can drift); no perceptual check of converted bitmaps |
| M7 | med | verified-fixed | a18d335; `INK_LUMA = 127` < threshold 128; survives to compile un-recoded; composition pin | LightBurn's 50%-gray behavior unverified; generic "no burn at current dither" warning not added (outside scope); no hardware |
| M8 | med | verified-fixed | upstream (c29c232+081ec7a); 30 s watchdog, terminate-and-respawn, siblings rejected; pinned incl. sibling test | Flat 30 s (not pixel-scaled); while(true) hazard mitigated not removed; fake timers/Worker only |
| M9 | med | verified-fixed | upstream (94f5e9c); `isCurrent` re-checked after await on both paths; pinned | Unit-level with injected stub; no hook-level integration test; WYSIWYG not perceptually verified |
| M10 | med | verified-fixed | 8df5e83; retry keeps `fixedPalette` → stays on potrace; pinned (options + backend routing); perceptual fixture documents the degeneracy | The degenerate quantizer config itself untouched — IoU-0.25 collapse still exists in core for palette-free callers (currently unreachable via presets); no IoU assertion on the retry output |
| M11 | med | verified-fixed | 0dfaf02; assumes-header + mismatch confirm gate + never-connected toast; production wiring passes controllerSettings at both call sites; pinned | Settings null after port close (gate window narrower than phrased); Start path has no provenance header (roadmap); no hardware $30 clamp check |
| M12 | med | verified-fixed | 64582c4; `encodeWireBytes` byte-per-char, throws >0xFF (`web-serial.ts:171-183`); single write path; pinned on wire bytes [0x85] | No logic-analyzer capture; ASCII realtime bytes covered structurally, not individually pinned |
| M13 | med | verified-fixed | 1dc56c1; `findOversizedLine` pre-stream refusal + 10 s ack-stall notice (`laser-store-helpers.ts:48-83`); pinned | 4-line poll wiring untested (acknowledged); watchdog suppressed while another notice shows; 'paused' wedge out of scope; no hardware stall |
| M14 | med | verified-fixed | 619e8b4 docs-only; header/PROJECT.md/§8.3 ledger all match the emitted `M3 S0`; preamble already byte-pinned | §8.3 "Hardware-verified" is a recorded maintainer claim, unverifiable here; divergence is deliberate and ledgered |
| M15 | med | verified-fixed | 62cd10f; restore marks dirty + keeps slot; slot cleared only on decline or first successful manual save; pinned (3 cases) | Decline still discards with no export option; no live crash→restore cycle |
| M16 | med | **partial** (matches claim) | upstream; quota-detecting `AutosaveWriteResult` + once-per-session warning toast; pinned | Image-heavy projects still get no working crash protection; beforeunload failure toast likely never seen; IndexedDB deferred |
| M21 | med | verified-fixed | f741cc9; 7-fixture malicious corpus exists on disk, covering every class the audit enumerated; sanitizer + full-pipeline integration tests; the five false doc claims now true | Browser parsererror branch still executed by no test (jsdom recovers — documented M31 blind spot); entity fixture ~16k chars, not billion-laughs scale; string-level assertions only, no real-browser execution proof |
| M22 | med | verified-fixed | 2f41384; Ctrl+. stop bypasses modal/editable gates structurally; Ctrl+Return shares `runStartJobFlow` + Idle readiness; pinned incl. modal bypass | Editable-target bypass verified by absence, not by a focused-input test; no Electron menu accelerators; native dialogs would block it (safe only because of H13 — whose ErrorBoundary gap also neutralizes this) |
| M23 | med | verified-fixed | b3b350f; raster draw gated on layer visibility (`draw-scene.ts:177-187`), exactly the audit's fix; orphan colors fail visible; pinned (3 cases) | Orphan behavior diverges from vectors (documented choice); selection boxes still draw for hidden layers (pre-existing); jsdom counting-proxy only |
| M25 | med | **partial** | 78d0776; snap-to-committed on debounce commit and blur, incl. the reconcile-blind equal-value case; pinned (4 cases) | F-A7/F-A16 flash + status-bar feedback still entirely absent (clamping visually silent except the snap); focused-field divergence window until blur when clamp == lastCommitted |
| M26 | med | **partial** | fdab192; drops route through the same `importImageFile` as the toolbar; mixed-drop ignore counts toasted; pinned (routing) | F-A3 25 MB confirm absent from **both** paths (spec contradiction stands); SVG still extension-only, no content sniff; decode-failure toast verified by code reading only (test mocks the pipeline) |
| M29 | med | **partial** | 01907f2; console/process restricted + node-import patterns banned in `src/core`; tree verified clean; CI enforces via lint | **No pinning test** (fix log's blanket failing-test-first claim false here); bare-specifier (`'process'`, `'util'`…) and `globalThis.*` bypasses; `window` param shadow footgun persists (`potrace-curve-optimize.ts:77`) |
| M32 | med | verified-fixed | upstream; will-navigate guard + window-open deny via pure policy fns; policy unit-tested incl. evil origins | main.ts wiring pinned by source-text grep only (no Electron runtime harness — LU29 open); will-redirect not separately guarded; no live desktop run |
| M33 | med | verified-fixed | 7051caf; deploy checks out `workflow_run.head_sha` (`deploy.yml:50`); full gate suite re-runs pre-publish; pinned (substring) | Pin is a substring check; manual re-run of an old green CI deploys that old validated commit (ordering wart); never exercised against production |
| M34 | med | verified-fixed | 795ee58; pnpm-aware license gate; 14-package closure independently re-derived from pnpm-lock.yaml; fails loud on zero/unknown; vendored-source limitation documented naming H11; pinned (wiring) | No functional disallowed-license test; gate structurally cannot see vendored source (documented, ties to H11/LC3) |
| M35 | med | verified-fixed | 64451ac; preflight rejects rotation only; no other mirror gate anywhere; output-pinned (column-mirror property test) | Preview still silently empty on prepareOutput failure (M27 remainder); **stash@{0} still carries a pre-emit mirror gate that would re-break this if applied as-is** (fix log flags the stash but not this collision); no hardware mirror burn |
| LC4 | low | verified-fixed | upstream; `pnpm guard:repo` in deploy.yml before publish; `.git`-suffix normalization present; functional temp-repo test | Not exercised on a real Actions run; guard is defense-in-depth only |
| LU6 | low | verified-fixed | f741cc9; href **allowlist** ('' / #fragment / data:image/ only, trimmed) — fail-closed, kills the whole bypass class; pre-fix bypass confirmed at f741cc9~1; pinned (4 cases + corpus) | data:image/* (incl. svg+xml) allowlisted by design — latent if markup is ever re-rendered in a scripting context; CSS url() out of scope; no live-browser check |
| LU9 | low | verified-fixed | 876c37f; TracePreview comment now states the real invariant; verified true against the code (locally built SVG, no user markup path) | Safety rests on review-time adherence; nothing mechanical guards dangerouslySetInnerHTML |
| LU10 | low | verified-fixed | 876c37f; dead CHUNK + `void CHUNK` deleted; comment now explains the real spread-limit rationale; behavior identical | `extractLumaBase64` still has no direct unit test |
| LU26 | low | verified-fixed | 876c37f; electron CSP comment now truthful (frozen policy unconditional); verified vs code | Whether dev HMR actually breaks under the frozen CSP untested (comment hedges) |
| LU34 | low | verified-fixed | 876c37f; font docs corrected in all three places; verified against the actual four .ttf files and FONT_REGISTRY | Docs/registry/disk agreement not mechanically enforced; LC3 (Apache text) separate and open |
| LU35 | low | verified-fixed | d80aaca; self-contained `public/404.html` + intentionally empty `_redirects`, both pinned (no catch-all, no hashed-asset refs) | **Not verified against production** — Pages' implicit-fallback switch-off is observable only post-deploy; build copy step not run |
| LU30 | low | verified-fixed | upstream; origin-gated permission handlers (serial/fileSystem only, trusted origins, main-frame); policy unit-tested incl. evil origins | Wiring grep-pinned only (no Electron runtime harness); no live run |
| LU31 | low | verified-fixed | upstream; unknown font normalized to default, **stored normalized** (fixes the file-claims-wrong-font half), warning toast; pinned | `findFontEntry` remains a zero-caller dead export; load-time silence for unknown fonts untested |

---

## 5. Discrepancies — where the fix log did not match reality

Ordered by materiality. No wrong commit attributions and no silently-fixed items were
found; every "fixed upstream" claim checked (15 of them) was provably true at e3da1a1.

1. **H5 (material overclaim, refuted):** claimed fully fixed upstream ("error:N is
   terminal for the stream plus ADR-041"). A refuter demonstrated, by executing the actual
   streamer module at HEAD, that an error in the job's final ~120-byte window is
   overwritten to 'done' by trailing ok acks (`streamer.ts:170-177`), reproducing the
   finding's "reports a clean finish" symptom; ADR-041's terminality statement is false
   for that window and no test pins ok-after-errored. Safety core holds (no bytes sent
   after error; persistent notice survives). Downgraded to partial.
2. **H4 (overclaim):** "fixed upstream" — but skewX/skewY still import as identity with no
   warning (the audit's suggested fix explicitly listed skew), and rotate()/matrix()
   application has zero test coverage.
3. **H13 (completeness claim wrong in one place):** "all mid-stream-reachable call sites
   swapped" — `ErrorBoundary.tsx:95/99` raw `window.prompt` remains mid-job-reachable
   after a render crash, which is precisely H13's harm mechanism (and it also neutralizes
   the M22 keyboard stop in that state).
4. **M25 / M26 (half-fixes dispositioned as fixed):** M25 shipped only the snap — the
   finding's F-A7/F-A16 flash/status feedback is entirely absent. M26 shipped routing —
   the F-A3 25 MB confirm and the documented content sniff remain absent from all paths.
5. **M29 (process claim false):** the fix log's blanket "failing-test-first, one finding
   per commit" is false for 01907f2 — no pinning test exists for the new lint rules; the
   exact config-drift class the audit caught could recur silently for them.
6. **C1 (unverifiable claim):** "every finding re-verified against e3da1a1 by a 12-agent
   pass" cannot be verified from the repo; this pass confirms the reconcile only for what
   it examined.
7. **M35 (omission):** the fix log defers stash@{0} to the maintainer but does not flag
   that the stash's pre-emit mirror gate would re-introduce the M35 contradiction
   (including the silently-empty preview) if applied unsliced.
8. **HD1 (adjacent live instance not logged):** the Stop-removing write-failure pattern
   exists in the tree today in `resumeJob`'s refill-failure path
   (`laser-job-actions.ts:84-88` → 'disconnected'), independent of the unapplied stash.
9. **M14 (unverifiable assertion recorded as fact):** the new LIGHTBURN-STUDY §8.3 entry
   asserts "Hardware-verified" for M3 S0 priming — a maintainer claim no artifact in the
   repo substantiates.
10. **Stale-comment class survivals (the class the audit policed):** `error-codes.ts`
    header still claims a nonexistent "status bar (transient toast)" surfacing (H5);
    `JobControls.tsx:169` tooltip "(excludes acceleration overhead)" now contradicts the
    acceleration-modeling planner (M2); `trace-perceptual.test.ts:10-11` still names
    imagetracerjs as the current pin while Line Art runs potrace (H11-adjacent).
11. **H6 (minor inconsistency found under attack):** menu Home enabled in 'errored' state
    while the panel's Home is disabled — harmless for H6's mechanism but the gates
    (`use-app-commands.ts:36-38` vs `isActiveJob`) should agree.
12. **Audit-side staleness (in the fix log's favor):** M17's audit text described a
    shallow five-key shape validator; real main already validates per-field. The
    version-freeze half of M17 stands regardless.
13. **Suite-health claims not fully checkable:** "1210 tests at baseline" and "green at
    every commit" were not executable read-only; only HEAD's 1325/186 and the 172→186
    file growth were confirmed.

---

## 6. What remains unverified (Karpathy's law)

Green tests and structural verification are not fidelity. Carried forward honestly:

- **No hardware burns, anywhere.** The decisive F.2.f asymmetric-image burn (C2/M3/M35
  orientation), the unload 0x18 delivery (C3), DTR-on-port-close behavior (C3 renderer
  crash leg), single-byte jog-cancel on a real wire (M12), the ack-stall watchdog (M13),
  a real error:N injection (H5), $30 clamp behavior (M11), and the raster/fill energy
  outcomes (H2) are all unverified on a controller.
- **No live UI.** Every dialog, shortcut, toast, gate, and canvas fix is jsdom- or
  coordinate-level only; no dev server was touched and no synthetic DOM events were fired
  (charter rule). H3's registration was never rendered to pixels.
- **Perceptual blind spots persist.** Raster engrave and fill hatch still have **zero**
  perceptual fixtures — the suite cannot see engrave/fill fidelity (the fix log concedes
  this at line 107). Trace IoU covers Line Art only; centerline has no perceptual
  coverage; IoU measures area, not LightBurn parity (no side-by-side exists).
- **No LightBurn side-by-side.** All LightBurn behaviors were checked against
  LIGHTBURN-STUDY.md and vendor docs, not a live install (M7's 50%-gray question
  explicitly so).
- **Worker/browser runtime.** All worker fixes (H10, M8) run against FakeWorker stubs;
  real Vite worker bundles, real DOMParser/DOMPurify behavior (M21/LU6), real drag-drop
  (M26), and Electron main-process wiring (LU30/M32 — grep-pinned only) are unverified.
- **Deploy/build surfaces.** LU35's Pages fallback switch-off and M33's checkout ref were
  never exercised against production; `build:web`/`build:desktop`, `lint:electron`,
  `test:coverage` were not run.
- **Process claims.** Per-commit greenness across the 32 commits, the 1210 baseline test
  count, failing-test-first ordering (unprovable from single commits; false for M29), and
  the 12-agent re-verification are unconfirmed.
- **H11's derivation question** (is the potrace port GPL-derived?) requires an offline
  diff against the GPL C source — not performed.

---

## 7. Recommended next steps (ordered)

1. **Fix the H5 done-overwrite before PR or immediately after** — make the ok→'done'
   transition require `status === 'streaming'` (or mark 'completed with errors'), and pin
   ok-after-errored in `streamer.test.ts`. This is the only refuted fix claim and it
   reproduces the original finding's symptom in a normal job tail. Correct ADR-041 and the
   stale `error-codes.ts` header in the same change.
2. **Close the H13 ErrorBoundary gap:** route `ErrorBoundary.tsx:95/99` through the
   job-aware wrappers (or a non-blocking fallback), and add an ESLint
   `no-restricted-properties` ban on raw `window.alert/confirm/prompt` so the class stays
   closed. This also restores the M22 panic-stop guarantee after a render crash.
3. **Fix the HD1-adjacent live bug:** `resumeJob` refill failure
   (`laser-job-actions.ts:84-88`) should not transition to 'disconnected' (Stop button
   vanishes mid-beam) — use 'errored', which also pre-decides HD1's question for the
   sibling paths.
4. **Maintainer decisions (cannot be made by an agent):**
   - **H11 potrace:** legal call — write the ADR + provenance record, diff against GPL
     potrace, or swap/relicense the default backend. The license gate explicitly cannot
     clear this.
   - **Branch protection on main:** currently impossible (GitHub 403 on the private free
     plan) — either upgrade to Pro, make the repo public, or record a compensating
     control (e.g. PR-only convention + required local gate) in DECISIONS.md.
   - **stash@{0} slicing** (HD1/M36/M37/M38/M39/LU23): merge-with-fixes-in-slices per the
     audit's §4; it no longer applies cleanly. **Do not apply its pre-emit mirror gate**
     (re-breaks M35) and restore the safety comments it deletes (M39).
5. **Finish the overclaimed halves:** H4 skew handling (or an explicit import warning) +
   rotate/matrix pins; M25 F-A7 clamp feedback (flash/status); M26 25 MB confirm + SVG
   sniff (or amend WORKFLOW.md); H12 warning on the Save G-code path (one-line call to
   `detectJobIntentWarnings`); a pinning test for M29's lint rules.
6. **Stage 0 perceptual debt:** add raster-engrave and fill-hatch perceptual fixtures
   (the suite's largest standing blind spot), a raster-vs-vector registration fixture
   (C2's third requested pin), and per-origin orientation pins for center/rear-left/
   rear-right.
7. **Hardware session:** run the F.2.f checklist — asymmetric-image burn (orientation +
   mirror), tab-close mid-job (0x18 delivery), induced error:N, oversized-line and stall
   behavior, jog-cancel byte. Until then, treat all safety fixes as structurally-verified
   only.
8. **Small hygiene items found by this pass** (one commit each): align menu
   `laser.home` gating with `isActiveJob` ('errored'); fix the stale `JobControls.tsx:169`
   acceleration tooltip; fix `trace-perceptual.test.ts:10-11` backend comment; consolidate
   the third `isClosedEnough` copy in `live-job-estimate.ts`.
9. **PR readiness:** structurally, yes — lint/typecheck/test green at HEAD, one finding
   per commit holds for every session commit checked, Conventional Commit titles, tests
   accompany source changes (except M29, noted). Per CLAUDE.md's snapshot gate, the PR
   description **must carry** the acknowledgment line the fix log specifies:
   `Snapshot change acknowledged: new H15 corpus fixtures only — no existing snapshot modified.`
   (verified true — 37418e3 added only new snapshot entries; no existing snapshot was
   touched on the branch). Recommend landing items 1–3 above on the branch first, since
   H5's refutation contradicts a claim the PR description would otherwise repeat.

---

*Verification performed read-only on 2026-06-10 against `fix/audit-2026-06-10` @
`b6b8e92`. This report is the only file created. Verdict policy: honesty over generosity —
"partial with specifics" was preferred to "verified-fixed" wherever doubt existed.*
