# FINDINGS.md — Confirmed audit findings

> Only **evidence-backed** findings live here. Candidates start in `AUDIT_STATE.md`
> and are promoted here only after the Step 4 evidence check and Step 5 verifier
> pass. Severity per `RUBRIC.md`. **No source is fixed** — "Suggested fix direction"
> and "Do not fix yet" are guidance for a later, maintainer-approved fix phase.

## Finding format

```
Finding ID:   <Sxx-NNN>
Sector:       <S0x>
Severity:     Critical | High | Medium | Low | Info
Status:       Confirmed | Needs verification | False positive | Resolved later
File(s):      path/to/file
Line(s)/fn:   L123 / functionName
Evidence:     <direct quote or command output that proves it>
Why it matters:
Risk:
Suggested fix direction:
Do not fix yet:  <why touching it now is unsafe / out of audit scope>
```

## Fix status (2026-07-05 — maintainer approved "fix all")

**Fixed + verified (13 findings):**
- **S04-001** (Medium) — `src/io/svg/parse-path-d.ts` now rejects non-finite coordinates at the SVG import boundary (`finiteNumber` guard, mirroring the `.lf2` validator). Failing-test-first; `parse-path-d.test.ts` + full `io/svg` suite (111 tests) green.
- **S03-001** (Low) — `electron/rtsp-camera-bridge.ts` refuses untrusted Origins server-side (`isAllowedBridgeOrigin`) + caps concurrent ffmpeg (`MAX_CONCURRENT_FFMPEG`). Bridge tests green; `lint:electron` clean.
- **S01-005 + S01-008** — `THIRD_PARTY_NOTICES.md` rewritten to cover all bundled libs + the 4 fonts with attributions; `OFL-1.1` added to `scripts/check-licenses.mjs` (license-check green); PROJECT.md "MIT fonts" corrected to Apache-2.0 + OFL-1.1.
- **S01-001/002/003/004/006/007 + S02-001/002/003** — doc drift corrected across PROJECT / README / WORKFLOW / CONTRIBUTING / AUDIT (all EOL-preserving via PowerShell raw-replace — the Edit tool flips CRLF on these files).

**Deferred / not code-fixable (3 findings):**
- **S04-002** (Low) — DEFERRED as a focused refactor: converting *only* combine/offset to `Result` worsens in-file consistency (`weld`/`dogbone` in the same caller still throw); convert the whole vector-op family together in one reviewed PR. (Its single caller `vector-path-actions.ts` currently swallows the thrown message — worth surfacing when converted.)
- **S03-002** (Low) — DEFERRED by design: ASAR fuses land with the first *signed* release; no code-signing config exists yet. Exact fix recorded (AUDIT.md A1) for that milestone.
- **S05-001** (Info) — NOT code-fixable: output fidelity vs LightBurn + real-hardware behavior require the maintainer's perceptual-harness run + physical burns; no code change closes it.

Verification (post-fix): typecheck / lint / lint:electron / license-check / check:file-size / prettier(changed files) all PASS. Full `pnpm test` re-run in progress. **No commits made** — working tree only.

---

## Severity counts (live)

| Severity | Confirmed | Needs verification |
|---|---:|---:|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 2 | 0 |
| Low | 7 | 0 |
| Info | 7 | 0 |

S01 Pass 2 (adversarial) verdicts on all findings recorded in AUDIT_STATE.md ("S01 close-out"). All 6 survived; S01-005 severity is conditional on the S02 bundle-notice check.

Prior-finding re-verifications this session: **R-H3** (public sourcemap IP leak) confirmed
**RESOLVED** — `vite.config.ts:121` `sourcemap: false`. (See S01-004.)

---

## Confirmed findings

> Phase 1 recorded only structural facts verified *while mapping* (not deep-audit
> results). Deep-audit findings begin in the S01+ passes.

---

Finding ID:   S01-001
Sector:       S01 (also touches S07)
Severity:     Low
Status:       Confirmed
File(s):      PROJECT.md
Line(s)/fn:   `PROJECT.md` Stack section ("Platform adapter: `platform/web/` and `platform/electron/` implement the same `PlatformAdapter` interface")
Evidence:     `Glob src/platform/**/*.ts` returns only `src/platform/types.ts` and `src/platform/web/*` — there is **no** `src/platform/electron/` directory. The Electron adapter behavior lives in the top-level `electron/` folder. PROJECT.md's own Module-layout section (further down) lists only `platform/web/`, contradicting its own Stack section.
Why it matters: A reader following the Stack section looks for `platform/electron/` that does not exist; internal doc contradiction erodes trust in the contract file that `CLAUDE.md` says to read first.
Risk:         Documentation drift only — no runtime impact. Regression risk if someone "creates" the missing dir to match the doc.
Suggested fix direction: In a later docs-only PR, correct the Stack line to state the Electron adapter lives in top-level `electron/`, or reconcile with the Module-layout section.
Do not fix yet: Audit is findings-only; confirm exact intended wording with maintainer during the fix phase.

