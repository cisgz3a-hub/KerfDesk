# MEMORY.md — Verified lessons for the audit

> Audit-scoped memory (distinct from the maintainer's session auto-memory). Only
> **verified** lessons — each with the evidence that established it and a rule for
> future passes. No guesses. Update in Step 6 of each sector loop.

---

Lesson:   The repo has two names by design — **KerfDesk** (user-facing product/URL) and **LaserForge 2.0 / `laserforge`** (repo, package, internal architecture). App-brand strings like "KerfDesk" are intentional.
Evidence: `index.html:8` `<title>KerfDesk</title>`; `package.json:2` `"name": "laserforge"`; `PROJECT.md` "Naming contract". Prior memory: "app brands itself KerfDesk — don't 'fix' those strings."
Where it applies: S01, S08 (any string/branding finding).
Rule for future passes: Never flag KerfDesk↔LaserForge duality as a bug; it is a documented contract.
Date/pass: 2026-07-05 / Phase 1.

---

Lesson:   `src/core/` is contractually **pure** — no disk/net/`process`/`navigator`/`window`/`document`, no `Date.now()`, no RNG, no `console.*`, no throw-for-control-flow (return `Result<T,E>`). Enforced by ESLint `no-restricted-globals`/`no-restricted-imports` + `eslint-plugin-boundaries`.
Evidence: `CLAUDE.md` "Pure core" + "Imports — boundaries enforced"; `PROJECT.md` non-negotiables 10–12.
Where it applies: S04, S05.
Rule for future passes: In `src/core`, treat any clock/rng/global/IO use as a High candidate (invariant + purity violation). Pass time/RNG in as params.
Date/pass: 2026-07-05 / Phase 1.

---

Lesson:   Green tests prove **structure + determinism only**, never **fidelity**. The suite asserts SVG prefixes, path counts, byte-identical G-code over fuzz seeds. It does not prove a trace/fill/engrave/raster looks like its source. Even the IoU perceptual harness does not catch the outline-vs-centerline trace gap.
Evidence: `CLAUDE.md` rule 2; `PROJECT.md` Phase E note ("not caught by the IoU harness"); maintainer auto-memory "Karpathy's law".
Where it applies: S05 (trace/fill/raster), S08, S09.
Rule for future passes: Never record a fidelity feature as "working" from green tests. A fidelity claim resting only on `pnpm test` is itself an Info finding.
Date/pass: 2026-07-05 / Phase 1.

---

Lesson:   Many Phase H/I/K features are coded + test-passing ("Built") but the hardware/physical-fit/fidelity pass is **CLAIMED/unverified**. Hardware truth: only GRBL v1.1 + grblHAL are hardware-verified (Falcon A1 Pro, 2026-07-02); FluidNC/Marlin/Smoothieware/Ruida are simulator-only.
Evidence: `PROJECT.md` Phase H table "Status: Built ... hardware pass still CLAIMED"; Phase I "Hardware truth table"; Phase K "hardware fit CLAIMED"; `AUDIT.md` inventory (to read in S01).
Where it applies: S01, S03, S04, S05, S07.
Rule for future passes: Distinguish "code exists + tests pass" from "verified against hardware/LightBurn." The latter is mostly absent; record it as Info, not as proof the feature is correct.
Date/pass: 2026-07-05 / Phase 1.

---

Lesson:   A large prior audit corpus already exists and is recent — `audit/REPOSITORY-SECTOR-{ARCHITECTURE,AUDIT,PROGRESS}-2026-07-03.md` (the AUDIT file is ~322 KB) plus ~90 dated reports under `audit/reports/` and `audit/findings/`. The 2026-07-03 sector map (S01–S09) covers the full `git ls-files` inventory.
Evidence: `Get-ChildItem audit -Recurse` this session; read of `REPOSITORY-SECTOR-ARCHITECTURE-2026-07-03.md`.
Where it applies: All sectors (as prior evidence), especially S01.
Rule for future passes: Mine the prior corpus for candidate findings and evidence, but **re-verify against the current tree** before promoting — prior claims reflect the tree when written (branch/fast-forward drift). Cite the prior file + a fresh current-tree check.
Date/pass: 2026-07-05 / Phase 1.

---

Lesson:   The shell is **PowerShell on win32**; the tree uses `\` paths and may have CRLF/LF EOL sensitivity. Prior memory: `.md` files are prettier-ignored, and both `sed` and the Edit tool can flip CRLF→LF — check `git diff --stat` after doc edits.
Evidence: Environment (win32, PowerShell); maintainer auto-memory "doc EOL trap".
Where it applies: All sectors when running commands or (later) proposing doc fixes.
Rule for future passes: Prefer the dedicated Grep/Glob/Read tools over shell text tools. Watch path-separator assumptions as an S07/S08 correctness item.
Date/pass: 2026-07-05 / Phase 1.

---

Lesson:   Raw line count ≠ the enforced limit. `CLAUDE.md`/CI count **code lines** (blank + comment excluded, 400 hard / 250 soft) with a separate **600 raw** backstop. Largest raw file this session is 498 lines (`trace-image.ts`) — under the raw backstop, and code-line count is unknown until `check:file-size` runs.
Evidence: `CLAUDE.md` "Size limits"; PowerShell raw line count this session; `package.json:26` `check:file-size` script is the authority.
Where it applies: S02 (run the check), S04/S05/S08 (god-file findings).
Rule for future passes: Never claim a file-size violation from raw counts. `pnpm check:file-size` only enforces the **600 raw** backstop (verified passing this session, exit 0); the **400 counted-code-line** hard cap is enforced by **ESLint `max-lines`** — run `pnpm lint` and cite it before any god-file finding.
Date/pass: 2026-07-05 / Phase 1 (refined Phase 2).

---

Lesson:   This **worktree had no `node_modules`** — installed this session via `pnpm install --ignore-scripts` (exit 0). `--ignore-scripts` skips Electron's binary download, so `build:electron-main`, `build:desktop`, and any test that launches the Electron binary cannot run here; `test`/`lint`/`typecheck`/`check:file-size`/`license-check`/`audit:deps` do run.
Evidence: Bash probe `[ -d node_modules ]` → MISSING; background install task `bfo87oqc3` exit 0.
Where it applies: S02, S03 (electron build/verify), all sectors needing checks.
Rule for future passes: Electron *binary*-dependent checks are BLOCKED in this worktree — record them blocked-with-reason, not as failures. Static/policy electron tests still run.
Date/pass: 2026-07-05 / Phase 2.

---

Lesson:   `AUDIT.md` is an honest but **append-only** ledger (VERIFIED / CLAIMED / DEFERRED). Its top "Repo at a glance" table is a **2026-05-28 snapshot** (520 src, 2420 tests) and is stale vs the current tree (824 src in `src/` alone). Later passes are appended without refreshing the header, so sections can contradict each other (external-check #5 sourcemap text vs the R-H3 fix; verified this session).
Evidence: AUDIT.md L23–25 vs this session's counts; external-check #5 (L386) vs vite.config.ts:121 (`sourcemap:false`).
Where it applies: S01, and any sector citing AUDIT.md.
Rule for future passes: Treat AUDIT.md sections as dated point-in-time claims; cite the specific pass + re-verify against the current tree. Prefer the newest dated pass on any conflict.
Date/pass: 2026-07-05 / Phase 2.

---

Lesson:   Verified test baseline (this worktree, post-install, 2026-07-05): **`pnpm test` = 590 test files / 3594 tests / 0 fail** (258s). Supersedes AUDIT.md's stale "2420/2420".
Evidence: `audit/evidence/baseline-test-2026-07-05.txt` L986–989 (exit 0).
Where it applies: S01, S05, S08, S09 (coverage/verification baseline).
Rule for future passes: Use **3594** as the live green-test baseline, not AUDIT.md's number. Green ≠ fidelity (see the fidelity-caveat lesson).
Date/pass: 2026-07-05 / Phase 2 (S01 Pass 1).

---

Lesson:   `DECISIONS.md` ADR log is **chronological-append** (numbers appear out of order: 022 after 032, 060 after 093, 100 before 098), currently **collision-free** (one heading per number; the prior 094 and 106 collisions from memory were resolved by renumber). Highest = **ADR-113** (2026-07-05, region-enhance); **next free = 114**. All gaps are documented *inside* DECISIONS.md.
Evidence: ADR-heading grep of DECISIONS.md; gap grep — 023/024 = ad-hoc/deferred (L3942–3945), 054–091 = build-plan reservation (L3299/3408/3936), 099 = retired-unused, resolution reassigned to ADR-104 (L4319/4336).
Where it applies: S01; any sector citing an ADR number.
Rule for future passes: Do NOT flag ADR gaps as "missing" — they are reserved/retired on purpose. When citing an ADR, grep its heading (numeric order ≠ file order). Note ADR-052 = Scanning-offset, ADR-053 = Verified Origin (PROJECT.md's earlier mis-citation is self-corrected).
Date/pass: 2026-07-05 / Phase 2 (S01 Pass 1).

---

Lesson:   Full runnable release gate is GREEN this worktree (2026-07-05): typecheck / lint / lint:electron / license-check / audit:deps all exit 0; lint 0 problems (so **no file exceeds the 400 code-line cap**, no `any`/`!`); audit:deps "No known vulnerabilities found". NOT run here: `guard:repo`, `format:check`, `build:web`, `build:electron-main` (electron binary absent).
Evidence: `audit/evidence/baseline-checks-2026-07-05.txt` EXIT markers all =0.
Where it applies: S02, and as the structural-health baseline for all sectors.
Rule for future passes: Structural discipline (size/types/lint/vulns/determinism) is solid — do not spend passes re-litigating it. Concentrate finding-hunting on fidelity, hardware, safety invariants, and untrusted-input paths, which the gates do NOT cover.
Date/pass: 2026-07-05 / Phase 2.

---

Lesson:   Dependency governance is split: **RESEARCH_LOG.md** documents all 9 runtime deps (ADR-017 metric holds). **THIRD_PARTY_NOTICES.md** does NOT — it is Rayforge-only and omits every bundled library (react, three, dompurify, zustand, opentype.js, imagetracerjs, clipper2-ts, lucide-static) + the 4 bundled fonts. `pnpm license-check` PASSES but only checks license *type* (no GPL), never notice reproduction → a green license gate is NOT attribution compliance (finding S01-005, Medium).
Evidence: THIRD_PARTY_NOTICES.md L1–10 (whole file); RESEARCH_LOG.md dep grep; license-check exit 0.
Where it applies: S01 (compliance), S02 (does `dist/web/*.js` embed `@license` banners? vite.config sets no `legalComments`).
Rule for future passes: Never treat `license-check` green as attribution compliance. S02 must check the built bundle for embedded notices before the compliance picture is complete.
Date/pass: 2026-07-05 / Phase 2 (S01 Pass 1).

---

Lesson:   README.md (self-described "entry index") is ~5 phases stale: Status stops at "Phase G in progress" and never mentions CNC router (Phase H/ADR-098), multi-controller (Phase I), Camera Mode (ADR-107..110), or box generator (Phase K) — all Built per PROJECT.md. It keeps stale MVP exclusions (Marlin/Smoothie/Ruida, raster — all shipped) and a stale test count (2641/423). Separately verified GOOD this pass: **"no ipcMain surface"** Electron claim is TRUE (grep ipc*/contextBridge across all .ts/.tsx = 0 hits); **LICENSE** is genuinely proprietary (© 2026 Johann Stolk).
Evidence: README L5/L22–30/L49 vs PROJECT.md phase tables + baseline 3594 tests; ipc grep 0 hits; LICENSE L1–10.
Where it applies: S01, S03 (electron ipc), S08.
Rule for future passes: 3 divergent stale test counts now exist (AUDIT.md 2420, README 2641, actual 3594) — governance docs drift independently; always re-count. The "no IPC" design is real: the Electron renderer talks to hardware via WebSerial + File System Access directly — in S03 confirm that wiring, don't hunt for a preload/contextBridge that doesn't exist.
Date/pass: 2026-07-05 / Phase 2 (S01 Pass 1).

