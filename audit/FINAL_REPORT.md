# FINAL_REPORT.md — LaserForge 2.0 / KerfDesk whole-repo audit

**Date:** 2026-07-05 · **Branch:** `claude/gifted-goldstine-28dc0b` · **Mode:** findings-only (no source modified)
**Method:** 9 sectors (S01–S09), 3 passes each (broad → adversarial → integration; large sectors sampled highest-risk with residual documented). Every finding is evidence-backed (file:line + command output). Full detail in `FINDINGS.md`; per-sector working notes + verified positives in `AUDIT_STATE.md`; verified lessons in `MEMORY.md`.

---

## 1. Executive summary

**Verdict: this is a structurally excellent, safety-conscious codebase. No Critical, no High findings. The machine-safety machinery is verified correct end-to-end.** The single most actionable code issue (S04-001) is **Medium** (arguably High) and has a **~2-line fix**. Everything else is licensing/compliance or documentation drift.

What the audit **verified correct** (the important part for a laser/CNC tool):
- **G-code safety invariants** — laser-off-on-travel (#3), power-scale honesty (#7), determinism (#5), bounds (#1), and the CNC Z-safe/overdeep invariants — are correctly implemented in the emitters *and* independently re-checked by the preflight predicates, across **all four GRBL dialects** (`requiresS0OnRapid: true` everywhere) and the CNC strategy (retract-before-travel by construction). [S05]
- **E-stop reachability (#9)** — the H13 `job-aware-dialogs` mechanism guarantees no native modal can suspend the renderer while a job runs, so **Stop stays clickable**; enforced by an ESLint ban. The resume/stop concurrency race (R-H2) is resolved (functional `set`), Pause is gated on confirmed `$32` laser mode, and disconnect handling is stop-first with a stall watchdog. [S08]
- **Untrusted-input boundaries** — SVG sanitizer (DOMPurify + allowlist href hook), `.lf2` load validation (finite + magnitude bounds), DXF number guards, and the Electron trust boundary (contextIsolation/sandbox, deny-by-default permissions, `app://` + path-traversal guard, no `ipcMain`) are all solid. [S03, S06]
- **Enforcement is real** — the ESLint/CI gates that the docs claim (file-size 400 code-lines, module boundaries, pure-core, no-floating-promises, license allow-list) are actually configured and green: **3594 tests pass, 0 lint problems, 0 dependency vulnerabilities.** [S02]

**Finding tally: 0 Critical · 0 High · 2 Medium · 7 Low · 7 Info (16 total) · 2 rejected false-positives.**

The biggest *unmeasured* risk is not a defect but a **verification gap**: output **fidelity vs LightBurn** and **real-hardware behavior** cannot be validated in this headless audit, and several Phase H/I/K/camera features are coded + test-passing but **hardware-CLAIMED, not hardware-verified** (the project's own `AUDIT.md` says so). That is the maintainer's remaining work, not a code fix.

---

## 2. Architecture summary

TypeScript / React / Vite / Electron GRBL-laser + CNC CAM app. Pure `core/` pipeline → `io/` formats/persistence → `platform/web` + `electron/` adapters → G-code file or WebSerial stream. No backend, no network by contract. Strict module boundaries, file-size limits, discriminated-union state, and property/snapshot tests are all CI-enforced. Full map: `ARCHITECTURE.md`. Sector division + risk: `SECTORS.md`.

Standout engineering quality observed repeatedly: finiteness guards almost everywhere; idempotent lifecycle + leak-free cleanup in the serial layer; defensive re-checks of safety invariants on the *emitted text* (not just at the source); and unusually careful, well-commented reasoning about laser-safety edge cases (feed-hold vs `$32`, stationary-beam skips, phantom-ack buffer overflow).

---

## 3. Highest-risk sectors (as audited)

| Rank | Sector | Why | Outcome |
|---|---|---|---|
| 1 | **S05 Output/job/trace** (Critical) | The G-code + all 9 safety invariants | **Verified correct.** 1 Medium (S04-001, spans S04), 1 Info (fidelity gap). |
| 2 | **S08 UI** (High, largest) | E-stop reachability, disconnect, state | **Safety paths verified correct.** No finding; large residual documented. |
| 3 | **S06 IO** (High) | Untrusted parsers + persistence | Strong. Hosts the S04-001 *entry point* (SVG import). |
| 4 | **S03 Electron** (High) | Trust boundary + local bridge | Hardened. 2 Low (bridge origin-auth, ASAR fuses-deferred). |
| 5 | **S04 Core** (High) | Geometry / clipper2 NaN / devices | Strong. 1 Medium (S04-001), 1 Low (throw-for-control-flow). |
| 6 | **S02 Tooling/CI** (High) | The only enforcement of invariants | Enforcement real + complete. 3 Info (coverage-of-coverage gaps). |

---

## 4. Findings — Critical / High

**None.** No Critical or High finding survived verification.

> Note: **S04-001 is rated Medium but flagged "arguably High"** — see §5. It is the one finding where the maintainer may reasonably choose High. It is listed first in the fix order regardless.

---

## 5. Findings by severity (see `FINDINGS.md` for full evidence)

### Medium (2)

- **S04-001 — No finiteness backstop on geometry coordinates → malformed G-code, reachable via SVG import.** `parse-path-d.ts` parses SVG `d` numbers with bare `Number()`, so `Number("1e999")` → `Infinity` enters scene coordinates unguarded; the emitter formats it as literal `XInfinity` (`grbl-strategy.ts:36` `toFixed`), and the `#1` bounds preflight **can't parse "Infinity"/"NaN"** so it does **not** flag it. Bounded downstream (GRBL rejects the malformed word + ADR-041 stops the stream → a *failed* job, not dangerous motion), which holds it at Medium. Also disturbs the canvas (undrawable object + possible NaN fit-to-bounds). **Root cause = import-vs-load asymmetry**: the `.lf2` *load* path validates coordinates (finite + `|v|≤1e6`) but SVG *import* does not. **Fix is ~2 call sites** in `parse-path-d.ts` (guard `Number()` with the `.lf2` validator's finiteness+magnitude check), ideally plus a preflight `non-finite-coord` backstop. *(DXF is NOT affected — its `parseNumber` guards.)*
- **S01-005 — Bundled fonts ship with no license notice (compliance).** The 4 bundled fonts are Apache-2.0 + **OFL-1.1** (not "MIT" as PROJECT.md says — see S01-008), and OFL-1.1 **requires** the license/copyright accompany the font in distribution. The built `dist/web` embeds JS `@license` banners (71) so the *libraries* are covered, but the binary `.ttf` fonts have **no notice** anywhere in the bundle, and `THIRD_PARTY_NOTICES.md` lists only "Rayforge." `license-check` passing does **not** cover this (it checks license *type* on npm packages only; vendored assets are out of scope by its own admission).

### Low (7)

- **S03-001** — RTSP camera bridge (`:51731`) sets CORS headers but never *rejects* non-allowlisted origins server-side; while the desktop app runs, any web page can trigger blind LAN RTSP probes / unbounded `ffmpeg` spawns (bounded: private-hosts only, no cross-origin response read, no code exec).
- **S03-002** — Electron ASAR fuses not flipped (`electron-builder.yml` has no `@electron/fuses`/`afterPack`). DEFERRED — matters only at first *signed* release (= prior AUDIT.md A1).
- **S04-002** — `vector-path-booleans.ts` throws for control flow (expected user-input errors the UI catches) instead of returning `Result` — CLAUDE.md's own anti-pattern, un-enforced by lint, inconsistent with `selection-transform.ts`. (~40 `throw new` in core; most are legitimate `assertNever`/invariant throws — needs per-site triage, do not bulk-convert.)
- **S01-001** — PROJECT.md Stack section references a `platform/electron/` dir that doesn't exist (adapter lives in top-level `electron/`); contradicts PROJECT.md's own module-layout section.
- **S01-006** — README (the "entry index") is ~5 phases stale — omits the entire CNC/multi-controller/camera/box surface + stale test count.
- **S01-007** — `WORKFLOW.md` header + `CONTRIBUTING.md` intro claim "through Phase F.1/F.3" while the WORKFLOW body actually contains all the CNC/multi-controller/box flows (~1000 lines) — stale status prose, not missing content.
- **S01-008** — PROJECT.md calls the bundled fonts "MIT"; they're Apache-2.0 + OFL-1.1, and **OFL-1.1 is not in the ADR-017 allow-list nor `check-licenses.mjs`** (they pass CI only because vendored fonts aren't scanned). Policy/enforcement gap feeding S01-005.

### Info (7) — observations / verification gaps, not defects

- **S01-002** — non-negotiable #16 ("every source file has a `.test.ts` sibling") is neither true (824 src / 584 test) nor CI-enforced.
- **S01-003** — `AUDIT.md`'s headline "at a glance" table is a stale 2026-05-28 snapshot (520 files vs 824+ now).
- **S01-004** — `AUDIT.md` external-check #5 says `sourcemap:true` "acceptable" while the config is `false` and its own R-H3 says fixed — self-contradiction (R-H3 is genuinely resolved).
- **S02-001** — Playwright/E2E is named in PROJECT.md but absent from deps + CI.
- **S02-002** — `audit:deps` (`--audit-level=low`, all deps) sits inside the blocking release gate — stricter than the stated "direct dependency" policy and makes the gate time-dependent (a new transitive advisory can block all deploys).
- **S02-003** — CI runs ubuntu-only; the Windows desktop `.exe` (a primary target) is never packaged/smoke-tested in CI.
- **S05-001** — Output **fidelity vs LightBurn** is not automatable (LightBurn is closed-source) and could not be perceptually reviewed in this headless audit. *The project's perceptual harness is substantive* (IoU + precision/recall/f1 over rendered output vs analytic + real-logo ground truth; precision catches doubled-contour outline artefacts) — this is a residual verification gap, not a missing capability.

### Rejected false-positives (2, logged in `FINDINGS.md`)
- "ADR numbering has undocumented gaps" — every gap is documented inside `DECISIONS.md` (reserved/retired); numbering is collision-free.
- "`--branch=master` deploy is wrong" — intentional; the Cloudflare Pages production branch is `master` (documented in `deploy.yml`).

---

## 6. Suggested fix order

1. **S04-001** (Medium/arguably-High, cheap + high-value) — add the finiteness+magnitude guard at the SVG import boundary (`parse-path-d.ts` `Number()` sites), mirroring the `.lf2` validator; optionally add a preflight `non-finite-coord` check as defense-in-depth. Bug-fix workflow: write a failing test (`d="M 1e999 0 …"` → import → expect rejection/clamp), then fix. Closes the G-code *and* canvas effects.
2. **S01-005 + S01-008** (compliance, one pass) — generate a complete third-party-notices file covering bundled libs **and** the OFL/Apache fonts; add OFL-1.1 to the ADR-017 allow-list (or reconsider fonts); correct PROJECT.md's "MIT fonts" wording.
3. **S03-001** (Low, defense-in-depth) — reject non-allowlisted `Origin` server-side in the camera bridge (the allowlist is already computed) + a per-session token + an ffmpeg-concurrency cap.
4. **Doc refresh** (S01-001/003/004/006/007, S02-001, one docs-only PR) — the "status prose froze ~Phase F–G" cluster: refresh README/WORKFLOW-header/CONTRIBUTING status, the AUDIT.md headline table + sourcemap contradiction, and the platform/electron reference. **These are docs-only** — no test change, low risk.
5. **Deferred / policy** — S03-002 (fuses, before first signed release), S02-002 (audit:deps gate policy), S02-003 (add a Windows CI job), S04-002 (Result-vs-throw triage), S01-002 (reword or enforce sibling-test claim). Maintainer's discretion.

---

## 7. Regression risks (what could break during future fixes)

- **The emitters + dialects + preflight predicates are load-bearing and byte-snapshot-tested.** Any change to `grbl-strategy.ts`, `cnc-grbl-strategy.ts`, `gcode-dialects.ts`, `emit-raster.ts`, or the `invariants/` predicates will trip the G-code snapshot tests — that's by design; require a `Snapshot change acknowledged:` line and re-verify the 9 invariants.
- **The S04-001 fix must not alter *valid* geometry** — clamp/reject only non-finite (and optionally over-magnitude) values; finite-huge coordinates are already caught by preflight bounds, so don't double-handle them.
- **`laser-store` + its action modules are a tightly-reasoned safety unit** — the functional-`set` (R-H2), `markErrored`-not-`disconnect` (keep-Stop-mounted), and `$32`-gated Pause choices are deliberate. Read the in-code comments before touching; a naive "simplification" here is a laser-safety regression.
- **The H13 dialog ban is enforced by ESLint** — new UI that needs a confirm/prompt during a job must go through `job-aware-dialogs.ts`, not raw `window.*`.

---

## 8. Test recommendations

- **S04-001 regression test** (import a `1e999`/`Infinity` SVG path → assert it's rejected/clamped before it reaches the scene) — this is the one genuine coverage gap in an otherwise dense suite.
- **Add a Windows CI job** running `build:desktop` + a minimal smoke (S02-003), or document desktop packaging as release-manual.
- **Consider a preflight property test** asserting *no emitted coordinate is non-finite* over fuzzed scenes (would have caught S04-001 structurally).
- **Fidelity/hardware (maintainer, out of automation):** run the perceptual harness + a LightBurn side-by-side on the trace/fill/raster corpus; execute the standing air-cut / Falcon burn protocols to move Phase H/I/K/camera features from CLAIMED → VERIFIED.

---

## 9. Files that should NOT be touched without caution

- `src/core/output/grbl-strategy.ts`, `src/core/output/cnc-grbl-strategy.ts`, `src/core/devices/gcode-dialects.ts` — the G-code + safety invariants; snapshot-locked.
- `src/core/invariants/*.ts`, `src/core/preflight/preflight.ts` — the safety net that proves the invariants on emitted text.
- `src/ui/state/laser-job-actions.ts`, `laser-connection-actions.ts`, `laser-safe-write.ts`, `job-aware-dialogs.ts` — the E-stop / streaming / disconnect safety unit.
- `src/platform/web/web-serial.ts` — serial lifecycle (leak-free, DoS-bounded, realtime-byte-exact).
- `src/io/svg/sanitize.ts` — the untrusted-SVG boundary.
- `electron/main.ts` + `trusted-renderer-policy.ts` — the desktop trust boundary.

---

## 10. Unanswered questions / documented uncertainty

- **Fidelity vs LightBurn** and **real-hardware behavior** — not verifiable in this environment (no render, no devices, LightBurn closed-source). The single largest open risk area, by the project's own account.
- **S08 residual** — ~430 of 435 UI files were not line-read (covered by verified lint + 3594 tests). Specifically **not** exhaustively audited: whether a *custom React modal* could visually occlude the Stop button (H13 covers native dialogs only), and per-component WCAG 2.2 AA a11y.
- **S04/S05 residual** — ~280 of 292 core files and ~5 large trace/raster files not line-read (fidelity unverifiable here anyway; structure/determinism covered by tests + the verified emitter).
- **Historical corpus** — ~225 dated report files under root + `audit/` catalogued as non-authoritative history, not line-read.
- **Simulator-only controllers** (FluidNC/Marlin/Smoothieware/Ruida) — correctness rests on the `__fixtures__/controllers/` simulators; real-firmware parity is unverified (documented in PROJECT.md's truth table).

---

## Bottom line

For a tool that drives lasers and routers, the things that matter most — **can it start a fire on travel, can you always hit Stop, is the G-code deterministic and in-bounds, is untrusted input contained** — are **verified correct**. The work remaining is (a) one small, high-value robustness fix (S04-001), (b) a licensing/notices cleanup (S01-005), (c) a documentation refresh, and (d) the fidelity + hardware verification that only the maintainer can run. No source was modified by this audit.