---

Finding ID:   S02-001
Sector:       S02 (also S09)
Severity:     Info
Status:       Confirmed
File(s):      package.json, PROJECT.md
Line(s)/fn:   `package.json` devDependencies (lines 52–81); `PROJECT.md` Stack ("Playwright (E2E smoke per platform)")
Evidence:     `PROJECT.md` lists "Playwright (E2E smoke per platform)" as part of Testing; `package.json` devDependencies contains no `@playwright/test` or `playwright` entry. `release:check` (`package.json:27`) runs no E2E step. Matches a prior memory note ("absent Playwright").
Why it matters: The Phase-A acceptance and Stack claim an E2E smoke layer that is not wired; "E2E smoke" is effectively absent, so cross-platform launch is unverified by CI.
Risk:         False confidence that E2E is covered; not a runtime defect. To re-confirm scope during S02.
Suggested fix direction: Either adopt Playwright + add an E2E job to CI, or update PROJECT.md to state E2E is manual/deferred.
Do not fix yet: Findings-only; scope decision is the maintainer's.

---

Finding ID:   S01-002
Sector:       S01 (also S09)
Severity:     Info
Status:       Confirmed
File(s):      src/ (whole tree), PROJECT.md
Line(s)/fn:   `PROJECT.md` Non-negotiable #16 ("Co-located tests: every source file has a `.test.ts` sibling")
Evidence:     Verified file counts this session — `src/` has 824 source vs 584 test files (core 299/212, io 50/45, ui 435/285). `CLAUDE.md` explicitly states "CI does not enforce a direct sibling-test rule." So #16 is aspirational, not true or enforced.
Why it matters: A stated non-negotiable that is neither true nor enforced masks real coverage gaps on high-risk files; the audit must identify *which* untested files matter (per sector) rather than trust the blanket claim.
Risk:         Untested high-risk core/output/io files could harbor undetected defects. Blast radius identified per sector.
Suggested fix direction: Reword #16 to match enforcement reality, and/or add sibling-test CI enforcement for `src/core/output` + `src/core/job` + `src/io` at minimum.
Do not fix yet: Findings-only; which files to backfill is a fix-phase decision.

---

Finding ID:   S01-003
Sector:       S01
Severity:     Info
Status:       Confirmed
File(s):      AUDIT.md
Line(s)/fn:   "Repo at a glance" table L21–38 (L23 "520 TS/TSX source files"; L25 "2420/2420" @ 2026-06-28)
Evidence:     AUDIT.md L23 = 67,153 LOC across 520 source files, L24 = 389 test files. This session's count: `src/` alone has **824 source + 584 test** files (core 299/212, io 50/45, ui 435/285), excluding electron/scripts. Tree ~doubled (CNC Phase H, camera, box, controllers) since the table. AUDIT.md is append-only — later dated passes (2026-07-02/03/04) were added below without refreshing the headline table.
Why it matters: A reader glancing at the top of AUDIT.md sees "520 files / ✅ compact / ship-ready" numbers that no longer describe the repo; the headline verdict predates the largest growth.
Risk:         Documentation staleness only. Could mislead a release-readiness judgement taken from the top table.
Suggested fix direction: Date-stamp the "at a glance" table as a 2026-05-28 snapshot or refresh counts; add a "current metrics" pointer to the latest pass.
Do not fix yet: Findings-only; AUDIT.md is the maintainer's ledger.

---

