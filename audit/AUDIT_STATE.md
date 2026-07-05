# AUDIT_STATE.md — Live progress tracker

Updated: 2026-07-05 (Phase 2 · S01 Pass 1). Read this first on every audit iteration.

**Loop cadence (maintainer directive 2026-07-05):** self-paced at **~5 min (300s)**
per iteration. Each wakeup: read this file → do the next chunk → update `audit/*` md
→ `ScheduleWakeup(300)`. Keep the md files updated every iteration.

---

## Current position

| Field | Value |
|---|---|
| **Phase** | Phase 2 — sector audit loop |
| **Current sector** | ✅ **AUDIT COMPLETE** — all 9 sectors + Phase 3 done. `FINAL_REPORT.md` written. |
| **Current pass** | Done. **Loop STOPPED** (awaiting maintainer review before any fix phase). |
| **Next action** | NONE — maintainer reviews `audit/FINAL_REPORT.md` + approves which findings to fix. Do NOT fix without approval. Final tally: 0 Crit · 0 High · 2 Med · 7 Low · 7 Info (16) · 2 rejected. |
| **Fix policy** | FINDINGS ONLY. No source edits. |

---

## Toolchain status

- `node_modules` was **MISSING** in this worktree → installed via `pnpm install --ignore-scripts` (task `bfo87oqc3`, **exit 0**).
- `--ignore-scripts` skipped the Electron binary → `build:electron-main`/`build:desktop` and any binary-launching Electron test are **BLOCKED here** (record blocked-with-reason).
- Runnable: `test`, `lint`, `lint:electron`, `typecheck`, `check:file-size`, `license-check`, `audit:deps`.

### Baseline health checks
| Check | Status | Evidence |
|---|---|---|
| `check:file-size` | ✅ **PASS** (exit 0) — 0 files > 600 raw lines | baseline-file-size-2026-07-05.txt |
| `test` (`vitest run`) | ✅ **PASS** — 590 files / **3594 tests** / 0 fail (258s) | baseline-test-2026-07-05.txt |
| `typecheck` | ✅ **PASS** (exit 0) | baseline-checks-2026-07-05.txt |
| `lint` (400 code-line cap via `max-lines`) | ✅ **PASS** (exit 0, 0 problems) → **confirms no file > 400 code lines** | baseline-checks-2026-07-05.txt |
| `lint:electron` | ✅ **PASS** (exit 0) | baseline-checks-2026-07-05.txt |
| `license-check` | ✅ **PASS** (exit 0) — no GPL-family deps | baseline-checks-2026-07-05.txt |
| `audit:deps` | ✅ **PASS** (exit 0) — "No known vulnerabilities found" | baseline-checks-2026-07-05.txt |

**Baseline verdict:** all runnable gates GREEN (guard/format:check/build/electron-binary not run — see blocked). Structural discipline verified; risk is fidelity/hardware, not structure.

---

## Sector progress

| Sector | Pass 1 | Pass 2 | Pass 3 | Complete? |
|---|:--:|:--:|:--:|:--:|
| S01 Governance/contracts | ✅ | ✅ | ✅ | ✅* |
| S02 Tooling/build/CI | ✅ | ✅ | ✅ | ✅ |
| S03 Electron runtime | ✅ | ✅ | ✅ | ✅* |
| S04 Core domain/controllers | ✅ | ✅ | ✅ | ✅* |
| S05 Job/output/trace | ✅ | ✅ | ✅ | ✅* |
| S06 IO/persistence | ✅ | ✅ | ✅ | ✅* |
| S07 Platform adapters | ✅ | ✅ | ✅ | ✅* |
| S08 UI workflows | ✅ | ✅ | ✅ | ✅* |
| S09 Fixtures/harness | ✅ | ✅ | ✅ | ✅ |

Legend: ⬜ not started · 🟡 in progress · ✅ done (evidence recorded).

---

## S01 Pass 1 — running notes