---

Lesson:   WORKFLOW.md body is comprehensively populated far beyond its stale header: F-F4/F-F5, F-CNC1..F-CNC35 (Phase H, L1297–2175), Phase I (L2176), Phase K (L2236) all present. Its header (L5) still claims only "through F.3 fleshed out, C/D/E stubs." So the CNC/multi-controller/box UI flows ARE documented — only the header + CONTRIBUTING ("shipped through Phase F.1") are stale. The **meta-pattern:** append-only spec bodies (PROJECT/DECISIONS/AUDIT/WORKFLOW-body) stay current; the human-facing *status prose* (README, WORKFLOW header, CONTRIBUTING intro) froze ~Phase F–G.
Evidence: WORKFLOW.md section grep; WORKFLOW L5; CONTRIBUTING L1/L3.
Where it applies: S01, S08.
Rule for future passes: When a doc header claims low coverage, grep the body before recording "missing" — the defect here is stale status prose, not absent content. Findings S01-006/007 are the same class; don't multiply them — the fix is one "refresh status prose" pass.
Date/pass: 2026-07-05 / Phase 2 (S01 Pass 1→2).

---

Lesson:   S02 enforcement is genuinely strong and prior audit fixes are all REAL in the current tree. `eslint.config.mjs` enforces max-lines 400 (code lines) / func 80 / complexity 12, module boundaries, `import/no-cycle`, exhaustive pure-core bans, `switch-exhaustiveness-check`, no-any/no-`!`. The **H13 rule** bans `window.alert/confirm/prompt` everywhere except `src/ui/state/job-aware-dialogs.ts` (native dialogs freeze Stop mid-job). CI `release:check` is complete; deploy is gated on CI success (`workflow_run`+conclusion, re-runs release:check, M33 head_sha pin). Built `dist/web` embeds 71 JS `@license` banners but ships 4 fonts (Roboto Apache-2.0, 3× OFL-1.1) with NO notice. `--branch=master` deploy is intentional (CF production branch, legacy).
Evidence: eslint.config.mjs L113–272; ci.yml/deploy.yml; dist/web @license grep = 71; RESEARCH_LOG L146.
Where it applies: S02, S03 (electron lint = eslint.electron.config.mjs), S08 (H13→E-stop).
Rule for future passes: Don't re-flag structural discipline — enforced + green. Two real leads OUT of S02: (1) **S08 must prove the H13/job-aware-dialogs path keeps Stop reachable (#9)** — highest-value E-stop check; (2) `opentype`/`clipper2` bundle chunks may lack embedded notices (spot-check). Font-notice gap (S01-005) is the one concrete compliance item.
Date/pass: 2026-07-05 / Phase 2 (S02 Pass 1).