Finding ID:   S01-004
Sector:       S01 (cross-checks S02 vite.config.ts)
Severity:     Info
Status:       Confirmed
File(s):      AUDIT.md, vite.config.ts
Line(s)/fn:   AUDIT.md external-check #5 (L386–390 "sourcemap: true is set … Acceptable") vs R-H3 (L503–523) vs vite.config.ts:121
Evidence:     vite.config.ts:115–121 sets `sourcemap: false` with a comment citing R-H3 (proprietary + public URL). R-H3 is marked "FIX THIS SESSION" and the 2026-05-28 verdict says it was fixed. Yet external-check #5 still reads "sourcemap: true is set … Acceptable," contradicting both the current config and R-H3.
Why it matters: The scary reading (public sourcemap IP leak, HIGH) is NOT live — code is correct. The residual issue is AUDIT.md contradicting itself, which could cause a future reader to "re-fix" or mis-assess. Also records prior finding R-H3 as genuinely RESOLVED (verified this session).
Risk:         Doc contradiction only; no runtime/IP risk.
Suggested fix direction: Update external-check #5 to state sourcemaps are disabled (R-H3 resolved).
Do not fix yet: Findings-only.

---

Finding ID:   S01-005
Sector:       S01 (compliance; bundle-embedding path verifies in S02)
Severity:     Medium  (release/legal framing is higher — see Why)
Status:       Confirmed (notices-file omission) · bundle-embedding sub-question Needs verification
File(s):      THIRD_PARTY_NOTICES.md; cross-ref RESEARCH_LOG.md, package.json deps, vite.config.ts
Line(s)/fn:   THIRD_PARTY_NOTICES.md L1–10 (entire file)
Evidence:     THIRD_PARTY_NOTICES.md contains ONLY a "Rayforge" reference-adaptation note (camera model). It lists NONE of the bundled runtime deps that RESEARCH_LOG.md documents as adopted and that ship in `dist/web/assets/index-*.js`: react + react-dom (MIT), zustand (MIT), dompurify (Apache-2.0/MPL-2.0), opentype.js (MIT), imagetracerjs (Unlicense), clipper2-ts (MIT-compat), three (MIT), lucide-static (ISC); nor the 4 bundled MIT `.ttf` fonts. MIT/BSD/ISC/Apache-2.0 all require reproducing the copyright + permission notice in distributions. `pnpm license-check` passes but only verifies license *type* (no GPL) — NOT notice reproduction, so the green gate is false comfort here.
Why it matters: The web app is publicly deployed (Cloudflare) and bundles these libraries; distributing them without their required notices is a license-compliance gap across ~8 libraries + fonts. A prior release-readiness audit (memory) rated missing "font notices" among release-blocking criticals — so in a sellability framing this is higher than Medium.
Risk:         Legal/compliance exposure on distribution. Low enforcement probability for a small proprietary app, but a clear, standing obligation. Not a runtime/safety bug.
Suggested fix direction: Generate a complete notices file covering every bundled runtime dep + bundled fonts (e.g. from `license-checker` output or a rollup license plugin) and ship it in the distribution. Separately verify whether the built bundle already embeds `@license` banners (esbuild `legalComments`) — if so, document that as the compliance mechanism.
Do not fix yet: Findings-only. Confirm in S02 whether `dist/web` embeds notices before deciding the file is the sole mechanism.
UPDATE (2026-07-05, S02 empirical bundle check): built `dist/web` and grepped it. The **JS libraries' notices ARE embedded** — 71 `@license`/copyright banners across the JS chunks (index 48, three.module 4, vendor-react 12, vendor-state 6, vendor-cam 1) — so the JS notice obligation is *substantially met*. The gap is now precise + irreducible: the **4 bundled fonts** (`Roboto` Apache-2.0; `Pacifico`/`Inconsolata`/`Dancing Script` OFL-1.1 — RESEARCH_LOG L146) ship as binary `.ttf` in `dist/web/assets/` with **NO accompanying license/copyright text** (no `LICENSES` file in `dist/web`). **OFL-1.1 explicitly requires** the copyright + license accompany the font in any distribution; `THIRD_PARTY_NOTICES.md` consolidates none of it. → Severity stays **Medium**, re-scoped to fonts + notices consolidation; JS portion downgraded to "met via embedded banners" (spot-check `opentype`/`clipper2` chunks later — `opentype-*.js` showed 0 banner hits, possible gap). Cross-ref S01-008.

---