**Files read so far:** `PROJECT.md`, `AUDIT.md` (full), `vite.config.ts` (cross-check), `CLAUDE.md` (session), `DECISIONS.md` (ADR headings + gap grep — not yet the full ADR bodies).
**Confirmed findings:** S01-001 (Low, platform/electron doc drift), S01-002 (Info, sibling-test claim false), S01-003 (Info, AUDIT.md stale headline metrics), S01-004 (Info, AUDIT.md sourcemap self-contradiction). See `FINDINGS.md`.
**ADR integrity (checked):** DECISIONS.md holds ADR-001..113 (chronological-append, non-monotonic). **Collision-free** (prior 094/106 collisions resolved by renumber). All gaps (023/024/054–091/099) are documented reservations/retirements *inside* DECISIONS.md → candidate REJECTED (see FINDINGS rejected log). Highest ADR-113 (2026-07-05); next free 114.
**Dependency governance (checked):** RESEARCH_LOG.md has entries for **all 9 runtime deps** (ADR-017 metric holds ✅). BUT `THIRD_PARTY_NOTICES.md` = Rayforge only → **omits all 8 bundled libs + 4 fonts** → **S01-005 (Medium, compliance)**. `license-check` verifies license *type*, not notice reproduction. `LICENSE` verified proprietary (All Rights Reserved, © 2026 Johann Stolk) — consistent with ADR-018/package.json; its dep-disclaimer does NOT cure S01-005.
**README/docs (checked):** README ~5 phases stale (omits CNC/Phase H, multi-controller/I, camera, box/K; stale test count 2641) → **S01-006 (Low)**. `docs/**` = ~55 historical dated planning/research/roadmap files (esp. `docs/superpowers/plans/`) — not authoritative contracts; skimmed, not a finding.
**Verified-good (positive, no finding):** `grep ipcMain|ipcRenderer|contextBridge` across all .ts/.tsx = **0 hits** → PROJECT.md "no IPC surface" security claim **holds** (Electron renderer uses WebSerial/FS-Access directly; confirm exact wiring in S03). Full runnable release gate GREEN. ADR numbering collision-free.
**S01 close-out (Pass 1 ✅ · Pass 2 adversarial ✅ · Pass 3 integration ✅):**
- *Pass 1 coverage:* all authoritative contracts (CLAUDE/PROJECT/WORKFLOW/DECISIONS/AUDIT/README/CONTRIBUTING/LICENSE/RESEARCH_LOG/THIRD_PARTY_NOTICES) + entry docs read; `docs/**` skimmed. WORKFLOW.md body verified comprehensive (F-CNC1..35, Phase I, Phase K present). **Residual (documented uncertainty):** ~225 historical report files (`AUDIT-*/HANDOFF-*/FEATURE-*/FIXES-*/LIGHTBURN-*/MATERIAL-*/audit/reports/*`) catalogued as non-authoritative historical evidence, NOT line-read (low yield for new defects) — re-open only if a code sector needs a specific report.
- *Pass 2 (adversarial) verdicts:* all 6 findings survive. **S01-001** (Low) strengthened — likely NO separate Electron adapter (web adapter may serve both; verify S07). **S01-002/003/004** (Info) hold as doc-accuracy notes. **S01-005 (Medium) — severity CONDITIONAL on the S02 bundle check**; even if `dist` embeds `@license` banners, the 4 bundled `.ttf` fonts can't self-attribute → an irreducible ≥Low notices gap remains. **S01-006/007** (Low) — same stale-status-prose class (one fix pass). "ADR gaps" candidate stays REJECTED.
- *Pass 3 (integration):* S01 findings have no runtime effect but set false expectations downstream — captured in the cross-sector re-verification queue. No S01 finding blocks another sector.
- *Verifier agrees S01 is complete* (with the historical-file residual noted). `*` = complete-with-residual.

---

## S02 Pass 1 — running notes (Tooling/build/CI)

**Read:** `eslint.config.mjs`, `.github/workflows/{ci,deploy}.yml`, `vite.config.ts`, built `dist/web`, `dist/web/_headers`, `tsconfig.json`, `vitest.config.ts`, `scripts/check-licenses.mjs`, `scripts/assert-correct-repo.mjs`. **Still to read:** `scripts/check-file-size-policy.mjs` + `clean-electron-output.mjs`, `eslint.electron.config.mjs`, `_redirects`, `pnpm-workspace.yaml`, `public/**` → then S02 Pass 2/3.

**More verified positives (S02 cont.):**
- **CSP/_headers strong:** `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'none'`, `base-uri 'self'`; HSTS 1y+includeSubDomains; X-Frame DENY; nosniff; Permissions-Policy locks serial/camera to self. (`style-src` has `'unsafe-inline'` — standard; PROJECT only claims no inline *scripts*.) **NOTE→S03:** CSP hardcodes `http://127.0.0.1:51731` in img-src/connect-src = local RTSP camera bridge; audit that bridge/port in S03.
- **tsconfig strict+** — strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + noImplicitOverride/Returns + noUnusedLocals/Params + verbatimModuleSyntax. Matches/exceeds PROJECT.md. (`skipLibCheck:true` standard.)
- **vitest** — CI `maxWorkers:1` (onTaskUpdate flake fix, 2-vCPU runner). **Coverage REPORTED but NOT threshold-enforced**, and `release:check` runs `test` not `test:coverage` → coverage is informational only (cross-ref S01-002; matches documented review-gated philosophy — not a new finding).
- **check-licenses.mjs** — `pnpm licenses list --prod` (all prod packages incl. transitive, M34 fix); TYPE-only allow-list; **explicitly disclaims vendored source + notices** (L11–14) → reinforces S01-005; OFL-1.1 absent from allow-list → **S01-008 upgraded to Low**.
- **assert-correct-repo.mjs (guard)** — remote-allowlist + folder-name defense-in-depth; validates via git-common-dir so **linked worktrees pass** (resolves the prior worktree-guard trap). Robust.