---

Lesson:   S02 security/config verified strong: CSP (`dist/web/_headers`) is genuinely strict (script-src 'self', object-src none, frame-ancestors none, form-action none, HSTS) — but hardcodes `http://127.0.0.1:51731` (local RTSP camera bridge) in img-src/connect-src → audit that bridge in S03. tsconfig is strict+ (noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax…). vitest CI `maxWorkers=1` (flake fix); coverage reported but NOT threshold-gated (release:check runs `test`, not `test:coverage`). `check-licenses.mjs` = pnpm-store TYPE allow-list, npm packages ONLY — explicitly disclaims vendored source + notices, and OFL-1.1 is NOT in the allow-list (the 3 OFL fonts pass only because vendored `.ttf` aren't scanned). `assert-correct-repo` guard handles linked worktrees via git-common-dir.
Evidence: dist/web/_headers; tsconfig.json; vitest.config.ts L24-30; check-licenses.mjs L11-34; assert-correct-repo.mjs L35-53.
Where it applies: S02, S03 (camera bridge port 51731), S07.
Rule for future passes: The license gate proves license TYPE for npm packages ONLY — NOT vendored assets (fonts, in-house potrace port) or notice reproduction; qualify any "license-check green" claim. Coverage is not CI-gated — don't assume a coverage floor.
Date/pass: 2026-07-05 / Phase 2 (S02 Pass 1).

---

Lesson:   S03 (Electron) opens strong. `electron/main.ts` has all 4 hardening flags (contextIsolation/nodeIntegration:false/sandbox/webSecurity); **A4 RESOLVED** — renderer served over a privileged `app://` scheme via `protocol.handle` with a real path-traversal guard (`path.relative` rejects `..`), not `file://`; CSP via onHeadersReceived matches web `_headers`; permission handlers delegate DENY-BY-DEFAULT to `trusted-renderer-policy`; navigation + window-open locked to trusted origins; no `ipcMain`; DevTools only when `!isPackaged`. S02 also closed: CI is ubuntu-only and never runs `build:desktop` (electron-builder --win) → Windows `.exe` target CI-untested (S02-003).
Evidence: electron/main.ts L101-130 (app://+guard), L140-145 (webPreferences), L219-287 (perm+nav); ci.yml:19.
Where it applies: S03, S07.
Rule for future passes: main.ts is solid — the S03 finding surface is the DELEGATED policy (`trusted-renderer-policy.ts`: is the allowlist actually narrow / deny-by-default?) and the RTSP camera bridge (`rtsp-camera-bridge.ts` on :51731: input validation, what it serves). **A1 (ASAR fuses) is the one known DEFERRED item** — verify still absent in `electron-builder.yml`.
Date/pass: 2026-07-05 / Phase 2 (S02 close / S03 Pass 1).

---

Lesson:   S03 delegated security is genuinely solid: `trusted-renderer-policy.ts` is deny-by-default + narrow (serial + fileSystem* + video-media only, trusted-origin gated, `window.open` always false); `rtsp-camera-bridge-policy.ts` blocks public SSRF (rtsp:// + private/loopback host only); the bridge is carefully written (bounded buffers, timeouts, argv-array spawn = no shell injection). Two real findings: **S03-001 (Low)** — the :51731 bridge sets CORS headers but never REJECTS non-allowlisted origins server-side, so any web origin can trigger blind LAN RTSP probes / unbounded ffmpeg spawns (bounded: private-only, no response read, desktop-only). **S03-002 (Low, =A1)** — no ASAR fuses in electron-builder.yml (DEFERRED to signed release); `publish:null` good.
Evidence: trusted-renderer-policy.ts L59-110; rtsp-camera-bridge-policy.ts L13-43; rtsp-camera-bridge.ts L254-282 (CORS-only); electron-builder.yml (no fuses).
Where it applies: S03, S07 (camera/serial platform side).
Rule for future passes: CORS ≠ access control for a localhost server — it gates response *reads*, not request *side-effects*. The bridge is the one genuine (if bounded) attack surface in S03; everything else in electron/ is hardened. Don't manufacture findings from the strong parts.
Date/pass: 2026-07-05 / Phase 2 (S03 Pass 1).

---

Lesson:   TOP LEAD — non-finite coordinate → malformed G-code (S04-001, High/Needs-verification). CONFIRMED: `grbl-strategy.ts:36` coord formatter is `n.toFixed(DECIMAL_PLACES)` and `NaN.toFixed()`→"NaN" / `Infinity.toFixed()`→"Infinity" (feed IS guarded L49/62/71, coords are NOT); `kerf-offset.ts` guards only the kerf scalar, not point coords, `cleanCoord` normalizes -0 only. `NaN` defeats naive bounds checks (`NaN>bed` and `NaN<0` both false) so a range-only preflight won't catch it. `invariants/gcode-words.ts` is a PARSER (guards on read), not an emit guard.
Evidence: kerf-offset.ts L8-49/89-91; grbl-strategy.ts:36 (+49/62/71); gcode-words.ts L1-12.
Where it applies: S04 (geometry NaN sources), S05 (preflight/emitter — DECIDES severity).
Rule for future passes: The #1 S05 read is `preflight.ts` — does it explicitly reject non-finite coords (not just range)? If yes → S04-001 downgrades; if no AND any geometry op yields NaN → Confirmed High/Critical. Also check the 5 clipper2 files + arc-sampling + selection-transform as NaN sources. Feed-vs-coord finiteness asymmetry is the tell.
Date/pass: 2026-07-05 / Phase 2 (S03 close / S04 Pass 1).

---

Lesson:   S04-001 RESOLVED → **Medium/Confirmed**. `preflight.ts` is thorough (bounds/power/speed/passes/laser-on-travel/no-go/CNC, `assertNever`) and DOES guard scalar params (`Number.isFinite(speed)` L213; NaN power fails range L178) — but has NO non-finite-COORDINATE check, and `findOutOfBoundsCoords`' `GCODE_NUMBER` regex doesn't match "NaN"/"Infinity" so those coord words are silently dropped. `arc-sampling.sampleArcPoints` produces NaN points from a non-finite radius; emitter `toFixed`→"NaN". BUT bounded: GRBL rejects the malformed word (error:2/33) + ADR-041 makes it terminal → stops the stream → FAILED job, not wild motion. Hence Medium, not High.
Evidence: preflight.ts L35-56/117/212-214/340; arc-sampling.ts L13-38; grbl-strategy.ts:36; ADR-041.
Where it applies: S05 (emitter), S06 (do imports admit non-finite? — decides real-world likelihood), S08.
Rule for future passes: Finiteness story = scalar params guarded; geometry coords NOT; downstream GRBL+ADR-041 catch it. Always check downstream nets (GRBL parser, ADR-041 terminal-error, preflight) before rating an output-safety finding High. S06 must check whether SVG/DXF/STL/nc parsers admit non-finite — that's S04-001's residual trigger question.
Date/pass: 2026-07-05 / Phase 2 (S04 Pass 1).

---

Lesson:   S04 core is high quality. `selection-transform.ts` guards EVERY numeric input (`Number.isFinite`) and returns `Result` — so the transform UI is NOT a NaN source (tightens S04-001's trigger to malformed import → S06). GRBL RX buffer = 120 (`grbl-streaming.ts:1`, MIT-2 resolved, validated + safe fallback). One convention wrinkle: `vector-path-booleans.ts` THROWS for control flow (expected input errors the UI catches) vs the `Result` pattern — CLAUDE.md's own anti-pattern, un-enforced by lint (S04-002, Low). `grep 'throw new' src/core` = ~40 non-test sites / ~14 files, mixed legit-invariant (assertNever) vs control-flow (needs triage — don't over-claim all are violations).
Evidence: selection-transform.ts L84/122/144-151/174; grbl-streaming.ts:1; vector-path-booleans.ts L47-114.
Where it applies: S04, S06 (import finiteness = S04-001 trigger).
Rule for future passes: S04 quality is high (guarded + tested). Sample highest-risk (geometry NaN, output, devices, controllers) and lean on verified purity/boundary lint + 3594 tests for the 292-file bulk; document sampling as residual. Result-vs-throw is the one convention split.
Date/pass: 2026-07-05 / Phase 2 (S04 Pass 1).

---

Lesson:   S04 CLOSED (sampled). More verified positives: `scene-object.ts` SceneObject union is exhaustive with `assertNever` in every switch default (legit invariant throw — distinct from S04-002 control-flow throws); `grbl/status-parser.ts` robustly rejects non-finite MPos/WPos/FS/Ov; `profile-catalog.ts` validates `maxPowerS>0` + `minPowerS≤maxPowerS`. **KEY:** finiteness is guarded almost everywhere in core (inputs/transforms/status/scalars) → S04-001 is an ISOLATED geometry-coord→emit gap, not systemic. S04 findings: S04-001 (Medium), S04-002 (Low). ~280/292 files are documented residual (covered by purity/boundary lint + 3594 tests).
Evidence: scene-object.ts L314-358; status-parser.ts L117-198; profile-catalog.ts L316-320.
Where it applies: S05 (emitter is the S04-001 other half + #7 power basis from device maxPowerS), FINAL_REPORT.
Rule for future passes: When writing FINAL_REPORT, frame S04-001 as isolated (finiteness guarded elsewhere) + bounded (GRBL+ADR-041) → Medium, not a systemic safety hole. S05 is the CRITICAL sector — give grbl-strategy.ts a FULL read (#7/#3/#5 invariants + toFixed coord finiteness).
Date/pass: 2026-07-05 / Phase 2 (S04 close).

---

Lesson:   S05 emitter VERIFIED rock-solid on the safety invariants. `grbl-strategy.ts`: #7 `scaleS=round(power/100*maxPowerS)` exact; #5 deterministic (toFixed(3)/LF/indexed, byte-identical cut-only jobs); #3 laser-off ENFORCED — ALL 4 GRBL dialects (`gcode-dialects.ts` L80/94/107/119) have `requiresS0OnRapid:true` so every G0 carries explicit S0 (safe on $32=0), plus M4-dark-on-travel + zero-length-move skip (no stationary beam-on G1). S04-001's emitter side is scoped to COORDS only (feed throws on non-finite; power is preflight-guarded). No new finding — emitter is exemplary/defensive.
Evidence: grbl-strategy.ts L35-53/95-130/368-399; gcode-dialects.ts requiresS0OnRapid:true ×4.
Where it applies: S05, FINAL_REPORT (the most safety-critical code is correct = strong positive).
Rule for future passes: The G-code emitter + dialects are verified-correct on #3/#5/#7 — don't re-litigate. Remaining S05 risk is FIDELITY (trace outline-vs-centerline, raster, fill) which tests DON'T prove (Karpathy's law) + CNC overdeep/Z invariants. That's where S05's real findings (if any) will be — and most are Info-unverifiable (need perceptual/hardware, impossible here).
Date/pass: 2026-07-05 / Phase 2 (S05 Pass 1).

---

Lesson:   S05 safety net VERIFIED across laser + CNC. `cnc-grbl-strategy.ts`: CNC Z-safe holds BY CONSTRUCTION (every XY rapid preceded by appendRetract to max(0,safeZ); plunges always G1; zero-length skip). `invariants/predicates.ts`: `findLaserOnTravelIssues` (#3) robust (sticky-S + M5/M107); `findOutOfBoundsCoords` (#1) correct for finite + **confirms S04-001** (parseGcodeWord regex won't match "NaN" → null → not flagged). No-exposure obs: bounds predicate checks arc endpoints only (own output has no arcs, so moot). Emitters + dialects + preflight + predicates ALL verified-correct on safety invariants.
Evidence: cnc-grbl-strategy.ts L186-281; predicates.ts L50-126.
Where it applies: S05, FINAL_REPORT.
Rule for future passes: FINAL_REPORT should LEAD with "safety invariants (#1/#3/#5/#7 + CNC Z-safe) verified correct across the emitters/dialects/preflight/predicates" — this is the audit's strongest positive. S04-001 is the ONE confirmed safety-adjacent gap (coord finiteness, Medium, bounded). Remaining S05 = fidelity (Info-unverifiable here) + compile-job determinism.
Date/pass: 2026-07-05 / Phase 2 (S05 Pass 1).

---

Lesson:   S05 CLOSED. CNC #overdeep (`cnc-depth.ts`) + #Z-safe (`cnc-motion.ts` findPlungedTravelIssues) predicates verified correct (flag on final text). `compile-job.ts` ADR-050 memoization = WeakMap object-identity + (layer,device,fillRule) key, capped/test-pinned/output-invariant → determinism-safe. **The FULL safety machinery (emitters+dialects+preflight+predicates, laser+CNC) is VERIFIED CORRECT** — the audit's strongest positive. S05 findings: S04-001 (Medium, coord finiteness) + S05-001 (Info, fidelity UNVERIFIABLE headless — trace outline-vs-centerline etc.). ~5 big files (trace-image 498, emit-raster 451, fill-hatching) NOT line-read: fidelity unverifiable here anyway; structure/determinism covered by tests + verified emitter.
Evidence: cnc-depth.ts L21-45; cnc-motion.ts L20-73; compile-job.ts L39-44/264-285.
Where it applies: S06 (S04-001 trigger = import non-finite admission), S09 (perceptual harness = S05-001 verification path), FINAL_REPORT.
Rule for future passes: 6/9 sectors done, all safety machinery verified. Remaining sectors: S06 (untrusted parsers + .lf2 + S04-001 trigger), S07 (WebSerial lifecycle), S08 (E-stop reachability + H13 + state), S09 (harness). Then Phase 3 FINAL_REPORT.
Date/pass: 2026-07-05 / Phase 2 (S05 close).

---

Lesson:   S06 KEY RESULT — **S04-001 TRIGGER CONFIRMED reachable via SVG import.** `parse-path-d.ts` `NUMBER_RE` (L62) allows unbounded exponents → `Number("1e999")`=Infinity flows unguarded into scene coords; a FRESH import does NOT run the `.lf2` validator. Root cause = **import-vs-load asymmetry**: `.lf2` LOAD validates coords (`project-validator-primitives.requireCoordinate`: finite + |v|≤1e6) but SVG/DXF IMPORT doesn't. So S04-001 now defeats the #1 bounds preflight via a valid SVG → arguably High, held Medium (GRBL+ADR-041 bound it to a failed job). Positives: SVG sanitizer strong (DOMPurify svg-profile + allowlist href hook + removeAllHooks bracketing); `.lf2` load validation exemplary (no non-finite admission).
Evidence: parse-path-d.ts L62/97/129; project-validator-primitives.ts L49-51/166-168; sanitize.ts L51-84.
Where it applies: S06, FINAL_REPORT (S04-001 = the top actionable finding), S08 (Infinity bounds → canvas render?).
Rule for future passes: The import boundary (SVG/DXF) is the S04-001 hole; the one-line fix is to mirror the `.lf2` validator there. Check `parse-svg.ts` + `dxf` for the same missing-guard pattern. Report S04-001 with the confirmed SVG trigger + Medium/High maintainer-decision framing.
Date/pass: 2026-07-05 / Phase 2 (S06 Pass 1).

---

Lesson:   S06 CLOSED. S04-001 trigger SCOPED to `parse-path-d` (SVG `d` bare `Number()`) ONLY — DXF `parseNumber` (dxf-entities.ts:180) guards `Number.isFinite?:fallback`; `.lf2` load + `parse-svg` attribute parsing guard too. So the S04-001 fix = 2 call sites in parse-path-d (L97/129). Migrations (`migrations.ts`) fail EXPLICITLY (no-path) on uncovered versions → no silent data loss. SVG sanitizer strong; `.lf2` load validation exemplary. Verifier win: hypothesized DXF shares the hole → REFUTED by reading parseNumber.
Evidence: dxf-entities.ts:180-182; migrations.ts L35-42; parse-svg.ts L290/315/336; parse-path-d.ts L97/129.
Where it applies: S07 (next), FINAL_REPORT (S04-001 fix is localized + cheap).
Rule for future passes: 7/9 sectors done. S04-001 = #1 actionable (Medium/arguably-High, 2-call-site fix). Remaining: S07 (WebSerial lifecycle + A2 port.forget + S03-001 camera client), S08 (E-stop/#9 + H13 + Infinity-bounds-render + state slices — biggest UI sector), S09 (harness). Then Phase 3 FINAL_REPORT.
Date/pass: 2026-07-05 / Phase 2 (S06 close).

---

Lesson:   S07 CLOSED. `web-serial.ts` (machine-control crux) VERIFIED STRONG — careful idempotent lifecycle (stale-port sweep, open-retry, disconnect cleanup, finally→onEnd, no leaks); **A2 resolved** (port.forget on explicit close only); DoS-bounded (64KB line cap vs spoofed-device OOM); M12 byte-per-char wire encoding (GRBL realtime bytes intact); correct stream-close order. No finding. The "disconnect-burn" locus is the STREAMER's response to onClose (laser-store, S08), NOT web-serial.
Evidence: web-serial.ts L92-162 (lifecycle+A2), L171-211 (encode+64KB line cap), L241-269 (stream cleanup).
Where it applies: S08 (laser-store disconnect→stop-job = real disconnect-burn + MIT-T1 + R-H2 locus), FINAL_REPORT.
Rule for future passes: 8/9 sectors. S08 (biggest, UI, 435 src files) is next — SAMPLE highest-risk: E-stop reachability #9 (H13 job-aware-dialogs path — can a modal block Stop?), `laser-store.ts` disconnect→stop + R-H2 race + MIT-T1, whether Infinity scene bounds (S04-001) freeze the canvas, state-slice discipline. Lean on verified lint/boundary/tests for the bulk. Then S09 + FINAL_REPORT.
Date/pass: 2026-07-05 / Phase 2 (S07 close).

---

Lesson:   S08 SAFETY CORE VERIFIED — the app's most safety-critical UI is exceptionally well-reasoned. **R-H2 RESOLVED** (resume+stop use functional `set()` — snapshot at write time, prevents buffer-accounting drift → uncontrolled motion; cited in laser-job-actions.ts). **#9 E-stop reachability VERIFIED** (job-aware-dialogs H13: job-active → native dialogs become non-blocking toasts, fail closed → renderer loop never suspends → Stop stays clickable; enforced by the S02 ESLint ban). On resume-write-fail: `markErrored` NOT disconnect, DELIBERATELY to keep Stop mounted. Pause gated on confirmed $32 laser mode. `safetyNotice` on any failed Stop/Pause/Resume write or USB-drop-mid-job. No finding.
Evidence: laser-job-actions.ts L82-187 (R-H2 L118/152-187; pause L92-94); job-aware-dialogs.ts L1-47.
Where it applies: S08, FINAL_REPORT (E-stop/job-control safety = verified correct = #2 headline positive after S05's emitter).
Rule for future passes: The safety-critical UI (E-stop, job control, disconnect) is VERIFIED CORRECT — don't manufacture findings. Remaining S08 (sampled): `laser-connection-actions.ts` onClose path, god-file coupling (scene-mutations 491/store 427 raw — lint-green so ≤400 CODE lines), Infinity-bounds canvas render (S04-001 downstream). Then S09 + FINAL_REPORT.
Date/pass: 2026-07-05 / Phase 2 (S08 Pass 1).

---

Lesson:   S08 CLOSED (sampled). Disconnect handling (`laser-connection-actions.ts`) thorough + safety-first: explicit disconnect stop-first+warn+teardown; cable-yank onClose→teardown+safe-patch; **stall watchdog** (detectStreamStall→streamStalledNotice) = the disconnect-burn-delay fix; comprehensive teardown; R-L2 event-driven handshake. `draw-scene.ts` has NO finiteness guard → S04-001 Infinity = undrawable object + possible NaN fit-to-bounds (recoverable; folded into S04-001). No new finding. The ENTIRE safety-critical UI (E-stop/#9, R-H2, pause-gate, start-guards, disconnect) is VERIFIED CORRECT.
Evidence: laser-connection-actions.ts L81-84/105-145/212-239; draw-scene.ts grep (no isFinite).
Where it applies: S09, FINAL_REPORT.
Rule for future passes: After S09, all 9 sectors have a Pass-1. S08 residual is LARGE (~430 UI files) but safety paths ARE verified — document honestly (custom-modal Stop-occlusion + a11y not exhaustively checked). FINAL_REPORT lead: safety machinery VERIFIED CORRECT (S05 emitter + S08 E-stop); S04-001 = #1 actionable (2-line fix, Medium/arguably-High); S01-005 notices + doc-drift = the rest. Next: S09 (IoU-asserts-fidelity? malicious-corpus coverage) → Phase 3 FINAL_REPORT.
Date/pass: 2026-07-05 / Phase 2 (S08 close).

---

Lesson:   S09 CLOSED → **ALL 9 SECTORS DONE.** Perceptual harness is SUBSTANTIVE (corrects S05-001): `compare.ts` = IoU+precision+recall+f1 over rasterized OUTPUT vs analytic+real-logo ground truth; precision catches doubled-contour outline artefacts, recall catches dropped strokes; centerline-deviation/edge-truth add geometry metrics; real logo asset. Residual = no LightBurn automation (closed-source) + headless rasterizer + auditor-couldn't-run. Malicious SVG corpus (7 files) covers the main classes. Controllers = simulators (hardware-CLAIMED).
Evidence: compare.ts L1-65; svg/malicious/ (7 files); controllers/ sims.
Where it applies: PHASE 3 FINAL_REPORT.
Rule for future passes: PHASE 3 = write `audit/FINAL_REPORT.md` then STOP + hand to maintainer (do NOT fix). FINAL tally (per FINDINGS.md table): **0 Critical / 0 High / 2 Medium / 7 Low / 7 Info = 16 findings**, 2 rejected. Medium = S01-005 (font notices), S04-001 (coord finiteness). Low = S01-001/006/007/008, S03-001/002, S04-002. Info = S01-002/003/004, S02-001/002/003, S05-001. Verdict: structurally excellent, safety-verified end-to-end; S04-001 = #1 actionable (2-line import-boundary fix); S01-005 font-notices (compliance) = #2; rest = doc-drift/policy.
Date/pass: 2026-07-05 / Phase 2 (S09 close).