Finding ID:   S01-006
Sector:       S01
Severity:     Low
Status:       Confirmed
File(s):      README.md (cross-ref PROJECT.md Phase H/I/K tables, DECISIONS ADR-094..113)
Line(s)/fn:   README.md L5 (Status), L22–30 ("What it isn't … in MVP"), L49 (Build status test count)
Evidence:     README self-describes as "the entry index" (L5). Its Status stops at "Phase G drawing tools are in progress" and never mentions CNC router mode (Phase H / ADR-098), multi-controller support (Phase I / ADR-094..097), Camera Mode (ADR-107..110), or the box generator (Phase K / ADR-106) — all "Built" per PROJECT.md's phase tables. L22–30 "What it isn't" still says "Not for Marlin, Smoothie, Ruida" and "Not for raster image engraving" — both shipped since. L49 cites "2641 tests across 423 test files" (2026-07-03) vs this session's verified 3594 tests / 590 files. (Third divergent stale test count across docs: AUDIT.md 2420, README 2641, actual 3594 — cf S01-003.)
Why it matters: The front-door/entry-index doc materially understates the current product (an entire CNC pivot + multi-controller + camera + box gen are invisible) and carries a stale test metric — a new reader/maintainer forms a wrong scope model.
Risk:         Documentation drift only; no runtime impact. Onboarding/scope-comprehension risk.
Suggested fix direction: Refresh README Status to cover Phases G–K + camera; drop/replace the stale "in MVP" exclusions that shipped; replace the hard-coded test count with the current figure or a "see AUDIT.md" pointer.
Do not fix yet: Findings-only.

---

Finding ID:   S01-007
Sector:       S01
Severity:     Low
Status:       Confirmed
File(s):      WORKFLOW.md, CONTRIBUTING.md
Line(s)/fn:   WORKFLOW.md L5 (status header); CONTRIBUTING.md L1, L3
Evidence:     WORKFLOW.md L5 says only "Phase A, B, and F (through F.3)" flows are fleshed out, "C/D/E sections are still stubs," and "code for all phases through F.3 is shipped." This contradicts its OWN body: section grep shows fully-written flows F-F4/F-F5, F-CNC1..F-CNC35 (Phase H, L1297–2175), Phase I multi-controller (L2176), Phase K box generator (L2236). The header understates coverage by ~1000 lines and mis-states shipped scope. CONTRIBUTING.md L1/L3 says "shipped through Phase F.1" — stale (through Phase K). Same "status prose froze ~Phase F while the product advanced" pattern as README (S01-006).
Why it matters: WORKFLOW.md is the CONTRIBUTING-mandated source of truth for UI flows; a header claiming the CNC/multi-controller/box flows are absent (when present below) misleads contributors about coverage and whether the "document the flow first" gate was met.
Risk:         Documentation drift; no runtime impact.
Suggested fix direction: Update WORKFLOW.md header to reflect flows actually present (through Phase K + camera) and true shipped scope; update CONTRIBUTING.md "shipped through Phase F.1" to current.
Do not fix yet: Findings-only.

---

Finding ID:   S02-002
Sector:       S02
Severity:     Info
Status:       Confirmed
File(s):      package.json (audit:deps L25, release:check L27), .github/workflows/{ci,deploy}.yml, PROJECT.md security posture
Evidence:     `release:check` — the blocking gate in ci.yml:46 and deploy.yml:73 — includes `audit:deps` = `pnpm audit --audit-level=low`, which fails on ANY advisory (direct OR transitive) at low+ severity. PROJECT.md security posture states the policy as "CVE in a direct dependency blocks releases until patched." Enforcement is thus STRICTER than the documented policy (all deps, low+), and it makes the gate time-dependent: a commit green today can fail tomorrow when a new advisory drops for a transitive dep, blocking ALL deploys until patched.
Why it matters: A new transitive low-sev advisory can block the whole deploy pipeline with no code change; gate pass/fail is not a pure function of the tree. Minor divergence from the stated "direct dependency" policy.
Risk:         Operational (surprise pipeline breakage) + policy/doc drift. Benign today (0 vulns). Not a runtime/safety bug.
Suggested fix direction: Either reword PROJECT.md to match enforcement (all deps, low+), or split `audit:deps` into a separate non-blocking/scheduled job scoped to direct deps / higher severity. The strict form is defensible for a machine-control tool — maintainer's call.
Do not fix yet: Findings-only.

---