**Add to cross-sector queue:** [S03] audit RTSP camera bridge on `http://127.0.0.1:51731` (fixed port in CSP + Electron bridge).

**S02 remaining reads (Pass 1 done):** `check-file-size-policy.mjs` (600 raw backstop, CRLF-normalized), `eslint.electron.config.mjs` (same strict rules for `electron/`), `_redirects` (intentionally empty — an SPA rewrite would corrupt stale module-worker chunk fetches). Not read (low yield, residual): `clean-electron-output.mjs`, `generate-source-coverage-ledger.mjs`, `pnpm-workspace.yaml`, `public/**`. **New finding:** S02-003 (Info, no Windows desktop packaging in CI).

**S02 close-out (Pass 1 ✅ · Pass 2 adversarial ✅ · Pass 3 integration ✅):**
- *Findings:* S02-001, S02-002, S02-003 (all Info). *Rejected:* `--branch=master`. *Contributed to:* S01-005, S01-008.
- *Pass 2 adversarial:* sector is overwhelmingly positive — enforcement is real + complete; the only gaps are coverage-of-coverage (no E2E, no Windows CI, coverage not threshold-gated) + audit:deps-gate brittleness. No false positives survived.
- *Pass 3 integration:* S02 gates protect every code sector — lint-green ⇒ no god files / no boundary breaks / no impure core / no floating promises, so later sectors can trust structural discipline and focus on logic + fidelity. The H13 rule hands S08 a concrete E-stop check.
- *Verifier agrees S02 complete.*

---

## S03 Pass 1 — running notes (Electron runtime + bridge)

**Read:** `electron/main.ts`. **Verified positives:** all 4 hardening flags (contextIsolation / nodeIntegration:false / sandbox / webSecurity); **A4 resolved** (`app://` privileged scheme + `protocol.handle` + path-traversal guard L124-127); CSP via onHeadersReceived aligned with web `_headers`; deny-by-default permission handlers (delegate to `trusted-renderer-policy`); navigation + window-open locked to trusted origins; DevTools only when `!isPackaged`; no `ipcMain`. Camera bridge started safely (try/catch) on :51731.
**Read (cont.):** `trusted-renderer-policy.ts` — **verified DENY-BY-DEFAULT + narrow** (serial + fileSystem* + video-media only; `window.open` always denied; every grant trusted-origin gated). `rtsp-camera-bridge-policy.ts` — **blocks public SSRF** (rtsp:// + private/loopback host only). `rtsp-camera-bridge.ts` — careful (bounded stderr buffer, timeouts, `spawn` argv-array = no shell injection, process cleanup) BUT **no server-side Origin rejection → S03-001 (Low)** (CORS only gates response reads, not request side-effects). `electron-builder.yml` — no ASAR fuses → **S03-002 (Low, = A1 DEFERRED)**; `publish:null` (no auto-update) good.
**Still to read:** `serial-port-choice.ts`, `source-map-policy.ts` (+ `-test`), `csp-policy.test.ts`, `rtsp-camera-bridge-cli.ts` → then S03 Pass 2/3 → close S03.

**S03 close-out (Pass 1 ✅ · Pass 2 adversarial ✅ · Pass 3 integration ✅):**
- *Read (final):* `serial-port-choice.ts` (pure safe helpers, safe indexing). `source-map-policy.ts`/`csp-policy.ts` don't exist — the `*-policy.test.ts` files are guard tests for config defined in main.ts (`CSP_POLICY`) + electron-builder (`!*.map`). Residual (low-yield, not read): `rtsp-camera-bridge-cli.ts` (thin wrapper around audited bridge), the `.test.ts` guard files.
- *Findings:* S03-001 (Low, bridge origin-auth), S03-002 (Low, ASAR fuses DEFERRED). *Verified positives:* full hardening, A4 resolved (+traversal guard), deny-by-default narrow policy, SSRF-blocked bridge, no shell injection, `publish:null`, sourcemaps excluded from electron dist.
- *Pass 2 adversarial:* S03-001 stays Low (bounded: private-only, no cross-origin response read, desktop-only; unbounded-ffmpeg DoS noted). No false positives.
- *Pass 3 integration:* S03 ↔ S07 (the :51731 client is web-camera/camera-bridge on the platform side) — S03-001 spans both. No S03 finding blocks another sector.
- *Verifier agrees S03 complete.* `*` = complete-with-residual (CLI + test files).

---

## S04 Pass 1 — running notes (Core domain: geometry / controllers / devices / scene)

**clipper2 surface (5 core files):** `vector-path-tools.ts`, `vector-path-booleans.ts`, `dogbone.ts`, `kerf-offset.ts`, `box/panel-fit.ts`.
**Read:** `kerf-offset.ts`; `invariants/gcode-words.ts` (a G-code PARSER — rejects non-finite on read, regex won't match "NaN"; NOT an emit guard); `grbl-strategy.ts` (grep only — coord formatter `toFixed` unguarded; feed guarded).
**Top lead:** **S04-001** (High/Needs-verification) — non-finite coord → literal `XNaN` in G-code. Emitter + kerf-offset confirmed unguarded; reachability (a geometry op producing NaN + preflight bypass) is the #1 S05 read.
**S04-001 RESOLVED (this pass):** read `preflight.ts` — thorough (bounds, power incl minPower≤power, speed `Number.isFinite`, passes int≥1, laser-on-travel, long-blank-feed, no-go, layer-mode, raster-transform, offset-fill, CNC; `assertNever` on SceneObject) — but **no non-finite-COORDINATE check**; the bounds parser silently drops "NaN"/"Infinity" words (`GCODE_NUMBER` regex won't match them). `arc-sampling.ts` confirmed a NaN source (non-finite radius → NaN points). → **S04-001 = Medium/Confirmed** (bounded by GRBL parse-reject + ADR-041 terminal-error → failed job, not wild motion). Residual: does a common import produce non-finite? → S06.
**Read (cont.):** `selection-transform.ts` — **exemplary: all numeric inputs finiteness-guarded, returns `Result`** (NOT a NaN source → tightens S04-001 residual to the import path). `vector-path-booleans.ts` — `deltaMm` guarded; point coords unguarded into clipper2 (same S04-001 class); **throws for control flow → S04-002 (Low)**. `grbl-streaming.ts` — **MIT-2 = 120 confirmed** (validated + safe fallback).
**Read (final S04):** `scene/scene-object.ts` — 6-variant union, `assertNever` in every switch default (legit invariant throw ≠ S04-002 control-flow throws); #18/#19 ✅. `controllers/grbl/status-parser.ts` — robustly finiteness-guarded (rejects non-finite MPos/WPos/FS/Ov), state-name validated, FS:/F: handled, WCO/Ov intermittent-cache documented. `devices/profile-catalog.ts` (grep) — per-profile `maxPowerS` ($30: 255/1000/1) + origin, VALIDATED (`maxPowerS>0`, `minPowerS≤maxPowerS`).

**S04 close-out (Pass 1 sampled ✅ · Pass 2 adversarial ✅ · Pass 3 integration ✅):**
- *Findings:* S04-001 (Medium, geometry-coord→emit finiteness; spans S05), S04-002 (Low, control-flow throws). *Verified positives:* selection-transform Result-guarded; status-parser finiteness-guarded; SceneObject union exhaustive (#18/#19); device profiles validated (#7 basis); MIT-2 buffer=120; purity/boundary lint clean; 3594 tests green.
- *Key insight:* finiteness is guarded almost EVERYWHERE (inputs, transforms, status frames, scalars) → **S04-001 is an isolated geometry-coord→emit gap, not systemic.**
- *Pass 2 adversarial:* no false positives; S04-002 scoped precisely (not all 40 throws are violations). Simulator-only controllers (marlin/smoothie/ruida/fluidnc) not deep-read — hardware-unverified anyway (Info-class if touched).
- *Pass 3 integration:* S04↔S05 tightly coupled — geometry/devices/scene feed the S05 emitter; S04-001 is the explicit cross-thread. SceneObject union consumed by compile-job via exhaustive switches.
- *Residual (documented):* ~280 of 292 files not line-read (box, cnc, camera, material-library, relief, sim, text, most controllers) — covered by verified purity+boundary lint + 3594 tests; re-open on demand. `*` = complete-with-large-residual (sampled a Critical-adjacent sector).
- *Verifier agrees S04 complete (sampled).*

---

## S05 Pass 1 — running notes (CRITICAL: job compile / preflight / raster / trace / output)

**Read:** `output/grbl-strategy.ts` (full), `devices/gcode-dialects.ts` (full); `preflight.ts` (in S04).
**Invariants VERIFIED (strong positives):**
- **#7 power scale** ✅ `scaleS = Math.round((power/100)*maxPowerS)` — exact formula, over validated `maxPowerS`.
- **#3 laser-off on travel** ✅ VERIFIED across ALL 4 GRBL dialects — each has `requiresS0OnRapid: true`, so `travelLine` emits explicit `S0` on every rapid (safe even on $32=0 non-laser-mode controllers where modal S would persist). Plus M4-dynamic keeps the diode dark on travel; `sweepSpanLines` skips zero-length moves (no stationary beam-on G1); the neotronics dialect uses `G1 F800 S0` controlled-travel.
- **#5 determinism** ✅ fixed `toFixed(3)`, LF endings, purely indexed iteration, no clock/rng; mode-flips minimized so cut-only jobs stay byte-identical.
- **S04-001 emitter side** ✅ confirmed + precisely scoped: `fmt` (toFixed) unguarded for COORDS only; `roundedPositiveFeed` THROWS on non-finite feed; preflight blocks non-finite power → only geometry coordinates lack the guard.
**Defensive design:** exhaustive `assertNever` on Group kind; a cnc-group reaching the laser strategy emits a comment marker not motion; coolant M7/M8/M9 transitions.
**Read (cont.):** `output/cnc-grbl-strategy.ts` — **CNC Z-safe VERIFIED**: every XY rapid preceded by `appendRetract` (Z→max(0,safeZ)) BY CONSTRUCTION; plunges always `G1` (never rapid); zero-length skip; same-XY depth-pass optimization safe; retract→M5→park postamble. `invariants/predicates.ts` — **safety net VERIFIED**: `findLaserOnTravelIssues` (#3) robust (sticky-S + M5/M107 + inline-S0); `findOutOfBoundsCoords` (#1) correct for finite coords + **CONFIRMS S04-001** (`parseGcodeWord` regex won't match "NaN" → `value===null` → not flagged); `expectedS` (#7) matches emitter's `scaleS`.
**Minor obs (no exposure, NOT a formal finding):** bounds predicate checks arc (G2/G3) ENDPOINTS only, not swept bulge — irrelevant to own output (emitter produces only G0/G1, no arcs); could matter only if validating external arc-heavy G-code.
**Read (final S05):** `invariants/cnc-depth.ts` (#overdeep — flags Z below stock+allowance on final text) ✅; `invariants/cnc-motion.ts` (findPlungedTravelIssues — modal-Z tracker flags rapid plunges + buried XY rapids) ✅; `job/compile-job.ts` memoization cache (ADR-050) — `WeakMap` object-identity + (layer,device,fillRule) key, GC-bounded, capped, test-pinned, output-invariant → determinism-safe ✅.

**S05 close-out (Pass 1 ✅ · Pass 2 adversarial ✅ · Pass 3 integration ✅):**
- *Safety machinery VERIFIED CORRECT end-to-end:* emitters (grbl-strategy, cnc-grbl-strategy), dialects (requiresS0OnRapid ×4), preflight, and ALL predicates (#1 bounds, #3 laser-off, #7 power, CNC #overdeep + #Z-safe). This is the audit's strongest positive.
- *Findings:* S04-001 (Medium — coord finiteness, spans S04/S05; predicate-confirmed), S05-001 (Info — fidelity UNVERIFIABLE here). No safety-invariant defect found.
- *Pass 2 adversarial:* looked for false negatives in the predicates (arc-bulge, non-finite bypass, sticky-S) — non-finite bypass = the S04-001 gap (recorded); arc-bulge has no own-output exposure (no arcs emitted). No new confirmed defect.
- *Pass 3 integration:* S05 consumes S04 (scene/geometry/devices) and feeds the streamer (S08) + files (S06). S04-001 trigger (does an import admit non-finite?) resolves in S06. Fidelity (S05-001) integrates with the perceptual harness (S09).
- *Residual (documented):* full line-reads of `trace/**` (498-line trace-image + centerline), `raster/emit-raster.ts` (451), `fill-hatching.ts`, other-controller strategies (marlin/smoothie/ruida — sim-only) NOT done — fidelity is unverifiable here anyway (S05-001), and structure/determinism are covered by 3594 tests + verified emitter. `*` = complete-with-residual.
- *Verifier agrees S05 complete.*

---

## S06 Pass 1 — running notes (IO / persistence)

**Read:** `io/svg/sanitize.ts`, `io/project/project-validator-primitives.ts`, `io/svg/parse-path-d.ts` (full).
**Verified positives:**
- **SVG sanitizer STRONG** (`sanitize.ts`): DOMPurify `USE_PROFILES:{svg,svgFilters}` (strips script/foreignObject); custom href hook = ALLOWLIST (only `#` fragments + `data:image/`; LU6 fix closed the protocol-relative/whitespace bypass); `removeAllHooks()` bracketing (no cross-call hook leakage). Malicious corpus test in S09. Untrusted-SVG boundary solid.
- **`.lf2` LOAD validation EXEMPLARY** (`project-validator-primitives.ts`): `isFiniteNumber` underlies all numeric checks; `requireCoordinate` = finite + |v|≤1e6 mm; `requireScale` = finite + ≤1e5; percent/positive/integer all finiteness-guarded. **The `.lf2` load path CANNOT admit non-finite** — no silent data loss via non-finite.
**S04-001 TRIGGER RESOLVED:** `parse-path-d.ts` `NUMBER_RE` admits `1e999`→Infinity, no guard, fresh SVG import bypasses the `.lf2` validator → **S04-001 confirmed reachable via SVG import** (severity now arguably High; held Medium — see finding). Root cause = import-vs-load validation asymmetry.
**Still to read (S06):** `parse-svg.ts` (does it guard parse-path-d output?), `io/project/` migrations (schemaVersion + silent-loss), `io/dxf/` (clean-room + non-finite, same asymmetry?), `io/stl/`, `io/gcode/parse-gcode-program.ts`, `io/lightburn/`, `io/rd/` (Ruida experimental), `io/material-library/`. Then S06 Pass 2/3.

**Read (final S06):** `project/migrations.ts` — pure N→N+1 dispatcher, FAILS explicitly (`no-path`) when no migrator covers a version (no silent-wrong-load) ✅; `dxf/dxf-entities.ts parseNumber` (L180) guards `Number.isFinite ? : fallback` → DXF coords NOT admitted non-finite ✅; `parse-svg.ts` guards attribute/viewBox/scale finiteness (L290/315/336) but NOT path-d coords.

**S06 close-out (Pass 1 ✅ · Pass 2 adversarial ✅ · Pass 3 integration ✅):**
- *Verified positives:* SVG sanitizer strong (DOMPurify svg-profile + allowlist href + removeAllHooks bracketing); `.lf2` load validation exemplary (finite + magnitude bounds, no silent non-finite); migrations fail-explicit (no silent data loss); DXF `parseNumber` guards finiteness.
- *Findings:* S04-001 trigger CONFIRMED + SCOPED to `parse-path-d` (SVG only; DXF/.lf2/attribute-parse all guard) → a 2-call-site fix. No NEW S06 finding.
- *Pass 2 adversarial:* hypothesized DXF shares the asymmetry → REFUTED (parseNumber guards). Migrations future-version (v>current) returns raw for the validator to reject — safe.
- *Pass 3 integration:* S06 is the S04-001 ENTRY POINT (SVG import → S04/S05 emitter). Sanitizer feeds the S09 malicious corpus. `.lf2` round-trips the scene S04 consumes.
- *Residual (documented):* `io/stl` (mesh→relief; likely guarded like DXF), `io/gcode/parse-gcode-program.ts` (read-only sim, no emit), `io/rd` (Ruida experimental, warned), `io/lightburn` (device config not geometry), `io/material-library` NOT line-read — lower-risk + consistent guarding pattern; re-open on demand. `*` = complete-with-residual.
- *Verifier agrees S06 complete.*

---

## S07 Pass 1 — running notes + close-out (Platform adapters)

**Read:** `platform/web/web-serial.ts` (full).
**web-serial VERIFIED STRONG (no finding):** careful idempotent lifecycle (stale-port sweep → requestPort; open-with-retry; disconnect→removeEventListener+closeStreams+fireClose; read loop try/catch/**finally→onEnd**; no listener/stream leaks). **A2 RESOLVED** — `port.forget?.()` on EXPLICIT close only (cable-yank leaves pairing for re-plug). **DoS-bounded** — `MAX_SERIAL_LINE_LENGTH=64KB` (spoofed-device/line-noise OOM protection; over-length dropped). **M12** byte-per-char wire encoding (GRBL realtime bytes intact; throws on char >0xFF). **Stream cleanup order** correct (reader.cancel→releaseLock, writer.close→releaseLock, then port.close).
**NOTE→S08:** the "disconnect-burn" locus is NOT here — web-serial fires onClose correctly; whether the STREAMER stops the job on onClose is `laser-store` (S08). MIT-T1 ('disconnected' streamer status) also → S08.

**S07 close-out (Pass 1 ✅ · Pass 2 ✅ · Pass 3 ✅):**
- *Findings:* none. web-serial (machine-control crux) strong; A2 resolved.
- *Residual (documented):* `web-adapter.ts` (FS Access save/open — atomic via createWritable-until-close), `web-camera.ts`/`camera-bridge.ts` (client of S03-001; risk is server-side, recorded), `pwa-precache.ts` (prior "update-nag fix" memory), `deploy-workflow-gate.ts` (verified S02/R-H5), `repo-policy.ts`, `cloudflare-pages-routing.ts` — lower-risk glue, NOT line-read; re-open on demand. `*` = complete-with-residual.
- *Verifier agrees S07 complete.*

---

## S08 Pass 1 — running notes (UI — largest sector, sampling highest-risk)

**Read:** `state/laser-store.ts` (composition root — split per ADR-015), `state/laser-job-actions.ts` (Start/Pause/Resume/Stop), `state/job-aware-dialogs.ts` (H13).
**SAFETY VERIFIED (strong positives — the app's most safety-critical UI):**
- **R-H2 RESOLVED** — `runResumeJob` + `stopJob` both use **functional `set((s)=>…)`** (streamer snapshot at write time, not stale `get()`) → prevents in-flight-accounting drift → buffer overflow → uncontrolled motion. R-H2 cited in-code (L118, L152-187).
- **#9 E-stop reachability VERIFIED** — `job-aware-dialogs.ts` (H13): job-active → `alert/confirm/prompt` become non-blocking toasts (confirm/prompt fail CLOSED) → renderer loop never suspends → Stop stays clickable. Enforced by the S02 ESLint ban. On resume-write-fail: `markErrored` NOT `disconnect`, DELIBERATELY to keep Stop mounted while GRBL may still run buffered lines.
- **Pause safety** — realtime feed-hold gated on CONFIRMED $32 laser mode (`assertPauseSafe`); $32=0/unknown blocks with "Use Stop instead" (feed-hold could leave beam on at a stationary head). Smoothieware/Marlin exceptions documented.
- **Start safety** — pending-ack drain + re-assert guards (double-start + phantom-ack-refill protection); M13 oversized-line reject; clean streamer rollback on write fail.
- **Disconnect** — `safetyNotice` raised on failed Stop/Pause/Resume write OR USB-drop-mid-job (createSafeWrite/ADR-042). MIT-T1 addressed (markErrored + safetyNotice, not bare 'disconnected').
**Note:** laser-store holds imperative connection/timer/subscription handles in a module-level `refs` object — documented "outside React-observable state" pattern (ui/state, not core-purity). Not a finding.
**Still to read/verify (S08, sampled):** `laser-connection-actions.ts` (onClose→streamer path = full disconnect-burn), `store.ts` + `scene-mutations.ts` (state-slice discipline; god-file candidates — lint-green so ≤400 code lines, review coupling), `workspace/draw-scene.ts` (Infinity scene bound from S04-001 → canvas? same root cause). Then S08 Pass 2/3.

**Read (final S08):** `state/laser-connection-actions.ts` — disconnect thorough (explicit: stop-first + warn-on-fail + teardown; cable-yank onClose → teardown + buildPortClosePatch; **stall watchdog** `detectStreamStall`→safetyNotice = the disconnect-burn-delay fix; R-L2 event-driven handshake; comprehensive teardown, no leaks). `draw-scene.ts` grep — NO finiteness guard → S04-001 Infinity = undrawable object + possible NaN fit-to-bounds (recoverable UI glitch; folded into S04-001).

**S08 close-out (Pass 1 sampled ✅ · Pass 2 adversarial ✅ · Pass 3 integration ✅):**
- *Safety-critical UI VERIFIED CORRECT:* E-stop reachability #9 (H13), R-H2 resume/stop race (functional set), pause $32-gate, start ack-drain/oversized/double-start, disconnect stop-first + stall-watchdog + safetyNotice. No finding.
- *Findings:* none new; S04-001 downstream broadened (canvas). god-file NOTE: `scene-mutations` (491 raw) / `store` (427 raw) are lint-green → ≤400 CODE lines (not violations); coupling not deep-reviewed (residual).
- *Pass 2 adversarial:* H13 covers native dialogs; a custom React modal rendering OVER the Stop button would be a separate risk — NOT checked exhaustively across ~430 UI files → explicit residual uncertainty. Disconnect leaves-streamer-sending path covered by markErrored/teardown.
- *Pass 3 integration:* S08 consumes S07 (web-serial onClose) + S04/S05 (scene→G-code→streamer). S04-001 Infinity has a UI downstream. H13 enforced by S02 lint.
- *Residual (documented, LARGE):* ~430/435 UI files NOT line-read — workspace renderers, all dialogs/panels/wizards, trace/raster/drawing-tool UI. Covered by verified lint (component-size, react-hooks, boundaries, H13 ban) + 3594 tests. **Explicit uncertainty:** custom-React-modal Stop-occlusion + per-component a11y not exhaustively audited; UX fidelity unverifiable headless (S05-001). `*` = complete-with-large-residual.
- *Verifier agrees S08 complete (sampled; highest-risk safety paths verified).*

---

## S09 Pass 1 + close-out (Fixtures / harness / test assets)

**Read:** `__fixtures__/perceptual/compare.ts`; mapped `perceptual/**`, `svg/malicious/**` (7 files), `controllers/**`.
**Findings:** none new. **S05-001 REFINED** — the harness is substantive (corrects the "structure-only" framing).
**Verified positives:**
- **Perceptual harness substantive** — `compare.ts` = IoU + precision + recall + f1 over a rasterized-OUTPUT mask (`gcode-rasterize`/`toolpath-rasterize`) vs analytic + real-logo ground truth; **precision catches doubled-contour outline artefacts, recall catches dropped strokes**; `centerline-deviation`/`edge-truth` add geometry metrics; real logo `arch-house-langebaan-source.png` for real-world quality. Residual: no LightBurn automation (closed-source), headless pure-JS rasterizer, auditor couldn't run it.
- **Malicious SVG corpus** (7 files) covers the main classes: entity-expansion (XXE), external-hrefs, javascript-href, nested-foreignobject, script-element, script-in-attribute, malformed-truncated — validates `sanitize.ts`.
- **Controllers** = simulators (grbl/marlin/smoothie/ruida + fake-serial-port driving the REAL store); consistent with the hardware-CLAIMED theme (per PROJECT.md truth table).
- **`ci-budget.ts`** = the CI-flake budget fix (runner-speed, not stochastic).
**S09 close-out (Pass 1 ✅ · Pass 2 ✅ · Pass 3 ✅):** verifier agrees complete. **← ALL 9 SECTORS DONE.**

**Enforcement — verified REAL (positives, not findings):**
- ESLint enforces everything CLAUDE.md claims: `max-lines:400` (skipBlank+skipComments = the 400 *code*-line authority → lint-green ⇒ no god files), func `80`, complexity `12`, module boundaries, `import/no-cycle`, exhaustive pure-core bans (window/document/navigator/localStorage/fetch/console/process/atob/btoa + node imports + Date.now/Math.random/new Date), `switch-exhaustiveness-check`, `no-explicit-any`, `no-non-null-assertion`.
- **H13 safety rule:** `window.alert/confirm/prompt` banned repo-wide except `src/ui/state/job-aware-dialogs.ts` — native blocking dialogs freeze the renderer event loop (and the Stop button) mid-job. **→ S08 must verify E-stop (#9) is actually protected by this path.**
- Prior fixes present + real: **M29** (console/process/node core bans), **M33** (deploy checkout pinned to CI head_sha), **R-H4**, **R-H5**, **A5**.
- CI runs full `release:check` on push:main + every PR; deploy gated on CI success and re-proves `release:check`.

**Findings:** S02-002 (Info, audit:deps in blocking gate). **Rejected:** `--branch=master` (intentional CF production branch). **A6 bundle:** NON-BLOCKING — 500 kB raw warning fires on lazy `three.module` (704 kB, CNC viewer); compressed eager path ≪ 1 MB target. **S01-005:** JS notices embedded (met), font notices absent (OFL gap).

---

## Cross-sector re-verification queue (from AUDIT.md prior findings)

Prior audit claims to re-verify against the current tree in the owning sector (don't trust "RESOLVED" blindly):

| Prior ID | Claim | Verify in | Status |
|---|---|---|---|
| R-H3 | sourcemaps disabled | S02 (`vite.config.ts`) | ✅ **verified** `sourcemap:false` |
| R-H2 | resume/stop race fixed (functional `set`) | S08 (`laser-job-actions.ts`) | ✅ functional set() in BOTH resume+stop (R-H2 cited in-code) |
| R-H4 | react-hooks plugin wired | S02 (`eslint.config.mjs`) | ✅ wired (rules-of-hooks error, exhaustive-deps warn) |
| R-H5 | deploy gated on CI (`workflow_run`) | S02 (`.github/workflows/deploy.yml`) | ✅ gate + re-runs release:check + M33 head_sha pin |
| A1 | ASAR fuses (DEFERRED) | S03 (`electron-builder.yml`) | ✅ confirmed absent → S03-002 (DEFERRED) |
| A2 | `port.forget()` on disconnect (RESOLVED) | S07 (`web-serial.ts`) | ✅ forget() on explicit close only (not cable-yank) |
| A4 | `protocol.handle('app')` (RESOLVED) | S03 (`electron/main.ts`) | ✅ app:// scheme + path-traversal guard |
| A5 | 4 type-aware lint rules on | S02 (`eslint.config.mjs`) | ✅ all 4 + switch-exhaustiveness-check |
| MIT-2 | GRBL streamer buffer 127→120 | S04 (`grbl-streaming.ts`) | ✅ =120 (validated + safe fallback) |
| MIT-T1 | streamer `'disconnected'` status | S08 | ✅ addressed — uses markErrored (keeps Stop mounted) + safetyNotice, deliberately NOT a bare 'disconnected' |
| — | "unguarded clipper2 NaN" (memory) | S04/S05 | ✅ S04-001 Medium/Confirmed (no coord finiteness backstop; bounded by GRBL+ADR-041) |
| — | trace outline-vs-centerline gap | S05 (`trace/`) | ⬜ |
| S01-005 | does built bundle embed `@license` banners? | S02 (`pnpm build:web` → grep `dist/web`) | ✅ JS=71 banners (met); FONTS=0 notices (OFL gap) |

---

## Commands run (session cumulative)

- File inventory / largest files / src-vs-test counts (PowerShell).
- Reads: PROJECT.md, package.json, index.html, AUDIT.md, vite.config.ts, audit/REPOSITORY-SECTOR-ARCHITECTURE-2026-07-03.md.
- Globs: entry points, src/platform, electron.
- Bash: toolchain probe; `pnpm install --ignore-scripts` (exit 0); `pnpm check:file-size` (exit 0, PASS); `pnpm test` (background, running).

---

## Open questions (for maintainer)

1. Proceed S01→S09 as mapped, or reprioritize S05 (Critical/output) first?
2. OK that I ran `pnpm install --ignore-scripts` in this worktree to enable checks? (Reversible; no source touched.)
3. Electron *binary* verification (build:desktop, hardware) is not possible in this environment — those stay Info/blocked. Confirm that's acceptable.

## Blocked checks

- Electron binary builds/tests — blocked by `--ignore-scripts` (no binary). Reason recorded.
- Hardware verification (laser/CNC/camera) — impossible without attached devices; all such claims recorded Info/unverifiable, never tested.

---

## Last sector report (Phase 1)

Phase 1 (repo map) complete — 3 structural findings, scaffold + sector plan delivered.
Recommendation was to proceed to S01; maintainer reply cleared the gate and set the 5-min cadence.