Finding ID:   S01-008
Sector:       S01 (found during S02 bundle check)
Severity:     Low  (upgraded from Info after reading the S02 license gate)
Status:       Confirmed
File(s):      PROJECT.md, RESEARCH_LOG.md, scripts/check-licenses.mjs, DECISIONS.md ADR-017
Line(s)/fn:   PROJECT.md L88/L285 ("MIT fonts") vs RESEARCH_LOG.md L146 vs check-licenses.mjs ALLOWED_LICENSES (L18–34)
Evidence:     RESEARCH_LOG.md L146: bundled fonts are Roboto (Apache-2.0), Inconsolata/Pacifico/Dancing Script (OFL-1.1) — claimed "all MIT-compatible per ADR-017." PROJECT.md twice calls them "MIT." Two problems: (1) they are Apache-2.0 + OFL-1.1, not MIT; (2) **OFL-1.1 is NOT in ADR-017's stated allow-list** (MIT/BSD/Apache-2.0/MPL-2.0/ISC/Unlicense/0BSD) **nor in `check-licenses.mjs` ALLOWED_LICENSES** — so "MIT-compatible per ADR-017" is unsupported by the actual policy. The fonts pass CI only because they are vendored `.ttf` assets, which `pnpm licenses list --prod` does not scan (check-licenses.mjs L11–14 explicitly disclaims vendored source).
Why it matters: A shipped, distributed license class (OFL-1.1) sits outside the project's own dependency-license policy AND outside the automated gate. Either OFL should be explicitly added to the ADR-017 allow-list (fonts are a normal OFL use) or the fonts reconsidered. Also drives the S01-005 notice duty.
Risk:         Policy/enforcement gap (Low). No runtime impact — but the green license gate does NOT cover these fonts.
Suggested fix direction: Add OFL-1.1 (and confirm Apache-2.0) to the ADR-017 allow-list as font-compatible; correct PROJECT.md's "MIT fonts" wording; consider a vendored-asset license check.
Do not fix yet: Findings-only.

---

Finding ID:   S02-003
Sector:       S02
Severity:     Info
Status:       Confirmed
File(s):      .github/workflows/ci.yml, package.json
Line(s)/fn:   ci.yml:19 (`runs-on: ubuntu-latest`); release:check (package.json:27 — includes `build:electron-main`, NOT `build:desktop`)
Evidence:     CI runs only on `ubuntu-latest`; `release:check` builds the web bundle + compiles the Electron MAIN process (`build:electron-main` = tsc) but never runs `build:desktop` (`electron-builder --win --x64`) nor any Windows runner. PROJECT.md lists the Windows desktop `.exe` as a primary delivery target and Phase-A acceptance #2 requires it "packaged … opens and runs on Windows 10 and 11." That packaging + Windows runtime is not exercised by CI. (Compounds S02-001: no Playwright E2E either.)
Why it matters: A break in Windows packaging (electron-builder config, native deps, path handling) or a Windows-only runtime regression would not be caught by CI — only manually. For a stated primary target, a real coverage gap.
Risk:         CI coverage gap for the desktop target; no runtime/safety bug today.
Suggested fix direction: Add a Windows-runner job (scheduled or tag-triggered) that runs `build:desktop` + a minimal smoke, or document desktop packaging as release-manual.
Do not fix yet: Findings-only.

---

Finding ID:   S03-001
Sector:       S03
Severity:     Low
Status:       Confirmed
File(s):      electron/rtsp-camera-bridge.ts (cross-ref -policy.ts)
Line(s)/fn:   handleBridgeRequest (L20-40), setCorsHeaders/cameraBridgeCorsOrigin (L254-282), streamWithFfmpeg (L73-90)
Evidence:     The bridge is a loopback HTTP server on 127.0.0.1:51731 with /probe + /stream.mjpg endpoints that, given a `?url=` param, open an RTSP socket and spawn `ffmpeg` to transcode. It gates the TARGET via rtspCameraUrlPolicy (rtsp:// + loopback/private-host only — blocks public SSRF) and sets CORS response headers for an allowlist (app://app, localhost:5173, kerfdesk.com, *.laserforge-2fj.pages.dev). BUT `cameraBridgeCorsOrigin` is used only to SET the response header — it never REJECTS a request whose Origin is absent/unallowlisted. CORS gates cross-origin response *reads*, not request *side-effects*. So while the desktop app runs, ANY web page the user visits (or any local process) can `fetch('http://127.0.0.1:51731/stream.mjpg?url=rtsp://192.168.x.y/...')`; the request executes (ffmpeg spawns / RTSP DESCRIBE fires) even though the attacker can't read the MJPEG. ffmpeg spawn is per-request with no rate limit.
Why it matters: An unauthenticated local server that spawns processes + opens private-network sockets on any origin's request is a classic localhost-service surface: (a) blind SSRF — a hostile page can enumerate/timing-probe the user's LAN RTSP services (private hosts only); (b) resource/DoS — unbounded ffmpeg spawns. No shell injection (spawn uses argv array) and no public-host reach bound it. Desktop-only (bridge doesn't run in the browser build).
Risk:         Local surface reachable by any web origin while the desktop app runs; bounded to private-network RTSP + ffmpeg resource use; no response exfil, no public SSRF, no code exec. Low.
Suggested fix direction: Reject requests server-side when `Origin` is present and not allowlisted (allowlist already computed in `cameraBridgeCorsOrigin`); for no-Origin requests require a per-session secret token minted by main and handed to the renderer. Add a concurrent-ffmpeg cap.
Do not fix yet: Findings-only.

---

Finding ID:   S03-002
Sector:       S03
Severity:     Low  (Medium at first signed release)
Status:       Confirmed (== prior AUDIT.md A1; DEFERRED)
File(s):      electron-builder.yml, package.json
Line(s)/fn:   electron-builder.yml (no `afterPack` / `@electron/fuses`); package.json (no `build.afterPack`)
Evidence:     electron-builder.yml has win/nsis packaging but NO `afterPack` hook and NO `@electron/fuses` config — the Electron security fuses (runAsNode:false, nodeCliInspect:false, onlyLoadAppFromAsar, embeddedAsarIntegrityValidation) are not flipped. ASAR is on (electron-builder default) but unvalidated. `publish: null` (good — no auto-update from URLs). Same open item AUDIT.md tracks as A1, DEFERRED "until first signed release."
Why it matters: Once a signed `.exe` ships, an attacker who tampers with the packaged ASAR could flip `runAsNode` back on and gain Node execution; fuses make the binary refuse. N/A for the current dev/web build (no signed release yet); real before distribution.
Risk:         Tampering/privilege escalation on a distributed signed build. Not applicable to the current unsigned state.
Suggested fix direction: Add an `afterPack` step calling `@electron/fuses.flipFuses()` with the 5 fuses from AUDIT.md A1 before the first signed release.
Do not fix yet: Findings-only; DEFERRED — sequence with the signing work.

---

Finding ID:   S04-001
Sector:       S04 (geometry) + S05 (preflight/emitter) — reachability resolved
Severity:     Medium  (arguably HIGH — now confirmed-reachable via the primary SVG import path + it defeats the #1 bounds preflight; held at Medium only because GRBL parse-reject + ADR-041 prevent dangerous motion. **Maintainer to decide Medium vs High.**)
Status:       Confirmed — REACHABLE via SVG import (S06 confirmed `1e999`→Infinity, parse-path-d unguarded)
File(s):      src/core/geometry/kerf-offset.ts, src/core/output/grbl-strategy.ts (+ other geometry: vector-path-booleans, dogbone, arc-sampling, shapes)
Line(s)/fn:   kerf-offset.ts L8-49 (offsetClosedPolylinesForKerf / cleanCoord); grbl-strategy.ts L36 (`n.toFixed(DECIMAL_PLACES)`)
Evidence:     CONFIRMED emitter-side: the G-code coordinate formatter `n.toFixed(DECIMAL_PLACES)` (grbl-strategy.ts:36) does NOT guard finiteness — `NaN.toFixed(3)` → "NaN", `Infinity.toFixed(3)` → "Infinity" — so a non-finite coordinate emits literal `XNaN`/`XInfinity`. Feed values ARE finiteness-guarded (grbl-strategy.ts:49/62/71 `Number.isFinite(feed)`), but X/Y coordinates are formatted directly. CONFIRMED geometry-side: `offsetClosedPolylinesForKerf` (kerf-offset.ts:12) guards only the kerf SCALAR (`Number.isFinite(kerfOffsetMm)`), NOT the polyline point coords fed to clipper2 `inflatePathsD`; `cleanCoord` (L89-91) normalizes `-0` but does not reject NaN/Infinity. This is the "unguarded clipper2 NaN" the audit memory flagged.
Why it matters: A non-finite coordinate anywhere in geometry (degenerate clipper2 boolean/offset, divide-by-zero transform, degenerate arc) would flow to the emitter and produce malformed G-code the machine can't execute. Critically, `NaN` DEFEATS naive bounds checks (`NaN > bedWidth` and `NaN < 0` are both false), so a range-only preflight would NOT catch it → violates non-negotiable #1 (bounds) and risks #4 (no partial output).
Risk:         Malformed output (literal `XNaN`/`XInfinity`) can be produced AND is not caught by preflight. Bounded downstream: GRBL rejects the malformed word (error:2/33), and ADR-041 makes an error:N terminal → stops the stream + safety notice — so the realistic outcome is a FAILED/partial job with a cryptic error, not a wild dangerous move. Hence Medium, not High/Critical.
Resolution (2026-07-05, read of preflight.ts + arc-sampling.ts): (a) CONFIRMED preflight has NO non-finite-coordinate check — its PreflightCodes list has no such code, and `findOutOfBoundsCoords` parses coords with the `GCODE_NUMBER` regex which does NOT match "NaN"/"Infinity", so those words are silently dropped and never flagged out-of-bed (NaN also defeats range compares). NOTE scalar params ARE guarded — `layerSpeedOutOfRange` checks `Number.isFinite(speed)` (L213) and NaN power fails the `>=0 && <=100` range (L178). Only geometry COORDINATES lack a finiteness backstop. (b) CONFIRMED a geometry primitive can produce NaN: `arc-sampling.ts sampleArcPoints` with a non-finite `radiusMm` yields `center + NaN*cos()` = NaN points (the `!(radiusMm>0)` guard covers the step calc, not the point calc). Residual uncertainty: whether a COMMON user action (vs. a malformed DXF/`.nc`/SVG import or degenerate transform) triggers non-finite input → S06 import validation.
TRIGGER RESOLVED (S06, 2026-07-05): **YES — reachable via SVG import.** `parse-path-d.ts` `NUMBER_RE` (L62 `[eE][+-]?\d+`) accepts unbounded exponents, so `Number("1e999")` = Infinity flows unguarded into scene coordinates (L97 `.map(Number)`, L129 `Number(match[0])`; handleMove/Line/etc. propagate it — no finiteness check). ROOT-CAUSE ASYMMETRY: the `.lf2` LOAD path validates coords via `project-validator-primitives.requireCoordinate` (finite + |v|≤1e6 mm), but FRESH SVG import does NOT run that validator — so a valid-grammar SVG with a huge exponent defeats the #1 bounds preflight (can't parse "Infinity") and reaches the emitter as `XInfinity`. (Finite-huge coords e.g. 1e30 ARE caught by preflight bounds; only Infinity/NaN slip.) SCOPE (S06 cont.): DXF is NOT affected — `dxf-entities.parseNumber` (L180) guards `Number.isFinite(parsed) ? parsed : fallback`; `.lf2` load + `parse-svg`'s attribute/viewBox parsing also guard. The hole is SPECIFIC to `parse-path-d`'s bare `Number()`/`.map(Number)` (L97/129) — so the fix is two localized call sites, not a broad import overhaul. S08 downstream (broadens harm): `ui/workspace/draw-scene.ts` has no finiteness guard either, so an Infinity-coord import also renders as an undrawable object and can NaN the fit-to-bounds zoom (recoverable UI glitch) — the same import-boundary fix resolves both the G-code and canvas effects.
Suggested fix direction: Best single fix — apply the `.lf2` validator's finiteness+magnitude guard at the SVG/DXF IMPORT boundary too (`parse-path-d`/`parse-svg`), so imports match loads. Plus a preflight `non-finite-coord` backstop (reject any non-finite emitted coord → no output, per #4) and/or an emitter formatter that Results/throws on non-finite instead of `toFixed`. Also reject non-finite `radiusMm` in arc-sampling; sanitize clipper2 in/out in kerf-offset + booleans.
Do not fix yet: Findings-only.

---

Finding ID:   S04-002
Sector:       S04 (core convention)
Severity:     Low  (borderline Info — unenforced-convention deviation)
Status:       Confirmed (vector-path-booleans); broader extent needs per-site review
File(s):      src/core/geometry/vector-path-booleans.ts (cross-ref selection-transform.ts as the Result exemplar)
Line(s)/fn:   combineVectorObjects L47/L59, offsetVectorObjects L78/L91, closedWorldPaths L114
Evidence:     PROJECT.md non-negotiables #10-13 + CLAUDE.md "Pure core" say core must "return a Result<T,E>" and list "Throwing for control flow" as an anti-pattern. This is NOT lint-enforced (pure-core ESLint rules cover globals/imports/clock/rng, not throw). `vector-path-booleans.ts` throws on EXPECTED user-input conditions (fewer than 2 objects, open contour, empty result, non-finite offset) that the UI catches — the exact anti-pattern — while its sibling `selection-transform.ts` returns a proper `Result` (`{kind:'ok'|'error'}`) for the same class. Repo-wide `grep 'throw new' src/core` = ~40 non-test sites across ~14 files; an unknown subset are legitimate invariant/`assertNever` throws vs control-flow throws (needs per-site triage — do NOT assume all are violations).
Why it matters: Inconsistent error-handling in pure core; a `throw` relies on every caller catching (the type system doesn't force it, unlike Result), so a future non-UI caller could surface an uncaught exception. Latent robustness + maintainability, not a current bug.
Risk:         Internal consistency/robustness; UI callers currently catch. Low.
Suggested fix direction: Convert the control-flow throws in `vector-path-booleans.ts` (and peers, after triage separating them from invariant/assertNever throws) to the `Result` pattern already used by `selection-transform.ts`; optionally add a lint rule.
Do not fix yet: Findings-only.

---

Finding ID:   S05-001
Sector:       S05 (trace / fill / raster / image fidelity)
Severity:     Info  (verification gap — UNVERIFIABLE in this environment, not a proven defect)
Status:       Confirmed (as a verification gap)
File(s):      src/core/trace/** (trace-image.ts, centerline/**), src/core/job/fill-hatching.ts, src/core/raster/emit-raster.ts + dither.ts
Line(s)/fn:   n/a (whole subsystems)
Evidence:     Per CLAUDE.md rule 2 + PROJECT.md, the automated suite (3594 tests green) proves STRUCTURE + DETERMINISM only, never FIDELITY (does the trace/fill/engrave LOOK like the source vs LightBurn?). This audit runs headless — no rendering, no laser/CNC, no LightBurn — so fidelity is UNVERIFIABLE here. Known open state (PROJECT.md Phase E + ADR-025/058/100): imagetracerjs is outline-only (a single pen stroke → two parallel contours; the centerline mode addresses it but its perceptual quality is unproven here); `DEFAULT_TRACE_OPTIONS` degenerates on already-binary input; the IoU *headline* metric alone is weak on the outline-vs-centerline gap.
S09 REFINEMENT (2026-07-05 — CORRECTS the "structure-only" framing): the perceptual harness is actually SUBSTANTIVE. `__fixtures__/perceptual/compare.ts` computes IoU + **precision + recall + f1** over a rasterized-OUTPUT mask (`gcode-rasterize`/`toolpath-rasterize`) vs analytic + real-logo ground truth — and **precision explicitly penalizes the doubled/too-thick-contour outline artefact** (compare.ts L10-11), recall penalizes dropped strokes; `centerline-deviation.ts`/`edge-truth.ts` add geometry-accuracy metrics; a REAL logo (`arch-house-langebaan-source.png`) exercises real-world trace quality. So fidelity IS partially automated-verified. Why this stays Info (the real residual): (1) no automated LightBurn-specific comparison (closed-source — and matching the SOURCE image is arguably the better target anyway); (2) the harness rasterizes HEADLESS in pure JS, not the real browser Canvas; (3) this audit could not RUN it or perceptually review the rendered output.
Why it matters: Output fidelity vs LightBurn is the project's stated hard problem and biggest differentiator — exactly what green tests do NOT measure. A trace/fill/raster can be geometrically wrong and pass everything.
Risk:         User-facing wrong-looking output (not a crash/safety issue). Cannot be rated higher without perceptual/hardware evidence.
Suggested fix direction: Maintainer-side perceptual verification — render trace/fill/raster output and diff vs source + a LightBurn side-by-side (perceptual harness `src/__fixtures__/perceptual/`, golden-image diff, or a physical burn). Not an audit-fixable item.
Do not fix yet: Findings-only; a verification gap for the maintainer, not a code change.

---

## Rejected / false-positive log

- **[S02] "`--branch=master` deploy is wrong (default branch is `main`)" — REJECTED (false positive).** Candidate: `package.json:38` + `deploy.yml:84` deploy with `--branch=master` while git's default branch is `main`. Evidence check: deploy.yml:9-12 documents it as intentional — the Cloudflare Pages project's *production* branch is `master` (legacy), so `--branch=master` is exactly what routes a deploy to the production URL; a non-matching branch would land as a CF "Preview". Correct + documented. Verifier agreed.
- **[S01] "ADR numbering has undocumented gaps" — REJECTED (false positive).** Candidate: DECISIONS.md skips ADR-023, 024, 054–056, 061–091, 099. Evidence check: every gap is documented *inside* DECISIONS.md — 023/024 acknowledged as ad-hoc/deferred numbers (L3942–3945); 054–091 reserved for the build plan (L3299, 3408, 3936); 099 explicitly *retired unused*, its collision-resolution role reassigned to ADR-104 (L4319, 4336). Numbering is collision-free (one heading per number; prior 094/106 collisions already resolved by renumber). Not a defect — good governance hygiene. Verifier pass agreed.
