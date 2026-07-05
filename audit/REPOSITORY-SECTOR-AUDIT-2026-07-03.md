# LaserForge-2.0 Sector Audit

Date started: 2026-07-03
Target checkout: `C:\Users\Asus\LaserForge-2.0`
Mode: sector audit plus user-approved fix-phase tracking.

## Audit Rules

- Divide the repository into sectors before auditing source behavior.
- Audit one sector at a time.
- Run at least three passes per sector.
- Update this file after each completed pass.
- Record bugs, risks, weak areas, missing logic, bad architecture, unclear code, and verification gaps.
- Do not fix product code during the audit.
- After all sectors are complete, collect all findings for maintainer review before any fix phase starts.

## Current Status

Active sector: S09 current-state delta audit.
Completed sectors: S01 Governance, audit history, and product contracts; S02 Tooling, build, release, CI, and static shell; S03 Electron desktop runtime and local bridge; S04 Core domain models, controller/device/material primitives; S05 Core job compilation, preflight, raster/trace, and output; S06 IO formats and persistence; S07 Platform adapters; S08 UI application workflows; S09 Fixtures, perceptual harness, and test assets.
Current pass: S09 delta Pass 2 complete; S09 delta Pass 3 next.

## Findings Summary

| ID | Severity | Sector | Status | Finding |
|---|---|---|---|---|
| S01-001 | Medium | S01 | Fixed | Product/release naming is split across LaserForge and KerfDesk contract surfaces. |
| S01-002 | Low | S01 | Fixed | README ADR index is stale: it describes 26 ADRs while `DECISIONS.md` now reaches ADR-093 plus ADR-060. |
| S01-003 | Medium | S01 | Fixed | Release/test status in README and AUDIT.md is stale relative to current inventory and phase scope. |
| S01-004 | Medium | S01 | Fixed | `WORKFLOW.md` is the source of truth for UI flows but still has Phase C/D/E stubs while those phases are shipped. |
| S01-005 | Medium | S01 | Fixed | Historical release-gate claims do not prove the current dirty worktree. |
| S01-006 | Medium | S01 | Fixed | README hardware-verification wording is too broad for the documented pending hardware gaps. |
| S01-007 | Medium | S01 | Fixed | Cloudflare auto-deploy status contradicts itself across README and AUDIT.md. |
| S01-008 | Low | S01 | Fixed | The historical audit corpus has no index/README despite dozens of reports and findings files. |
| S01-009 | Medium | S01 | Fixed | `PROJECT.md` data-model and module-layout sections are stale relative to shipped scene variants and folders. |
| S01-010 | Low | S01 | Fixed | `DECISIONS.md` future-ADR numbering note references a missing plan file and stale contiguous numbering. |
| D-S01-001 | Medium | S01 | Open | Sector map omitted current core/root paths. |
| D-S01-002 | Medium | S01 | Open | Completion ledger did not cover post-baseline commits. |
| D-S01-003 | Low | S01 | Open | Phase H summary header stale after H.14. |
| S02-001 | High | S02 | Fixed | Production web headers deny browser camera permission while the current UI calls `getUserMedia`. |
| S02-002 | Medium | S02 | Fixed | Raw physical line backstop only scans `src/`, leaving Electron/config/scripts outside the CI raw-line policy. |
| S02-003 | Medium | S02 | Fixed | Runtime engine declarations allow Node/pnpm versions looser than the CI/deploy environment comments require. |
| S02-004 | Medium | S02 | Fixed | Release verification steps are duplicated across `release:check`, CI, and deploy instead of sharing one gate. |
| D-S02-001 | Low | S02 | Open | Deterministic build-time metadata has no direct regression test. |
| D-S02-002 | Low | S02 | Open | Production web build still emits a Vite chunk-size warning. |
| D-S02-003 | Low | S02 | Open | CI-only Vitest worker throttling has no direct policy regression test. |
| S03-001 | High | S03 | Fixed | RTSP bridge CORS allows the Pages fallback hostname but not canonical `kerfdesk.com`. |
| S03-002 | High | S03 | Fixed | Electron permission policy does not grant browser camera/media permission even though the UI calls `getUserMedia`. |
| S03-003 | Medium | S03 | Fixed | RTSP probe waits for socket end, so cameras that keep the connection open can time out after a valid response. |
| S03-004 | Medium | S03 | Fixed | FFmpeg streaming path lacks child-process error/exit handling after returning HTTP 200. |
| S03-005 | Low | S03 | Fixed | RTSP private-host validation accepts malformed IPv4-like hosts because it does not bound octets to `0..255`. |
| S03-006 | Low | S03 | Fixed | Electron CSP rationale comments still describe the pre-camera bridge policy, making the security posture unclear. |
| S04-001 | Medium | S04 | Fixed | Core camera profile validation accepts any `rtsp://` URL while the bridge only supports loopback/private-network RTSP hosts. |
| S04-002 | Medium | S04 | Fixed | Camera alignment readiness accepts near-degenerate or high-residual point sets because it has no conditioning/error threshold. |
| S04-003 | Medium | S04 | Fixed | Device profile validation does not enforce consistency between the `camera` capability and `cameraProfile` metadata. |
| S04-004 | Medium | S04 | Fixed | `buildJogCommand` can emit non-finite `$J=` jog commands such as `XNaN`, `YInfinity`, and `FNaN`. |
| S04-005 | Low | S04 | Fixed | GRBL alarm/status parsers use `parseInt` without full-token numeric validation for coded suffixes. |
| S04-006 | Low | S04 | Fixed | Layer color constructors and assignment helpers allow invalid layer-color strings despite the lowercase hex color contract. |
| S04-007 | Low | S04 | Fixed | Polyline bounds logic is duplicated in `create-polyline.ts` instead of using the shared helper used by sibling shape factories. |
| S04-008 | Low | S04 | Fixed | Scan-offset validation rejects duplicate speeds, but the core normalizer silently keeps the last duplicate speed. |
| S04-009 | Low | S04 | Fixed | G-code dialect resolution silently falls back to `grbl-dynamic` for unknown dialect ids. |
| S04-010 | Medium | S04 | Fixed | Guarded GRBL setting writes accept JavaScript numeric syntax and send the original string to firmware. |
| S04-011 | Medium | S04 | Fixed | Welding vector objects drops object-level output metadata such as operation overrides and power scale. |
| S04-012 | Medium | S04 | Fixed | Selection transform builders can propagate non-finite values into scene transforms. |
| D-S04-001 | Medium | S04 | Open | Exported surfacing generator lacks finite/positive guards. |
| D-S04-002 | Medium | S04 | Open | Grid/heightmap sizing helpers can return malformed grids for non-finite dimensions. |
| D-S04-003 | Medium | S04 | Open | Material feed seeding can persist non-finite feed values. |
| D-S04-004 | Low | S04 | Open | Expanded default CNC tool library lacks an invariant test for its stable-ID contract. |
| S05-001 | Medium | S05 | Fixed | Active no-go-zone preflight uses a simplified duplicate parser while the fuller modal-aware implementation is unused. |
| S05-002 | Low | S05 | Fixed | Preflight and invariant G-code parsers share a narrow decimal grammar that misses valid/common numeric forms. |
| S05-003 | Medium | S05 | Fixed | Non-finite layer speed can pass preflight and propagate to emitted feed words such as `FNaN`. |
| S05-004 | High | S05 | Fixed | Pre-emit raster budget checks only the first matching image operation, while compilation emits every image operation. |
| S05-005 | Medium | S05 | Fixed | Main preflight layer-mode and raster checks are not sub-layer-aware even though compile/preview/frame paths are. |
| S05-006 | Medium | S05 | Fixed | Malformed saved raster luma silently degrades to all-white output instead of invalidating the raster/job. |
| S05-007 | Medium | S05 | Fixed | Raster scan-offset compensation is applied to emitted G-code and bounds but not to route-preview toolpaths. |
| S05-008 | Medium | S05 | Fixed | Raster duration estimates collapse wide white gaps into one feed sweep even though output and preview split them into rapid-separated spans. |
| D-S05-001 | Low | S05 | Open | Auto-upscale exported helpers do not validate scale factors. |
| D-S05-002 | Low | S05 | Open | Trace core accepts malformed `RawImageData` shape without explicit guard. |
| D-S05-003 | Low | S05 | Open | Canny edge core does not bound threshold ratios or blur sigma. |
| D-S05-004 | Low | S05 | Open | Trace image-adjustment options do not fail closed on non-finite values. |
| S06-001 | Medium | S06 | Fixed | Project deserialization accepts unvalidated device capabilities while machine-profile import rejects them. |
| S06-002 | Medium | S06 | Fixed | SVG import has no total geometry, point-count, or finite-coordinate budget before materializing imported vectors. |
| S06-003 | Medium | S06 | Fixed | Project `.lf2` validation caps coordinates and raster source pixels, but not total vector/object/point counts. |
| S06-004 | Medium | S06 | Fixed | Project `.lf2` validation accepts duplicate scene IDs and dangling group references that later scene operations assume are canonical. |
| S06-005 | Medium | S06 | Fixed | SVG `<use>` imports can drop common `<symbol>` sprite geometry because referenced symbols are skipped like inert definitions. |
| S06-006 | Low | S06 | Fixed | G-code metadata header fields are interpolated into comment lines without newline/control-character sanitization. |
| S07-001 | Medium | S07 | Fixed | Web save streams are not closed or aborted when a file write fails. |
| S07-002 | Medium | S07 | Fixed | Browser camera bridge client trusts unvalidated JSON from the local HTTP bridge. |
| S07-003 | Medium | S07 | Fixed | Web Serial line-size guard only limits unterminated partial lines, not huge newline-terminated records. |
| S07-004 | Medium | S07 | Fixed | Deploy policy tests do not pin all current pre-publish gates. |
| S07-005 | Medium | S07 | Fixed | Web save workflow promises a browser-download fallback that the platform adapter does not implement. |
| S07-006 | Medium | S07 | Fixed | Web Serial stale-open recovery paths are not covered by regression tests. |
| S07-007 | Low | S07 | Fixed | `CameraBridgeAdapter.rtspPreviewUrl(...)` is a production-unused API surface. |
| S08-001 | Medium | S08 | Fixed | Focus Test can be enabled in the command registry but the real shell callback only shows a not-implemented alert. |
| S08-002 | Medium | S08 | Fixed | Image import and multi-file trace use hidden DOM file inputs/download links instead of the platform file boundary. |
| S08-003 | Medium | S08 | Fixed | PWA update reload banner ignores active job states `done` and `errored` that still require recovery controls. |
| S08-004 | Medium | S08 | Fixed | Workspace drag hook is not directly covered by its test file. |
| S08-005 | Medium | S08 | Fixed | View transform and event-coordinate math can produce invalid scene coordinates. |
| S08-006 | Medium | S08 | Fixed | Preview preparation still runs synchronously on the workspace UI path. |
| S08-007 | Medium | S08 | Fixed | Path-node hit testing ignores hidden layer visibility. |
| S08-008 | Medium | S08 | Fixed | Frame fallback for over-budget rasters ignores selected-output scope. |
| S08-009 | Medium | S08 | Fixed | Ctrl/Cmd+. stop shortcut does nothing during active frame or jog motion. |
| S08-010 | Medium | S08 | Fixed | Trace worker requests do not clean up or retire the worker when `postMessage(...)` throws synchronously. |
| S08-011 | Medium | S08 | Fixed | Trace boundary dragging can persist non-finite crop rectangles when preview geometry collapses. |
| S08-012 | Low | S08 | Fixed | Cut Settings dialog can save layer speeds above the active device max feed while inline controls clamp them. |
| S08-013 | Medium | S08 | Fixed | Selected Artwork Settings treats the first selected object's operation settings as common for the whole mixed selection. |
| S08-014 | Low | S08 | Fixed | Preview route playback buttons use an undefined CSS class instead of the shared button chrome. |
| S08-015 | Low | S08 | Fixed | The hover-help contract accepts unregistered `data-help-id` values, and preview controls already use IDs outside the help registry. |
| S08-016 | Low | S08 | Fixed | Add/Edit Text numeric inputs can pass non-finite or out-of-contract values into text rendering and scene state. |
| D-S08-001 | Medium | S08 | Open | PWA update dismissal re-arm clears storage without invalidating the mounted prompt render. |
| D-S08-002 | Medium | S08 | Open | UI canvas/WebGL tests pass while emitting jsdom canvas errors and async `act(...)` warnings. |
| S09-001 | Medium | S09 | Fixed | The required Arch House fixture detector accepts non-PNG files even though all real-logo consumers decode the path as PNG. |
| S09-002 | Low | S09 | Fixed | Perceptual artifact PNGs are ignored local outputs but are referenced like durable audit evidence. |
| S09-003 | Low | S09 | Fixed | `writePerceptualArtifact(...)` can render a misleading comparison for mismatched mask dimensions. |
| S09-004 | Low | S09 | Fixed | The active real-logo benchmark fixture lives under `audit/fixtures`, mixing test-fixture ownership with audit evidence. |
| S09-005 | Low | S09 | Fixed | The Arch House opt-in trace evidence writer uses an unignored `audit/evidence/trace-artifacts` output path. |
| S09-006 | Medium | S09 | Fixed | The centerline performance regression test uses the worker timeout as its only budget despite a much lower stated target and current runtime. |
| S09-007 | Low | S09 | Fixed | The minimal PNG decoder has no dedicated malformed/unsupported-file tests even though it gates the real-logo benchmark fixture. |
| S09-008 | Low | S09 | Fixed | The emitted-G-code burn rasterizer has no direct parser tests beyond three generated GRBL fill fixtures. |
| D-S09-001 | Low | S09 | Open | `TRACE_AUDIT` diagnostic tests count as passing tests when the diagnostic environment flag is absent. |
| D-S09-002 | Low | S09 | Open | `_edge-zoom` TRACE_AUDIT diagnostic still hardcodes the removed `audit/fixtures/trace` logo path. |

## Pass Log

### S01 Pass 1 - Contract and Audit Corpus Orientation

Scope planned:

- Root operating contract documents.
- Historical audit documents and audit evidence layout.
- Documentation/source-of-truth consistency risks.
- Dirty-worktree impact on audit reliability.

Evidence inspected:

- `git rev-parse --show-toplevel`, `git branch --show-current`, and `git status --short`.
- `git ls-files -co --exclude-standard`.
- `CLAUDE.md`, `PROJECT.md`, `WORKFLOW.md`, `README.md`, `AUDIT.md`, `DECISIONS.md`, `LICENSE`, and `package.json`.
- Targeted `rg` checks for product naming, phase status, stubs, release metrics, and license posture.

Findings:

#### S01-001 - Product/release naming is split across LaserForge and KerfDesk contract surfaces

Severity: Medium.

Evidence:

- `package.json:2` names the package `laserforge`.
- `PROJECT.md:1` and `PROJECT.md:11` frame the product as LaserForge 2.0.
- `AUDIT.md:1` is titled LaserForge 2.0.
- `README.md:1` names the product KerfDesk, and `README.md:69-88` describes `kerfdesk.com` as canonical while retaining `laserforge` as the Cloudflare API project.
- `WORKFLOW.md:1`, `WORKFLOW.md:32`, `WORKFLOW.md:380`, `WORKFLOW.md:418`, and `WORKFLOW.md:421` use KerfDesk user-facing text.
- `public/404.html:13` and `public/404.html:41` still say LaserForge 2.0.

Risk:

The rebrand may be intentional, but the architecture contracts do not clearly state the canonical product name, package/API legacy name, and user-facing release name. That creates release-verification ambiguity and makes it easy for future docs, UI copy, Cloudflare settings, or audit reports to validate the wrong surface.

No fix made.

#### S01-002 - README ADR index is stale

Severity: Low.

Evidence:

- `README.md:40` says `DECISIONS.md` contains 26 ADRs (`ADR-001..026`).
- `DECISIONS.md` currently includes later ADRs such as `ADR-059`, `ADR-060`, `ADR-092`, and `ADR-093`.

Risk:

New contributors will under-read the decision log and may miss binding architectural decisions, especially the later material-library, device-setup, PWA, trace, and camera-era decisions.

No fix made.

#### S01-003 - Release/test status docs are stale relative to current inventory and scope

Severity: Medium.

Evidence:

- `README.md:47` says the 2026-06-28 gate passed with 2,420 tests across 389 files.
- `AUDIT.md:25-26` repeats 2,420 passing tests and 389 test files.
- Current file inventory from `git ls-files -co --exclude-standard` shows 417 `*.test.ts` / `*.test.tsx` files in the current worktree.
- `README.md:5` and `README.md:47` summarize through Phase F.3, while `PROJECT.md:100-104` documents Phase F.4, F.5, and Phase G in progress.
- `AUDIT.md:1` is still titled "post-Phase F.1" despite later sections covering newer work.

Risk:

The top-level docs present old release confidence as if it covers the current tree. That weakens audit traceability: a reader can confuse a clean 2026-06-28 release gate with the dirty, newer worktree under audit.

No fix made.

#### S01-004 - Workflow source-of-truth has shipped-phase stubs

Severity: Medium.

Evidence:

- `WORKFLOW.md:3` says UI changes that contradict `WORKFLOW.md` require a `WORKFLOW.md` update first.
- `WORKFLOW.md:5` says Phase C/D/E sections are still stubs even though code for phases through F.3 is shipped.
- `WORKFLOW.md:746`, `WORKFLOW.md:781`, and `WORKFLOW.md:791` are explicit Phase C, D, and E stub headings.
- `PROJECT.md:79` and `PROJECT.md:87` mark Phase D and Phase E as shipped.

Risk:

For shipped workflows, the declared source of truth is incomplete. Future UI and behavior changes may be reviewed against implementation memory or ad hoc assumptions instead of success/error/empty/edge flow contracts.

No fix made.

#### S01-005 - Historical release-gate claims do not prove the current dirty worktree

Severity: Medium.

Evidence:

- `git status --short` at audit start shows many modified and untracked files, including `electron/*rtsp-camera-bridge*`, camera profiles, machine-profile, material-library, and device-profile files.
- `README.md:47` and `AUDIT.md:25` cite a 2026-06-28 `pnpm release:check` result.
- The current audit did not yet run `pnpm release:check`, and the working tree has changed since the cited gate.

Risk:

The audit can use historical gates as background, but not as proof of current correctness. Later sectors must verify relevant behavior against the dirty worktree or explicitly mark claims as stale.

No fix made.

Pass 1 result: complete. S01 still needs Pass 2 and Pass 3.

### S01 Pass 2 - Independent Consistency and Audit-Process Pass

Evidence inspected:

- Targeted scans across `README.md`, `PROJECT.md`, `WORKFLOW.md`, `AUDIT.md`, `DECISIONS.md`, `audit/**`, and `docs/**` for `CLAIMED`, `DEFERRED`, `pending`, `not yet`, `stale`, `TODO`, and source-of-truth language.
- `Test-Path audit\README.md`.
- Counts of `audit/findings`, `audit/reports`, `audit/evidence`, and `audit/prompts`.
- Focused line reads around `README.md:1-95`, `PROJECT.md:92-110`, `WORKFLOW.md:1-8`, `WORKFLOW.md:1040-1048`, and `AUDIT.md:245-275`.

Findings:

#### S01-006 - README hardware-verification wording is too broad

Severity: Medium.

Evidence:

- `README.md:5` says "Hardware-verified on a Creality Falcon A1 Pro running GrblHAL 1.1f" in the same status paragraph that also says F.2 hardware burn and F.3 hardware verification are pending.
- `PROJECT.md:98` says F.2.f hardware burn is pending.
- `PROJECT.md:99` says F.3 hardware verification is pending.
- `PROJECT.md:100` says F.4 live in-app render/placement and LightBurn side-by-side verification are not yet done.
- `AUDIT.md:253-270` lists many claimed-not-verified items, including F.1 Fill no real Falcon burn yet, F.2 hardware pending, and Set Origin deferred.

Risk:

A reader can interpret the README headline as product-wide hardware verification even though several safety-sensitive burn/origin/render workflows are explicitly not verified. That can lead to unsafe confidence in current behavior.

No fix made.

#### S01-007 - Cloudflare auto-deploy status contradicts itself across README and AUDIT.md

Severity: Medium.

Evidence:

- `README.md:80-84` says secrets are required and then says "Current status (2026-06-28): push-to-deploy is active."
- `AUDIT.md:269` says Cloudflare Pages auto-deploy is only CLAIMED and that the two secrets are not yet set, so the first auto-deploy attempt will fail.
- `package.json:38-39` routes manual deploys through `pnpm release:check`, but that does not resolve whether GitHub auto-deploy secrets are present.

Risk:

The repo has two incompatible deployment truths. A release operator may rely on push-to-deploy when it is not actually authenticated, or dismiss a failing deploy as expected when it should be investigated.

No fix made.

#### S01-008 - Historical audit corpus lacks an index

Severity: Low.

Evidence:

- `audit/README.md` does not exist.
- Current audit corpus counts: 12 JSON findings files, 65 report files, 58 top-level evidence files, 7 prompt files, and 8 top-level audit files.
- Root docs point to `AUDIT.md` as the rolling audit, but the archive has no maintained map of which files are current, superseded, resolved, stale, or evidence-only.

Risk:

The project has strong audit history, but the corpus is difficult to navigate without prior context. That increases the chance that future audits resurrect stale findings or miss active ones.

No fix made.

Pass 2 result: complete. S01 still needs Pass 3.

### S01 Pass 3 - Coverage and Remaining-Gap Pass

Evidence inspected:

- `PROJECT.md` data model, module layout, source-of-truth, and Phase A acceptance sections.
- `DECISIONS.md` future ADR numbering note.
- `git ls-files -co --exclude-standard` grouped across S01 sub-areas.
- Current `src/core`, `src/io`, and `src/ui` folder/index inventory.
- Targeted scans for current `RasterImage`, shape, material-library, and camera concepts.

S01 coverage result:

- Root contracts inspected: `CLAUDE.md`, `PROJECT.md`, `WORKFLOW.md`, `DECISIONS.md`, `README.md`, `AUDIT.md`, `LICENSE`, `package.json`.
- Historical audit and docs corpus inspected by structure, counts, and targeted status scans.
- S01 sub-area coverage: 10 root contract files, 9 root historical files, 151 `audit/**` files after this audit set, 4 general `docs/**` files, 3 `docs/research/**` files, and 47 `docs/superpowers/plans/**` files.
- No additional major S01 area remains unchecked at sector level. Individual archived plans/reports may still contain stale historical statements, but that is covered by S01-008 rather than requiring another S01 loop now.

Findings:

#### S01-009 - `PROJECT.md` architecture sections are stale relative to shipped variants and folders

Severity: Medium.

Evidence:

- `PROJECT.md:220-240` still presents an MVP-era data model with `Layer.mode: 'line'` and says the MVP has `ImportedSvg`, Phase D adds `TextObject`, and Phase E adds `TracedImage`.
- Earlier in the same file, `PROJECT.md:95-108` documents shipped or in-progress Fill, Image, Convert-to-Bitmap, Material calibration, and Shape/Drawing work.
- Current code and decisions reference `RasterImage`, `kind: 'shape'`, material libraries, and camera profiles.
- `PROJECT.md:246-282` lists a module layout with folders such as `plan/`, `fonts/`, and `io/image/`, but the current tracked source uses folders including `src/core/camera`, `src/core/controllers`, `src/core/material-library`, `src/core/raster`, `src/core/shapes`, `src/core/trace`, `src/io/lightburn`, `src/io/machine-profile`, `src/io/material-library`, `src/ui/material-library`, and `src/ui/calibration`.

Risk:

`PROJECT.md` is declared the scope and architecture source of truth, but its architecture snapshot is now old enough to mislead sector audits and future feature placement. That increases the chance of wrong-boundary edits.

No fix made.

#### S01-010 - `DECISIONS.md` future-ADR numbering note is stale

Severity: Low.

Evidence:

- `DECISIONS.md:3579-3585` says the contiguous body runs ADR-001..057 and references `.claude/plans/plan-a-full-build-sparkling-kazoo.md`.
- `Test-Path .claude\plans\plan-a-full-build-sparkling-kazoo.md` returned `False` in the primary checkout.
- The same decision log currently contains later entries such as ADR-059, ADR-060, ADR-092, and ADR-093.

Risk:

The numbering note may cause new ADRs to be filed under the wrong numbering assumption or depend on an unavailable local plan file.

No fix made.

Pass 3 result: complete. S01 sector status: complete after three passes. Move to S02.

### S02 Pass 1 - Release Gate and Static Host Orientation

Scope planned:

- `package.json` scripts and release gates.
- GitHub Actions workflows.
- TypeScript, Vite, Vitest, ESLint, Prettier, and workspace config.
- Static shell and Cloudflare headers/redirects.
- Repo guard and maintenance scripts.

Evidence inspected:

- `package.json` scripts.
- `.github/workflows/ci.yml`.
- `.github/workflows/deploy.yml`.
- `scripts/assert-correct-repo.mjs`.
- `scripts/check-file-size-policy.mjs`.
- `scripts/check-licenses.mjs`.
- `scripts/clean-electron-output.mjs`.
- `eslint.config.mjs`, `eslint.electron.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `vite.config.ts`.
- `public/_headers`, `public/_redirects`, `public/404.html`, and `index.html`.
- Current diff for `package.json` and `public/_headers`.

Findings:

#### S02-001 - Production web headers deny browser camera permission while UI calls `getUserMedia`

Severity: High.

Evidence:

- `public/_headers:19` sets `Permissions-Policy: ... camera=() ...`.
- `src/ui/laser/MachineSetupCameraPreview.tsx:154-164` starts browser camera preview through `navigator.mediaDevices.getUserMedia`.
- `src/ui/laser/MachineSetupCameraPreview.tsx:178-194` unlocks camera labels by calling `getUserMedia({ video: true, audio: false })`.
- `src/ui/laser/MachineSetupCameraPreview.test.tsx:60-80` explicitly tests that listing cameras asks for permission and exposes external camera names.
- `public/_headers:13` was modified for the RTSP bridge, so the static host policy is already being adjusted for camera-related work, but the browser-camera permission remains denied.

Risk:

On the deployed web app, the browser-camera path can be blocked by the response header even though the UI offers browser camera listing and preview. RTSP bridge preview may still work through `127.0.0.1:51731`, but USB/webcam camera selection is likely broken in production.

No fix made.

#### S02-002 - Raw physical line backstop only scans `src/`

Severity: Medium.

Evidence:

- `CLAUDE.md:37` says CI runs a 600 raw physical lines backstop.
- `CLAUDE.md:41` frames the raw physical-line backstop as a file policy.
- `package.json:26-27` wires `check:file-size` into `release:check`.
- `scripts/check-file-size-policy.mjs:5` sets `sourceRoots = ['src']`.
- Electron code is linted separately, but `electron/**`, `scripts/**`, root config files, and other TypeScript/JS maintenance code are outside the raw physical-line backstop.

Risk:

Large Electron/runtime support files or maintenance scripts can grow beyond the raw physical-line policy while the `check:file-size` gate still passes. That creates a policy blind spot around exactly the desktop and release tooling code that tends to accumulate security-sensitive glue.

No fix made.

Pass 1 result: complete. S02 still needs Pass 2 and Pass 3.

### S02 Pass 2 - Gate Consistency and Escape-Path Pass

Evidence inspected:

- `package.json` engine and `packageManager` declarations.
- `.github/workflows/ci.yml` Node/pnpm setup comments and steps.
- `.github/workflows/deploy.yml` Node/pnpm setup comments and steps.
- Local `node -v`, `pnpm -v`, and `corepack --version`.
- Cross-check of `release:check`, CI, and deploy command sequences.

Findings:

#### S02-003 - Runtime engine declarations are looser than CI/deploy runtime requirements

Severity: Medium.

Evidence:

- `package.json:7-11` declares `node >=20.0.0`, `pnpm >=9.0.0`, and `packageManager: pnpm@11.3.0`.
- `.github/workflows/ci.yml:35-39` says Node 22 is required by pnpm 11.3.0 and sets `node-version: 22`.
- `.github/workflows/deploy.yml:65-66` says pnpm 11.3.0 needs Node `>=22.13` and also sets `node-version: 22`.
- Local tool output during this audit was Node `v24.15.0`, pnpm `11.7.0`, and corepack `0.34.6`, so the current machine is not exercising the loose Node 20 path.

Risk:

The repo advertises support for Node 20 and pnpm 9+, while the CI/deploy comments say the pinned package-manager path needs Node 22. A contributor can follow the declared engines, hit local install/tooling failures, or produce lock/tool differences not represented by CI.

No fix made.

#### S02-004 - Release verification is duplicated across local and GitHub gates

Severity: Medium.

Evidence:

- `package.json:27` defines `release:check` as `guard:repo`, typecheck, lint, Electron lint, format, license, dependency audit, tests, web build, Electron main build, and file-size check.
- `.github/workflows/ci.yml:45-70` repeats most of that list manually but does not run `pnpm guard:repo`.
- `.github/workflows/deploy.yml:72-103` repeats the list manually again and includes `pnpm guard:repo`.
- Manual deploy scripts call `pnpm release:check`, but CI and deploy workflow do not call that script directly.

Risk:

The release gate can drift silently. A future change to `release:check` may not be reflected in CI/deploy, or a GitHub workflow change may not be reflected in local release checks. This already shows a small mismatch: CI does not run the repo identity guard while local release and deploy do.

No fix made.

Pass 2 result: complete. S02 still needs Pass 3.

### S02 Pass 3 - Coverage and Remaining-Gap Pass

Evidence inspected:

- Full S02 file list: 24 files across config, package metadata, GitHub workflows, scripts, public static files, and app shell.
- `.gitignore`, `.prettierignore`, `.editorconfig`, `.gitattributes`, `.prettierrc`, and `pnpm-workspace.yaml`.
- Targeted scans for `TODO`, `FIXME`, secrets, local host allowances, source map references, runtime version pins, release-gate references, and Cloudflare references.
- `pnpm guard:repo`.
- `pnpm check:file-size`.

S02 coverage result:

- `pnpm guard:repo` passed for `C:\Users\Asus\LaserForge-2.0`.
- `pnpm check:file-size` passed, with the known scope caveat recorded in S02-002.
- Static shell files and hosting headers were inspected.
- No additional S02 area remains unchecked at sector level.

New findings: none.

Pass 3 result: complete. S02 sector status: complete after three passes. Move to S03.

### S03 Pass 1 - Electron Runtime and Bridge Orientation

Scope planned:

- Electron main process.
- Electron CSP and trusted-renderer policy.
- RTSP camera bridge and bridge CLI.
- Desktop serial-port choice.
- Electron build config.

Evidence inspected:

- `electron/main.ts`.
- `electron/trusted-renderer-policy.ts` and tests.
- `electron/serial-port-choice.ts` and tests.
- `electron/rtsp-camera-bridge.ts`, `electron/rtsp-camera-bridge-policy.ts`, `electron/rtsp-camera-bridge-cli.ts`, and tests.
- `electron/csp-policy.test.ts`, `electron/source-map-policy.test.ts`, `electron/tsconfig.json`, and `electron-builder.yml`.
- Cross-sector references to `README.md`, `public/_headers`, and `src/ui/laser/MachineSetupCameraPreview.tsx`.

Findings:

#### S03-001 - RTSP bridge CORS omits canonical `kerfdesk.com`

Severity: High.

Evidence:

- `README.md:68-88` says the canonical production release URL is `https://kerfdesk.com`, with `https://laserforge-2fj.pages.dev` only the fallback hostname.
- `electron/rtsp-camera-bridge.ts:156-160` allows `app://app`, local dev origins, or `isLaserForgePagesOrigin(origin)`.
- `electron/rtsp-camera-bridge.ts:163-170` only accepts `laserforge-2fj.pages.dev` and its subdomains for deployed web origins.
- `electron/rtsp-camera-bridge.test.ts:5-14` tests `laserforge-2fj.pages.dev` but has no `kerfdesk.com` or `www.kerfdesk.com` case.
- `public/_headers:13` allows the deployed web app to request `http://127.0.0.1:51731`, so the static host is prepared for the bridge but the bridge itself rejects the canonical origin.

Risk:

The RTSP camera bridge can work in Electron, local dev, and the Pages fallback domain while failing from the actual production domain due to missing `Access-Control-Allow-Origin`. That breaks the browser/dev RTSP camera path exactly where users are told the production app lives.

No fix made.

#### S03-002 - Electron permission policy omits browser camera/media permission

Severity: High.

Evidence:

- `src/ui/laser/MachineSetupCameraPreview.tsx:154-164` starts preview with `navigator.mediaDevices.getUserMedia`.
- `src/ui/laser/MachineSetupCameraPreview.tsx:178-194` calls `getUserMedia({ video: true, audio: false })` to unlock camera labels.
- `electron/trusted-renderer-policy.ts:72-81` gates permission requests through `isAllowedAppPermission`.
- `electron/trusted-renderer-policy.ts:91-92` only allows `serial` and `fileSystem*` permissions.
- `electron/trusted-renderer-policy.test.ts` covers serial and file-system permission grants, but no camera/media grant.

Risk:

In the Electron desktop app, the browser-camera picker/preview path can be denied by the main-process permission handler even for the trusted renderer. RTSP bridge mode may work, but USB/webcam camera mode is likely blocked.

No fix made.

Pass 1 result: complete. S03 still needs Pass 2 and Pass 3.

### S03 Pass 2 - Runtime Failure-Mode and Test-Coverage Pass

Evidence inspected:

- Targeted scans of Electron code for permissions, origins, FFmpeg spawning, server close, protocol handling, and error paths.
- Current diff under `electron/**`.
- Full S03 file inventory.
- Focused command: `pnpm test --run electron`.

Verification:

- `pnpm test --run electron` passed: 6 files, 21 tests.
- Passing tests do not cover S03-001, S03-002, S03-003, or S03-004.

Findings:

#### S03-003 - RTSP probe waits for socket end

Severity: Medium.

Evidence:

- `electron/rtsp-camera-bridge.ts:111-128` sends an RTSP `DESCRIBE`, accumulates data on `data`, but only resolves on the socket `end` event.
- `electron/rtsp-camera-bridge.ts:119` rejects after 2.5 seconds on timeout.
- `electron/rtsp-camera-bridge.test.ts:17-21` tests `rtspProbeIsOk(...)` on static strings, but not the socket behavior or the case where a camera returns `200 OK` and keeps the TCP session open.

Risk:

RTSP servers may keep the connection open after responding. In that case the bridge can collect a valid `200 OK` response but still reject as timed out because `end` never fires. Users see "RTSP probe timed out" even though the camera responded.

No fix made.

#### S03-004 - FFmpeg streaming path lacks child-process error/exit handling after HTTP 200

Severity: Medium.

Evidence:

- `electron/rtsp-camera-bridge.ts:73-90` spawns `ffmpeg`.
- `electron/rtsp-camera-bridge.ts:91-96` immediately writes HTTP 200, pipes stdout, and kills the process on response close.
- There is no `ffmpeg.on('error')`, no `ffmpeg.on('exit')`, and no stderr handling for stream startup or mid-stream failure.

Risk:

If `ffmpeg` fails after the cached availability check, exits immediately due to bad credentials/RTSP negotiation, or errors during spawn, the client can receive a 200 stream response with no structured failure. A spawn error can also become an unhandled child-process error. This weakens the camera bridge diagnostics and can make the UI look stuck instead of explaining the failure.

No fix made.

Pass 2 result: complete. S03 still needs Pass 3.

### S03 Pass 3 - Coverage and Remaining-Gap Pass

Evidence inspected:

- Full S03 file inventory and line counts across `electron/**` and `electron-builder.yml`.
- `electron/main.ts`, `electron/trusted-renderer-policy.ts`, `electron/rtsp-camera-bridge.ts`, `electron/rtsp-camera-bridge-policy.ts`, `electron-builder.yml`, and focused Electron tests.
- Targeted searches for permission handlers, navigation guards, CSP, RTSP bridge origins, FFmpeg process handling, loopback/private-host policy, and packaging/source-map policy.

Verification:

- `pnpm lint:electron` passed.
- Focused Electron Vitest command passed: 6 files, 21 tests.
- `pnpm exec tsx` is not available in this repo, so the malformed-IPv4 policy edge was confirmed by source inspection plus a Node `URL` parser check rather than by importing the TypeScript policy directly.

Findings:

#### S03-005 - RTSP private-host validation accepts malformed IPv4-like hosts

Severity: Low.

Evidence:

- `electron/rtsp-camera-bridge-policy.ts:33-38` splits the hostname into numeric parts and only checks that all four parts are integers.
- `electron/rtsp-camera-bridge-policy.ts:41-50` then accepts hosts based only on the first one or two octets (`10.*`, `172.16-31.*`, `192.168.*`).
- The logic does not reject octets outside the valid IPv4 range. A Node parser check showed that `rtsp://192.168.1.999/live`, `rtsp://10.999.999.999/live`, and `rtsp://172.16.300.1/live` keep those hostnames intact and match the current private-range predicate.
- `electron/rtsp-camera-bridge-policy.test.ts:5-23` covers valid private examples and one public example, but no malformed-octet cases.

Risk:

Malformed camera URLs can pass the bridge policy and fail later as socket/DNS errors instead of being rejected as invalid input. This is not a broad public-network SSRF bypass, but it weakens the intended private-host guard and produces avoidable confusing diagnostics.

No fix made.

#### S03-006 - Electron CSP rationale comments are stale after camera bridge addition

Severity: Low.

Evidence:

- `electron/main.ts:78-80` correctly includes `CAMERA_BRIDGE_ORIGIN` in `img-src` and `connect-src`.
- `electron/main.ts:312-318` still describes `img-src 'self' data: blob:` and `connect-src 'self'` with "no outbound HTTP" and "External services: None."
- `electron/csp-policy.test.ts:16-22` now asserts the local RTSP bridge allowance, so tests reflect the newer runtime policy while the explanatory comment does not.

Risk:

The runtime policy and tests are aligned, but the main-process security rationale is misleading for future CSP changes. A maintainer could interpret the app as having no HTTP connect target when the local camera bridge is intentionally allowed.

No fix made.

Pass 3 result: complete. S03 has three audit passes, targeted lint/test coverage, and no remaining major unchecked Electron areas. S03 closed.

### S04 Pass 1 - Core Domain Orientation and Dirty-Path Sweep

Evidence inspected:

- S04 inventory from the architecture file: 109 files under `src/core/app-branding.ts`, `src/core/camera/**`, `src/core/controllers/**`, `src/core/devices/**`, `src/core/geometry/**`, `src/core/grbl-streaming.ts`, `src/core/material-library/**`, `src/core/scene/**`, `src/core/shapes/**`, `src/core/text/**`, and `src/core/util/**`.
- Current tracked diffs in S04, especially device-profile, catalog validation, camera metadata, and material matching.
- High-line-count and contract files: camera profile/transform, device profile/catalog, GRBL command/response/status/streaming primitives, material recipe/matching code, scene/layer/object models, shape factories, text rendering, and geometry helpers.
- Targeted searches for `TODO`, `throw new Error`, `as any`, `unknown as`, non-finite handling, layer color contracts, and duplicated helpers.

Verification:

- Focused S04 smoke command passed: 7 files, 63 tests for camera/device/material/GRBL command/status/response paths.
- Scene/shape/text/geometry command passed: 25 files, 145 tests.
- Full S04 test slice passed: 43 files, 286 tests.
- A Node stdin reproduction of the `buildJogCommand` formatting logic emitted `$J=G91 G21 XNaN YInfinity FNaN` for non-finite numeric inputs.

Findings:

#### S04-001 - Core camera RTSP validation is looser than bridge RTSP validation

Severity: Medium.

Evidence:

- `src/core/camera/camera-profile.ts:232-245` accepts a camera source when `new URL(value).protocol === 'rtsp:'`.
- `electron/rtsp-camera-bridge-policy.ts:13-21` later rejects non-loopback/non-private RTSP hosts.
- `src/core/camera/camera-profile.test.ts:99-114` verifies RTSP-vs-HTTP protocol validation, but does not cover public-network RTSP URLs or alignment with the bridge policy.

Risk:

Machine/project profiles can persist a public or otherwise unsupported RTSP URL as valid camera metadata, only for the local bridge to reject it later. The runtime bridge still protects the stream endpoint, but the core profile contract and runtime policy disagree, which creates confusing imports/setup states and duplicated security logic.

No fix made.

#### S04-002 - Camera alignment lacks near-degenerate and residual validation

Severity: Medium.

Evidence:

- `src/core/camera/camera-transform.ts:66-75` rejects exact duplicate points and exact collinearity only.
- `src/core/camera/camera-transform.ts:78-90` solves a homography from all point pairs, but no later step measures reprojection residual/error.
- `src/core/camera/camera-profile.test.ts:42-64` covers duplicate and collinear point sets, but no nearly collinear, badly conditioned, or high-residual alignment sets.

Risk:

Four or more points can be technically unique and non-collinear but still produce an unstable or visibly wrong workspace overlay. Because `cameraProfileReadiness` reports `ready` after the solver succeeds, users may trust a distorted camera alignment when placing work.

No fix made.

#### S04-003 - Device profile validation does not enforce camera capability/profile consistency

Severity: Medium.

Evidence:

- `src/core/devices/device-profile.ts:77-88` stores both a `capabilities` list and an optional `cameraProfile`.
- `src/core/devices/profile-catalog.ts:167-195` validates profile basics, laser metadata, camera shape, and no-go zones, but does not cross-check `capabilities` against `cameraProfile`.
- `src/core/devices/profile-catalog.ts:139-144` treats capabilities as the source for `profileSupportsCapability(...)`.
- Current camera/profile tests cover valid camera metadata, but not "camera capability without profile" or "profile without camera capability" cases.

Risk:

Imported/custom profiles can advertise camera support with no usable profile, or carry camera metadata while feature gates say the profile has no camera capability. That can make setup/readiness UI and persisted machine identity disagree.

No fix made.

#### S04-004 - `buildJogCommand` can emit non-finite jog commands

Severity: Medium.

Evidence:

- `src/core/controllers/grbl/commands.ts:95-109` checks only `typeof params.dx/dy/dz === 'number'` and always formats `params.feed` through `Math.round`.
- `src/core/controllers/grbl/commands.test.ts:37-65` covers normal axes, rounding, and zero feed clamping, but not `NaN` or `Infinity`.
- `src/ui/state/laser-store.ts:368-374` writes the result of `buildJogCommand(params)` directly to the serial connection for jog actions.
- A read-only Node reproduction of the same formatting logic produced `$J=G91 G21 XNaN YInfinity FNaN` for `{ dx: NaN, dy: Infinity, feed: NaN }`.

Risk:

If any UI or adapter path passes non-finite motion values, the core command builder can send malformed jog G-code to GRBL instead of refusing the command before serial write. GRBL will likely reject it, but the motion operation state has already been entered.

No fix made.

#### S04-005 - GRBL coded suffix parsing is lenient for alarms/status substates

Severity: Low.

Evidence:

- `src/core/controllers/grbl/response.ts:67-72` parses coded keywords such as `ALARM:` with `Number.parseInt(...)` and no full-token regex.
- `src/core/controllers/grbl/status-parser.ts:116-122` parses state substates such as `Hold:0` with `Number.parseInt(...)` and no full-token regex.
- `src/core/controllers/grbl/response.test.ts:14-25` explicitly hardened `error:7ok`, but there are no equivalent `ALARM:9x` or `Hold:1x` tests.

Risk:

Malformed controller lines with numeric prefixes can be classified as real alarms or substates instead of unknown/malformed responses. This is not a motion-safety bypass, but it can make logs and UI diagnostics less trustworthy when firmware or serial noise emits unexpected tokens.

No fix made.

#### S04-006 - Layer color helpers do not enforce the hex color contract

Severity: Low.

Evidence:

- `src/core/scene/layer.ts:54` documents `Layer.color` as lowercase 6-digit hex.
- `src/core/scene/layer.ts:115-124` returns `args.color` directly from `createLayer`.
- `src/core/scene/scene.ts:44-45` normalizes assigned layer colors through `normalizeLayerColor`.
- `src/core/scene/scene.ts:119-120` lowercases only strings matching `^#[0-9a-fA-F]{6}$`; invalid strings pass through unchanged.
- `src/core/scene/scene.test.ts:76-90` and `src/core/scene/layer.test.ts:45-49` cover valid colors only.

Risk:

Core scene helpers can produce layer/object colors that violate the stated layer key contract. Downstream code uses these strings as CSS swatches, layer keys, file metadata, and output comments, so invalid values can create display/key mismatches instead of being rejected at the domain boundary.

No fix made.

#### S04-007 - Polyline bounds logic is duplicated

Severity: Low.

Evidence:

- `src/core/shapes/create-polyline.ts:35-50` defines a local `boundsOfPolylines(...)`.
- `src/core/shapes/polyline-bounds.ts:3-18` defines the same helper.
- `src/core/shapes/create-polygon.ts` and `src/core/shapes/create-star.ts` import the shared helper instead of duplicating it.

Risk:

This is not a current behavior bug, but it is a local architecture drift point. Future changes to bounds handling can update polygon/star behavior while leaving polyline creation behind.

No fix made.

Pass 1 result: complete. S04 still needs Pass 2 and Pass 3.

### S04 Pass 2 - Controller/Device Contract Consistency Review

Evidence inspected:

- Independent reads of GRBL settings write guards, console command preparation, settings parsing, machine bounds/origin transforms, G-code dialect resolution, and scan-offset profile helpers.
- Cross-checks from core helpers into IO consumers for machine profiles, project files, and material-library device hints.
- Targeted scans for scan-offset and dialect validation coverage.

Verification:

- Focused S04 pass-2 command passed: `pnpm exec vitest run src/core/devices/gcode-dialects.test.ts src/core/controllers/grbl/grbl-setting-write.test.ts src/core/controllers/grbl/console-command.test.ts src/core/controllers/grbl/parse-settings.test.ts src/core/devices/machine-bounds.test.ts src/core/devices/origin-transform.test.ts`.
- Result: 6 test files passed, 34 tests passed.
- A read-only Node check confirmed `Number('1e3')`, `Number('0x10')`, and `Number('+10')` are finite even though those original strings are what the guarded setting writer would send.

Findings:

#### S04-008 - Scan-offset validation and normalization disagree on duplicate speeds

Severity: Low.

Evidence:

- `src/core/devices/scan-offset-profile.ts:6-14` rejects a scan-offset table when two points share the same `speedMmPerMin`.
- `src/core/devices/scan-offset-profile.ts:17-27` normalizes by putting points into a `Map`, so later duplicate speeds silently overwrite earlier entries.
- `src/io/project/project-shape-validator.ts:371-380` and `src/io/project/project-scan-offset.test.ts:74-93` reject duplicate scan-offset speeds on project import.
- `src/io/machine-profile/machine-profile-io.ts:147-160` also validates imported machine profile scan offsets before normalizing.
- `src/ui/laser/MeasuredScanOffsetApply.tsx` and `src/ui/laser/ScanOffsetEditor.tsx` use the normalizer directly while editing/applying scan-offset rows.

Risk:

The import paths are guarded, so this is not currently a broad corrupted-file bug. The weak area is that the shared core helper has two meanings: "validate/canonicalize a table" in IO and "last value wins" in editor merge paths. A future caller can accidentally hide duplicate calibration rows and change raster compensation without an explicit error or conflict decision.

No fix made.

#### S04-009 - G-code dialect resolution silently falls back for unknown ids

Severity: Low.

Evidence:

- `src/core/devices/gcode-dialects.ts:83-88` resolves `device.gcodeDialect?.dialectId` and returns `GRBL_DYNAMIC_DIALECT` if the id is not found.
- `src/core/devices/gcode-dialects.ts:95-101` has a stricter `isGcodeDialectSelection(...)` predicate for known dialect ids.
- `src/io/project/project-shape-validator.ts:376-380` rejects unknown project dialect selections.
- `src/io/machine-profile/machine-profile-shape.ts:81-83` rejects unknown machine-profile dialect selections.
- `src/core/devices/gcode-dialects.test.ts:20-26` covers valid built-in resolution only, not invalid runtime input.

Risk:

Validated project/profile imports reject unknown dialects, which bounds the current risk. The resolver itself is still lenient at the output-facing core boundary; if any future or in-memory caller skips IO validation, a profile intended for a safety-specific dialect can quietly emit as `grbl-dynamic` instead of failing closed.

No fix made.

#### S04-010 - Guarded GRBL setting writes accept non-canonical numeric strings

Severity: Medium.

Evidence:

- `src/core/controllers/grbl/grbl-setting-write.ts:25-40` trims the entered value, validates it, then builds the firmware command from the original normalized string.
- `src/core/controllers/grbl/grbl-setting-write.ts:55-62` uses JavaScript `Number(value)` for validation.
- A read-only Node check showed `Number('1e3')`, `Number('0x10')`, and `Number('+10')` are finite.
- `src/core/controllers/grbl/grbl-setting-write.test.ts:48-76` covers `not-a-number`, stale backup, and unknown setting cases, but not exponent, hex, plus-sign, or other non-decimal firmware literal forms.

Risk:

The writer is intentionally guarded by fresh-backup and confirmation checks, but the numeric grammar is looser than a GRBL setting command should rely on. The UI can approve a value because JavaScript can parse it while still sending the exact original string to firmware, which can lead to firmware rejection, confusing write failures, or a value parsed differently than the guard expected.

No fix made.

Pass 2 result: complete. S04 still needs Pass 3 as a remaining-gap/coverage pass before the sector can close.

### S04 Pass 3 - Remaining Core Primitive and Coverage Sweep

Evidence inspected:

- Remaining S04 core primitives: material-library recipe capture/normalization/matching, geometry kerf/tabs/weld helpers, text-to-polyline rendering, selection transforms, shape factories, output scopes, visibility/hit-testing, and shared numeric utilities.
- Vector path operation call sites in UI state to understand how core metadata loss would surface.
- Targeted searches for non-finite numeric handling, unsafe casts, duplicated geometry helpers, and untested edge contracts.

Verification:

- Focused S04 pass-3 command passed: `pnpm exec vitest run src/core/material-library src/core/geometry src/core/text src/core/scene src/core/shapes src/core/util`.
- Result: 29 test files passed, 164 tests passed.

Findings:

#### S04-011 - Welded vector objects lose object-level output metadata

Severity: Medium.

Evidence:

- `src/core/geometry/vector-path-tools.ts:25-38` preserves `locked`, `operationOverride`, and `powerScale` when a single vector object is materialized through `materializeVectorObject(...)`.
- `src/core/geometry/vector-path-tools.ts:74-81` creates welded output with only `kind`, `id`, `source`, `bounds`, `transform`, and `paths`.
- `src/core/scene/scene-object.ts:73-81` defines `powerScale`, `operationOverride`, and `locked` as object-level metadata shared by vector scene variants.
- `src/core/job/compile-job.ts:67-86` and `src/core/job/compile-job.ts:117-154` apply object-level overrides/power scale during job compilation.
- `src/ui/state/vector-path-actions.ts:78-92` welds all selected vector objects without checking whether they have matching output overrides or power scale.
- `src/core/geometry/vector-path-tools.test.ts:57-85` and `src/ui/state/vector-path-actions.test.ts:53-80` test geometry/bounds only; they do not cover metadata preservation or deliberate metadata stripping.

Risk:

Welding selected artwork can silently change how the result will burn by dropping per-object operation overrides or power scale. If selected objects have mixed metadata, blindly preserving one value would also be wrong; the missing logic is an explicit merge/refusal/default decision at the core operation boundary.

No fix made.

#### S04-012 - Selection transform builders accept non-finite numeric edits

Severity: Medium.

Evidence:

- `src/core/scene/selection-transform.ts:77-94` builds nudge transforms by adding `dx` and `dy` directly to object transform coordinates.
- `src/core/scene/selection-transform.ts:137-143` rejects dimensions only when `width <= MIN_DIMENSION_MM` or `height <= MIN_DIMENSION_MM`; `NaN` passes those comparisons.
- `src/core/scene/selection-transform.ts:184-192` derives resize scale factors directly from the supplied width/height.
- `src/core/scene/selection-transform.ts:157-181` applies `rotationDeg` through trigonometry and modulo normalization without a finite-number guard.
- `src/ui/state/selection-transform-actions.ts:92-100` applies nudge results to scene state if the builder returns `ok`.
- `src/core/scene/selection-transform.test.ts:23-107` covers normal move/resize/rotate behavior, but not `NaN`, `Infinity`, or non-finite edit rejection.

Risk:

A malformed numeric edit from UI state, keyboard nudge, imported command state, or future tool integration can write `NaN`/`Infinity` into scene transforms. Once persisted, non-finite transforms can poison hit-testing, bounds, preview, save/load, and job compilation in ways that are hard to diagnose.

No fix made.

Pass 3 result: complete. S04 has three audit passes, focused test coverage across the sector, and no remaining major unchecked S04 areas. S04 closed.

### S05 Pass 1 - Job, Preflight, Raster, Trace, and Output Orientation

Evidence inspected:

- Job compilation and output paths: `compile-job.ts`, raster compilation helpers, GRBL strategy, raster emitter, frame/bounds preflight, and pre-emit raster budget checks.
- Safety invariant paths: main preflight, laser-off travel predicates, blank-feed checks, active no-go-zone preflight, and the alternate no-go-zone helper.
- Trace/raster preparation paths: trace options, ImageTracer/Potrace/centerline/edge entry points, batch trace export, UI trace loader/worker constraints, and raster budget tests.
- Focused searches for duplicate safety logic, numeric parsing, `NaN`/`Infinity` propagation, trace budget boundaries, and property-test exclusions.

Verification:

- S05 core slice passed: `pnpm exec vitest run src/core/preflight src/core/invariants src/core/job src/core/output src/core/raster src/core/trace`.
- Result: 86 test files passed, 613 tests passed.
- Existing tests cover many happy-path and property invariants, but the relevant property generators explicitly exclude `NaN`/`Infinity` and the preflight speed tests cover too-high and zero speeds only.

Findings:

#### S05-001 - Active no-go-zone preflight uses simplified duplicate collision logic

Severity: Medium.

Evidence:

- `src/core/preflight/preflight.ts:30` imports `findNoGoZoneCollisions` from `./no-go-zone-preflight`.
- `src/core/preflight/preflight.ts:135` calls that active helper against the emitted G-code and configured no-go zones.
- `src/core/preflight/no-go-zone-preflight.ts:9-27` tracks line segments from the active parser; `src/core/preflight/no-go-zone-preflight.ts:29-43` parses G0/G1/G2/G3 X/Y words from each line but assumes absolute coordinates and does not handle `G90`/`G91` modal state.
- `src/core/preflight/no-go-zones.ts:27-55` exports a second `findNoGoZoneCollisions` implementation that filters enabled zones against machine bounds, tracks absolute/relative mode at `src/core/preflight/no-go-zones.ts:70-73`, and applies relative motion at `src/core/preflight/no-go-zones.ts:92-101`.
- Repository search shows the fuller `no-go-zones.ts` implementation is not the one used by the main preflight path.

Risk:

The main generated output is mostly absolute, so the immediate risk is bounded. The weakness is architectural: a safety preflight has two implementations, and the active one is the simpler parser. Stale/manual/future G-code containing modal relative motion can be checked differently from the fuller helper, and future changes can harden the unused code while leaving the real safety path weaker.

No fix made.

#### S05-002 - G-code invariant parsers use a narrow duplicated numeric grammar

Severity: Low.

Evidence:

- `src/core/invariants/predicates.ts:37-45` defines `NUM = (-?\d+(?:\.\d+)?)` and parses axis/power values with that grammar.
- `src/core/invariants/blank-feed.ts:26-35` repeats the same numeric grammar.
- `src/core/preflight/no-go-zone-preflight.ts:100-102` repeats the same shape for no-go X/Y parsing.
- `src/core/preflight/no-go-zones.ts:23-25` and `src/core/preflight/no-go-zones.ts:170-172` repeat the same shape again in the alternate helper.
- `src/core/preflight/preflight.ts:423-424` uses the same narrow grammar in the relative-envelope parser.
- Current tests cover ordinary decimal values, while external G-code comments in `src/core/invariants/predicates.ts:8-11` imply tolerance for stale or external G-code inputs.

Risk:

The internal emitter mostly writes fixed decimal values, so generated LaserForge output is unlikely to trip this today. The invariant layer also positions itself as a guard for stale/external G-code, where common forms such as `+1`, `.5`, `1.`, exponent notation, or lowercase axis words may be ignored. That can under-report out-of-bed, laser-on-travel, blank-feed, or no-go-zone risks for non-emitted input.

No fix made.

#### S05-003 - Non-finite layer speed can reach emitted feed words

Severity: Medium.

Evidence:

- `src/core/preflight/preflight.ts:165-169` only flags speed when `layer.speed <= 0 || layer.speed > maxFeed`; `NaN` passes both comparisons.
- `src/core/job/compile-job.ts:195` stores compiled group speed as `Math.min(layer.speed, device.maxFeed)`, which remains `NaN` when the layer speed is `NaN`.
- `src/core/output/grbl-strategy.ts:108`, `src/core/output/grbl-strategy.ts:128`, and `src/core/output/grbl-strategy.ts:168` round `group.speed` before writing feed words, yielding `NaN` for vector feed output.
- `src/core/raster/emit-raster.ts:449-450` rejects `feedMmPerMin <= 0`, but this comparison also misses `NaN`; `src/core/raster/emit-raster.ts:96` rounds the value for the raster feed word.
- `src/core/preflight/preflight.test.ts:235-253` covers too-high and zero speed only.
- `src/core/output/grbl-strategy.property.test.ts:53-58` and `src/core/raster/emit-raster.property.test.ts:29-33` explicitly generate finite speeds and finite raster numeric fields.

Risk:

Validated project IO may reject some malformed persisted state, but the core preflight/compile boundary itself is not fail-closed. A corrupted in-memory layer, future import path, or tool integration can produce malformed G-code like `FNaN` while preflight reports no speed issue. For machine output code, non-finite speed should be treated as invalid before any emitter sees it.

No fix made.

Pass 1 result: complete. S05 still needs at least Pass 2 and Pass 3 before the sector can close.

### S05 Pass 2 - Compile, Operation-Layer, and Raster Output Contract Pass

Evidence inspected:

- Operation-layer expansion from `outputOperationLayers(...)` through compile, frame bounds, raster preview, pre-emit raster budget, and main preflight.
- Raster compile/preview luma decoding, processed-bitmap preview, crop/adjust-preview decoders, and project-shape validation for persisted raster luma.
- Raster gap-split behavior in the emitter and preview toolpath, plus duration-estimate tests to scope whether this pass should log an estimate-parity issue.

Verification:

- Focused S05 pass-2 command passed: `pnpm exec vitest run src/core/preflight/pre-emit.test.ts src/core/preflight/preflight-raster.test.ts src/core/job/compile-job-raster.test.ts src/core/job/frame-bounds.test.ts src/ui/workspace/draw-raster-preview.test.ts src/ui/raster/processed-bitmap.test.ts src/io/gcode/prepare-output.test.ts src/core/job/estimate-duration.test.ts src/core/job/toolpath-raster.test.ts src/core/raster/emit-raster.test.ts`.
- Result: 10 test files passed, 109 tests passed.
- Existing tests prove image sub-layers are supported by pre-emit, frame bounds, and raster preview, but they do not cover full main-preflight behavior for image sub-layers or multiple image operations on the same raster color.

Findings:

#### S05-004 - Pre-emit raster budget checks only the first matching image operation

Severity: High.

Evidence:

- `src/core/preflight/pre-emit.ts:31-38` finds a single matching image operation for each raster object with `.find(...)`.
- `src/core/preflight/pre-emit.ts:44` budgets only that one `effectiveLayer`.
- `src/core/job/compile-job.ts:51-55` loops every `outputOperationLayers(layer)` entry and calls `compileRasterGroupsForLayer(...)` for each operation layer.
- `src/core/scene/layer.ts:157-181` allows sub-layers to capture independent operation settings, and `src/core/scene/layer.ts:185-188` materializes all enabled sub-layers as output operation layers.
- `src/core/preflight/pre-emit.test.ts:108-114` covers one oversized image sub-layer, but not a same-color raster with multiple image operations where the first passes and a later sub-layer exceeds the budget.

Risk:

This undermines the pre-emit guard's explicit purpose: preventing huge raster allocations before compile. A same-color raster can have one modest image operation followed by a high-resolution image sub-layer; pre-emit can pass after checking the first operation, then compile emits every operation and allocates/dithers the oversized later raster group. That is a real freeze/DoS escape path in the output pipeline.

No fix made.

#### S05-005 - Main preflight is not operation-layer/sub-layer-aware

Severity: Medium.

Evidence:

- `src/core/preflight/preflight.ts:80` defines `outputLayers` as top-level `project.scene.layers.filter((l) => l.output)`.
- `src/core/preflight/preflight.ts:93` and `src/core/preflight/preflight.ts:185-192` run layer-mode mismatch checks against those top-level layers only.
- `src/core/preflight/preflight.ts:97` and `src/core/preflight/preflight.ts:302-320` check unsupported raster rotation from top-level image-layer colors only.
- `src/core/preflight/preflight.ts:358` and `src/core/preflight/preflight.ts:427-442` compute the overscan hint from top-level image/fill layers only.
- By contrast, `src/core/job/compile-job.ts:51-55`, `src/core/preflight/pre-emit.ts:31-38`, `src/core/job/frame-bounds.ts:62-68`, and `src/ui/workspace/draw-raster-preview.ts:37-45` all use `outputOperationLayers(...)`.
- Existing tests verify image sub-layers in pre-emit (`src/core/preflight/pre-emit.test.ts:108-114`), frame bounds (`src/core/job/frame-bounds.test.ts:110-122`), and preview (`src/ui/workspace/draw-raster-preview.test.ts:145-171`), while `src/core/preflight/preflight-raster.test.ts` covers top-level layer cases only.

Risk:

The main safety verdict and the compile/preview/frame paths disagree about what an output layer means. A line-mode base layer with an image sub-layer can be compiled and previewed as an image operation, but main preflight can still treat the raster as stranded on a line layer. Other messages, such as unsupported raster transform and overscan guidance, can also be missed or attached to the wrong operation. This makes sub-layer output either falsely blocked or diagnosed through misleading checks.

No fix made.

#### S05-006 - Malformed persisted raster luma silently becomes all-white output

Severity: Medium.

Evidence:

- `src/io/project/project-shape-validator.ts:224` validates `lumaBase64` only as an optional string.
- `src/core/job/compile-job-raster.ts:43-45` decodes present `lumaBase64` for raster output; `src/core/job/compile-job-raster.ts:145-154` returns `whiteLuma(expectedLength)` if it sees a non-base64 character.
- `src/ui/raster/processed-bitmap.ts:106-115`, `src/ui/raster/crop-image.ts:121-130`, and `src/ui/raster/AdjustImageDialog.preview.ts:93-102` have parallel decoders that catch decode errors and return white luma.
- `src/core/job/compile-job-raster.test.ts:115-118` explicitly covers missing legacy luma as a safe all-white fallback, and `src/core/job/compile-job-raster.test.ts:120-137` covers valid saved luma without host `atob`; no current test distinguishes missing luma from malformed present luma.

Risk:

Missing luma for legacy rasters is a reasonable fail-safe. Malformed present luma is different: it means the persisted image payload is corrupt or hand-edited. Today that can silently preview and emit as blank/all-white output instead of invalidating the project, warning the operator, or falling back to a re-decode path from `dataUrl`. The user can lose a raster engraving without a clear error.

No fix made.

Pass 2 result: complete. S05 still needs Pass 3 as a remaining-gap/coverage pass before the sector can close.

### S05 Pass 3 - Remaining Gap, Preview, Estimate, Optimizer, and Trace Sweep

Evidence inspected:

- Raster scan-offset flow from device calibration through `grblStrategy.emit(...)`, `emitRasterGroup(...)`, job bounds, preview toolpath building, and duration estimation.
- Raster gap-split flow across `emit-raster.ts`, `toolpath.ts`, `estimate-duration.ts`, and planner block pricing.
- Preview/output parity tests, frame registration tests, raster scan-offset tests, job-bounds tests, optimizer tests, and core trace boundary/image/path tests.
- Targeted searches for `scanOffsetMm`, `bidirectionalScanOffsetMm`, `scanningOffsets`, `RASTER_GAP_RAPID_THRESHOLD_MM`, `rasterActiveSpan`, `activeSpans`, `estimateJobDuration`, and `buildPreviewToolpath`.

Verification:

- Focused S05 pass-3 command passed: `pnpm exec vitest run src/core/output/grbl-strategy-raster-calibration.test.ts src/core/output/grbl-strategy-scan-offset.test.ts src/core/raster/emit-raster.test.ts src/core/raster/emit-raster-scan-offset.test.ts src/core/job/toolpath.test.ts src/core/job/toolpath-raster.test.ts src/core/job/estimate-duration.test.ts src/core/job/job-bounds.test.ts src/ui/workspace/draw-preview.parity.test.ts src/ui/workspace/preview-scene-frame.test.ts src/core/job/optimize-paths.test.ts src/core/trace/trace-boundary.test.ts src/core/trace/trace-image.test.ts src/core/trace/trace-to-paths.test.ts src/core/trace/potrace-trace.test.ts`.
- Result: 15 test files passed, 143 tests passed.
- Existing tests prove emitted raster scan-offset behavior and job-bounds scan-offset coverage, but no test currently proves preview route geometry includes the same profile-level raster shift.
- Existing tests prove raster output and preview split wide white gaps into rapid-separated spans, but duration-estimate tests only assert nonzero raster duration and fill multi-span pricing.

Findings:

#### S05-007 - Raster scan-offset compensation is missing from route-preview toolpaths

Severity: Medium.

Evidence:

- `src/core/output/grbl-strategy.ts:304` passes `scanOffsetMm: offsetForSpeed(device.scanningOffsets, group.speed)` into raster G-code emission.
- `src/core/raster/emit-raster.ts:207` applies that scan offset to reverse raster rows.
- `src/core/output/grbl-strategy-raster-calibration.test.ts:33-36` and `src/core/output/grbl-strategy-scan-offset.test.ts:18-52` verify that emitted raster G-code shifts reverse rows when the device has scan-offset calibration.
- `src/core/job/job-bounds.ts:132-145` also includes profile raster scan offsets in burn/motion bounds.
- `src/core/job/compile-job-raster.test.ts:90-105` explicitly asserts that raster groups keep scan-offset compensation profile-scoped and do not bake it into `bidirectionalScanOffsetMm`.
- `src/ui/workspace/draw-preview.ts:138-143` passes `project.device.scanningOffsets` into `buildToolpath(...)`, but `src/core/job/toolpath.ts:75-78` routes raster groups to `appendRasterGroupSteps(...)` without the options object.
- `src/core/job/toolpath.ts:93-104` consumes `options.scanningOffsets` only for fill groups, while `src/core/job/toolpath.ts:223` shifts raster preview rows only by `group.bidirectionalScanOffsetMm`, which the compile test above expects to remain undefined.
- `src/core/job/toolpath-raster.test.ts:31-103` covers raster route-preview rows and bidirectional travel, but not profile-level raster scan-offset parity.

Risk:

For calibrated raster engraving, the machine burns reverse rows at shifted X coordinates while the route preview overlay shows unshifted reverse rows. Job bounds account for the physical envelope, so this is not the same as an unchecked overtravel bug, but it is still a user-facing parity problem: the visible route and scrubber can disagree with the actual burn placement after calibration.

No fix made.

#### S05-008 - Raster duration estimate ignores ADR-039 wide-gap rapid splits

Severity: Medium.

Evidence:

- `src/core/raster/emit-raster.ts:36-42` defines the raster wide-white-gap rapid split threshold for ADR-039.
- `src/core/raster/emit-raster.ts:121-148` emits one sweep per active span, and `src/core/raster/emit-raster.ts:164-184` splits a row into multiple spans when the white gap is wider than 5 mm.
- `src/core/job/toolpath.ts:149-163` and `src/core/job/toolpath.ts:179-203` mirror the same raster gap split for route preview.
- `src/core/job/estimate-duration.ts:54-65` converts a raster group into a synthetic fill group before planning.
- `src/core/job/estimate-duration.ts:68-99` creates at most one raster sweep segment per row, and `src/core/job/estimate-duration.ts:103-120` returns the row envelope from first active pixel to last active pixel.
- `src/core/job/planner.ts:126-129` prices each fill sweep as one continuous feed block across its full envelope, which is correct for ADR-034 fill gaps but not for ADR-039 raster gaps that output/preview now cross with G0 rapids.
- `src/core/raster/emit-raster.test.ts:22-42` covers the output-side wide-gap split, and `src/core/job/toolpath-raster.test.ts` covers raster preview sweeps, but `src/core/job/estimate-duration.test.ts:272-277` only verifies raster-only jobs are nonzero.

Risk:

For sparse raster rows with large white gaps, the ETA can price the gap as slow feed movement across the full row envelope even though the emitted job and route preview rapid between ink islands. This can materially overstate cut time and misallocate cut-vs-travel time on logo/text-style rasters. It is not an emitted-G-code safety issue, but it weakens planning accuracy and operator trust in the runtime estimate.

No fix made.

Pass 3 result: complete. S05 has three audit passes, focused verification across preflight/compile/output/raster/trace/preview/estimate paths, and no remaining major unchecked S05 area. S05 closed.

### S06 Pass 1 - Persistence and Import Boundary Orientation

Evidence inspected:

- S06 inventory across `src/io/project`, `src/io/machine-profile`, `src/io/material-library`, `src/io/svg`, `src/io/lightburn`, and `src/io/gcode`.
- Project `.lf2` shape validation, deserialization, normalization, device-profile metadata handling, and related project IO tests.
- Machine-profile and material-library import/export validators, metadata helpers, and schema tests.
- SVG sanitizer, parser, presentation-state handling, path parser, curve flattener, unit conversion, shape-to-polyline converter, malicious corpus tests, and UI SVG import boundary.
- LightBurn `.lbdev` importer and G-code prepare/output metadata wrapper.

Verification:

- Focused S06 pass-1 command passed: `pnpm exec vitest run src/io/project src/io/machine-profile src/io/material-library src/io/svg src/io/lightburn src/io/gcode`.
- Result: 35 test files passed, 254 tests passed.
- Existing tests cover machine-profile capability rejection, SVG sanitizer/malicious corpus cases, SVG circular-use recursion, project device-profile metadata preservation, G-code metadata wrapping, and material library IO; no current test rejects unknown capabilities inside a project `.lf2` device or caps imported SVG geometry/coordinate materialization.

Findings:

#### S06-001 - Project deserialization accepts unvalidated device capabilities

Severity: Medium.

Evidence:

- `src/core/devices/device-profile.ts:22-30` defines the known `ProfileCapability` values: `grbl`, `wcs`, `air-assist`, `no-go-zones`, `scan-offsets`, `verified-origin`, `z-axis`, and `camera`.
- `src/io/project/project-shape-validator.ts:72-98` validates required and optional device fields for project files, but does not validate `device.capabilities`.
- `src/io/project/deserialize-project.ts:98-122` normalizes the project device by spreading `...dev`, so an arbitrary `capabilities` array from the saved project survives deserialization.
- `src/io/project/deserialize-project.ts:133-135` already branches on `Array.isArray(capabilities) && capabilities.includes(capability)` for Z-travel confirmation, proving the deserializer treats the field as meaningful after load.
- `src/core/devices/profile-catalog.ts:139-143` exposes `profileSupportsCapability(...)` as a generic gate, and UI/core call sites use either that helper or direct `capabilities.includes(...)` checks for hardware-related affordances.
- By contrast, `src/io/machine-profile/machine-profile-shape.ts:20-29`, `src/io/machine-profile/machine-profile-shape.ts:142-148`, and `src/io/machine-profile/machine-profile-shape.ts:246-247` validate imported machine-profile capabilities against the same known set.
- `src/io/machine-profile/machine-profile-io.test.ts:171-179` rejects an imported profile containing `['grbl', 'macro-runner']`, while project-device metadata tests preserve known capability state and do not cover unknown capability rejection.

Risk:

Hand-edited or corrupted `.lf2` files can carry arbitrary device capability strings even though standalone machine-profile imports reject the same shape. Today the known feature gates only react to known strings, so this is not a direct privilege escalation by itself, but it leaves the persistence boundary inconsistent around hardware capability flags and creates a future footgun: any new gate that trusts project-loaded capabilities may inherit stale or fabricated feature state.

No fix made.

#### S06-002 - SVG import lacks a total geometry and finite-coordinate budget

Severity: Medium.

Evidence:

- `src/ui/app/file-actions.ts:49-54` gates SVG import only on loaded text length through `confirmOversizeImport(...)` before calling `parseSvg(...)`.
- `src/io/svg/parse-svg.ts:137-139` and `src/io/svg/parse-svg.ts:170-172` walk every SVG child element; `src/io/svg/parse-svg.ts:142-155` caps recursive depth for circular or deeply nested `<use>` structures, but does not cap total elements, subpaths, or points.
- `src/io/svg/parse-svg.ts:206-212` pushes transformed points for every parsed subpath into `byColor` without a total point budget or finite-coordinate check.
- `src/io/svg/shape-to-polylines.ts:75-96` parses all `polyline`/`polygon` point pairs from the `points` attribute and returns the whole point array.
- `src/io/svg/parse-path-d.ts:66-76` tokenizes and dispatches a full path, and `src/io/svg/parse-path-d.ts:240-246`, `src/io/svg/parse-path-d.ts:253-261`, `src/io/svg/parse-path-d.ts:268-274`, `src/io/svg/parse-path-d.ts:281-290`, and `src/io/svg/parse-path-d.ts:297-313` append flattened curve/arc points without a global import budget.
- `src/io/svg/svg-units.ts:63-86` checks parsed lengths are finite, but the downstream matrix composition/application in `parse-svg.ts` can still materialize extreme transformed coordinates without a post-transform finite check.
- `src/io/svg/parse-svg.test.ts:222-233` covers circular `<use>` denial-of-service protection, while current SVG tests do not assert a total geometry cap or imported-coordinate finiteness.

Risk:

A legal but huge SVG can pass the text-size prompt and still force the importer to allocate and transform an unbounded number of points before later preview/output complexity checks can help. Extreme finite source coordinates or transforms can also overflow into non-finite imported geometry. The likely failure mode is a frozen import, memory pressure, or a corrupted scene object that fails only later during save/reopen or preview, rather than a clear import-time rejection.

No fix made.

Pass 1 result: complete. S06 still needs Pass 2 and Pass 3 before the sector can close.

### S06 Pass 2 - Project Persistence, Export, and Cross-Reference Pass

Evidence inspected:

- Project serialization/deserialization, migrations, shape validation, layer/sub-layer normalization, scene groups, and project security tests.
- Machine-profile import/export canonicalization and the Machine Setup import/export UI boundary.
- Material library import/export, multi-library persistence collection, localStorage restore/migration, and material-library file-action handlers.
- LightBurn `.lbdev` review-first importer and its UI apply gate.
- G-code save boundary, metadata header assembly, project save/open handlers, material-library save/open handlers, and their focused UI tests.

Verification:

- Focused S06 pass-2 command passed: `pnpm exec vitest run src/io/project/project-security-validation.test.ts src/io/project/project-groups.test.ts src/io/project/project.test.ts src/io/machine-profile/machine-profile-io.test.ts src/io/material-library/material-library-io.test.ts src/io/lightburn/lbdev-import.test.ts src/io/gcode/gcode-metadata.test.ts src/ui/app/file-actions.test.ts src/ui/app/material-library-file-actions.test.ts src/ui/laser/MachineSetupImportExport.test.tsx src/ui/state/material-library-collection.test.ts src/ui/state/material-library-persistence.test.ts`.
- Result: 12 test files passed, 106 tests passed.
- Existing project security tests cover inverted bounds, absurd raster source dimensions, and absurd coordinate magnitude. Existing group IO tests cover durable round-trip, missing legacy groups, and malformed non-string group IDs, but not duplicate IDs, dangling references, or total scene/vector size limits.

Findings:

#### S06-003 - Project `.lf2` validation lacks a total geometry budget

Severity: Medium.

Evidence:

- `src/io/project/project-shape-primitives.ts:1-2` defines coordinate and transform-scale magnitude ceilings, and `src/io/project/project-shape-primitives.ts:47-51` applies the coordinate ceiling per point.
- `src/io/project/project-shape-validator.ts:45` defines `MAX_RASTER_SOURCE_PIXELS`, and `src/io/project/project-shape-validator.ts:228-238` rejects raster source dimensions whose `pixelWidth*pixelHeight` exceeds that cap.
- `src/io/project/project-shape-validator.ts:117-125` validates every layer/object/group array, but does not cap the number of layers, objects, or groups.
- `src/io/project/project-shape-validator.ts:335-363` validates colored paths, polylines, and points by recursively walking arrays without any total point/path/polyline budget.
- `src/io/project/project-shape-primitives.ts:4-13` implements `validateArray(...)` as a simple full-array loop with no length ceiling.
- `src/io/project/project-security-validation.test.ts:41-105` covers inverted bounds, raster source pixel bombs, and single absurd coordinate values, but not a valid-coordinate vector scene with excessive object/path/point counts.

Risk:

A hand-edited or generated `.lf2` can contain syntactically valid, finite vector geometry with millions of objects or points. The loader will parse the whole JSON and then walk/materialize every array before any preview, preflight, or output complexity guard can help. This is the persistent-project equivalent of the SVG import budget gap: it can freeze project open, exhaust memory, or leave the user with a project that technically validates but is too large for the UI to handle.

No fix made.

#### S06-004 - Project `.lf2` validation does not enforce scene ID and group reference invariants

Severity: Medium.

Evidence:

- `src/io/project/project-shape-validator.ts:117-125` validates `scene.layers`, `scene.objects`, and optional `scene.groups` independently.
- `src/io/project/project-shape-validator.ts:135-152` validates a group as `{ id, name, objectIds }` with at least two string `objectIds`, but does not check that those object IDs exist in `scene.objects`, are unique within the group, or that group IDs are unique.
- `src/io/project/project-shape-validator.ts:166-175`, `src/io/project/project-shape-validator.ts:186-201`, `src/io/project/project-shape-validator.ts:205-240`, and `src/io/project/project-shape-validator.ts:243-253` require each scene object to have an `id`, but do not check uniqueness across `scene.objects`.
- `src/io/project/project-layer-shape-validator.ts:21-47` requires each layer to have an `id` and `color`, but does not check uniqueness of layer IDs or color keys across `scene.layers`.
- `src/core/scene/scene.ts:29-40` removes or replaces objects by matching `id`, so duplicate object IDs affect more than one scene object.
- `src/core/scene/scene.ts:60-78` updates, removes, and moves layers by `id`, using either `map`, `filter`, or the first matching index; duplicate layer IDs therefore produce inconsistent mutation behavior.
- `src/ui/state/scene-group-actions.ts:114-143` expands and prunes groups against the live object-id set, but project open preserves dangling/duplicate group references until a later group mutation happens.
- `src/io/project/project-groups.test.ts:7-49` proves groups round-trip and rejects non-string metadata, but has no coverage for duplicate object IDs, duplicate layer IDs/colors, duplicate group IDs, repeated group members, or dangling group members.

Risk:

The scene model and UI mutation layer treat object IDs, layer IDs, layer colors, and group memberships as canonical identity links. A corrupted `.lf2` can load with duplicate or dangling identities, after which ordinary actions can replace/delete multiple objects unexpectedly, update all duplicate layers while moving only the first, expand selections through ghost group members, or leave groups that look valid in persistence but are semantically stale. These are open-time integrity failures, not emitted-G-code issues by themselves, but they can corrupt user edits and make later audit symptoms hard to trace.

No fix made.

Pass 2 result: complete. S06 still needs Pass 3 as a remaining-gap/coverage pass before the sector can close.

### S06 Pass 3 - SVG, LightBurn, Metadata, and Remaining-Gap Sweep

Evidence inspected:

- SVG sanitizer configuration, malicious corpus, presentation-state tests, `<use>` handling, symbol/defs handling, and shape-to-polyline parsing.
- LightBurn `.lbdev` importer and tests for GRBL, non-GRBL, `.lbzip`, and malformed imports.
- G-code metadata header implementation, UI build-info assembly, metadata tests, and `emitGcode(...)` metadata integration.
- Rechecked S06 coverage after Pass 1 and Pass 2 findings to identify whether major IO/persistence surfaces remained uninspected.

Verification:

- Focused S06 pass-3 command passed: `pnpm exec vitest run src/io/svg/sanitize.test.ts src/io/svg/malicious-corpus.test.ts src/io/svg/parse-svg.test.ts src/io/svg/parse-svg-presentation-state.test.ts src/io/svg/shape-to-polylines.test.ts src/io/lightburn/lbdev-import.test.ts src/io/gcode/gcode-metadata.test.ts src/io/gcode/emit-gcode.test.ts`.
- Result: 8 test files passed, 66 tests passed.
- Existing SVG tests cover sanitization, malicious fixtures, transform handling, physical unit scaling, text/image ignore counts, and circular `<use>` recursion, but they do not cover `<use>` references to `<symbol>` sprites.
- Existing G-code metadata tests verify the current static metadata fixture emits comment lines, but do not test newline/control characters inside metadata fields.

Findings:

#### S06-005 - SVG `<use>` drops `<symbol>` sprite geometry

Severity: Medium.

Evidence:

- `src/io/svg/sanitize.ts:75-78` explicitly permits `defs`, `symbol`, and `use` elements through DOMPurify.
- `src/io/svg/parse-svg.ts:148-171` walks elements, but returns immediately when the current tag is `defs` or `symbol`.
- `src/io/svg/parse-svg.ts:175-191` resolves `<use href="#...">` and then calls `walkElement(referenced, placedState, ...)` on the referenced node.
- When the referenced node is a `<symbol>`, that call enters the same `tag === 'defs' || tag === 'symbol'` early return and never visits the symbol's child geometry.
- `src/io/svg/parse-svg.test.ts:222-233` covers circular `<use>` references for recursion safety, and `src/io/svg/sanitize.test.ts:77-84` covers a same-document `<use>` pointing at a `<path>`, but no test covers a `<use>` pointing at a `<symbol>`.

Risk:

SVG symbol sprites are common in icon exports and design-system assets. A file shaped as `<symbol id="mark">...</symbol><use href="#mark"/>` can sanitize successfully, parse without error, and still import as blank or missing geometry because the referenced symbol is treated as inert definition content even in the `<use>` path. This is a user-visible import fidelity bug rather than a machine safety issue, but it will make valid SVGs appear empty or incomplete.

No fix made.

#### S06-006 - G-code metadata comments are not newline-safe

Severity: Low.

Evidence:

- `src/io/gcode/gcode-metadata.ts:12-18` defines metadata fields as unconstrained strings.
- `src/io/gcode/gcode-metadata.ts:32-45` interpolates those strings directly into GRBL comment lines with no escaping or newline/control-character replacement.
- `src/ui/app/build-info.ts:9-16` currently supplies metadata from build-controlled constants (`APP_GCODE_NAME`, `__APP_VERSION__`, `__GIT_SHA__`, `__BUILD_TIME__`, and `EMITTER_REVISION`), so the present UI path is low exposure.
- `src/io/gcode/gcode-metadata.test.ts:17-29` verifies that the current `META` fixture produces comment-prefixed lines, but it does not cover metadata strings containing `\n`, `\r`, or other line-breaking characters.
- `src/io/gcode/emit-gcode.test.ts:51-78` verifies metadata headers do not alter the preflight verdict, but also uses simple single-line metadata.

Risk:

Today the metadata values are build-time constants, so this is not an immediate user-controlled G-code injection path. Still, `gcodeMetadataHeader(...)` is a public IO helper whose safety contract says the header is inert comment text. If future provenance fields include branch names, project names, filenames, or CI-provided strings, a newline in one field can create a following non-comment line before the motion body. The low-cost hardening is to make the helper sanitize or encode metadata fields at the boundary where it promises comment-only output.

No fix made.

Pass 3 result: complete. S06 has three audit passes across project persistence, machine/material libraries, SVG import, LightBurn import, and G-code export metadata. No remaining major S06 area remains unchecked. S06 closed.

### S07 Pass 1 - Platform Adapter Boundary Orientation

Evidence inspected:

- Platform adapter contracts and web implementations in `src/platform/types.ts`, `src/platform/web/index.ts`, `src/platform/web/web-adapter.ts`, `src/platform/web/web-serial.ts`, and `src/platform/web/camera-bridge.ts`.
- Web Serial, camera bridge, PWA precache, Cloudflare routing, favicon, deploy workflow, and repo-policy platform tests.
- Boundary behavior for browser file picker save targets, browser-to-local camera bridge JSON, and serial device line framing.

Verification:

- Focused S07 command passed: `pnpm exec vitest run src/platform`.
- Result: 7 test files passed, 29 tests passed.
- Current tests cover Web Serial stale-port cleanup, read-loop parsing, partial-line overflow, disconnect callbacks, missing serial support, camera bridge success/unavailable mapping, and static platform deployment policies. They do not cover failed file writes, malformed bridge JSON, or newline-terminated oversized serial lines.

Findings:

#### S07-001 - Web save streams are left open when writes fail

Severity: Medium.

Evidence:

- `src/platform/web/web-adapter.ts:60-67` returns a save target whose `write(...)` implementation creates a `FileSystemWritableFileStream`, writes the provided data, and then closes it.
- `src/platform/web/web-adapter.ts:63-65` has no `try`/`finally` or abort path around `await writable.write(data)`, so a rejected write skips `await writable.close()`.
- No `web-adapter` test file exists in `src/platform/web`; the S07 test slice does not exercise failed File System Access API writes.

Risk:

If the browser or filesystem rejects a write after the writable stream is created, the adapter can leave the stream unclosed and the file operation partially committed or locked until browser cleanup. Users may then see a generic save failure followed by confusing retry behavior, while the platform abstraction gives callers no way to recover or distinguish a clean cancellation from an incomplete write.

No fix made.

#### S07-002 - Camera bridge probe JSON is trusted without shape validation

Severity: Medium.

Evidence:

- `src/platform/web/camera-bridge.ts:23-28` fetches `/probe`, casts `await response.json()` directly to `CameraBridgeProbeResult`, and passes it to `normalizeProbeResult(...)`.
- `src/platform/web/camera-bridge.ts:38-49` treats any value with `kind === 'ok'` as a valid ok response and copies `url`, `ffmpegAvailable`, `codec`, and `previewUrl` without runtime type checks.
- `src/platform/web/camera-bridge.test.ts` covers a valid ok response and fetch rejection/unavailable behavior, but not malformed JSON, non-object JSON, wrong field types, non-2xx responses with JSON bodies, or an unexpected `kind`.

Risk:

The local bridge is an HTTP boundary rather than an in-process typed call. A stale, malformed, or conflicting service on `127.0.0.1:51731` can make the web adapter report a camera as ready with invalid fields, broken preview URLs, or incorrect FFmpeg capability state. That can send users into later preview/stream failures instead of a clear bridge-unavailable or invalid-response message.

No fix made.

#### S07-003 - Serial line-size guard does not cap newline-terminated records

Severity: Medium.

Evidence:

- `src/platform/web/web-serial.ts:185-189` documents the 64 KiB guard as protection against spoofed-device denial-of-service from unbounded serial buffering.
- `src/platform/web/web-serial.ts:199-207` concatenates `buffer + chunk`, pushes each newline-terminated line with `lines.push(next.slice(0, nl)...)`, and only applies `MAX_SERIAL_LINE_LENGTH` to the remaining unterminated partial after all newline records have been emitted.
- `src/platform/web/web-serial.test.ts:169-189` covers normal line splitting, partial continuation, and over-length unterminated garbage, but not a single huge record that includes a newline.

Risk:

GRBL status and response lines should be tiny, but a noisy or spoofed serial device can still send a very large newline-terminated record. The platform adapter will hand that entire string to subscribers, which can inflate logs/state and create UI stalls even though the code comment intends to guard against serial-line denial-of-service. The guard currently protects only the no-newline case.

No fix made.

Pass 1 result: complete. S07 still needs Pass 2 and Pass 3 before the sector can close.

### S07 Pass 2 - Web Serial Lifecycle and Platform Policy Guard Pass

Evidence inspected:

- Full Web Serial adapter lifecycle in `src/platform/web/web-serial.ts`, including stale-port cleanup, open retry, disconnect handling, explicit close, wire-byte encoding, line extraction, and stream lock release.
- Web Serial tests in `src/platform/web/web-serial.test.ts`.
- Static platform/deploy policy tests in `src/platform/web/deploy-workflow-gate.test.ts`, `src/platform/web/repo-policy.test.ts`, `src/platform/web/pwa-precache.test.ts`, `src/platform/web/cloudflare-pages-routing.test.ts`, and `src/platform/web/favicon.test.ts`.
- Production/static web policy files `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`, `public/_headers`, `public/_redirects`, and `vite.config.ts`.
- Web save contract surfaces in `WORKFLOW.md`, `src/platform/web/web-adapter.ts`, and the UI save callers.

Verification:

- Focused S07 pass-2 command passed: `pnpm exec vitest run src/platform/web/web-serial.test.ts src/platform/web/deploy-workflow-gate.test.ts src/platform/web/repo-policy.test.ts src/platform/web/pwa-precache.test.ts`.
- Result: 4 test files passed, 24 tests passed.
- A local runtime check showed `new DOMException('cancel', 'AbortError') instanceof Error` is true under the repository Node runtime, so the adapter's `AbortError` cancellation check is not being logged as a current finding.

Findings:

#### S07-004 - Deploy policy tests omit some current pre-publish gates

Severity: Medium.

Evidence:

- `.github/workflows/deploy.yml:90-103` runs `pnpm audit:deps` and `pnpm check:file-size` before `cloudflare/wrangler-action@v3` publishes.
- `package.json:27` includes both `pnpm audit:deps` and `pnpm check:file-size` in `release:check`.
- `src/platform/web/deploy-workflow-gate.test.ts:54-76` describes its policy as running repo identity proof and CI gates before Wrangler publishes, but its `requiredBeforePublish` list omits `pnpm audit:deps` and `pnpm check:file-size`.
- `src/platform/web/repo-policy.test.ts:80-91` only checks that `pnpm check:file-size` appears somewhere in CI/deploy workflows, not that it runs before publish. No S07 policy test currently pins `pnpm audit:deps` in the deploy workflow.

Risk:

The workflow is currently stronger than the test. A future edit could remove `pnpm audit:deps` from deploy, or move `pnpm check:file-size` after publication, while the S07 deploy policy tests still pass. That weakens the safety value of these static guard tests exactly where they are supposed to preserve the release contract.

No fix made.

#### S07-005 - Web save fallback is documented but absent in the platform adapter

Severity: Medium.

Evidence:

- `WORKFLOW.md:341-343` says web G-code save uses the File System Access API where available, else browser download.
- `WORKFLOW.md:395-397` says web project save uses the File System Access API where available and falls back to browser download.
- `src/platform/web/web-adapter.ts:3-6` explicitly says there is no download fallback because the delivery target is Chromium.
- `src/platform/web/web-adapter.ts:52-65` calls `window.showSaveFilePicker(...)`, creates a writable stream, writes, and closes it; there is no feature-detection branch or anchor/download fallback.
- UI callers such as `src/ui/app/file-actions.ts:115-126`, `src/ui/app/file-actions.ts:198-211`, and `src/ui/app/save-processed-bitmap.ts:43-52` depend on `platform.pickFileForSave(...)` and surface errors, but do not provide a fallback save path.

Risk:

The implementation and the workflow contract disagree. In a browser where File System Access is unavailable or blocked by policy, the web app cannot fall back to a download even though the workflow says it can. Users are likely to see generic save errors instead of a usable browser download path or a clear "unsupported browser" gate, and tests will not catch the drift because S07 has no web-adapter coverage for unsupported file APIs.

No fix made.

Pass 2 result: complete. S07 still needs Pass 3 as a remaining-gap/coverage pass before the sector can close.

### S07 Pass 3 - Remaining-Gap and Coverage Sweep

Evidence inspected:

- Camera bridge adapter tests and UI RTSP preview integration in `src/platform/web/camera-bridge.test.ts`, `src/platform/web/camera-bridge.ts`, and `src/ui/laser/MachineSetupCameraPreview.tsx`.
- Web Serial stale-open comments and implementation in `src/platform/web/web-serial.ts`.
- Web Serial test coverage in `src/platform/web/web-serial.test.ts`.
- Static routing/favicon platform tests and the full S07 file inventory.
- Targeted `rg` usage checks for `rtspPreviewUrl`.

Verification:

- Focused S07 pass-3 command passed: `pnpm exec vitest run src/platform/web/camera-bridge.test.ts src/platform/web/cloudflare-pages-routing.test.ts src/platform/web/favicon.test.ts src/platform/web/web-serial.test.ts`.
- Result: 4 test files passed, 14 tests passed.
- S07 file inventory rechecked: 12 files under `src/platform/**`; every file in the sector has been inspected across Pass 1 through Pass 3.

Findings:

#### S07-006 - Web Serial stale-open recovery is not directly tested

Severity: Medium.

Evidence:

- `src/platform/web/web-serial.ts:15-20` documents a Chromium/Electron quirk where `requestPort()` can return a port still flagged open from a previous session.
- `src/platform/web/web-serial.ts:45-58` implements `closeStalePairedPorts()` by scanning `navigator.serial.getPorts()` and closing open paired ports before the picker.
- `src/platform/web/web-serial.ts:70-87` implements `openWithRetry(...)` by detecting an "already open" error, closing the port, and retrying once.
- `src/platform/web/web-serial.test.ts:59-109` covers disconnect/read-loop/explicit-close cleanup, `src/platform/web/web-serial.test.ts:133-166` covers wire encoding, and `src/platform/web/web-serial.test.ts:169-190` covers line extraction.
- The shared test helper at `src/platform/web/web-serial.test.ts:111-118` hardcodes `getPorts: vi.fn(async () => [])`, and no current test returns an already-open paired port or makes `port.open(...)` fail once with "already open".

Risk:

The stale-open recovery code exists because real Chromium/Electron behavior has caused open-port failures before. Since the direct stale-port sweep and already-open retry paths are untested, a future refactor can break the exact hardware-session recovery path while all current S07 tests still pass. The failure mode is user-visible connection failure after a crash, stale reader lock, or interrupted previous session.

No fix made.

#### S07-007 - Camera bridge preview URL method is unused in production

Severity: Low.

Evidence:

- `src/platform/types.ts:80` includes `rtspPreviewUrl(...)` in the `CameraBridgeAdapter` contract.
- `src/platform/web/camera-bridge.ts:14` implements `rtspPreviewUrl(...)`, and `src/platform/web/camera-bridge.test.ts:46-48` asserts its formatted output.
- `rg -n "rtspPreviewUrl" src/platform src/ui electron` found no production UI caller; the only UI reference is a test mock at `src/ui/laser/MachineSetupCameraPreview.test.tsx:157`.
- `src/ui/laser/MachineSetupCameraPreview.tsx:103-114` renders the RTSP image from `result.previewUrl` returned by `probeRtspCamera(...)`, not from the adapter method.

Risk:

The adapter contract now exposes two ways to describe a stream preview URL, but the production UI only uses the probe result. The unused method makes the camera bridge boundary harder to reason about and gives tests a path to pin that can drift without affecting the actual app. This is low severity because the active UI path is clear, but the extra API surface increases maintenance ambiguity.

No fix made.

Pass 3 result: complete. S07 has three audit passes across file picker behavior, Web Serial lifecycle, camera bridge client behavior, PWA/static deploy policy, and platform contract coverage. No remaining major S07 area remains unchecked. S07 closed.

### S08 Pass 1 - App Shell, File Actions, Commands, and Global Hooks

Evidence inspected:

- Root app composition and global hooks in `src/ui/app/App.tsx`.
- File actions, dirty-discard flow, autosave/recovery, unload-stop, wake-lock, PWA update prompt, shortcut handlers, and tests under `src/ui/app`.
- Command registry, command families, command shell, toolbar/menu/context-bar command surfaces, hidden image pickers, and tests under `src/ui/commands` and `src/ui/common`.
- Platform architecture contract in `PROJECT.md`.

Verification:

- Focused S08 pass-1 command passed: `pnpm exec vitest run src/ui/app src/ui/commands src/ui/common`.
- Result: 48 test files passed, 241 tests passed.
- Existing tests cover file-action failure copy, G-code controller mismatch export confirmation, selected-output export, dirty-project save/discard/cancel flow, modal shortcut suppression, app mount hook ordering, command registry gating, PWA streaming/paused suppression, wake-lock reacquire/release, unload-stop, and dialog focus handling.

Findings:

#### S08-001 - Focus Test can be enabled even though the real action is not implemented

Severity: Medium.

Evidence:

- `src/ui/commands/use-app-commands.ts:136-139` marks `focusTestAvailable` true when the active profile supports `z-axis` and `zTravelConfirmed === true`.
- `src/ui/commands/command-families.ts:277-286` enables `tools.focus-test` in that state with the user-facing title `Create a Z-axis focus test pattern`.
- `src/ui/commands/use-app-commands.ts:249-252` wires the enabled command to the `requestFocusTest` callback.
- The real shell callback at `src/ui/commands/CommandShell.tsx:60-63` only shows `Focus Test needs a dedicated, hardware-verified Z-motion generator before it can run.`
- `src/ui/commands/command-registry.test.ts:226-237` only verifies that a mocked `focusTest` callback is invoked when `focusTestAvailable` is true; it does not render `CommandShell` or assert that a focus-test generator/dialog actually exists.
- Repo search found material, interval, and scan-offset generators/dialogs, but no focus-test generator equivalent in `src/core/job` or `src/ui/calibration`.

Risk:

For a user who correctly verifies Z travel, the Tools menu can present Focus Test as available, pass the dirty-project guard, and then end in a not-implemented alert. That is a product-flow mismatch: the command registry says the feature is runnable, while the shell says it is still blocked. The existing unit test reinforces the mock contract rather than the real shell behavior, so this can remain green while the UI advertises a dead-end command.

No fix made.

#### S08-002 - Image import and batch trace bypass the platform file boundary

Severity: Medium.

Evidence:

- `PROJECT.md:40` says the shared web/desktop code is separated only by a thin platform adapter for file I/O, serial port, and drag-and-drop.
- `PROJECT.md:192` and `PROJECT.md:258-262` describe `platform/web` and `platform/electron` as the platform file boundary, with UI importing platform through dependency injection.
- `src/ui/commands/CommandShell.tsx:37-38` owns raw `HTMLInputElement` refs for image import and multi-file trace.
- `src/ui/commands/CommandShell.tsx:53-54` dispatches those commands by calling `.click()` on hidden DOM inputs rather than through `PlatformAdapter`.
- `src/ui/commands/CommandShell.tsx:164-203` implements the hidden `<input type="file">` controls directly in the command shell.
- `src/ui/commands/import-image-action.ts:13-24` and `src/ui/commands/import-image-action.ts:32-45` read the selected `File` directly into raster scene data.
- `src/ui/commands/multi-file-trace-action.ts:73-95` traces selected `File` objects, and `src/ui/commands/multi-file-trace-action.ts:106-119` downloads SVGs through an anchor/object URL instead of a save target.

Risk:

SVG/project/material-library file flows go through the platform adapter, but image import and batch trace use browser DOM file APIs directly from UI code. That weakens the web/Electron boundary and makes native file behavior, permission handling, cancellation semantics, and batch-output location harder to unify or test. It also contradicts the repository architecture file's stated "only place I/O lives" boundary, making future desktop/native-file work more likely to fork.

No fix made.

#### S08-003 - PWA update prompt can reload while a job still needs recovery

Severity: Medium.

Evidence:

- `src/ui/app/PwaUpdatePrompt.tsx:18-21` suppresses the reload banner only when `streamer.status` is `streaming` or `paused`.
- `src/ui/state/laser-store-helpers.ts:37-42` defines `isActiveJob(...)` to include `streaming`, `paused`, `done`, and `errored`; the comment explains that `done` only means all lines were acknowledged, not that physical motion has finished.
- `src/ui/laser/JobControls.tsx:38-45` keeps recovery controls mounted for `done` and `errored` states so Stop remains available until Idle clears the streamer.
- `src/ui/app/PwaUpdatePrompt.test.tsx:71-83` only asserts suppression for `streaming` and `paused`; there is no test for `done` or `errored`.

Risk:

If a service-worker update becomes ready while the streamer is `done` but not yet cleared by an Idle report, or `errored` and waiting for explicit Stop, the app can show a Reload banner and allow `updateServiceWorker(true)`. Reloading at that point can remove the recovery controls and tear down the serial UI while the rest of the laser UI still treats the job as active. This is the same class of safety-state drift the shared `isActiveJob(...)` helper was created to prevent.

No fix made.

Pass 1 result: complete. S08 still needs additional passes across workspace/canvas editing, laser/state workflows, layers/material/raster/trace/text panels, and final coverage before the sector can close.

### S08 Pass 2 - Workspace Canvas, Interaction, and Preview Pass

Evidence inspected:

- Workspace component composition, draw effect, pointer handlers, wheel zoom, preview overlays, preview playback, preview toolpath derivation, and canvas bitmap sizing under `src/ui/workspace`.
- Drag state, transform/rotate/scale/pan helpers, snapping, marquee selection, draw/pen/measure tools, path-node editing hit tests, registration jig panel, overlays, and workspace draw/preview/raster preview paths.
- Core hit-test and layer-visibility behavior used by workspace selection.

Verification:

- Focused S08 pass-2 command passed: `pnpm exec vitest run src/ui/workspace`.
- Result: 42 test files passed, 184 tests passed.
- Existing tests cover many pure geometry helpers, preview parity, raster preview cache behavior, registration jig controls, path-node edit helpers, draw tools, snapping, and canvas bitmap resizing. The gaps below remain despite that green slice.

Findings:

#### S08-004 - Workspace drag hook is not directly covered by its test file

Severity: Medium.

Evidence:

- `src/ui/workspace/Workspace.tsx:89-93` wires the live canvas to `onMouseDown`, `onMouseMove`, `onMouseUp`, `onMouseLeave={handlers.onMouseUp}`, and `onDoubleClick`.
- `src/ui/workspace/use-workspace-drag.ts:61-87` starts the selected drag mode, initializes marquee/measure state, and calls `beginInteraction()` for transform-like drags.
- `src/ui/workspace/use-workspace-drag.ts:89-108` updates cursor/draft/measure/marquee/path-node/transform state during mousemove.
- `src/ui/workspace/use-workspace-drag.ts:110-129` finishes the drag, clears cursor/snap guides, calls mode-specific commit logic, and clears hook state.
- `src/ui/workspace/use-workspace-drag.ts:255-285` commits draw, measure, pan/context-menu, marquee, and transform completion paths.
- `src/ui/workspace/use-workspace-drag.test.ts:1-42` only imports and tests `finishDrawToolOnLeftDoubleClick(...)`; it does not render the hook or exercise the actual begin/update/finish event pipeline.

Risk:

The pure helpers have useful tests, but the live hook boundary is where preview-mode blocking, `beginInteraction()`/`endInteraction()`, mouseleave finalization, right-click context-bar opening, draw/measure cleanup, and snap-guide clearing actually connect. A regression in that wiring could leave interaction state stuck, commit the wrong drag, or fail to clear UI overlays while the misleadingly named `use-workspace-drag.test.ts` still passes.

No fix made.

#### S08-005 - View transform and event-coordinate math can produce invalid scene coordinates

Severity: Medium.

Evidence:

- `src/ui/workspace/view-transform.ts:36-39` subtracts a fixed 48 px padding from the canvas dimensions and multiplies by `zoomFactor` without clamping the usable width/height or checking for finite positive bed dimensions.
- `src/ui/workspace/view-transform.ts:65-82` divides mouse coordinates by `rect.width`, `rect.height`, and the computed `v.scale` without guarding zero, negative, or non-finite values.
- `src/ui/workspace/view-transform.ts:126-135` uses the same unguarded `rect.width`/`rect.height` division for wheel-zoom cursor anchoring.
- `src/ui/workspace/drag-state.ts:295-305` computes pan deltas by dividing by `cssScale = rect.width / canvas.width` and `view.scale`, again with no finite positive guard.
- `src/ui/workspace/use-canvas-bitmap-size.ts:43-45` keeps the last bitmap size when the element is unmeasurable, but that does not protect live event conversions when the CSS rect is zero/tiny or when the canvas is smaller than the fixed padding.
- `src/ui/workspace/view-transform.test.ts:4-83` covers normal fit/zoom/pan cases only; `src/ui/workspace/use-canvas-bitmap-size.test.tsx:83-105` covers normal measurement and zero-size fallback, not tiny positive canvas dimensions or event conversion guards.

Risk:

If the workspace pane is collapsed below the padding size, exactly zero-sized during layout churn, or receives malformed view/device dimensions, the computed scale can become zero, negative, `Infinity`, or `NaN`. Those values can feed pointer conversion, panning, selection, draw/measure drafts, and transform updates, producing inverted coordinates or non-finite scene points before downstream state has a chance to reject them.

No fix made.

#### S08-006 - Preview preparation still runs synchronously on the workspace UI path

Severity: Medium.

Evidence:

- `src/ui/workspace/Workspace.tsx:60-61` calls `usePreviewToolpath(project, previewMode)` and immediately passes the result to preview playback and drawing.
- `src/ui/workspace/use-preview-toolpath.ts:21-33` uses `useMemo(...)` to resolve placement and call `buildPreviewToolpath(...)` whenever preview mode or its dependencies change.
- `src/ui/workspace/draw-preview.ts:115-146` builds preview output synchronously by validating scope, running the vector complexity guard, calling `prepareOutput(...)`, building the toolpath, and mapping it back to scene coordinates.
- `src/ui/workspace/draw-scene.ts:97-108` draws preview synchronously and still has a fallback `opts.previewToolpath ?? buildPreviewToolpath(project)` in the draw path.
- `src/ui/workspace/draw-raster-preview.ts:30-52` runs raster preview generation from `drawScene(...)`, and `src/ui/workspace/draw-raster-preview.ts:77-97` calls `buildProcessedRasterBitmap(...)`, creates an offscreen canvas, and writes `ImageData` synchronously on a cache miss.
- `src/ui/workspace/draw-preview-complexity.test.ts:43-90` covers the extreme trace skip, and `src/ui/workspace/draw-raster-preview.test.ts:78-102` covers the over-budget raster skip, but no test covers valid-but-large preview work happening off the render/draw path or being cancellable.

Risk:

The preview now has important budget guards, but valid jobs under those guards can still do compile/optimization/toolpath mapping and first raster-preview bitmap generation on the main UI path when the operator enters Preview or changes preview dependencies. That can freeze the canvas and controls during exactly the pre-burn review step where responsiveness and cancellation matter most.

No fix made.

#### S08-007 - Path-node hit testing ignores hidden layer visibility

Severity: Medium.

Evidence:

- Core object hit testing in `src/core/scene/hit-test.ts:23-34` skips locked objects and objects without a visible layer through `sceneObjectHasVisibleLayerFromMap(...)`.
- Marquee selection in `src/ui/workspace/selection-marquee.ts:14-18` also skips locked objects and hidden-layer objects.
- Path-node hit testing in `src/ui/workspace/path-node-hit-test.ts:14-22` scans editable path objects directly, and `src/ui/workspace/path-node-hit-test.ts:54-58` filters only locked objects and editable kinds; it does not check object or path layer visibility.
- `src/ui/workspace/path-node-drag.ts:20-22` selects any node returned by `hitPathNode(...)`.
- `src/ui/workspace/draw-selection-overlay.ts:21-31` refuses to draw selection/path-node handles for invisible objects, so a hidden-layer object can be selected for node editing without visible node handles.
- `src/ui/workspace/path-node-hit-test.test.ts:35-64` covers topmost editable nodes, locked objects, non-vector objects, and outside-threshold misses, but not hidden path layers.

Risk:

The node tool can select and edit geometry on hidden layers even though normal click selection and marquee selection treat hidden-layer objects as non-interactive. That creates an invisible-edit footgun: a user can drag, nudge, or delete nodes on artwork they intentionally hid, with little or no visual feedback from the canvas.

No fix made.

Pass 2 result: complete. S08 still needs additional passes across laser/state workflows, layers/material/raster/trace/text panels, and final remaining-gap coverage before the sector can close.

### S08 Pass 3 - Laser, Machine Setup, and Live State Workflows

Evidence inspected:

- Laser rail composition, connection controls, jog controls, job controls, start flow, frame action, live estimate, shortcuts, status display, console panel, safety banners, and machine setup panels under `src/ui/laser`.
- Laser Zustand store actions and helpers under `src/ui/state`, including connection lifecycle, safe writes, stream start/pause/resume/stop, motion operations, controller operations, line handling, post-job settle, origin actions, GRBL settings actions, autofocus, transcript, and frame verification.
- Output-scope and selected-output tests for Start/Frame controls, Verified Origin frame/readiness tests, keyboard shortcut tests, camera setup tests, controller recovery tests, and active-job/motion-operation guard tests.
- Workflow/operator contracts in `WORKFLOW.md` and safety non-negotiables in `PROJECT.md`.

Verification:

- Focused S08 pass-3 command passed: `pnpm exec vitest run src/ui/laser src/ui/state`.
- Result: 95 test files passed, 618 tests passed.
- Existing tests cover many live-machine paths: controller connection/readiness, active-job command guards, jog/frame operation state, stop/pause/resume safety, post-job settle, origin invalidation, Verified Frame gating, machine setup, camera preview controls, console command gating, and selected-output Start. The gaps below remain despite that green slice.

Findings:

#### S08-008 - Frame fallback for over-budget rasters ignores selected-output scope

Severity: Medium.

Evidence:

- `src/ui/laser/use-frame-action.ts:30` reads the current output scope through `currentOutputScope(app)`.
- `src/ui/laser/use-frame-action.ts:40` computes `frameBounds = computeFrameBounds(...)` before the compile/output scope result is known.
- `src/ui/laser/use-frame-action.ts:45-50` calls `prepareOutput(project, { outputScope })`, then on an over-budget raster preflight failure uses `rasterBudgetFallbackBounds(prepared.preflight, frameBounds)`.
- `src/ui/laser/use-frame-action.ts:52` dispatches the fallback frame using those fallback bounds.
- `src/core/job/frame-bounds.ts:31-42` computes frame bounds from the whole `Scene`, iterating every scene object that has output enabled by layer color. It has no `OutputScope` argument and cannot restrict to selected object IDs.
- `WORKFLOW.md:720-725` says Cut Selected Graphics makes Preview, live estimate, Frame, Start job, and Save G-code compile the same selected-only output scope.
- `WORKFLOW.md:730-732` separately allows job-origin math to use full output design bounds when selection origin is disabled, but still says emitted output remains selected-only.
- `src/ui/laser/start-job-output-scope.test.ts:36-43` covers selected-output Start, and `src/ui/laser/JobControls-output-scope.test.tsx:16-27` covers the Cut Selected controls.
- `src/ui/laser/start-frame-raster-budget.test.tsx:121-158` covers over-budget raster Frame fallback for the whole scene, but not the selected-output fallback path.

Risk:

When Cut Selected Graphics is enabled and the selected raster is over budget, Frame can fall back to whole-scene physical bounds instead of selected-output bounds. The operator may frame unrelated artwork, hit bed/no-go-zone blockers caused by unselected objects, or get a false fit indication that does not match the selected-output Start/Save behavior promised by the workflow.

No fix made.

#### S08-009 - Ctrl/Cmd+. stop shortcut does nothing during active frame or jog motion

Severity: Medium.

Evidence:

- `WORKFLOW.md:514` documents `Cmd/Ctrl+.` as Stop job.
- `PROJECT.md:154` says the Stop path must remain reachable from any window state during a job.
- `src/ui/laser/use-job-shortcuts.ts:6-10` describes Stop as the panic path that bypasses modal/editable gates.
- `src/ui/laser/use-job-shortcuts.ts:24-26` handles `.` only when `isActiveJob(laser.streamer)` is true, then calls `laser.stopJob()`.
- `src/ui/laser/use-job-shortcuts.ts` does not inspect `laser.motionOperation`, so active jog/frame operations have no keyboard stop/cancel path.
- `src/ui/laser/JobControls.tsx:46-55` detects `motionOperation !== null` and renders motion controls while a frame or jog is active.
- `src/ui/laser/JobControls.tsx:207` labels those controls as `Cancel frame` or `Cancel jog`.
- `src/ui/state/laser-store-helpers.ts:82-84` already defines `disconnectStopCommands(...)` to send `RT_JOG_CANCEL` when `motionOperation !== null`, proving the store has a realtime cancel command for active frame/jog motion.
- `src/ui/laser/use-job-shortcuts.test.ts:46-89` covers active-job stop, modal-bypassing stop, no-job no-op, and plain-key no-op, but has no active `motionOperation` case.

Risk:

During active Frame/Jog motion, the visible UI offers Cancel frame/jog, but the documented stop shortcut silently does nothing because no streamer job is active. An operator who reaches for the keyboard stop path during physical motion may lose a fast software escape and must find the small visible cancel control or use a physical stop.

No fix made.

Pass 3 result: complete. S08 still needs additional passes across layers/material/raster/trace/text/calibration panels and final remaining-gap coverage before the sector can close.

### S08 Pass 4 - Layers, Materials, Raster/Trace/Text, and Calibration Panels

Evidence inspected:

- Layer and selected-artwork controls under `src/ui/layers`, including `CutsLayersPanel`, `LayerRow`, cut-settings dialogs, material-library panels, selected-object property controls, and layer defaults.
- Material library UI and state actions under `src/ui/material-library` and `src/ui/state/material-library-*`.
- Raster adjustment, convert-to-bitmap, trace import/preview, trace worker, text dialog, font loader, and calibration dialogs under `src/ui/raster`, `src/ui/trace`, `src/ui/text`, and `src/ui/calibration`.
- Related state actions for layer edits, object overrides, material presets, bitmap conversion, masks, break-apart, generated scenes, registration output/box actions, and project optimization.
- Existing tests for these panels and workflows, plus core trace boundary helpers where UI drag output crosses into crop logic.

Verification:

- Focused S08 pass-4 command passed: `pnpm exec vitest run src/ui/layers src/ui/material-library src/ui/raster src/ui/trace src/ui/text src/ui/calibration src/ui/state/layer-actions.test.ts src/ui/state/material-library-actions.test.ts src/ui/state/material-library-collection.test.ts src/ui/state/material-library-persistence.test.ts src/ui/state/material-library-management-actions.test.ts src/ui/state/material-preset-actions.test.ts src/ui/state/object-properties-actions.test.ts src/ui/state/convert-to-bitmap.test.ts src/ui/state/fill-selection-actions.test.ts src/ui/state/close-open-fill-contours-actions.test.ts src/ui/state/break-apart-actions.test.ts src/ui/state/image-mask-actions.test.ts src/ui/state/generated-scene-actions.test.ts src/ui/state/project-optimization-actions.test.ts src/ui/state/registration-box-actions.test.ts src/ui/state/registration-output-actions.test.ts`.
- Result: 54 test files passed, 335 tests passed.
- Existing coverage is strong for staged cut settings, material library CRUD/import/export, raster adjustment staging, bitmap conversion worker failure, trace worker timeout/runtime errors, trace preview normal dragging, text Unicode/font fallback, and calibration dialog option parsing. The gaps below remain despite that green slice.

Findings:

#### S08-010 - Trace worker requests do not clean up or retire the worker when `postMessage(...)` throws synchronously

Severity: Medium.

Evidence:

- `src/ui/trace/use-trace-worker-client.ts:165-190` creates a trace worker request, installs a timeout, stores the request in `pendingByRequestId`, and then calls `worker.postMessage(request)`.
- `src/ui/trace/use-trace-worker-client.ts:179-188` registers the pending request before the worker send.
- `src/ui/trace/use-trace-worker-client.ts:190` sends the request without a `try/catch`.
- `src/ui/trace/use-trace-worker-client.ts:112-118` has a helper to clear pending requests and retire the worker, but it is only used by timeout/runtime failure paths.
- The sibling bitmap worker already handles this failure mode: `src/ui/raster/convert-bitmap-worker-client.ts:85-97` registers the request and wraps `worker.postMessage(request)` in `try/catch`, while `src/ui/raster/convert-bitmap-worker-client.ts:98-102` deletes the pending entry, clears the timer, retires the worker, and rejects immediately.
- `src/ui/raster/vector-to-bitmap-worker.test.ts:97-108` covers synchronous bitmap-worker `postMessage` failure.
- `src/ui/trace/use-trace-worker-client.test.ts:107-215` covers successful worker tracing, worker trace errors, runtime errors, and timeout behavior, but not synchronous `postMessage` failure.

Risk:

If trace-worker `postMessage(...)` throws synchronously, for example due to a structured-clone failure, worker teardown race, or browser worker edge case, the Promise rejects but the trace client leaves a stale pending entry and timer behind. The shared worker instance also remains reusable until timeout/runtime failure, so later trace preview/commit requests can keep hitting a broken worker instead of retiring it and falling back cleanly.

No fix made.

#### S08-011 - Trace boundary dragging can persist non-finite crop rectangles when preview geometry collapses

Severity: Medium.

Evidence:

- `src/ui/trace/TracePreview.tsx:260-270` turns the drag start/end points into a trace boundary and passes it to `normalizeTraceBoundary(...)`.
- `src/ui/trace/TracePreview.tsx:285-297` computes the mouse-to-image point from `getBoundingClientRect()`, derives `scale = Math.min(rect.width / imageSize.width, rect.height / imageSize.height)`, and divides by `scale` without checking that the scale is finite and positive.
- `src/ui/trace/TracePreview.tsx:301-302` clamps with `Math.max(min, Math.min(max, value))`, which returns `NaN` when `value` is `NaN`.
- `src/core/trace/trace-boundary.ts:11-25` normalizes crop rectangles but only rejects null boundaries or non-positive image dimensions. It does not reject non-finite `x`, `y`, `width`, or `height`.
- `src/core/trace/trace-boundary.ts:17-25` rounds/clamps boundary coordinates and then returns `{ x, y, width, height }` when `width < 1 || height < 1` is false; that comparison does not reject `NaN`.
- `src/core/trace/trace-boundary.ts:29-36` trusts the normalized boundary when allocating/copying cropped image data.
- `src/ui/trace/TracePreview.test.tsx:86-113` covers a normal 100x100 preview drag.
- `src/core/trace/trace-boundary.test.ts:14-24` covers rounding, out-of-bounds, and empty boundary rejection, but not non-finite boundary values.

Risk:

If the trace preview is temporarily zero-sized during dialog/layout churn, or otherwise reports collapsed geometry, the crop boundary path can store `NaN` coordinates instead of treating the drag as invalid. Later preview/commit crop work can then receive a malformed crop rectangle, producing invalid trace results or brittle browser-dependent behavior around typed-array allocation and slicing.

No fix made.

#### S08-012 - Cut Settings dialog can save layer speeds above the active device max feed while inline controls clamp them

Severity: Low.

Evidence:

- Inline layer speed editing uses the active device max feed: `src/ui/layers/LayerRowFields.tsx:226-236` reads `project.device.maxFeed`, clamps parsed speed to `1..maxFeed`, and sets the input `max`.
- Selected-artwork speed editing does the same: `src/ui/layers/SelectedObjectOperationSettings.tsx:24-34` reads `maxFeed`, and `src/ui/layers/SelectedObjectOperationSettings.tsx:83-92` sets `max={props.maxFeed}` and clamps parsed speed to `1..props.maxFeed`.
- The staged Cut Settings dialog only sets a minimum: `src/ui/layers/CutSettingsCommonFields.tsx:30` renders the dialog speed field with `min={1}` and no device max.
- The Cut Settings draft parser explicitly allows any positive finite speed: `src/ui/layers/cut-settings-draft.ts:31` calls `numberField(data, 'speed', layer.speed, 1, Number.POSITIVE_INFINITY)`.
- `src/core/preflight/preflight.ts:9` documents speed as valid only within `(0, device.maxFeed]`, and `src/core/preflight/preflight.ts:165-168` emits `speed-out-of-range` when `layer.speed > maxFeed`.
- Compilation later caps the value instead of preserving the invalid setting: `src/core/job/compile-job.ts:195` and `src/core/job/compile-job-raster.ts:86` use `Math.min(layer.speed, device.maxFeed)`.
- `src/ui/layers/CutsLayersPanel.cut-settings.test.tsx:64-78` verifies that the dialog can save speed `1777`, but there is no max-feed case for a low-max-feed device.

Risk:

The same layer speed can be accepted in the advanced Cut Settings dialog, rejected by preflight, and capped by compile paths, while inline controls would have prevented the value. This inconsistency can confuse burn setup and create avoidable preflight blockers, especially after switching to a lower-feed machine profile.

No fix made.

#### S08-013 - Selected Artwork Settings treats the first selected object's operation settings as common for the whole mixed selection

Severity: Medium.

Evidence:

- `src/ui/layers/SelectedObjectOperationSettings.tsx:25-34` computes a `context` for the selected objects and renders controls labeled as selected-object settings.
- `src/ui/layers/SelectedObjectOperationSettings.tsx:52-113` renders mode, power, speed, passes, fill, and image controls for "selected objects".
- `src/ui/layers/SelectedObjectOperationSettings.tsx:252-258` implements `commonEffectiveOperationSettings(...)` by reading only `objects[0]` and returning the first object's effective operation settings. It does not compare the rest of the selected objects or surface a mixed-value state.
- `src/ui/layers/SelectedObjectOperationSettings.tsx:18-29` wires those controls to `setSelectedObjectsOperationOverride`.
- `src/ui/state/object-properties-actions.ts:88-104` applies a sanitized override patch to every selected object that matches the selected ID set.
- `src/ui/state/object-properties-actions.test.ts:43-64` verifies that the direct action applies the same override to multiple selected objects.
- `src/ui/layers/SelectedObjectProperties.test.tsx:74-94` covers selected artwork operation editing for a single selected object, but there is no mixed-layer or mixed-operation multi-selection UI test.

Risk:

When a user multi-selects artwork from different layers or with different existing overrides, the panel can display the first object's settings as if they describe the whole selection. A small edit then stamps the new override across the entire selection, potentially changing burn mode, speed, power, or image/fill behavior for objects whose different settings were not visible in the panel.

No fix made.

Pass 4 result: complete. S08 still needs one remaining-gap pass across UI kit/help/root job-placement/accessibility/test-coverage seams, plus a short revisit of text numeric edge cases, before the sector can close.

### S08 Pass 5 - Shared UI Kit, Help, Accessibility, Job Placement, and Remaining Coverage

Evidence inspected:

- Shared kit primitives and tests: `src/ui/kit/Button.tsx`, `src/ui/kit/IconButton.tsx`, `src/ui/kit/Dialog.tsx`, `src/ui/kit/NumberInput.tsx`, and `src/ui/kit/Button.test.tsx` / `Dialog.test.tsx`.
- Dialog and keyboard/a11y helpers: `src/ui/common/use-dialog-a11y.ts`, `src/ui/common/keyboard-targets.ts`, `src/ui/common/use-register-modal.ts`, and the hover-help contract test under `src/ui/a11y`.
- Help topic registry and command/control help coverage under `src/ui/help`.
- Root job-placement helper and call chain through `src/ui/job-placement.ts`, `src/ui/laser/start-job-readiness.ts`, and the job-placement tests.
- Theme token/canvas palette sync under `src/ui/theme`.
- Remaining preview overlay controls and playback state under `src/ui/workspace/preview-overlays.tsx` and `src/ui/workspace/use-preview-playback.ts`.
- Text dialog numeric parsing and text persistence boundary under `src/ui/text`, `src/core/text`, `src/ui/state/scene-mutations.ts`, and project text-object validation.

Verification:

- Focused S08 pass-5 command passed: `pnpm exec vitest run src/ui/a11y src/ui/kit src/ui/help src/ui/theme src/ui/job-placement.test.ts src/ui/common/use-dialog-a11y.test.tsx src/ui/common/ConfirmSaveDialog.test.tsx src/ui/common/ErrorBoundary.test.tsx src/ui/workspace/preview-overlays.test.tsx src/ui/workspace/use-preview-playback.test.tsx src/ui/text/AddTextDialog.test.tsx src/ui/app/shortcuts.test.ts src/ui/app/shortcuts-docs.test.ts src/ui/app/shortcuts-tools.test.ts`.
- Result: 15 test files passed, 91 tests passed.
- Job placement is guarded by `prepareStartJob(...)` idle/active-operation checks before placement resolution, so no separate S09/S08 placement-start finding was logged here.

Findings:

#### S08-014 - Preview route playback buttons use an undefined CSS class instead of the shared button chrome

Severity: Low.

Evidence:

- The shared button classes are defined as `.lf-btn` and variants in `src/ui/theme/tokens.css:100-162`.
- The shared `Button` component maps variants to `lf-btn` classes in `src/ui/kit/Button.tsx:19-22`, and `src/ui/kit/Button.test.tsx:42-56` pins that mapping.
- `rg -n "lf-button|lf-btn|\\.lf-button|\\.lf-btn" src/ui src/ui/theme/tokens.css` found `.lf-btn` definitions/usages and only two `lf-button` usages.
- `src/ui/workspace/preview-overlays.tsx:120-132` renders the Play/Pause route-preview button with `className="lf-button"`.
- `src/ui/workspace/preview-overlays.tsx:136-148` renders the Restart route-preview button with `className="lf-button"`.
- No `.lf-button` rule exists in `src/ui/theme/tokens.css`; the route-preview controls therefore miss the shared `.lf-btn` hover/active/disabled styling.
- `src/ui/workspace/preview-overlays.test.tsx:88-117` covers playback behavior and disabled state, but does not assert that these buttons use the shared button class.

Risk:

The route preview's Play/Pause and Restart buttons can render with browser-default styling plus ad hoc inline sizing instead of the app's shared button affordances. This is low-risk functionally, but it weakens visual consistency exactly on the pre-burn route-review surface and leaves the regression outside existing tests.

No fix made.

#### S08-015 - The hover-help contract accepts unregistered `data-help-id` values, and preview controls already use IDs outside the help registry

Severity: Low.

Evidence:

- `src/ui/a11y/button-hover-contract.test.ts:34-37` treats any raw `button`, `summary`, `input`, `select`, or `textarea` as covered if it has either `title` or `data-help-id`.
- `src/ui/help/help-topics.ts:58-59` defines registered help IDs as command/menu/tool plus `ControlHelpId`, but `ControlHelpId` is currently `control:${string}` rather than a closed union over known controls.
- `src/ui/help/help-topics.ts:323-336` resolves a help ID to a topic title, but falls back to the raw ID string if `topicById(...)` cannot resolve it.
- `src/ui/help/help-topics.test.ts:8-35` validates command coverage and tool help; `src/ui/help/help-topics.test.ts:48-92` validates a hardcoded subset of control help IDs. It does not scan every `data-help-id` in UI source for registry membership.
- `src/ui/workspace/preview-overlays.tsx:69`, `src/ui/workspace/preview-overlays.tsx:127`, `src/ui/workspace/preview-overlays.tsx:143`, and `src/ui/workspace/preview-overlays.tsx:159` use `data-help-id` values such as `preview.routePlayback` and `preview.routeSpeed`, which are outside the `command:`, `menu:`, `tool:`, and `control:` families.
- Those preview controls currently also have explicit `title` attributes, so this is a registry/coverage drift issue rather than a missing-tooltip issue today.

Risk:

Future typos or ad hoc help IDs can satisfy the hover-help contract without being resolvable by the help registry. If a help overlay, documentation extraction, analytics, or UI audit starts relying on `data-help-id`, these controls either resolve to raw IDs or disappear from registry-based coverage while tests still pass.

No fix made.

#### S08-016 - Add/Edit Text numeric inputs can pass non-finite or out-of-contract values into text rendering and scene state

Severity: Low.

Evidence:

- `src/ui/text/AddTextDialog.tsx:201-210` parses text size with `Number(e.target.value)` and only applies `Math.max(1, ...)`; it does not require `Number.isFinite(...)` or apply an upper limit.
- `src/ui/text/AddTextDialog.tsx:219-228` gives line height `max={5}` in the DOM, but the state update only applies `Math.max(0.5, Number(e.target.value) || 1)` and does not clamp to that max or require finiteness.
- `src/ui/text/AddTextDialog.tsx:234-243` gives letter spacing `min={-0.5}` and `max={2}`, but the state update uses `Number(e.target.value) || 0` with no finite check or min/max clamp.
- `src/ui/text/AddTextDialog.tsx:143-149` passes these state values directly to `textToPolylines(...)`.
- `src/ui/text/AddTextDialog.tsx:152-164` stores the same values into the `TextObject`.
- `src/core/text/text-to-polylines.ts:86-107` uses `sizeMm`, `lineHeight`, and `letterSpacing` directly in width, baseline, and glyph-path calculations.
- `src/io/project/project-shape-validator.ts:186-197` later requires saved text objects to have finite positive `sizeMm`/`lineHeight` and finite optional `letterSpacing`, with the primitive finite checks in `src/io/project/project-validator-primitives.ts:63-70` and `src/io/project/project-validator-primitives.ts:166-167`.
- `src/ui/text/AddTextDialog.test.tsx` covers Unicode normalization and unknown-font fallback, but not numeric bounds or non-finite text geometry input.

Risk:

Most normal browser numeric edits stay inside expected ranges, but pasted/pathological values such as an extremely large exponent can reach the renderer and scene state before the project validator rejects them on file load. That can create unsaveable or unstable text objects, and it leaves the text dialog inconsistent with other UI numeric parsers that explicitly clamp finite ranges.

No fix made.

Pass 5 result: complete. S08 is fully audited after five passes. No major UI subareas remain unchecked at sector level; remaining issues are recorded above. Move to S09 fixtures, perceptual harness, and test assets next.

### S09 Pass 1 - Fixture Corpus and Perceptual Artifact Orientation

Evidence inspected:

- Fixture inventory under `src/__fixtures__/**`, including the SVG normal corpus, malicious SVG corpus, perceptual trace/fill helpers, PNG encode/decode helpers, and trace artifact harness.
- Existing local generated PNGs under `perceptual-artifacts/**`.
- SVG fixture consumers: `src/io/svg/malicious-corpus.test.ts`, `src/io/svg/pipeline.snapshot.test.ts`, and `src/io/svg/import-perceptual.test.ts`.
- Trace and fill perceptual consumers: `src/core/trace/trace-perceptual.test.ts`, `src/__fixtures__/perceptual/toolpath-rasterize.test.ts`, and `src/__fixtures__/perceptual/trace-artifacts.test.ts`.
- Required real-logo fixture gate and consumers: `src/__fixtures__/perceptual/trace-artifact-runner.ts`, `src/__fixtures__/perceptual/arch-house-baseline.test.ts`, `src/__fixtures__/perceptual/arch-house-edge-quality.test.ts`, and `src/__fixtures__/perceptual/trace-benchmark-regression-cases.ts`.
- Git inventory for generated artifacts: `git ls-files perceptual-artifacts` and `git status --short --ignored perceptual-artifacts`.

Verification:

- Focused S09 pass-1 command passed: `pnpm exec vitest run src/io/svg/malicious-corpus.test.ts src/io/svg/pipeline.snapshot.test.ts src/io/svg/import-perceptual.test.ts src/core/trace/trace-perceptual.test.ts src/__fixtures__/perceptual/compare.test.ts src/__fixtures__/perceptual/rasterize.test.ts src/__fixtures__/perceptual/toolpath-rasterize.test.ts src/__fixtures__/perceptual/trace-artifacts.test.ts`.
- Result: 8 test files passed, 79 tests passed.

Findings:

#### S09-001 - The required Arch House fixture detector accepts non-PNG files even though all real-logo consumers decode the path as PNG

Severity: Medium.

Evidence:

- `src/__fixtures__/perceptual/trace-artifact-runner.ts:5-6` defines the required fixture stem and accepts `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, and `.json`.
- `src/__fixtures__/perceptual/trace-artifact-runner.ts:121-131` returns `present: true`, `ratingCap: 10`, and the first matching path for any of those extensions.
- `src/__fixtures__/perceptual/png-decode.ts:25-31` exposes `decodePngFile(...)` and rejects non-PNG signatures with `Not a PNG (bad signature)`.
- `src/__fixtures__/perceptual/arch-house-baseline.test.ts:29-34`, `src/__fixtures__/perceptual/arch-house-baseline.test.ts:83-85`, `src/__fixtures__/perceptual/arch-house-baseline.test.ts:100-102`, and `src/__fixtures__/perceptual/arch-house-baseline.test.ts:123-125` pass the required fixture path directly into `decodePngFile(...)`.
- `src/__fixtures__/perceptual/arch-house-edge-quality.test.ts:16-18`, `src/__fixtures__/perceptual/arch-house-edge-quality.test.ts:44-46`, and `src/__fixtures__/perceptual/arch-house-edge-quality.test.ts:67-69` do the same for edge-quality checks.
- `src/__fixtures__/perceptual/trace-benchmark-regression-cases.ts:123-127` and `src/__fixtures__/perceptual/trace-benchmark-regression-cases.ts:219-225` also decode the detected fixture as PNG.
- `src/__fixtures__/perceptual/trace-artifacts.test.ts:328-336` covers the absent-fixture cap path, but no test covers a present non-PNG fixture path.

Risk:

A maintainer can place `arch-house-langebaan-source.jpg`, `.webp`, `.bmp`, or `.json` in the documented fixture directory and the gate will report that the required fixture is present with a 10/10 rating cap. The real-logo tests and benchmark loop then fail later with a PNG decoder error instead of reporting an actionable fixture-format problem.

No fix made.

#### S09-002 - Perceptual artifact PNGs are ignored local outputs but are referenced like durable audit evidence

Severity: Low.

Evidence:

- `.gitignore:18-19` ignores `perceptual-artifacts/` as opt-in render dumps for `PERCEPTUAL_ARTIFACTS=1`.
- `git ls-files perceptual-artifacts` returned no tracked files during this pass.
- `git status --short --ignored perceptual-artifacts` reported `!! perceptual-artifacts/`, confirming the local PNGs are ignored workspace outputs.
- `src/__fixtures__/perceptual/png.ts:22-23` hardcodes the opt-in artifact directory name, and `src/__fixtures__/perceptual/png.ts:37-44` writes `${name}.png` into that directory when the environment flag is set.
- Existing audit reports cite these artifact paths as evidence: `audit/reports/step-1-verification-harness-2026-06-23.md:82-90` and `audit/reports/step-4-fill-raster-fidelity-2026-06-23.md:118-119`.

Risk:

The audit trail can imply that `perceptual-artifacts/*.png` are durable repository evidence, but a fresh checkout will not contain them and local regenerated images can differ without Git noticing. That weakens provenance for visual/perceptual claims unless reports also capture the command, source fixture, and expected regeneration path.

No fix made.

#### S09-003 - `writePerceptualArtifact(...)` can render a misleading comparison for mismatched mask dimensions

Severity: Low.

Evidence:

- `src/__fixtures__/perceptual/png.ts:37-44` calls `buildComparison(predicted, truth)` before writing the opt-in artifact.
- `src/__fixtures__/perceptual/png.ts:48-67` sizes the composite from `truth.width` and `truth.height`, then reads predicted pixels with `predicted.data[y * w + x] ?? 0`; it does not check that the predicted mask dimensions match the truth mask.
- `src/__fixtures__/perceptual/compare.ts:32-35` explicitly throws on mask width/height mismatch.
- `src/__fixtures__/perceptual/compare.test.ts:89-92` pins that dimension-mismatch behavior for metric comparison.
- Current callers such as `src/io/svg/import-perceptual.test.ts:37`, `src/core/trace/trace-perceptual.test.ts:56`, and `src/__fixtures__/perceptual/toolpath-rasterize.test.ts:40-93` call `writePerceptualArtifact(...)` independently; the writer has no matching mismatch test of its own.

Risk:

If a future perceptual fixture accidentally compares masks with different dimensions, the metric path may reject it while the visual artifact can still be written using truth dimensions and missing predicted pixels as background. That can leave a misleading side-by-side PNG during the exact failure mode where visual evidence is supposed to clarify what happened.

No fix made.

Pass 1 result: complete. S09 still needs a benchmark-loop/real-fixture pass and a final fixtures/harness coverage pass before the sector can close.

### S09 Pass 2 - Trace Benchmark Loop and Real-Fixture Gates

Evidence inspected:

- Trace benchmark orchestrator: `src/__fixtures__/perceptual/trace-benchmark-loop.ts` and `src/__fixtures__/perceptual/trace-benchmark-loop.test.ts`.
- Real-logo benchmark cases: `src/__fixtures__/perceptual/trace-benchmark-regression-cases.ts`, `src/__fixtures__/perceptual/arch-house-baseline.test.ts`, and `src/__fixtures__/perceptual/arch-house-edge-quality.test.ts`.
- Centerline and curve quality acceptance tests: `src/__fixtures__/perceptual/centerline-bar.test.ts` and `src/__fixtures__/perceptual/edge-curve-quality.test.ts`.
- Tracked fixture state for `audit/fixtures/trace/arch-house-langebaan-source.png`.
- Ignore behavior for `audit/evidence/trace-artifacts/*` and `perceptual-artifacts/*`.

Verification:

- Focused S09 pass-2 command passed: `pnpm exec vitest run src/__fixtures__/perceptual/trace-benchmark-loop.test.ts src/__fixtures__/perceptual/arch-house-baseline.test.ts src/__fixtures__/perceptual/arch-house-edge-quality.test.ts src/__fixtures__/perceptual/edge-curve-quality.test.ts src/__fixtures__/perceptual/centerline-bar.test.ts`.
- Result: 5 test files passed, 23 tests passed.
- Live benchmark highlights from the run: Arch House Line Art fixture decoded as `1024x1024`, produced 83 closed polylines, 0 open polylines, 51 hole candidates, 13,889 points, bottom-word ink of 3,215 pixels, and mask IoU 0.955. Arch House Edge Detection produced 0 tiny closed polylines, aggregate arch coverage 1.0, longest arch coverage about 0.705, and dark doorway fill ratio 0.285.

Findings:

#### S09-004 - The active real-logo benchmark fixture lives under `audit/fixtures`, mixing test-fixture ownership with audit evidence

Severity: Low.

Evidence:

- `src/__fixtures__/perceptual/trace-artifact-runner.ts:121-123` defaults required real-logo fixture discovery to `join(process.cwd(), 'audit', 'fixtures', 'trace')`.
- `git ls-files audit/fixtures/trace` returned tracked fixture `audit/fixtures/trace/arch-house-langebaan-source.png`.
- `src/__fixtures__/perceptual/arch-house-baseline.test.ts:29-34` requires that fixture to be present and decodable before running the Line Art acceptance gate.
- `src/__fixtures__/perceptual/arch-house-baseline.test.ts:57-65` asserts the active fixture's fixed image size and traced metric bands.
- `src/__fixtures__/perceptual/arch-house-edge-quality.test.ts:16-18`, `src/__fixtures__/perceptual/arch-house-edge-quality.test.ts:44-46`, and `src/__fixtures__/perceptual/arch-house-edge-quality.test.ts:67-69` also depend on the same audit fixture path.
- `src/__fixtures__/perceptual/trace-benchmark-loop.ts:78-86` includes the real-logo Edge Detection and Line Art cases in the current benchmark loop.

Risk:

The real-logo PNG is functionally a test fixture, but it is stored in the audit evidence tree rather than alongside the fixture harness under `src/__fixtures__`. Future cleanup, archiving, or sector-specific maintenance of `audit/**` can accidentally remove or replace a file that is now required for normal benchmark tests. It also hides an active test input outside the fixture sector's primary source tree.

No fix made.

#### S09-005 - The Arch House opt-in trace evidence writer uses an unignored `audit/evidence/trace-artifacts` output path

Severity: Low.

Evidence:

- `.gitignore:18-19` ignores only `perceptual-artifacts/` for `PERCEPTUAL_ARTIFACTS=1` render dumps.
- `src/__fixtures__/perceptual/arch-house-baseline.test.ts:21` sets `EVIDENCE_DIR` to `audit/evidence/trace-artifacts`.
- `src/__fixtures__/perceptual/arch-house-baseline.test.ts:52-54` writes trace artifact evidence to that directory when `PERCEPTUAL_ARTIFACTS === '1'`.
- `src/__fixtures__/perceptual/trace-artifact-runner.ts:108-118` creates the output directory and writes `.metrics.json` and `.overlay.svg` files.
- `git check-ignore -v audit/evidence/trace-artifacts/example.metrics.json audit/evidence/trace-artifacts/example.overlay.svg perceptual-artifacts/example.png` only reported an ignore match for `perceptual-artifacts/example.png`, not for the audit/evidence trace-artifact outputs.

Risk:

Running the Arch House acceptance test with the same opt-in flag used by the ignored perceptual PNG writer can create untracked files under `audit/evidence/trace-artifacts`. That makes evidence mode behave inconsistently: some artifacts are intentionally ignored, while this benchmark's outputs dirty the audit tree unless the maintainer knows to clean or stage them.

No fix made.

Pass 2 result: complete. S09 still needs one remaining-gap pass across fixture helper coverage, PNG decoding/encoding edges, generated evidence inventory, and architecture closure before the sector can close.

### S09 Pass 3 - Remaining Fixture Helper Coverage and Closure

Evidence inspected:

- Remaining fixture helper inventory under `src/__fixtures__/perceptual/**`, including centerline truth/deviation/geometry, edge truth/curve truth, `gcode-rasterize.ts`, `png-decode.ts`, `png.ts`, `import-fidelity.ts`, `shapes.ts`, and trace fixtures.
- Test linkage for helpers using sibling-test inventory and `rg` over fixture helper imports.
- Centerline performance budget test and live timing output.
- G-code rasterizer parser and the fill toolpath tests that exercise it.
- PNG decoder chunk/unfilter path and its current consumers.

Verification:

- Broad S09 pass-3 command passed: `pnpm exec vitest run src/__fixtures__/perceptual`.
- Result: 11 test files passed, 71 tests passed.
- The run included the centerline performance fixture; it logged `[centerline-perf] 1600x1200 stroke24: 1296ms, paths=1`.

Findings:

#### S09-006 - The centerline performance regression test uses the worker timeout as its only budget despite a much lower stated target and current runtime

Severity: Medium.

Evidence:

- `src/__fixtures__/perceptual/centerline-perf.test.ts:38` sets `BUDGET_MS = 30_000` with the comment `the worker ceiling; the rework target is < ~3s`.
- `src/__fixtures__/perceptual/centerline-perf.test.ts:41-49` traces a 1600x1200 grid and only asserts `elapsedMs < BUDGET_MS`.
- The S09 pass-3 run logged the same fixture at about 1,296 ms on this machine.
- `audit/reports/high-priority-image-burn-roadmap-plan-2026-06-03.md:711` documents the same 30,000 ms value as a trace worker timeout rather than a desired performance budget.

Risk:

A regression from roughly 1.3 seconds to 20-29 seconds would still pass the current performance test even though it would be a major user-visible delay and far above the stated rework target. The test currently guards only against hitting the worker ceiling, not against losing the performance headroom the fixture is meant to protect.

No fix made.

#### S09-007 - The minimal PNG decoder has no dedicated malformed/unsupported-file tests even though it gates the real-logo benchmark fixture

Severity: Low.

Evidence:

- `src/__fixtures__/perceptual/png-decode.ts:29-42` decodes PNG bytes and throws for bad signatures, unsupported bit depth, interlacing, and unsupported color types.
- `src/__fixtures__/perceptual/png-decode.ts:45-69` parses chunks with default `width`, `height`, `bitDepth`, `colorType`, and `interlace` values, and does not validate CRCs, required chunk presence, or complete chunk bounds.
- `src/__fixtures__/perceptual/png-decode.ts:109-125` unfilters rows while treating missing raw bytes as zero via `?? 0`.
- `rg -n "decodePng\\(|decodePngFile|png-decode.test|rasterizeGcodeBurn\\(|parseWords|GcodeRasterize|centerline-perf" src/__fixtures__/perceptual --glob "*.test.ts" --glob "*.ts"` found decoder consumers in the real-logo tests and benchmark cases, but no dedicated `png-decode` test file or malformed-PNG assertions.

Risk:

The happy path is covered by the tracked Arch House PNG, but corrupted, truncated, or unsupported fixture files may fail with opaque zlib/chunk errors or decode into misleading empty/default data before the trace tests report their real cause. This is low-risk for normal runs but weakens the fixture gate that is supposed to make real-image evidence trustworthy.

No fix made.

#### S09-008 - The emitted-G-code burn rasterizer has no direct parser tests beyond three generated GRBL fill fixtures

Severity: Low.

Evidence:

- `src/__fixtures__/perceptual/gcode-rasterize.ts:26-42` exposes `rasterizeGcodeBurn(...)` for emitted G-code comparison.
- `src/__fixtures__/perceptual/gcode-rasterize.ts:45-55` parses each stripped line, applies modal laser state and motion, and rasterizes only armed `G1` moves.
- `src/__fixtures__/perceptual/gcode-rasterize.ts:95-107` strips only semicolon comments and parses words with `/([A-Za-z])\s*(-?(?:\d+\.?\d*|\.\d+))/g`, so parser behavior for parentheses comments, plus-signed values, exponent notation, malformed words, modal-only lines, and alternate dialect output is unpinned.
- `src/__fixtures__/perceptual/toolpath-rasterize.test.ts:27-97` exercises `rasterizeGcodeBurn(...)` only through three `grblStrategy.emit(...)` fill jobs: solid square, annulus, and cross-hatch square.
- The Pass 3 import scan found no dedicated `gcode-rasterize.test.ts` or direct parser-semantics tests.

Risk:

The helper is used as the independent outside-in check for emitted burn output, but its own G-code parser semantics are only indirectly covered by current GRBL fill output. Future emitter changes, alternate dialect checks, or less common numeric/comment forms could be mis-rendered by the harness, making a G-code fidelity failure look like a burn-shape regression or hiding one entirely.

No fix made.

Pass 3 result: complete. S09 is fully audited after three passes. All sectors S01-S09 are complete, and no major repository area remains unchecked at the sector level.

## Fix Phase 1 After-Fix Audit - High-Severity Findings

Date: 2026-07-03.

Scope:

- Fixed the four high-severity findings only: S02-001, S03-001, S03-002, and S05-004.
- Left all medium- and low-severity findings open for later fix passes.
- Preserved the existing dirty worktree; no unrelated source files were reverted.

Changes audited:

- S02-001: `public/_headers` now sets `Permissions-Policy` camera access to `camera=(self)` while keeping `microphone=()` denied. `electron/csp-policy.test.ts` now pins that web header contract.
- S03-001: `electron/rtsp-camera-bridge.ts` now treats `https://kerfdesk.com` as a trusted hosted app origin for RTSP bridge CORS, and `electron/rtsp-camera-bridge.test.ts` pins it.
- S03-002: `electron/trusted-renderer-policy.ts` now grants trusted main-frame video-only Chromium `media` permission checks/requests and continues to deny audio. `electron/main.ts` passes Electron's `mediaType` and `mediaTypes` details into that policy. `electron/trusted-renderer-policy.test.ts` pins video allowed/audio denied.
- S05-004: `src/core/preflight/pre-emit.ts` now checks every matching image operation layer for every output raster image instead of only the first match. `src/core/preflight/pre-emit.test.ts` adds a regression where a safe first image operation is followed by an oversized image sub-layer.

Verification:

- Passed: `pnpm exec vitest run electron/csp-policy.test.ts electron/trusted-renderer-policy.test.ts electron/rtsp-camera-bridge.test.ts src/core/preflight/pre-emit.test.ts` - 4 files, 21 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint:electron`.
- Passed: `pnpm exec vitest run src/ui/laser/start-job-readiness.test.ts src/ui/laser/start-frame-raster-budget.test.tsx src/core/preflight src/core/raster/raster-budget.test.ts` - 9 files, 75 tests.
- After-fix static check confirmed `public/_headers` contains `camera=(self)` and `microphone=()`, RTSP bridge CORS includes `kerfdesk.com`, Electron permission policy uses `mediaType`/`mediaTypes`, and pre-emit no longer uses the old first-match layer lookup.

Result:

- Fixed: S02-001, S03-001, S03-002, S05-004.
- Remaining open findings: 73, all medium or low severity.

## Fix Phase 2 After-Fix Audit - Camera, RTSP, and Profile Validation Findings

Date: 2026-07-03.

Scope:

- Fixed seven camera/RTSP/profile validation findings: S03-003, S03-004, S03-005, S04-001, S04-002, S04-003, and S07-002.
- Preserved unrelated dirty worktree changes and did not revert pre-existing camera/profile work.
- Left the remaining medium/low findings open for later fix passes.

Changes audited:

- S03-003: `electron/rtsp-camera-bridge.ts` now resolves RTSP DESCRIBE probes as soon as a complete response header/body is buffered, including `Content-Length`-bounded SDP bodies, instead of waiting only for socket `end`.
- S03-004: `electron/rtsp-camera-bridge.ts` now defers MJPEG HTTP 200 headers until FFmpeg emits preview bytes, returns a 502 JSON error if FFmpeg fails before streaming, destroys an already-started stream on child errors, drains stderr, and cleans up the child on client close.
- S03-005: `electron/rtsp-camera-bridge-policy.ts` now requires IPv4-looking host parts to be decimal octets in `0..255`.
- S04-001: `src/core/camera/camera-profile.ts` now validates RTSP camera sources against the same loopback/private-network host family accepted by the local bridge instead of accepting any `rtsp://` URL.
- S04-002: `src/core/camera/camera-transform.ts` now rejects near-collinear alignment point clouds and rejects solved transforms whose machine/image residuals exceed fixed thresholds.
- S04-003: `src/core/devices/profile-catalog.ts` now enforces that the `camera` capability and `cameraProfile` metadata are present together.
- S07-002: `src/platform/web/camera-bridge.ts` now validates unknown bridge JSON before returning a typed `CameraBridgeProbeResult`, including rejecting malformed `ok` payloads.

Verification:

- Passed: `pnpm exec vitest run electron/rtsp-camera-bridge.test.ts electron/rtsp-camera-bridge-policy.test.ts src/core/camera/camera-profile.test.ts src/core/devices/profile-catalog.test.ts src/io/machine-profile/machine-profile-camera.test.ts src/io/project/project-camera-profile.test.ts src/platform/web/camera-bridge.test.ts` - 7 files, 28 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint:electron`.
- Passed: `pnpm exec vitest run src/ui/laser/MachineSetupDialog.test.tsx src/ui/laser/device-setup/device-setup-readiness.test.ts src/ui/laser/MachineSetupCameraPreview.test.tsx src/io/project/project-camera-profile.test.ts src/io/machine-profile/machine-profile-camera.test.ts` - 5 files, 28 tests.
- After-fix static audit confirmed the old socket-end-only probe path is gone, FFmpeg streaming no longer writes HTTP 200 before first output, malformed RTSP IPv4-like hosts are rejected in bridge and core profile tests, camera capability/profile consistency is pinned, and the browser bridge client no longer trusts a raw JSON cast.

Result:

- Fixed in this pass: S03-003, S03-004, S03-005, S04-001, S04-002, S04-003, S07-002.
- Total fixed findings: 11.
- Remaining open findings: 66 (44 medium, 22 low).

## Fix Phase 3 After-Fix Audit - Numeric and Finite-Value Invariant Findings

Date: 2026-07-03.

Scope:

- Fixed five numeric/finite-value invariant findings: S04-004, S04-005, S04-010, S04-012, and S05-003.
- Kept the fixes bounded to controller command/parsing guards, scene transform edit validation, preflight speed checks, and output/raster feed guards.
- Left the remaining medium/low findings open for later fix passes.

Changes audited:

- S04-004: `src/core/controllers/grbl/commands.ts` now rejects non-finite jog axes and feed values before building `$J=` firmware text. The laser store already clears the active jog operation if this builder throws.
- S04-005: `src/core/controllers/grbl/response.ts` and `src/core/controllers/grbl/status-parser.ts` now require full numeric tokens for `ALARM:N` and status substates, so `ALARM:9x` and `Hold:1x` no longer become real alarm/substate codes.
- S04-010: `src/core/controllers/grbl/grbl-setting-write.ts` now accepts only canonical decimal GRBL setting literals for guarded writes and requires `$32` to be exactly `0` or `1`.
- S04-012: `src/core/scene/selection-transform.ts` now rejects non-finite position, nudge, resize, and rotation edits instead of emitting transforms with `NaN`/`Infinity`; `src/ui/commands/NumericEditsBar.tsx` surfaces the new invalid-number reason.
- S05-003: `src/core/preflight/preflight.ts` now treats non-finite layer speeds as `speed-out-of-range`. `src/core/output/grbl-strategy.ts` and `src/core/raster/emit-raster.ts` now fail closed before emitting non-finite or non-positive feed words.

Verification:

- Passed: `pnpm exec vitest run src/core/controllers/grbl/commands.test.ts src/core/controllers/grbl/grbl-setting-write.test.ts src/core/controllers/grbl/response.test.ts src/core/controllers/grbl/status-parser.test.ts src/core/scene/selection-transform.test.ts src/core/preflight/preflight.test.ts src/core/output/grbl-strategy.test.ts src/core/raster/emit-raster.test.ts` - 8 files, 115 tests.
- Passed: `pnpm exec vitest run src/core/controllers/grbl/commands.test.ts src/core/controllers/grbl/grbl-setting-write.test.ts src/core/controllers/grbl/response.test.ts src/core/controllers/grbl/status-parser.test.ts src/core/scene/selection-transform.test.ts src/core/preflight/preflight.test.ts src/core/output/grbl-strategy.test.ts src/core/raster/emit-raster.test.ts src/ui/commands/NumericEditsBar.test.tsx src/ui/state/selection-transform-actions.test.ts src/core/controllers/grbl/parse-settings.test.ts` - 11 files, 140 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit confirmed jog command formatting no longer accepts non-finite inputs, guarded setting writes reject exponent/hex/plus/dot-only forms, coded GRBL suffix parsing is full-token, selection transform edits return errors for non-finite edits, preflight flags non-finite layer speeds, and both vector/raster output paths guard feed values before formatting `F...` words.

Result:

- Fixed in this pass: S04-004, S04-005, S04-010, S04-012, S05-003.
- Total fixed findings: 16.
- Remaining open findings: 61 (40 medium, 21 low).

## Fix Phase 4 After-Fix Audit - Raster Preview and ETA Parity Findings

Date: 2026-07-03.

Scope:

- Fixed two raster parity findings: S05-007 and S05-008.
- Kept the changes bounded to route-preview toolpath construction, raster ETA conversion, and focused regression tests.
- Left the remaining medium/low findings open for later fix passes.

Changes audited:

- S05-007: `src/core/job/toolpath.ts` now passes build-toolpath options into raster group preview construction and applies profile-level `scanningOffsets` to reverse raster rows unless a raster group carries an explicit `bidirectionalScanOffsetMm`.
- S05-008: `src/core/job/estimate-duration.ts` now splits raster rows into active spans using the same 5 mm wide-white-gap threshold family as output/preview, so sparse rows are priced as rapid-separated spans rather than one feed sweep from first to last ink.

Verification:

- Passed: `pnpm exec vitest run src/core/job/toolpath-raster.test.ts src/core/job/estimate-duration.test.ts src/core/output/grbl-strategy-scan-offset.test.ts src/core/output/grbl-strategy-raster-calibration.test.ts src/core/raster/emit-raster.test.ts src/core/raster/emit-raster-scan-offset.test.ts src/ui/workspace/draw-preview.parity.test.ts` - 7 files, 62 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit confirmed reverse raster preview rows now use scan-offset compensation from `BuildToolpathOptions.scanningOffsets`, and raster duration conversion no longer collapses wide sparse rows to a single first-to-last ink span.

Result:

- Fixed in this pass: S05-007, S05-008.
- Total fixed findings: 18.
- Remaining open findings: 59 (38 medium, 21 low).

## Fix Phase 5 After-Fix Audit - Main Preflight Operation-Layer Awareness

Date: 2026-07-03.

Scope:

- Fixed S05-005.
- Kept the change scoped to main preflight operation-layer expansion and layer-mode compatibility logic.
- Left malformed raster luma and remaining IO/persistence findings open for later fix passes.

Changes audited:

- S05-005: `src/core/preflight/preflight.ts` now uses `outputOperationLayers(...)` for main output layer checks, layer settings, offset-fill open-contour checks, unsupported raster transform checks, and overscan hint computation.
- `src/core/preflight/layer-mode-preflight.ts` now checks whether an object has any compatible operation layer for its color before reporting `layer-mode-mismatch`, avoiding a false mismatch when a base Line layer has an Image sub-layer for the same raster color.
- `src/core/preflight/preflight-raster.test.ts` now pins both sides of the sub-layer contract: image sub-layers are compatible raster output, and rotated raster images are still caught through image sub-layers.

Verification:

- Passed: `pnpm exec vitest run src/core/preflight/preflight-raster.test.ts src/core/preflight/preflight.test.ts src/core/preflight/pre-emit.test.ts src/core/job/compile-job-raster.test.ts src/core/job/frame-bounds.test.ts src/ui/workspace/draw-raster-preview.test.ts` - 6 files, 69 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit confirmed main preflight now derives operation layers with `outputOperationLayers(...)`, uses the new cross-operation-layer mismatch helper, and computes raster transform/overscan checks from operation layers rather than only top-level layers.

Result:

- Fixed in this pass: S05-005.
- Total fixed findings: 19.
- Remaining open findings: 58 (37 medium, 21 low).

## Fix Phase 6 After-Fix Audit - Malformed Raster Luma Handling

Fixed findings:

- S05-006 - malformed saved raster luma silently degrades to all-white output instead of invalidating the raster/job.

Changes audited:

- `src/io/project/project-raster-luma-validator.ts` now validates present raster `lumaBase64` payloads before deserialization succeeds. The guard checks valid Base64 characters, well-formed terminal padding, impossible Base64 lengths, unused trailing bits, and exact decoded byte length against `pixelWidth * pixelHeight`.
- `src/io/project/project-shape-validator.ts` wires that luma validation into raster object validation after the existing source-pixel cap, so corrupt persisted raster payloads are rejected at project-open time instead of entering scene state.
- `src/core/job/compile-job-raster.ts` now throws on malformed present `lumaBase64` during raster compilation, while preserving the legacy fail-safe where missing luma still compiles as all-white/off output.
- Regression coverage in `src/core/job/compile-job-raster.test.ts` and `src/io/project/project-security-validation.test.ts` covers invalid characters, short decoded luma, and malformed padding that previously matched the byte-count-only path.

Verification:

- Passed: `pnpm exec vitest run src/core/job/compile-job-raster.test.ts src/io/project/project-security-validation.test.ts src/io/project/project.test.ts src/ui/raster/processed-bitmap.test.ts src/core/preflight/preflight-raster.test.ts` - 5 files, 57 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit found and corrected an initial byte-count-only validator weakness before marking the finding fixed; the final pass rejects malformed Base64 shape as well as invalid decoded length.

Result:

- Fixed in this pass: S05-006.
- Total fixed findings: 20.
- Remaining open findings: 57 (36 medium, 21 low).

## Fix Phase 7 After-Fix Audit - Project Loader Capability, Budget, and Scene Integrity

Fixed findings:

- S06-001 - project deserialization accepts unvalidated device capabilities while machine-profile import rejects them.
- S06-003 - project `.lf2` validation lacks a total vector/object/point budget.
- S06-004 - project `.lf2` validation accepts duplicate scene IDs and dangling group references.

Changes audited:

- `src/core/devices/device-profile.ts` now exports the shared `PROFILE_CAPABILITIES` vocabulary, and `src/io/machine-profile/machine-profile-shape.ts` consumes that shared list instead of maintaining a separate local copy.
- `src/io/project/project-device-profile-validator.ts` adds `optionalProfileCapabilities(...)`, and `src/io/project/project-shape-validator.ts` rejects unknown `device.capabilities` tokens during `.lf2` deserialization.
- `src/io/project/project-scene-integrity-validator.ts` adds a pre-shape-validation scene budget for layers, objects, groups, group members, colored paths, polylines, and points. The final after-fix audit moved this budget pass ahead of per-item validation so pathological project files short-circuit before detailed object/layer walking.
- The same integrity validator rejects duplicate object IDs, duplicate layer IDs, duplicate layer colors, duplicate group IDs, dangling group object IDs, and repeated group members after the individual shapes are known to be well formed.
- Regression coverage now includes unknown loaded capabilities, over-budget scene arrays, duplicate layer colors, dangling group references, duplicate object IDs, duplicate group IDs, repeated group members, and the previously dangling group round-trip fixture was corrected to include its member objects.

Verification:

- Passed: `pnpm exec vitest run src/io/project/project-device-profile-metadata.test.ts src/io/project/project-security-validation.test.ts src/io/project/project-groups.test.ts src/io/project/project.test.ts src/io/machine-profile/machine-profile-io.test.ts src/io/machine-profile/machine-profile-camera.test.ts src/core/devices/device-profile.test.ts src/core/devices/profile-catalog.test.ts` - 8 files, 75 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit found and corrected an initial ordering weakness where the new scene budget ran after detailed shape validation; the final wiring checks `validateSceneBudgets(scene)` before layer/object/group item validation and then runs identity integrity checks afterward.

Result:

- Fixed in this pass: S06-001, S06-003, S06-004.
- Total fixed findings: 23.
- Remaining open findings: 54 (33 medium, 21 low).

## Fix Phase 8 After-Fix Audit - SVG Import Budget and Symbol-Use Fidelity

Fixed findings:

- S06-002 - SVG import has no total geometry, point-count, or finite-coordinate budget before materializing imported vectors.
- S06-005 - SVG `<use>` imports can drop common `<symbol>` sprite geometry because referenced symbols are skipped like inert definitions.

Changes audited:

- `src/io/svg/svg-import-budget.ts` centralizes SVG import limits for color groups, polylines, points, and coordinate magnitude, plus shared budget and coordinate assertion helpers.
- `src/io/svg/parse-svg.ts` now creates an import budget for each parse, reserves color/polyline/point budget before appending imported geometry, validates transformed points and resolved bounds, and keeps `<defs>`/`<symbol>` inert during normal document walks while expanding their children when reached through a safe local `<use>`.
- `src/io/svg/parse-path-d.ts` now enforces the shared point ceiling while path commands create subpaths and flattened curve/arc points.
- `src/io/svg/shape-to-polylines.ts` now parses `points="..."` incrementally and enforces the shared point ceiling instead of first materializing an unbounded number list.
- Regression coverage in `src/io/svg/parse-svg.test.ts` covers color-group budget rejection and extreme-coordinate rejection; `src/io/svg/parse-svg-presentation-state.test.ts` covers `<use>` references to `<symbol>` children.

Verification:

- Passed: `pnpm exec vitest run src/io/svg/parse-svg.test.ts src/io/svg/parse-svg-presentation-state.test.ts src/io/svg/sanitize.test.ts src/io/svg/malicious-corpus.test.ts src/io/svg/shape-to-polylines.test.ts src/io/svg/parse-path-d.test.ts` - 6 files, 74 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit confirmed the budget helper was extracted below the 400-line guard, SVG bounds/transformed points are range-checked, safe local symbol references now walk their child geometry, and lower-level path/point-list construction has a shared point ceiling.

Result:

- Fixed in this pass: S06-002, S06-005.
- Total fixed findings: 25.
- Remaining open findings: 52 (31 medium, 21 low).

## Fix Phase 9 After-Fix Audit - Platform Save, Serial, and Deploy-Policy Guards

Fixed findings:

- S07-001 - web save streams are not closed or aborted when a file write fails.
- S07-003 - Web Serial line-size guard only limits unterminated partial lines, not huge newline-terminated records.
- S07-004 - deploy policy tests do not pin all current pre-publish gates.
- S07-005 - web save workflow promises a browser-download fallback that the platform adapter does not implement.
- S07-006 - Web Serial stale-open recovery paths are not covered by regression tests.

Changes audited:

- `src/platform/web/web-adapter.ts` now gates web save on `window.showSaveFilePicker`, reports a clear File System Access API requirement when unsupported, and wraps writable-stream writes in `writeAndClose(...)` so failed writes or closes best-effort abort the stream before rethrowing.
- `src/platform/web/web-adapter.test.ts` covers failed write cleanup and the unsupported-save-API error.
- `src/platform/web/web-serial.ts` now drops newline-terminated serial records that exceed the 64 KiB line guard before they reach subscribers, while preserving the existing over-length partial-line drop.
- `src/platform/web/web-serial.test.ts` now covers huge newline-terminated records, stale paired-port closure before `requestPort()`, and the already-open close-and-retry path.
- `src/platform/web/deploy-workflow-gate.test.ts` now requires `pnpm audit:deps` and `pnpm check:file-size` before the Wrangler publish step.
- `WORKFLOW.md` no longer promises a browser-download fallback for web saves; it documents the Chromium File System Access API requirement and the absence of browser-download/IndexedDB fallback paths.

Verification:

- Passed: `pnpm exec vitest run src/platform/web/web-adapter.test.ts src/platform/web/web-serial.test.ts src/platform/web/deploy-workflow-gate.test.ts src/platform/web/repo-policy.test.ts src/platform/web/camera-bridge.test.ts src/platform/web/cloudflare-pages-routing.test.ts src/platform/web/favicon.test.ts src/platform/web/pwa-precache.test.ts` - 8 files, 36 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit confirmed failed save streams abort, huge newline serial records are skipped before subscriber delivery, deploy gate assertions now include the missing pre-publish commands, and stale-open serial recovery has direct tests.

Result:

- Fixed in this pass: S07-001, S07-003, S07-004, S07-005, S07-006.
- Total fixed findings: 30.
- Remaining open findings: 47 (26 medium, 21 low).

## Fix Phase 10 After-Fix Audit - UI Command, PWA, and Path-Node Guards

Fixed findings:

- S08-001 - Focus Test can be enabled even though the real command only displays a not-implemented alert.
- S08-003 - the PWA update prompt can offer reload while `done` or `errored` streamer states still need operator handling.
- S08-007 - path-node hit testing ignores hidden layer visibility.

Changes audited:

- `src/ui/commands/use-app-commands.ts` no longer marks Focus Test available from device Z-capability metadata alone; the context reports it unavailable until a real generator exists.
- `src/ui/commands/command-families.ts` now returns a disabled Focus Test command with the same dedicated, hardware-verified Z-motion generator reason used by the shell fallback.
- `src/ui/app/PwaUpdatePrompt.tsx` now uses the shared `isActiveJob(...)` helper, so update reload prompts stay hidden for `streaming`, `paused`, `done`, and `errored` streamer states.
- `src/ui/workspace/path-node-hit-test.ts` now builds the scene layer map, skips objects without any visible layer, and skips individual colored paths whose layer is hidden before returning editable node hits.
- Regression coverage in `src/ui/app/PwaUpdatePrompt.test.tsx`, `src/ui/commands/command-registry.test.ts`, and `src/ui/workspace/path-node-hit-test.test.ts` covers `done`/`errored` prompt suppression, the disabled Focus Test path even with advertised Z support, and hidden-layer path-node misses.

Verification:

- Passed: `pnpm exec vitest run src/ui/app/PwaUpdatePrompt.test.tsx src/ui/commands/command-registry.test.ts src/ui/commands/command-lock.test.ts src/ui/workspace/path-node-hit-test.test.ts src/ui/workspace/draw-scene-path-node-handles.test.ts` - 5 files, 44 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit corrected an initial complexity-cap lint failure in the node-hit helper split, then confirmed Focus Test cannot route to the dead-end action, the PWA guard uses the canonical active-job definition, and hidden path layers are ignored even when the same imported object still has another visible path.

Result:

- Fixed in this pass: S08-001, S08-003, S08-007.
- Total fixed findings: 33.
- Remaining open findings: 44 (23 medium, 21 low).

## Fix Phase 11 After-Fix Audit - Workspace Drag Hook Event-Pipeline Coverage

Fixed findings:

- S08-004 - the workspace drag hook lacked direct event-pipeline coverage.

Changes audited:

- `src/ui/workspace/use-workspace-drag-hook.test.tsx` adds a React canvas harness around the real `useDragMove(...)` hook, using a stable canvas bounding rect and the real Zustand stores rather than testing only pure helper functions.
- The new measure-drag regression dispatches mouse down, mouse move, and mouse up through the hook and verifies measure draft/cursor state updates through the UI/app stores.
- The new object-drag regression selects a real rectangle, dispatches mouse down and mouse move through the hook, verifies the object transform updates, then dispatches the React-backed mouse-leave path through `mouseout` and verifies `pendingUndo` clears and an undo entry is committed.

Verification:

- Passed: `pnpm exec vitest run src/ui/workspace/use-workspace-drag.test.ts src/ui/workspace/use-workspace-drag-hook.test.tsx src/ui/workspace/drag-state.test.ts src/ui/workspace/draw-tool.test.ts src/ui/workspace/path-node-drag.test.ts` - 5 files, 31 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit corrected the initial test fixture so it clicks the selected object's interior instead of a scale handle, and corrected the synthetic mouse-leave event to use the `mouseout` event React maps to `onMouseLeave`.

Result:

- Fixed in this pass: S08-004.
- Total fixed findings: 34.
- Remaining open findings: 43 (22 medium, 21 low).

## Fix Phase 12 After-Fix Audit - Workspace View-Transform Coordinate Guards

Fixed findings:

- S08-005 - workspace view transform and event-coordinate math could produce invalid scene coordinates.

Changes audited:

- `src/ui/workspace/view-transform.ts` now clamps tiny or malformed canvas/device dimensions to a finite positive usable area, normalizes invalid zoom/pan inputs, and guarantees `computeView(...)` returns a finite positive scale.
- `canvasMouseToScene(...)` and `clientToCanvasPx(...)` now return `null` for zero, negative, or non-finite canvas CSS/device dimensions instead of dividing through invalid rects.
- `zoomAtCursorPx(...)` now ignores non-finite or non-positive zoom factors and normalizes invalid view state before computing anchored zoom.
- `src/ui/workspace/drag-state.ts` now keeps pan at its drag-start offset when canvas CSS scale or view scale is unusable, avoiding `NaN`/`Infinity` pan propagation.
- Regression coverage in `src/ui/workspace/view-transform.test.ts` and `src/ui/workspace/drag-state.test.ts` covers tiny/malformed dimensions, unmeasurable event conversion, invalid zoom factors, and pan fallback for zero CSS scale.

Verification:

- Passed: `pnpm exec vitest run src/ui/workspace/view-transform.test.ts src/ui/workspace/drag-state.test.ts src/ui/workspace/use-workspace-drag-hook.test.tsx src/ui/workspace/use-workspace-drag.test.ts` - 4 files, 29 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit confirmed the conversion helpers now return finite values or `null`, and the pan path no longer divides by invalid CSS/view scales.

Result:

- Fixed in this pass: S08-005.
- Total fixed findings: 35.
- Remaining open findings: 42 (21 medium, 21 low).

## Fix Phase 13 After-Fix Audit - Selected-Output Frame Fallback and Keyboard Motion Stop

Fixed findings:

- S08-008 - Frame fallback for over-budget rasters ignored selected-output scope.
- S08-009 - `Ctrl/Cmd+.` did not stop active frame or jog motion.

Changes audited:

- `src/ui/laser/use-frame-action.ts` now filters the scene through `filterSceneForOutputScope(...)` before computing cheap Frame fallback bounds, so over-budget raster fallback uses the same selected-output object scope that `prepareOutput(...)` uses.
- `src/ui/laser/start-frame-raster-budget.test.tsx` now covers a selected over-budget raster with unrelated output-enabled raster artwork elsewhere in the scene; Frame dispatches the selected raster bounds only.
- `src/ui/laser/use-job-shortcuts.ts` now routes `Ctrl/Cmd+.` through a dedicated stop helper that calls `stopJob()` for active streamer jobs and `cancelJog()` for active frame/jog motion operations.
- `src/ui/laser/use-job-shortcuts.test.ts` now covers the active frame/jog motion case and confirms the shortcut uses `cancelJog()` rather than the stream-job stop path.

Verification:

- Passed: `pnpm exec vitest run src/ui/laser/start-frame-raster-budget.test.tsx src/ui/laser/use-job-shortcuts.test.ts src/ui/laser/JobControls.test.tsx src/ui/laser/LaserWindow.test.tsx src/ui/laser/live-job-estimate.test.ts` - 5 files, 36 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit corrected an initial shortcut complexity-cap lint failure by extracting the stop branch into `handleStopShortcut(...)`, then confirmed the selected-output fallback remains a cheap bounds path and does not call compile for the over-budget raster case.

Result:

- Fixed in this pass: S08-008, S08-009.
- Total fixed findings: 37.
- Remaining open findings: 40 (19 medium, 21 low).

## Fix Phase 14 After-Fix Audit - Trace Worker Send Cleanup and Crop-Boundary Finite Guards

Fixed findings:

- S08-010 - trace worker requests did not clean up or retire the worker when `postMessage(...)` threw synchronously.
- S08-011 - trace boundary dragging could persist non-finite crop rectangles when preview geometry collapsed.

Changes audited:

- `src/ui/trace/use-trace-worker-client.ts` now wraps `worker.postMessage(request)` in `try/catch`; synchronous send failure rejects all pending worker requests through the existing cleanup path and retires the shared worker.
- `src/ui/trace/use-trace-worker-client.test.ts` covers a throwing `postMessage(...)`, verifies rejection, verifies worker termination, and verifies the next request constructs a fresh worker.
- `src/core/trace/trace-boundary.ts` now rejects non-finite image dimensions and non-finite boundary `x`, `y`, `width`, or `height` before rounding/clamping crop rectangles.
- `src/ui/trace/TracePreview.tsx` now treats collapsed/non-finite preview rectangles or image dimensions as no image point, clearing any draft and refusing to emit a boundary change.
- Regression coverage in `src/core/trace/trace-boundary.test.ts` and `src/ui/trace/TracePreview.test.tsx` covers non-finite crop inputs and collapsed preview-frame drags.

Verification:

- Passed: `pnpm exec vitest run src/ui/trace/use-trace-worker-client.test.ts src/core/trace/trace-boundary.test.ts src/ui/trace/TracePreview.test.tsx src/ui/trace/use-trace-preview.test.ts src/ui/trace/trace-options.test.ts` - 5 files, 39 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit confirmed the worker send path clears timers through the pending reject wrappers, terminates the broken shared worker, and trace crop normalization now returns either finite integer crop bounds or `null`.

Result:

- Fixed in this pass: S08-010, S08-011.
- Total fixed findings: 39.
- Remaining open findings: 38 (17 medium, 21 low).

## Fix Phase 15 After-Fix Audit - Selected Artwork Mixed Settings

Fixed findings:

- S08-013 - Selected Artwork Settings treated the first selected object's operation settings as common for a mixed selection.

Changes audited:

- `src/ui/layers/SelectedObjectOperationSettings.tsx` now detects mixed operation settings across all selected artwork before rendering controls.
- Mixed mode/fill-style selects show a disabled `Mixed` state, mixed numeric fields render empty with a `Mixed` placeholder, and mixed checkboxes render indeterminate until the user explicitly edits them.
- Editing a mixed numeric field applies the newly entered value to every selected object instead of silently reusing the first object's old value.
- `src/ui/layers/selected-operation-mixed.ts` centralizes the operation-setting field comparison and covers all `LayerOperationSettings` keys.
- `src/ui/layers/SelectedObjectProperties.test.tsx` now covers a two-object mixed operation selection and verifies that mixed values stay visible until an explicit field edit is committed.

Verification:

- Passed: `pnpm exec vitest run src/ui/layers/SelectedObjectProperties.test.tsx src/ui/layers/CutsLayersPanel.test.tsx src/ui/layers/CutsLayersPanel.cut-settings.test.tsx src/ui/state/object-properties-actions.test.ts` - 4 files, 31 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit corrected an initial type mismatch by separating per-object effective settings from selected-context mixed metadata, then extracted mixed comparison into a pure helper to keep the selected-operation component within lint size limits.

Result:

- Fixed in this pass: S08-013.
- Total fixed findings: 40.
- Remaining open findings: 37 (16 medium, 21 low).

## Fix Phase 16 After-Fix Audit - Image Import and Batch Trace File Boundaries

Fixed findings:

- S08-002 - Image import and multi-file trace used hidden DOM file inputs/download links instead of the platform file boundary.

Changes audited:

- `src/platform/types.ts` extends `FileHandle` with an optional binary `blob()` reader so non-text file workflows can still use `PlatformAdapter`.
- `src/platform/web/web-adapter.ts` now exposes the selected browser `File` through `blob()` while preserving the existing `text()` contract for SVG/project/material imports.
- `src/ui/commands/CommandShell.tsx` no longer renders hidden `<input type="file">` controls for Import Image or Multi-File Trace; both commands now call `PlatformAdapter.pickFilesForOpen(...)` with PNG/JPG/JPEG extensions.
- `src/ui/commands/multi-file-trace-action.ts` no longer owns a DOM download-link fallback for the production path; traced SVGs are written through `writeTraceSvgFileWithPlatform(...)` and `PlatformAdapter.pickFileForSave(...)`.
- `src/ui/commands/CommandShell.file-boundary.test.tsx` verifies the shell has no file inputs and that Import Image and Multi-File Trace route through the platform picker.
- `src/ui/commands/multi-file-trace-action.test.ts` covers the writer contract, cancelled SVG saves, and platform save requests for traced SVG output.

Verification:

- Passed: `pnpm exec vitest run src/ui/commands/CommandShell.file-boundary.test.tsx src/ui/commands/multi-file-trace-action.test.ts src/ui/app/App.mount.test.tsx src/platform/web/web-adapter.test.ts` - 4 files, 17 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit confirmed CommandShell keeps the picker hooks before `useAppCommands(...)`, production image picking now crosses the adapter boundary, and batch trace SVG output writes through platform save targets rather than synthetic anchors.

Result:

- Fixed in this pass: S08-002.
- Total fixed findings: 41.
- Remaining open findings: 36 (15 medium, 21 low).

## Fix Phase 17 After-Fix Audit - Asynchronous Workspace Preview Preparation

Fixed findings:

- S08-006 - Preview preparation still ran synchronously on the workspace UI path.

Changes audited:

- `src/ui/workspace/use-preview-toolpath.ts` now schedules preview toolpath preparation from an effect and cancels stale scheduled work when preview exits or dependencies change, instead of building in render-time `useMemo(...)`.
- The hook now memoizes output-scope dependencies from primitive store selectors, avoiding re-preparation churn from a fresh `currentOutputScope(...)` object on hook-local state updates.
- `src/ui/workspace/draw-scene.ts` no longer falls back to `buildPreviewToolpath(project)` from the canvas draw path; preview route drawing only uses an already prepared toolpath.
- `src/ui/workspace/draw-raster-preview.ts` now schedules first-time raster preview canvas generation into the preview cache and triggers a redraw when ready, rather than calling `buildProcessedRasterBitmap(...)`, creating an offscreen canvas, and writing `ImageData` inside the draw call.
- Regression coverage in `src/ui/workspace/use-preview-toolpath.test.tsx`, `src/ui/workspace/draw-scene-preview-async.test.ts`, and `src/ui/workspace/draw-raster-preview-async.test.ts` covers scheduled/cancelled toolpath builds, absence of draw-loop preview compilation, and deferred raster preview cache generation.

Verification:

- Passed: `pnpm exec vitest run src/ui/workspace/use-preview-toolpath.test.tsx src/ui/workspace/draw-scene-preview-async.test.ts src/ui/workspace/draw-raster-preview.test.ts src/ui/workspace/draw-raster-preview-async.test.ts src/ui/workspace/draw-preview.test.ts src/ui/workspace/draw-preview-complexity.test.ts src/ui/workspace/use-preview-playback.test.tsx` - 7 files, 27 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit corrected an initial hook scheduling loop by stabilizing output-scope dependencies, and split the new raster async regression into its own test file to keep lint line caps intact.

Result:

- Fixed in this pass: S08-006.
- Total fixed findings: 42.
- Remaining open findings: 35 (14 medium, 21 low).

## Fix Phase 18 After-Fix Audit - Welded Vector Output Metadata

Fixed findings:

- S04-011 - Welding vector objects dropped object-level output metadata such as operation overrides and power scale.

Changes audited:

- `src/core/geometry/vector-path-tools.ts` now preserves common `locked`, `operationOverride`, and `powerScale` metadata when welding selected vector objects.
- The same core boundary now rejects weld input with mixed object-level output metadata instead of silently dropping all metadata or inheriting the first object's burn settings.
- `src/ui/commands/selection-command-state.ts` uses the same metadata-compatibility predicate to disable Weld for incompatible selected vector objects before the store action runs.
- `src/ui/state/vector-path-actions.ts` remains fail-closed through the existing core exception catch, leaving mixed-metadata selections unchanged if invoked directly.
- Regression coverage in `src/core/geometry/vector-path-tools.test.ts`, `src/ui/commands/selection-command-state.test.ts`, and `src/ui/state/vector-path-actions.test.ts` covers metadata preservation, mixed-metadata refusal, command gating, and store no-op behavior.

Verification:

- Passed: `pnpm exec vitest run src/core/geometry/vector-path-tools.test.ts src/ui/state/vector-path-actions.test.ts src/ui/commands/selection-command-state.test.ts src/ui/commands/command-vector-path-tools.test.ts` - 4 files, 13 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit corrected the command-side filter to use an explicit `VectorSceneObject` type predicate so the core compatibility helper receives only vector path objects.

Result:

- Fixed in this pass: S04-011.
- Total fixed findings: 43.
- Remaining open findings: 34 (13 medium, 21 low).

## Fix Phase 19 After-Fix Audit - Active No-Go-Zone Preflight Parser Consolidation

Fixed findings:

- S05-001 - Active no-go-zone preflight used a simplified duplicate parser while the fuller modal-aware implementation was unused.

Changes audited:

- `src/core/preflight/preflight.ts` now calls the modal-aware `findNoGoZoneCollisions(...)` from `src/core/preflight/no-go-zones.ts`, passing machine bounds and any trusted motion offset.
- The old simplified `src/core/preflight/no-go-zone-preflight.ts` duplicate parser was removed so the safety path has one implementation.
- The active no-go-zone helper now handles enabled-zone filtering, bed intersection filtering, modal `G90`/`G91` state, absolute moves, relative moves, and motion offsets in the path used by `runPreflight(...)`.
- `src/core/preflight/no-go-zones.test.ts` now covers modal relative motion that crosses a no-go zone; this is the stale/manual G-code class the simpler active parser could miss.

Verification:

- Passed: `pnpm exec vitest run src/core/preflight/no-go-zones.test.ts src/core/preflight/preflight.test.ts src/core/job/frame-preflight.test.ts src/ui/laser/start-job-readiness.test.ts src/ui/laser/use-frame-action.test.ts` - matched 4 files, 58 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit confirmed `findNoGoZoneCollisions(...)` is now defined in one core preflight helper and imported only by active preflight.

Result:

- Fixed in this pass: S05-001.
- Total fixed findings: 44.
- Remaining open findings: 33 (12 medium, 21 low).

## Fix Phase 20 After-Fix Audit - S09 Fixture and Performance Gates

Fixed findings:

- S09-001 - Required Arch House fixture discovery accepted non-PNG files even though consumers decode PNG.
- S09-006 - Centerline performance regression test used only the broad worker timeout as its effective budget.

Changes audited:

- `src/__fixtures__/perceptual/trace-artifact-runner.ts` now recognizes only `arch-house-langebaan-source.png` as the required real-logo fixture, matching `decodePngFile(...)` consumers.
- `src/__fixtures__/perceptual/trace-artifacts.test.ts` now proves a same-stem `.jpg` file does not satisfy the required fixture gate.
- `src/__fixtures__/perceptual/centerline-perf.test.ts` now separates the 30 second worker ceiling from an 8 second regression budget and asserts both.

Verification:

- Passed: `pnpm exec vitest run src/__fixtures__/perceptual/trace-artifacts.test.ts src/__fixtures__/perceptual/centerline-perf.test.ts src/__fixtures__/perceptual/trace-benchmark-loop.test.ts src/__fixtures__/perceptual/arch-house-baseline.test.ts src/__fixtures__/perceptual/arch-house-edge-quality.test.ts` - 5 files, 25 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- After-fix static audit confirmed the old non-PNG extension whitelist is gone and the centerline perf test has an explicit regression assertion below the worker timeout.

Result:

- Fixed in this pass: S09-001, S09-006.
- Total fixed findings: 46.
- Remaining open findings: 31 (10 medium, 21 low).

## Fix Phase 21 After-Fix Audit - S02 Tooling and Release Gates

Fixed findings:

- S02-002 - Raw physical line backstop only scanned `src/`.
- S02-003 - Runtime engine declarations were looser than the CI/deploy toolchain.
- S02-004 - Release verification was duplicated across local, CI, and deploy gates.

Changes audited:

- `scripts/check-file-size-policy.mjs` now scans `src`, `electron`, `scripts`, `audit/scripts`, and root TypeScript/JavaScript config files.
- `package.json` now requires Node `>=22.13.0` and pnpm `>=11.3.0 <12`, matching the Node 22/pnpm 11 release path already documented in CI.
- `.github/workflows/ci.yml` and `.github/workflows/deploy.yml` now call the shared `pnpm release:check` gate instead of duplicating every verification command inline.
- Workflow policy tests now assert that CI/deploy use `release:check` and that the shared script still contains the repo guard, typecheck, lint, Electron lint, format, license, dependency audit, tests, builds, and file-size gate.
- Release-gate cleanup kept adjacent checks green by using valid raster-luma fixtures in job-intent tests, splitting exported toolpath types out of `toolpath.ts` to preserve line discipline, and omitting undefined Electron media-permission fields under `exactOptionalPropertyTypes`.

Verification:

- Passed: `pnpm check:file-size`.
- Passed: `pnpm exec vitest run src/platform/web/deploy-workflow-gate.test.ts src/platform/web/repo-policy.test.ts src/ui/laser/job-intent-warnings.test.ts` - 3 files, 24 tests.
- Passed: `pnpm exec vitest run src/core/job/toolpath.test.ts src/ui/workspace/draw-preview.test.ts src/ui/workspace/preview-scene-frame.test.ts src/ui/workspace/preview-overlays.test.tsx` - 4 files, 33 tests.
- Passed: `pnpm exec vitest run electron/trusted-renderer-policy.test.ts electron/csp-policy.test.ts` - 2 files, 11 tests.
- Passed: `pnpm build:electron-main`.
- Passed: `pnpm release:check` end to end: repo guard, TypeScript, ESLint, Electron lint, Prettier, license check, dependency audit, 423 test files / 2641 tests, web build, Electron main build, and expanded file-size backstop.
- After-fix static audit confirmed CI/deploy now call `pnpm release:check`, the shared script still includes `pnpm check:file-size`, engines are aligned to the Node 22/pnpm 11 release path, and the file-size script no longer limits coverage to `src`.

Result:

- Fixed in this pass: S02-002, S02-003, S02-004.
- Total fixed findings: 49.
- Remaining open findings: 28 (7 medium, 21 low).

## Fix Phase 22 After-Fix Audit - S01 Governance and Documentation Contracts

Fixed findings:

- S01-001 - Product/release naming was split across LaserForge and KerfDesk contract surfaces.
- S01-002 - README ADR index described a stale 26-ADR range.
- S01-003 - Release/test status in README and `AUDIT.md` was stale relative to the current inventory and phase scope.
- S01-004 - `WORKFLOW.md` still marked shipped Phase C/D/E flow sections as stubs.
- S01-005 - Historical release-gate claims did not prove the current dirty worktree.
- S01-006 - README hardware-verification wording was too broad for documented pending hardware gaps.
- S01-007 - Cloudflare auto-deploy status contradicted itself across README and `AUDIT.md`.
- S01-009 - `PROJECT.md` data-model and module-layout sections were stale relative to shipped scene variants and folders.

Changes audited:

- `README.md` now states the naming contract: KerfDesk is the user-facing product/release URL, LaserForge 2.0 remains the repo/package/internal architecture name, and the Cloudflare API project remains `laserforge` for historical reasons.
- `README.md` now summarizes current Phase F/G scope, narrows hardware verification to the documented Falcon/GrblHAL paths, removes the stale 26-ADR count, and refreshes the release-gate evidence to 423 test files / 2641 tests on 2026-07-03.
- `README.md` and `AUDIT.md` now describe Cloudflare deploy status as workflow-configured but GitHub-secret presence unprovable from the local checkout, avoiding the old push-to-deploy contradiction.
- `AUDIT.md` now has current source/test counts, current bundle chunk evidence from the production build, a resolved A6 bundle-warning note, and the 2026-07-03 release-gate proof instead of the 2026-06-28 counts.
- `WORKFLOW.md` no longer labels Phase C, D, or E as stubs and now contains concise success/error/empty/edge contracts for shipped C/D/E workflow groups.
- `PROJECT.md` now identifies the KerfDesk/LaserForge naming split, replaces the MVP-only data model with current scene/layer/job concepts, and refreshes the module map to match the current `src`, `electron`, `scripts`, and `audit/scripts` layout.
- `public/404.html` now uses the KerfDesk user-facing product name.

Verification:

- Passed: stale-claim sweep across `README.md`, `AUDIT.md`, `WORKFLOW.md`, `PROJECT.md`, and `public/404.html` for old release counts, `STUB`, stale hardware/deploy claims, stale ADR count, old module-layout phrases, and old fallback-page naming.
- Passed: `pnpm exec prettier --check README.md AUDIT.md WORKFLOW.md PROJECT.md public/404.html`.
- Passed: `pnpm exec vitest run src/platform/web/repo-policy.test.ts src/platform/web/deploy-workflow-gate.test.ts` - 2 files, 13 tests.
- Passed: `pnpm check:file-size`.
- Passed: `pnpm release:check` end to end: repo guard, TypeScript, ESLint, Electron lint, Prettier, license check, dependency audit, 423 test files / 2641 tests, web build, Electron main build, and expanded file-size backstop.
- After-fix static audit confirmed no S01 medium findings remain open and only low-severity cleanup items remain.

Result:

- Fixed in this pass: S01-001, S01-002, S01-003, S01-004, S01-005, S01-006, S01-007, S01-009.
- Total fixed findings: 57.
- Remaining open findings: 20 (0 medium, 20 low).

## Fix Phase 23 After-Fix Audit - S01 Low-Severity Documentation Cleanup

Fixed findings:

- S01-008 - Historical audit corpus lacked an index.
- S01-010 - `DECISIONS.md` future-ADR numbering note referenced a missing plan file and stale contiguous numbering.

Changes audited:

- Added `audit/README.md` as the audit corpus index. It points to the active architecture, audit, and progress files; maps `evidence/`, `external/`, `findings/`, `fixtures/`, `prompts/`, `reports/`, and `scripts/`; and states navigation rules for distinguishing current findings from historical reports.
- Updated ADR-092 and ADR-093 numbering notes in `DECISIONS.md` so they no longer treat the missing `.claude/plans/plan-a-full-build-sparkling-kazoo.md` allocation table as authority.
- Updated the `DECISIONS.md` "Future ADRs" section to state the current non-contiguous ADR numbering rule: scan existing `## ADR-` headings and choose the next unused number.

Verification:

- Passed: `Test-Path audit/README.md` by file creation and direct readback.
- Passed: targeted grep confirmed no live docs still say the decision log has 26 ADRs, the ADR body is contiguous through ADR-057, or the missing build plan is authoritative.
- Passed: `pnpm exec prettier --check DECISIONS.md audit/README.md`.
- After-fix static audit confirmed no S01 findings remain open.

Result:

- Fixed in this pass: S01-008, S01-010.
- Total fixed findings: 59.
- Remaining open findings: 18 (0 medium, 18 low).

## Fix Phase 24 After-Fix Audit - S03 Electron CSP Rationale Cleanup

Fixed findings:

- S03-006 - Electron CSP rationale comments still described the pre-camera bridge policy.

Changes audited:

- `electron/main.ts` top-level security posture comment now says the trusted renderer can receive serial, File System Access, and video-only media permissions.
- `electron/main.ts` CSP rationale comments now explicitly document that `img-src` and `connect-src` allow the loopback RTSP camera bridge while still denying remote network services.
- No runtime CSP or permission behavior changed in this pass.

Verification:

- Passed: `pnpm exec vitest run electron/csp-policy.test.ts electron/trusted-renderer-policy.test.ts` - 2 files, 11 tests.
- Passed: `pnpm build:electron-main`.
- Passed: `pnpm exec prettier --check electron/main.ts`.
- Passed: stale-phrase grep for the old "serial / File System Access only", same-origin-only connect, and no-outbound-HTTP comment text.
- After-fix static audit confirmed Electron CSP/permission comments now match the tested local camera bridge and video-only media allowances.

Result:

- Fixed in this pass: S03-006.
- Total fixed findings: 60.
- Remaining open findings: 17 (0 medium, 17 low).

## Fix Phase 25 After-Fix Audit - S04 Layer Color Contract

Fixed findings:

- S04-006 - Layer color constructors and assignment helpers allowed invalid layer-color strings despite the lowercase hex color contract.

Changes audited:

- `src/core/scene/layer.ts` now owns the layer-color contract with `isLayerColor(...)` and `normalizeLayerColor(...)`.
- `createLayer(...)` normalizes valid uppercase hex colors to lowercase and rejects invalid layer colors before they become layer keys.
- `src/core/scene/scene.ts` now reuses the same core normalizer for `assignObjectToLayer(...)`, so object recoloring cannot persist invalid layer-color strings.
- `src/core/scene/index.ts` exports the layer-color helpers through the scene module public API.
- Regression tests in `src/core/scene/layer.test.ts` and `src/core/scene/scene.test.ts` cover uppercase normalization and invalid-color rejection.

Verification:

- Passed: `pnpm exec vitest run src/core/scene/layer.test.ts src/core/scene/scene.test.ts src/ui/state/layer-actions.test.ts src/ui/state/ui-store.test.ts` - 4 files, 52 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/core/scene/layer.ts src/core/scene/layer.test.ts src/core/scene/scene.ts src/core/scene/scene.test.ts src/core/scene/index.ts`.
- Passed: `pnpm check:file-size`.
- After-fix static audit confirmed the duplicate permissive scene normalizer is gone and layer construction/recoloring now share the same hex validation boundary.

Result:

- Fixed in this pass: S04-006.
- Total fixed findings: 61.
- Remaining open findings: 16 (0 medium, 16 low).

## Fix Phase 26 After-Fix Audit - S04 Polyline Bounds Consolidation

Fixed findings:

- S04-007 - Polyline bounds logic was duplicated in `create-polyline.ts` instead of using the shared shape helper.

Changes audited:

- `src/core/shapes/create-polyline.ts` now imports `boundsOfPolylines(...)` from `src/core/shapes/polyline-bounds.ts`.
- The local duplicate `boundsOfPolylines(...)` implementation and now-unused `Bounds`/`Polyline` imports were removed.
- Polygon, star, and polyline shape factories now share the same bounds helper.

Verification:

- Passed: `pnpm exec vitest run src/core/shapes/create-polyline.test.ts src/core/shapes/polygon.test.ts src/core/shapes/star.test.ts src/core/shapes/polyline.test.ts` - 4 files, 10 tests.
- Passed: `pnpm exec vitest run src/core/shapes/create-polyline.test.ts` after formatting - 1 file, 3 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm exec prettier --check src/core/shapes/create-polyline.ts`.
- Passed: `pnpm check:file-size`.
- After-fix static audit confirmed `src/core/shapes/polyline-bounds.ts` is the only remaining `boundsOfPolylines(...)` definition and all three shape factories import it.

Result:

- Fixed in this pass: S04-007.
- Total fixed findings: 62.
- Remaining open findings: 15 (0 medium, 15 low).

## Fix Phase 27 After-Fix Audit - S04 Scan-Offset Normalization Semantics

Fixed findings:

- S04-008 - Scan-offset validation rejected duplicate speeds, but the core normalizer silently kept the last duplicate speed.

Changes audited:

- `src/core/devices/scan-offset-profile.ts` now separates strict canonicalization from editor merge behavior.
- `normalizeScanOffsetTable(...)` now returns an empty canonical table when otherwise-valid points contain duplicate speeds, matching `isScanOffsetTable(...)` instead of silently deduplicating.
- `mergeScanOffsetTableBySpeed(...)` now owns the explicit "last edited speed wins" behavior needed by scan-offset editor flows.
- `src/ui/laser/MeasuredScanOffsetApply.tsx` and `src/ui/laser/ScanOffsetEditor.tsx` now use the explicit merge helper for editable row state.
- `src/core/devices/index.ts` exports the new helper through the core devices public API.
- `src/core/devices/scan-offset-profile.test.ts` pins duplicate rejection, explicit merge behavior, malformed-row filtering, and sort order.

Verification:

- Passed: `pnpm exec vitest run src/core/devices/scan-offset-profile.test.ts src/io/project/project-scan-offset.test.ts src/ui/laser/DeviceSettings.test.tsx src/ui/laser/MeasuredScanOffsetApply.test.tsx src/ui/laser/ScanOffsetEditor.test.tsx` - matched 4 files, 16 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/core/devices/scan-offset-profile.ts src/core/devices/scan-offset-profile.test.ts src/core/devices/index.ts src/ui/laser/MeasuredScanOffsetApply.tsx src/ui/laser/ScanOffsetEditor.tsx`.
- Passed: `pnpm check:file-size`.
- After-fix static audit confirmed import/canonical paths still call `normalizeScanOffsetTable(...)`, while UI edit/measurement paths call `mergeScanOffsetTableBySpeed(...)`.

Result:

- Fixed in this pass: S04-008.
- Total fixed findings: 63.
- Remaining open findings: 14 (0 medium, 14 low).

## Fix Phase 28 After-Fix Audit - S04 G-code Dialect Fail-Closed Resolution

Fixed findings:

- S04-009 - G-code dialect resolution silently fell back to `grbl-dynamic` for unknown dialect ids.

Changes audited:

- `src/core/devices/gcode-dialects.ts` now defaults to `grbl-dynamic` only when no dialect selection is present.
- An explicit but unknown `gcodeDialect.dialectId` now throws `Unknown GRBL G-code dialect: ...` at the core output-facing boundary.
- `src/core/devices/gcode-dialects.test.ts` now covers absent-selection defaulting and explicit unknown-id rejection.

Verification:

- Passed: `pnpm exec vitest run src/core/devices/gcode-dialects.test.ts src/core/output/grbl-strategy.test.ts src/core/output/grbl-strategy-scan-offset.test.ts src/core/preflight/machine-profile-preflight.test.ts src/ui/laser/job-intent-warnings.test.ts` - 5 files, 37 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/core/devices/gcode-dialects.ts src/core/devices/gcode-dialects.test.ts`.
- Passed: `pnpm check:file-size`.
- After-fix static audit confirmed unknown dialect ids no longer silently resolve to `grbl-dynamic`.

Result:

- Fixed in this pass: S04-009.
- Total fixed findings: 64.
- Remaining open findings: 13 (0 medium, 13 low).

## Fix Phase 29 After-Fix Audit - S05 G-code Word Parsing

Fixed findings:

- S05-002 - Preflight and invariant G-code parsers shared a narrow duplicated numeric grammar that missed valid/common numeric forms.

Changes audited:

- `src/core/invariants/gcode-words.ts` now owns shared G-code word parsing and command detection for invariant and preflight paths.
- The shared parser accepts signed values, leading/trailing decimals, exponent notation, lowercase words, and compact G-code words such as `G1X10Y.5`.
- `src/core/invariants/predicates.ts`, `src/core/invariants/blank-feed.ts`, `src/core/preflight/no-go-zones.ts`, and `src/core/preflight/preflight.ts` now use the shared helper instead of local duplicated numeric regexes.
- `src/core/invariants/gcode-words.test.ts` and adjacent invariant/preflight tests cover the newly accepted numeric forms and compact command recognition.

Verification:

- Passed: `pnpm exec vitest run src/core/invariants/gcode-words.test.ts src/core/invariants/predicates.test.ts src/core/invariants/blank-feed.test.ts src/core/preflight/no-go-zones.test.ts src/core/preflight/preflight.test.ts src/core/preflight/preflight-raster.test.ts` - 6 files, 63 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/core/invariants/gcode-words.ts src/core/invariants/gcode-words.test.ts src/core/invariants/predicates.ts src/core/invariants/predicates.test.ts src/core/invariants/blank-feed.ts src/core/invariants/blank-feed.test.ts src/core/invariants/index.ts src/core/preflight/no-go-zones.ts src/core/preflight/no-go-zones.test.ts src/core/preflight/preflight.ts`.
- Passed: `pnpm check:file-size`.
- After-fix static audit found no remaining local `NUM`, `parseMotionAxis`, `parseAxis(...)`, or `parseValue(...)` parser fragments in `src/core/invariants` or `src/core/preflight`.

Result:

- Fixed in this pass: S05-002.
- Total fixed findings: 65.
- Remaining open findings: 12 (0 medium, 12 low).

## Fix Phase 30 After-Fix Audit - S06 G-code Metadata Comment Sanitization

Fixed findings:

- S06-006 - G-code metadata header fields were interpolated into comment lines without newline/control-character sanitization.

Changes audited:

- `src/io/gcode/gcode-metadata.ts` now sanitizes metadata fields at the header boundary before emitting GRBL comment lines.
- Newline, C0 control, DEL, Unicode line separator, and Unicode paragraph separator characters are replaced with spaces and trimmed so provenance strings cannot create non-comment G-code lines.
- Normal build-controlled metadata output remains unchanged for ordinary one-line values.
- `src/io/gcode/gcode-metadata.test.ts` now covers malicious-looking newline/control-character metadata and verifies every non-empty emitted header line remains comment-prefixed.

Verification:

- Passed: `pnpm exec vitest run src/io/gcode/gcode-metadata.test.ts src/io/gcode/emit-gcode.test.ts` - 2 files, 9 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/io/gcode/gcode-metadata.ts src/io/gcode/gcode-metadata.test.ts`.
- Passed: `pnpm check:file-size`.
- After-fix static audit found no remaining raw `${metadata...}` interpolation in `src/io/gcode/gcode-metadata.ts`.

Result:

- Fixed in this pass: S06-006.
- Total fixed findings: 66.
- Remaining open findings: 11 (0 medium, 11 low).

## Fix Phase 31 After-Fix Audit - S07 Camera Bridge Preview API Cleanup

Fixed findings:

- S07-007 - `CameraBridgeAdapter.rtspPreviewUrl(...)` was a production-unused API surface.

Changes audited:

- `src/platform/types.ts` no longer exposes `rtspPreviewUrl(...)` on `CameraBridgeAdapter`.
- `src/platform/web/camera-bridge.ts` no longer implements a parallel preview URL formatter.
- `src/platform/web/camera-bridge.test.ts` now validates preview URLs only through the local bridge probe response.
- `src/ui/laser/MachineSetupCameraPreview.test.tsx` mocks the production-used `probeRtspCamera(...)` API only.

Verification:

- Passed: `pnpm exec vitest run src/platform/web/camera-bridge.test.ts src/ui/laser/MachineSetupCameraPreview.test.tsx` - 2 files, 9 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/platform/types.ts src/platform/web/camera-bridge.ts src/platform/web/camera-bridge.test.ts src/ui/laser/MachineSetupCameraPreview.test.tsx`.
- Passed: `pnpm check:file-size`.
- After-fix static audit found no remaining `rtspPreviewUrl` references in `src/platform`, `src/ui`, or `electron`.

Result:

- Fixed in this pass: S07-007.
- Total fixed findings: 67.
- Remaining open findings: 10 (0 medium, 10 low).

## Fix Phase 32 After-Fix Audit - S08 Cut Settings Max-Feed Enforcement

Fixed findings:

- S08-012 - Cut Settings dialog could save layer speeds above the active device max feed while inline controls clamped them.

Changes audited:

- `src/ui/layers/CutSettingsDialog.tsx` now passes an active max-feed limit into the staged form parser and common fields.
- `src/ui/layers/CutSettingsCommonFields.tsx` exposes the device max on the speed input and pre-caps existing over-max layer speeds when opening the dialog.
- `src/ui/layers/LayerRowCutSettings.tsx` and `src/ui/layers/LayerSubLayers.tsx` now pass `project.device.maxFeed` into layer and sub-layer Cut Settings dialogs.
- `src/ui/layers/cut-settings-draft.ts` now accepts optional cut-setting limits and clamps parsed speed to the supplied max feed while preserving the previous no-limit default for non-device recipe capture.
- Parser and panel tests now cover active max-feed capping.

Verification:

- Passed: `pnpm exec vitest run src/ui/layers/cut-settings-draft.test.ts src/ui/layers/CutsLayersPanel.cut-settings.test.tsx src/ui/layers/CutSettingsDialog.fill-density.test.tsx src/ui/state/layer-actions.test.ts` - 4 files, 48 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/ui/layers/cut-settings-draft.ts src/ui/layers/cut-settings-draft.test.ts src/ui/layers/CutSettingsCommonFields.tsx src/ui/layers/CutSettingsDialog.tsx src/ui/layers/LayerRowCutSettings.tsx src/ui/layers/LayerSubLayers.tsx src/ui/layers/CutsLayersPanel.cut-settings.test.tsx`.
- Passed: `pnpm check:file-size`.
- After-fix static audit confirmed layer and sub-layer Cut Settings paths now source `project.device.maxFeed` and pass it through to both the speed input and parser.

Result:

- Fixed in this pass: S08-012.
- Total fixed findings: 68.
- Remaining open findings: 9 (0 medium, 9 low).

## Fix Phase 33 After-Fix Audit - S08 Preview Route Button Chrome

Fixed findings:

- S08-014 - Preview route playback buttons used an undefined `lf-button` class instead of the shared button chrome.

Changes audited:

- `src/ui/workspace/preview-overlays.tsx` now uses the shared `lf-btn` class on Play/Pause and Restart route-preview buttons.
- `src/ui/workspace/preview-overlays.test.tsx` now asserts the route playback buttons use `lf-btn` and not the stale `lf-button` class.

Verification:

- Passed: `pnpm exec vitest run src/ui/workspace/preview-overlays.test.tsx src/ui/kit/Button.test.tsx src/ui/a11y/button-hover-contract.test.ts` - 3 files, 15 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/ui/workspace/preview-overlays.tsx src/ui/workspace/preview-overlays.test.tsx`.
- Passed: `pnpm check:file-size`.
- After-fix static audit found no production `lf-button` references in `src/ui` or `src/ui/theme/tokens.css`.

Result:

- Fixed in this pass: S08-014.
- Total fixed findings: 69.
- Remaining open findings: 8 (0 medium, 8 low).

## Fix Phase 34 After-Fix Audit - S08 Help-Id Registry Coverage

Fixed findings:

- S08-015 - The hover-help contract accepted unregistered `data-help-id` values, and preview controls used IDs outside the help registry.

Changes audited:

- `src/ui/help/help-topics.ts` now defines preview route controls as registered control help topics.
- `ControlHelpId` is now closed over `ControlHelpKey` instead of accepting any `control:${string}` value.
- `src/ui/workspace/preview-overlays.tsx` now uses `control:preview.*` help IDs for traversal, route playback, route restart, and route speed controls.
- `src/ui/a11y/button-hover-contract.test.ts` now rejects literal `data-help-id` values that do not resolve through the help registry.
- `src/ui/help/help-topics.test.ts` now covers preview help topics and rejects the old bare `preview.*` ID shape.

Verification:

- Passed: `pnpm exec vitest run src/ui/a11y/button-hover-contract.test.ts src/ui/help/help-topics.test.ts src/ui/workspace/preview-overlays.test.tsx src/ui/app/shortcuts-docs.test.ts src/ui/app/shortcuts-tools.test.ts` - 5 files, 27 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/ui/a11y/button-hover-contract.test.ts src/ui/help/help-topics.ts src/ui/help/help-topics.test.ts src/ui/workspace/preview-overlays.tsx`.
- Passed: `pnpm check:file-size`.
- After-fix static audit found no bare `data-help-id="preview.*"` values in `src/ui`.

Result:

- Fixed in this pass: S08-015.
- Total fixed findings: 70.
- Remaining open findings: 7 (0 medium, 7 low).

## Fix Phase 35 After-Fix Audit - S08 Text Numeric Bounds

Fixed findings:

- S08-016 - Add/Edit Text numeric inputs could pass non-finite or out-of-contract values into text rendering and scene state.

Changes audited:

- `src/ui/text/TextDialogNumericFields.tsx` now owns finite/range parsing for text size, line height, and letter spacing.
- Text size is clamped to `1..300` mm; line height is clamped to `0.5..5`; letter spacing is clamped to `-0.5..2`.
- `src/ui/text/AddTextDialog.tsx` now clamps edit initial values, user edits, and submit-time values before rendering or saving text objects.
- `src/ui/text/AddTextDialog.test.tsx` now verifies clamped numeric values are passed to `textToPolylines(...)` and saved into the text object.

Verification:

- Passed: `pnpm exec vitest run src/ui/text/AddTextDialog.test.tsx src/core/text/text-to-polylines.test.ts src/io/project/project.test.ts` - 3 files, 43 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/ui/text/AddTextDialog.tsx src/ui/text/AddTextDialog.test.tsx src/ui/text/TextDialogNumericFields.tsx`.
- Passed: `pnpm check:file-size`.
- After-fix static audit found no old inline `Math.max(... Number(...))` text numeric parser patterns in `src/ui/text/AddTextDialog.tsx`.

Result:

- Fixed in this pass: S08-016.
- Total fixed findings: 71.
- Remaining open findings: 6 (0 medium, 6 low).

## Fix Phase 36 After-Fix Audit - S09 Perceptual Artifact Provenance Wording

Fixed findings:

- S09-002 - Perceptual artifact PNGs were ignored local outputs but were referenced like durable audit evidence.

Changes audited:

- `audit/reports/step-1-verification-harness-2026-06-23.md` now labels the PNG paths as regenerable local artifacts.
- `audit/reports/step-4-fill-raster-fidelity-2026-06-23.md` now states optional PNG outputs are ignored by Git and not durable audit evidence.
- Both reports now use "Regenerable visual checks" instead of "Real-artifact evidence" in the rating rubric.

Verification:

- Passed: `pnpm exec prettier --check audit/reports/step-1-verification-harness-2026-06-23.md audit/reports/step-4-fill-raster-fidelity-2026-06-23.md`.
- Static wording audit found no remaining `Ignored proof files`, `Generated artifacts:`, `Artifact Evidence`, `artifact evidence`, `proof files`, or `Real-artifact evidence` wording in the touched reports.
- Static wording audit confirmed the reports now include ignored/regenerable local-output wording for `perceptual-artifacts/*.png`.

Result:

- Fixed in this pass: S09-002.
- Total fixed findings: 72.
- Remaining open findings: 5 (0 medium, 5 low).

## Fix Phase 37 After-Fix Audit - S09 Perceptual Artifact Dimension Guard

Fixed findings:

- S09-003 - `writePerceptualArtifact(...)` could render a misleading comparison PNG for mismatched mask dimensions.

Changes audited:

- `src/__fixtures__/perceptual/png.ts` now rejects mismatched predicted/truth mask dimensions before building an opt-in comparison PNG.
- Disabled artifact mode remains a no-op and still returns `null`, even if callers pass mismatched masks.
- `src/__fixtures__/perceptual/png.test.ts` covers disabled no-op behavior and enabled mismatch rejection.

Verification:

- Passed: `pnpm exec vitest run src/__fixtures__/perceptual/png.test.ts src/__fixtures__/perceptual/compare.test.ts src/__fixtures__/perceptual/toolpath-rasterize.test.ts` - 3 files, 14 tests.
- Passed: `pnpm exec vitest run src/__fixtures__/perceptual` - 12 files, 74 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/__fixtures__/perceptual/png.ts src/__fixtures__/perceptual/png.test.ts`.
- Passed: `pnpm check:file-size`.
- After-fix static audit confirmed the dimension guard runs before `buildComparison(...)` when artifact dumps are enabled.

Result:

- Fixed in this pass: S09-003.
- Total fixed findings: 73.
- Remaining open findings: 4 (0 medium, 4 low).

## Fix Phase 38 After-Fix Audit - S09 Real-Logo Fixture Ownership

Fixed findings:

- S09-004 - The active real-logo benchmark fixture lived under `audit/fixtures`, mixing test-fixture ownership with audit evidence.

Changes audited:

- `audit/fixtures/trace/arch-house-langebaan-source.png` moved to `src/__fixtures__/perceptual/assets/arch-house-langebaan-source.png`.
- `src/__fixtures__/perceptual/trace-artifact-runner.ts` now defaults required Arch House fixture discovery to the S09 perceptual fixture asset directory.
- `audit/REPOSITORY-SECTOR-ARCHITECTURE-2026-07-03.md` and `audit/reports/trace-quality-loop-baseline-2026-06-25.md` now point current readers at the S09-owned fixture path.

Verification:

- Passed: `pnpm exec vitest run src/__fixtures__/perceptual/trace-artifacts.test.ts src/__fixtures__/perceptual/arch-house-baseline.test.ts src/__fixtures__/perceptual/arch-house-edge-quality.test.ts src/__fixtures__/perceptual/trace-benchmark-loop.test.ts` - 4 files, 24 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/__fixtures__/perceptual/trace-artifact-runner.ts audit/REPOSITORY-SECTOR-ARCHITECTURE-2026-07-03.md audit/reports/trace-quality-loop-baseline-2026-06-25.md`.
- Passed: `pnpm check:file-size`.
- After-fix static audit found no active helper, architecture, or baseline-report references to `audit/fixtures/trace`.
- `git status -sb -- audit/fixtures/trace src/__fixtures__/perceptual/assets src/__fixtures__/perceptual/trace-artifact-runner.ts audit/REPOSITORY-SECTOR-ARCHITECTURE-2026-07-03.md audit/reports/trace-quality-loop-baseline-2026-06-25.md` shows the PNG as a rename into `src/__fixtures__/perceptual/assets`.

Result:

- Fixed in this pass: S09-004.
- Total fixed findings: 74.
- Remaining open findings: 3 (0 medium, 3 low).

## Fix Phase 39 After-Fix Audit - S09 Trace Artifact Evidence Output Path

Fixed findings:

- S09-005 - The Arch House opt-in trace evidence writer used an unignored `audit/evidence/trace-artifacts` output path.

Changes audited:

- `src/__fixtures__/perceptual/trace-artifact-runner.ts` now exports `DEFAULT_TRACE_ARTIFACT_EVIDENCE_DIR`, rooted at ignored `perceptual-artifacts/trace-artifacts`.
- `src/__fixtures__/perceptual/arch-house-baseline.test.ts` writes opt-in Arch House trace evidence through that ignored artifact directory.
- `src/__fixtures__/perceptual/trace-artifacts.test.ts` pins the default evidence directory away from `audit/evidence/trace-artifacts`.
- `audit/reports/trace-quality-loop-baseline-2026-06-25.md` now documents regenerable local trace evidence under `perceptual-artifacts/trace-artifacts`.

Verification:

- Passed: `$env:PERCEPTUAL_ARTIFACTS='1'; pnpm exec vitest run src/__fixtures__/perceptual/arch-house-baseline.test.ts -t "traces the required source fixture"` - 1 test passed, 3 skipped; output paths were under `perceptual-artifacts/trace-artifacts`.
- Passed: `pnpm exec vitest run src/__fixtures__/perceptual/trace-artifacts.test.ts src/__fixtures__/perceptual/arch-house-baseline.test.ts` - 2 files, 16 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/__fixtures__/perceptual/trace-artifact-runner.ts src/__fixtures__/perceptual/arch-house-baseline.test.ts src/__fixtures__/perceptual/trace-artifacts.test.ts audit/reports/trace-quality-loop-baseline-2026-06-25.md`.
- Passed: `pnpm check:file-size`.
- `git check-ignore -v perceptual-artifacts/trace-artifacts/example.metrics.json perceptual-artifacts/trace-artifacts/example.overlay.svg` confirmed both opt-in trace evidence files are ignored by the existing `perceptual-artifacts/` rule.
- After-fix static audit found no active writer or report path using `audit/evidence/trace-artifacts`; only the negative regression assertion names that old path.
- `git status -sb -- audit/evidence/trace-artifacts perceptual-artifacts ...` showed no dirty tracked `audit/evidence/trace-artifacts` files after the opt-in run.

Result:

- Fixed in this pass: S09-005.
- Total fixed findings: 75.
- Remaining open findings: 2 (0 medium, 2 low).

## Fix Phase 40 After-Fix Audit - S09 PNG Decoder Malformed Fixture Coverage

Fixed findings:

- S09-007 - The minimal PNG decoder had no dedicated malformed/unsupported-file tests even though it gates the real-logo benchmark fixture.

Changes audited:

- `src/__fixtures__/perceptual/png-decode.ts` now validates complete chunk headers/payloads, required IHDR/IDAT/IEND chunks, positive dimensions, and exact decompressed row data length before unfiltering.
- `src/__fixtures__/perceptual/png-decode.test.ts` covers valid RGB/RGBA decoding plus bad signatures, unsupported bit depths, unsupported colour types, interlace rejection, missing chunks, incomplete chunk payloads, truncated decoded rows, and unknown filters.

Verification:

- Passed: `pnpm exec vitest run src/__fixtures__/perceptual/png-decode.test.ts src/__fixtures__/perceptual/arch-house-baseline.test.ts src/__fixtures__/perceptual/arch-house-edge-quality.test.ts src/__fixtures__/perceptual/trace-benchmark-loop.test.ts` - 4 files, 23 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/__fixtures__/perceptual/png-decode.ts src/__fixtures__/perceptual/png-decode.test.ts`.
- Passed: `pnpm check:file-size`.
- After-fix static audit confirmed the malformed PNG error paths are implemented and pinned by `png-decode.test.ts`.

Result:

- Fixed in this pass: S09-007.
- Total fixed findings: 76.
- Remaining open findings: 1 (0 medium, 1 low).

## Fix Phase 41 After-Fix Audit - S09 G-Code Burn Rasterizer Parser Coverage

Fixed findings:

- S09-008 - The emitted-G-code burn rasterizer had no direct parser tests beyond three generated GRBL fill fixtures.

Changes audited:

- `src/__fixtures__/perceptual/gcode-rasterize.ts` now uses the shared G-code parser helpers for G/M/S/X/Y words instead of its own narrower regex.
- `src/core/invariants/gcode-words.ts` now strips parenthesized comments as well as semicolon comments before parsing.
- `src/__fixtures__/perceptual/gcode-rasterize.test.ts` directly covers compact lowercase words, plus-signed values, exponent notation, M4 arming, modal G1 movement, rapid moves, M5 shutoff, parenthesized/semicolon comments, and malformed numeric suffixes.
- `src/core/invariants/gcode-words.test.ts` pins parenthesized-comment stripping for other parser consumers.

Verification:

- Passed: `pnpm exec vitest run src/__fixtures__/perceptual/gcode-rasterize.test.ts src/__fixtures__/perceptual/toolpath-rasterize.test.ts src/core/invariants/gcode-words.test.ts src/core/invariants/blank-feed.test.ts src/core/invariants/predicates.test.ts src/core/preflight/no-go-zones.test.ts` - 6 files, 40 tests.
- Passed: `pnpm exec tsc --noEmit --project tsconfig.json`.
- Passed: `pnpm lint`.
- Passed: `pnpm exec prettier --check src/__fixtures__/perceptual/gcode-rasterize.ts src/__fixtures__/perceptual/gcode-rasterize.test.ts src/core/invariants/gcode-words.ts src/core/invariants/gcode-words.test.ts`.
- Passed: `pnpm check:file-size`.
- After-fix static audit confirmed the rasterizer delegates to `parseGcodeWord(...)` and `stripGcodeComment(...)`, and the direct parser-semantics tests are present.

Result:

- Fixed in this pass: S09-008.
- Total fixed findings: 77.
- Remaining open findings: 0 (0 medium, 0 low).

## Final Full-Repo After-Fix Verification

Scope:

- Rechecked the full repository after all 77 recorded audit findings were fixed and after-fix audited.
- Preserved the pre-existing dirty worktree context; no unrelated files were reverted.
- Addressed the final release-gate regression where two selection test files still used shorthand fixture colors that the now-strict layer-color contract intentionally rejects.

Final verification:

- Passed: `pnpm release:check`.
- The release gate included `pnpm guard:repo`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:electron`, `pnpm format:check`, `pnpm license-check`, `pnpm audit:deps`, `pnpm test`, `pnpm build:web`, `pnpm build:electron-main`, and `pnpm check:file-size`.
- Full test suite result inside the release gate: 428 test files passed, 2678 tests passed.
- Web production build completed.
- Electron main TypeScript build completed.
- License check passed for 15 production packages across 4 allowed license families.
- Dependency audit reported no known vulnerabilities.
- File-size raw-line backstop passed.

Final result:

- Total fixed findings: 77.
- Remaining open findings: 0 (0 medium, 0 low).
- Full repo after-fix release gate: passed.

## Current-State Delta Audit - 2026-07-04

Reason for reopening:

- The completed audit/fix ledger closed against the earlier audited baseline.
- Current `origin/main` is `09047e1`, twenty-six commits after `d603c01`. At S01 delta Pass 1 the head was `e31a3b8`; later fast-forwards added the audit-doc checkpoint, three S08 box/input commits, PWA update dismissal persistence, deterministic build-time configuration, CNC machine catalog/default-bit changes, probe/device-setup UI changes, runner-speed CI flake fixes, and the S04 audit-refresh documentation checkpoint.
- `git diff --name-status d603c01..origin/main` shows changes in S01, S02, S04, S05, S06, S08, and S09.
- `git ls-files -co --exclude-standard` currently returns 1,689 files.
- The previous sector map left 71 current files unclassified until this pass refreshed the architecture map.

No product source fixes are made in this delta audit. Audit documentation is updated because it is the requested audit ledger.

### S01 Delta Pass 1 - Current-State Map and Baseline Drift

Scope planned:

- Verify the current repo boundary, branch state, and active commit.
- Compare the current tree against the previous completed audit/fix baseline.
- Re-run the sector classifier against current `git ls-files -co --exclude-standard`.
- Record whether the existing architecture, audit, and progress files still prove completion for the current tree.

Evidence inspected:

- `Get-Location`, `git status -sb`, `git log --oneline -1`, and `git remote -v`.
- `git log --oneline d603c01..HEAD`.
- `git diff --name-status d603c01..HEAD`.
- `git ls-files -co --exclude-standard` and a sector-classification pass.
- `audit/REPOSITORY-SECTOR-ARCHITECTURE-2026-07-03.md`.
- `audit/REPOSITORY-SECTOR-PROGRESS-2026-07-03.md`.
- `audit/REPOSITORY-SECTOR-AUDIT-2026-07-03.md`.

Findings:

#### D-S01-001 - Sector map omitted current core/root paths

Severity: Medium.

Evidence:

- At S01 delta Pass 1, `git ls-files -co --exclude-standard` returned 1,679 files.
- The old architecture table still recorded the earlier 1,235-file post-artifact expectation and path memberships from the initial audit.
- A current classifier using the old patterns left 71 files unclassified, including `HANDOFF-CNC-2026-07-02.md`, `PHASE-H-BUILD.md`, `src/core/box/**`, `src/core/cnc/**`, `src/core/relief/**`, and `src/core/sim/**`.
- The architecture file was refreshed in that pass to list all 1,679 then-current files under S01-S09, with zero unclassified files.

Risk:

The audit could falsely claim full-repo coverage while entire current core areas sit outside the sector taxonomy. That breaks the first requirement of the audit contract: divide the repo into clear sectors and list which files belong to each sector.

No product source fix made. Audit architecture documentation updated.

#### D-S01-002 - Completion ledger did not cover post-baseline commits

Severity: Medium.

Evidence:

- `git log --oneline d603c01..HEAD` lists ten newer commits.
- `git diff --name-status d603c01..HEAD` shows changed files in docs, CNC material state, trace algorithms, project persistence, UI state/machine setup, and perceptual fixtures.
- The progress file's completed-sector and final-verification rows were written before these newer commits were present in the current checkout.

Risk:

The previous "all sectors complete" and "remaining open findings: 0" statements are true for their audited baseline, but they are not sufficient proof for current `main`. Without a delta audit, changed sectors could contain new bugs, risks, or unclear architecture that were never reviewed in three-pass sector order.

No product source fix made.

Pass result:

- S01 delta Pass 1 complete.
- Architecture file refreshed for the current file inventory.
- S01 remains open for delta Pass 2 and Pass 3 before the audit may move to S04/S05/S06/S08/S09 delta sectors.

### S01 Delta Pass 2 - Governance and Phase-Status Delta

Scope planned:

- Review the S01 documentation changes introduced after the previous audit baseline.
- Check ADR-112, Phase H project status, workflow text, and audit ledger wording for consistency.
- Check root handoff/build planning docs now classified under S01.

Evidence inspected:

- `git diff --stat d603c01..HEAD -- AUDIT.md DECISIONS.md PROJECT.md WORKFLOW.md HANDOFF-CNC-2026-07-02.md PHASE-H-BUILD.md`.
- `git diff --unified=80 d603c01..HEAD -- AUDIT.md DECISIONS.md PROJECT.md WORKFLOW.md`.
- Targeted `rg` over `AUDIT.md`, `DECISIONS.md`, `PROJECT.md`, `WORKFLOW.md`, `HANDOFF-CNC-2026-07-02.md`, and `PHASE-H-BUILD.md` for ADR-112, project material, hardware labels, pending/deferred wording, and trace-upscale notes.
- Focused reads around ADR-112 in `DECISIONS.md`, F-CNC35 in `WORKFLOW.md`, H.14 in `PROJECT.md`, and the ADR-112 row in `AUDIT.md`.

Findings:

#### D-S01-003 - Phase H summary header is stale after H.14

Severity: Low.

Evidence:

- `PROJECT.md` now includes `H.14 | Project material picker (ADR-112)` in the Phase H table.
- `DECISIONS.md` includes `ADR-112 - Project-level CNC material picker`.
- `WORKFLOW.md` includes `F-CNC35. Set the project material once (Easel-style) - ADR-112`.
- `AUDIT.md` includes an `ADR-112 project material picker` inventory row.
- The Phase H section header in `PROJECT.md` still says `Phase H - v0.8 "Router" [Built (G1-G8); hardware passes CLAIMED]`, which no longer summarizes the current H.14 table.

Risk:

The detailed rows are present, but the phase-level summary under-reports the current Phase H scope. A maintainer skimming only the phase header could miss that H.13/H.14 landed or misunderstand the status boundary between the older G1-G8 stretch items and the newer ADR-111/112 beginner-material work.

No fix made.

Pass result:

- S01 delta Pass 2 complete.
- S01 remains open for one remaining-gap pass before the audit can move to the next changed sector.

### S01 Delta Pass 3 - Remaining-Gap and Ledger-Coverage Pass

Scope planned:

- Recheck all S01 files changed after `d603c01`.
- Confirm the refreshed sector map has no unclassified current files.
- Search for obvious stale status and verification wording around ADR-112, Phase H, and root CNC handoff/build notes.
- Check the audit-doc patch for whitespace errors.

Evidence inspected:

- `git diff --name-only d603c01..HEAD` filtered to S01 paths.
- Targeted `rg` for `H.14`, `ADR-112`, `F-CNC35`, `Project material`, `project material`, `G1-G8`, and `G1-G8` variants across `PROJECT.md`, `AUDIT.md`, `DECISIONS.md`, and `WORKFLOW.md`.
- Targeted `rg` for `TODO`, `FIXME`, `TBD`, `not yet`, `pending`, `CLAIMED`, `DEFERRED`, and `VERIFIED` across current S01 docs.
- `git diff --check -- audit/REPOSITORY-SECTOR-ARCHITECTURE-2026-07-03.md audit/REPOSITORY-SECTOR-AUDIT-2026-07-03.md audit/REPOSITORY-SECTOR-PROGRESS-2026-07-03.md`.

Findings:

- No additional S01 delta findings.
- The broad pending/claimed markers are mostly longstanding hardware-verification honesty labels rather than new contradictions in the post-baseline docs.
- `D-S01-003` remains open as the only docs/content drift found in the current S01 delta.

Pass result:

- S01 delta Pass 3 complete.
- S01 delta sector closed after three passes.
- Move to S04 current-state delta audit.

### S04 Delta Pass 1 - Newly Classified Core CNC/Box/Relief/Simulation Orientation

Scope planned:

- Audit the S04 paths newly pulled into the current sector map: `src/core/box/**`, `src/core/cnc/**`, `src/core/relief/**`, and `src/core/sim/**`.
- Review the post-baseline S04 delta files: `src/core/cnc/feeds-calculator.ts`, `src/core/cnc/feeds-calculator.test.ts`, `src/core/cnc/index.ts`, and `src/core/scene/machine.ts`.
- Check exported core primitives for finite-value and size-budget invariants, because these folders include preview/simulation allocators and standalone CNC program generators.
- Run the focused valid-path S04 test slice.

Evidence inspected:

- `git diff --name-only d603c01..HEAD` filtered to S04 paths.
- `rg --files src/core/box src/core/cnc src/core/relief src/core/sim`.
- Export scan over `src/core/box`, `src/core/cnc`, `src/core/relief`, and `src/core/sim`.
- Targeted scan for `TODO`, `FIXME`, `throw new Error`, `NaN`, `Infinity`, casts, and nondeterminism markers in the same folders.
- Focused reads of `src/core/box/box-spec.ts`, `src/core/box/generate-box.ts`, `src/core/box/panel-fit.ts`, `src/core/cnc/compile-cnc-job.ts`, `src/core/cnc/profile-paths.ts`, `src/core/cnc/pocket-paths.ts`, `src/core/cnc/vcarve-ladder.ts`, `src/core/cnc/vcarve-clearance.ts`, `src/core/cnc/tile-plan.ts`, `src/core/cnc/surfacing.ts`, `src/core/cnc/feeds-calculator.ts`, `src/core/relief/mesh-to-heightmap.ts`, `src/core/relief/heightmap.ts`, `src/core/relief/relief-roughing.ts`, `src/core/relief/relief-finishing.ts`, `src/core/sim/removal-grid.ts`, `src/core/sim/removal-grid-display.ts`, and `src/core/sim/stamp-toolpath.ts`.
- Cross-checks of UI/IO guards in `src/ui/machine/SurfacingPanel.tsx`, `src/ui/machine/CncSetupPanel.tsx`, `src/ui/workspace/use-cnc-removal-grid.ts`, `src/ui/workspace/Cnc3DPane.tsx`, `src/ui/state/relief-param-actions.ts`, `src/io/project/deserialize-project.ts`, and `src/io/project/project-shape-validator.ts`.
- Focused test command passed: `pnpm exec vitest run src/core/box src/core/cnc src/core/relief src/core/sim` (28 test files, 170 tests).
- Focused material-key command passed: `pnpm exec vitest run src/core/cnc/feeds-calculator.test.ts` (1 file, 5 tests).

Findings:

#### D-S04-001 - Surfacing generator lacks core finite-value guards

Severity: Medium.

Evidence:

- `src/core/cnc/surfacing.ts` exports `surfacingRowYs(heightMm, stepMm)` and `buildSurfacingProgram(params)`.
- `surfacingRowYs` loops with `for (let y = 0; y < heightMm; y += stepMm)` and has no finite/positive guard on either argument.
- A zero or non-finite `stepMm` can make the row loop non-terminating; an infinite `heightMm` is also non-terminating.
- Non-finite or negative dimensions can also flow into formatted G-code comments and move commands, for example `fmt(NaN)` and `fmt(Infinity)`.
- `src/ui/machine/SurfacingPanel.tsx` clamps its own numeric inputs to finite values in `[0.1, 5000]`, but the core generator is exported from `src/core/cnc/index.ts` and its tests cover only valid parameters.

Risk:

The UI path normally masks the issue, but the core API itself can hang or emit invalid standalone surfacing G-code if called from another workflow, test helper, automation, or future import path with bad numeric input. This is a core safety boundary: invalid surfacing dimensions should fail closed instead of relying on every caller to sanitize perfectly.

No fix made.

#### D-S04-002 - Grid/heightmap sizing helpers can return malformed grids for non-finite dimensions

Severity: Medium.

Evidence:

- `src/core/sim/removal-grid.ts` exports `createRemovalGrid` and `coarsenedCellSize`, but `createRemovalGrid` does not require finite positive `widthMm`, `heightMm`, `originX`, `originY`, or `mmPerCell`.
- A quick runtime probe of the same sizing math showed `widthMm = NaN` or `Infinity` yields `widthCells: NaN`, `mmPerCell: NaN` or `Infinity`, and a zero-length `Float32Array`, while still producing a grid object shape.
- `src/core/relief/heightmap.ts` has the same finite-value gap in `heightmapCellSize`.
- `src/core/relief/mesh-to-heightmap.ts` checks `targetWidthMm > 0` and `reliefDepthMm > 0`, but `Infinity > 0` passes; downstream sizing can therefore produce a malformed "ok" heightmap instead of an error.
- Current UI/import paths mostly clamp or validate these values (`CncSetupPanel`, `relief-param-actions`, `deserialize-project`, and `project-shape-validator`), but the core helpers are exported and have no invalid-dimension tests.

Risk:

Malformed grid objects can make CNC preview, relief preview, or future simulation callers render blank/incorrect output while appearing successful. The 4M-cell ceiling protects huge finite grids, but non-finite dimensions bypass the intended memory/shape invariant.

No fix made.

Pass result:

- S04 delta Pass 1 complete.
- Valid-path regression coverage for newly classified S04 folders passed.
- S04 remains open for Pass 2 and Pass 3, with geometry/toolpath semantics and remaining exported-core contracts still to audit.

### S04 Delta Pass 2 - CNC Semantics and Project-Material Boundary Review

Scope planned:

- Recheck CNC compile ordering, tiling, relief rough/finish integration, and material-feed seeding paths.
- Verify whether the ADR-112 project material path can feed invalid numeric values into CNC layer settings.
- Cross-check valid-path tests for compile semantics, tiling, relief finish, feed calculation, project material, and CNC project persistence.

Evidence inspected:

- `src/core/cnc/compile-cnc-job.ts` and `src/core/cnc/compile-cnc-job.test.ts`.
- `src/core/cnc/tile-plan.ts` and `src/core/cnc/tile-plan.test.ts`.
- `src/core/cnc/compile-cnc-relief.ts` and `src/core/cnc/relief-finishing-compile.test.ts`.
- `src/core/cnc/feeds-calculator.ts` and `src/core/cnc/feeds-calculator.test.ts`.
- `src/ui/state/cnc-project-material.ts` and `src/ui/state/cnc-project-material.test.ts`.
- `src/ui/layers/CncMaterialRow.tsx`.
- `src/io/project/normalize-layer.ts`, `src/io/project/deserialize-project.ts`, and `src/io/project/project-machine-cnc.test.ts`.
- `src/io/project/project-scene-integrity-validator.ts` and related duplicate-layer-color tests, to confirm color-keyed layer identity is guarded at import.
- Focused command passed: `pnpm exec vitest run src/core/cnc/compile-cnc-job.test.ts src/core/cnc/tile-plan.test.ts src/core/cnc/relief-finishing-compile.test.ts src/core/cnc/feeds-calculator.test.ts src/ui/state/cnc-project-material.test.ts src/io/project/project-machine-cnc.test.ts` (6 files, 40 tests).

Findings:

#### D-S04-003 - Material feed seeding can persist non-finite feed values

Severity: Medium.

Evidence:

- `src/core/cnc/feeds-calculator.ts` validates material keys through `isChiploadMaterialKey`, but `calculateFeeds` does not require finite positive `bitDiameterMm`, `flutes`, or `rpm`.
- `calculateFeeds` multiplies `input.rpm * Math.max(1, Math.round(input.flutes)) * chiploadMm`; `rpm = NaN` yields `NaN` feed/plunge, and `rpm = Infinity` or `flutes = Infinity` yields non-finite feed values.
- `src/ui/state/cnc-project-material.ts` calls `calculateFeeds` and writes the returned `feedMmPerMin`, `plungeMmPerMin`, and `depthPerPassMm` into every CNC layer when applying a project material.
- `src/ui/layers/CncMaterialRow.tsx` does the same for the per-layer material picker.
- Normal UI and .lf2 paths generally clamp or normalize the source fields, but the core feed calculator and pure project-material helper are exported and the tests cover only finite valid inputs.

Risk:

If an invalid in-memory tool or layer setting reaches the material picker path, selecting a material can store non-finite feed/plunge values in project state. The compiler later caps non-finite feeds down to `1` mm/min rather than preserving the intended material preset or failing closed, and a non-finite depth-per-pass can collapse a job into a single full-depth pass. That is a CNC safety/behavior boundary, not only a display issue.

No fix made.

Pass result:

- S04 delta Pass 2 complete.
- Core compile ordering, tiling, relief finish integration, and valid project-material paths are covered by focused passing tests.
- S04 remains open for Pass 3 as a remaining-gap pass over box generation, relief/sim edge contracts, and audit-doc consistency.

### S04 Delta Pass 3 - Remaining Box/Relief/Simulation Gap Sweep

Scope planned:

- Recheck box generator validation, panel claims, layout, fit correction, and assembly-referee contracts.
- Recheck relief and simulation edge contracts not already covered in Pass 1 and Pass 2.
- Confirm focused tests cover the newly classified S04 folder families well enough to close the sector.
- Check audit-doc formatting before moving to S05.

Evidence inspected:

- `src/core/box/edge-pattern.ts`, `src/core/box/panel-claims.ts`, `src/core/box/layout.ts`, `src/core/box/panel-fit.ts`, `src/core/box/assembly-referee.ts`, `src/core/box/box-spec.test.ts`, and `src/core/box/generate-box.test.ts`.
- `src/core/relief/relief-surface-mesh.ts`, `src/core/relief/relief-roughing.ts`, `src/core/relief/relief-finishing.ts`, and their focused tests.
- `src/core/sim/stamp-toolpath.ts`, `src/core/sim/tool-kernels.ts`, `src/core/sim/removal-grid-display.ts`, and their focused tests.
- Focused command passed: `pnpm exec vitest run src/core/box src/core/relief src/core/sim` (15 files, 93 tests).
- Audit-doc formatting check passed after Pass 1 updates: `git diff --check -- audit/REPOSITORY-SECTOR-ARCHITECTURE-2026-07-03.md audit/REPOSITORY-SECTOR-AUDIT-2026-07-03.md audit/REPOSITORY-SECTOR-PROGRESS-2026-07-03.md`.

Findings:

- No additional S04 delta findings.
- Box generation has strong finite-value validation before generation, deterministic layout tests, property/fuzz coverage for panel geometry, and an independent assembly-referee check.
- Relief and simulation have good valid-path coverage for mesh sampling, roughing, finishing, surface mesh generation, kernels, display downsampling, and toolpath stamping. The remaining weaknesses are the numeric-boundary gaps already recorded in `D-S04-002` and `D-S04-003`.

Pass result:

- S04 delta Pass 3 complete.
- S04 current-state delta sector closed after three passes.
- Move to S05 current-state delta audit.

### S05 Delta Pass 1 - Trace Pipeline and Auto-Upscale Orientation

Scope planned:

- Audit the post-baseline S05 delta files under `src/core/trace/**`.
- Review the current trace orchestration points: preset wiring, trace dispatch, preprocessing, auto-upscale, edge detection, centerline, and potrace entry points.
- Check whether the new trace smoothing/upscale/apex work preserves bounded valid-path behavior and has clear API contracts at exported helper boundaries.
- Run focused valid-path trace tests.

Evidence inspected:

- `git diff --name-only d603c01..HEAD` filtered to `src/core/(invariants|job|output|preflight|raster|trace)`.
- `git diff --stat d603c01..HEAD -- src/core/trace`, showing 39 changed trace files with 3,654 insertions and 216 deletions.
- `rg --files src/core/trace` and targeted scans for `TODO`, `FIXME`, `NaN`, `Infinity`, casts, throws, logging, clocks, and random usage.
- Focused reads of `src/core/trace/auto-upscale.ts`, `src/core/trace/trace-image.ts`, `src/core/trace/trace-to-paths.ts`, `src/core/trace/trace-presets.ts`, `src/core/trace/edge-trace.ts`, `src/core/trace/centerline/trace-centerline.ts`, `src/core/trace/preprocess.ts`, `src/core/trace/potrace-bitmap.ts`, and `src/core/trace/index.ts`.
- Cross-check reads of `src/ui/trace/image-loader.ts`, `src/ui/trace/use-trace-worker-client.ts`, and `src/ui/trace/trace-worker.ts`.
- Focused command passed: `pnpm exec vitest run src/core/trace/auto-upscale.test.ts src/core/trace/trace-to-paths.test.ts src/core/trace/trace-image.test.ts src/core/trace/edge-trace.test.ts src/core/trace/centerline/centerline.test.ts` (5 test files, 78 tests).

Findings:

#### D-S05-001 - Auto-upscale exported helpers do not validate scale factors

Severity: Low.

Evidence:

- `src/core/trace/auto-upscale.ts` exports `upscaleBy(image, factor)` and `downscaleTracedPaths(paths, factor)`.
- `upscaleBy` computes `outWidth = image.width * factor`, `outHeight = image.height * factor`, then allocates `new Uint8ClampedArray(outWidth * outHeight * 4)` and divides by `factor` during bilinear sampling.
- `downscaleTracedPaths` divides every vector coordinate by `factor`.
- Internal trace dispatch uses `upscaleFactorFor(...)`, which only returns `2` or `3` today, so the surfaced preset path is valid.
- The helpers are still exported and tested directly, but the direct tests only cover valid positive integer factors.

Risk:

Future direct callers can pass `0`, negative, fractional, `NaN`, or `Infinity` factors and get zero/invalid buffers, allocation exceptions, non-finite traced coordinates, or incoherent image dimensions. The normal import flow does not appear exposed today, but the core helper contract is unclear at an exported API boundary.

No fix made.

#### D-S05-002 - Trace core accepts malformed RawImageData shape without an explicit guard

Severity: Low.

Evidence:

- `src/core/trace/trace-image.ts` defines `RawImageData` as `{ width, height, data }` but does not check that dimensions are finite positive integers or that `data.length === width * height * 4`.
- `preprocessForTrace`, `medianFilter`, `thresholdToMonochrome`, `thresholdBandToMonochrome`, `alphaToMonochrome`, `sketchTraceToMonochrome`, `inkMask`, centerline mask construction, and potrace bitmap conversion assume the dimension/data-length contract and often use `?? 0` or `?? 255` when channels are missing.
- `src/ui/trace/image-loader.ts` constructs valid buffers from canvas `ImageData` and applies header decode caps, so the normal UI import path is guarded indirectly.
- Worker and inline trace entry points still accept `RawImageData` structurally, and current tests cover valid image buffers rather than malformed dimension/data-length pairs.

Risk:

Malformed in-memory inputs can be traced as silently whitened, darkened, truncated, or otherwise corrupted images instead of failing closed with a clear error. That can hide upstream loader or worker-message bugs and makes the pure trace API harder to reuse safely.

No fix made.

Pass result:

- S05 delta Pass 1 complete.
- The focused trace suite passed for current valid-path behavior.
- S05 remains open for Pass 2 and Pass 3, with post-baseline trace algorithm internals, apex recovery, smoothing, and benchmark fixture coverage still to audit.

### S05 Delta Pass 2 - Edge, Centerline, Potrace, and Smoothing Internals

Scope planned:

- Audit backend-specific trace internals added or changed after the baseline: Canny edge detection, gradient/ridge reconnection, sub-pixel snapping, apex recovery, potrace dispatch, centerline smoothing/closure, and spatial acceleration.
- Check whether backend option inputs are bounded at the pure-core level or only by surfaced UI controls.
- Run the backend-heavy trace test slice.

Evidence inspected:

- `src/core/trace/canny-edges.ts` and `src/core/trace/canny-gradient.ts`.
- `src/core/trace/edge-trace.ts`, `src/core/trace/edge-reconnect.ts`, `src/core/trace/edge-subpixel.ts`, and `src/core/trace/edge-ink-support.ts`.
- `src/core/trace/potrace-apex.ts`, `src/core/trace/potrace-trace.ts`, and `src/core/trace/potrace-path-scanner.ts`.
- `src/core/trace/centerline/stroke-chains.ts`, `src/core/trace/centerline/loop-closure.ts`, `src/core/trace/centerline/chain-smoothing.ts`, `src/core/trace/centerline/curve-fit.ts`, `src/core/trace/centerline/spatial-grid.ts`, and adjacent centerline tests.
- `src/ui/trace/trace-options.ts` and `src/ui/trace/trace-options.test.ts` to check surfaced edge-control clamping.
- Focused command passed: `pnpm exec vitest run src/core/trace/canny-edges.test.ts src/core/trace/edge-trace.test.ts src/core/trace/edge-trace-determinism.test.ts src/core/trace/edge-subpixel.test.ts src/core/trace/potrace-apex.test.ts src/core/trace/potrace-trace.test.ts src/core/trace/centerline/chain-smoothing.test.ts src/core/trace/centerline/curve-fit.test.ts src/core/trace/centerline/loop-closure.test.ts src/core/trace/centerline/spatial-grid.test.ts src/core/trace/centerline/thick-blob.test.ts src/core/trace/centerline/centerline.test.ts` (12 test files, 69 tests).

Findings:

#### D-S05-003 - Canny edge core does not bound threshold ratios or blur sigma

Severity: Low.

Evidence:

- `src/core/trace/canny-edges.ts` exports `cannyEdges(image, options)` and `cannyEdgeField(image, options)`.
- `cannyEdgeField` passes `options.blurSigma` directly to `computeGradient`.
- `src/core/trace/canny-gradient.ts` builds a Gaussian kernel with `Math.ceil(sigma * 3)` when `blurSigma > 0`; a very large or infinite positive sigma can therefore request an unbounded kernel allocation.
- `cannyEdgeField` passes `lowThresholdRatio` and `highThresholdRatio` straight into hysteresis. Negative or non-finite threshold ratios can classify all pixels as strong edges, suppress all edges, or return a `lowThreshold` of `NaN`.
- `src/ui/trace/trace-options.ts` maps surfaced Edge Detection controls through clamped `0..100` sliders, and the built-in `Edge Detection` preset uses finite values, so the normal UI path is bounded.
- Direct core tests cover valid sensitivity/blur cases, flat images, ridge reconnection, sub-pixel smoothing, apex snapping, and determinism; they do not cover invalid Canny option values.

Risk:

The user-facing trace controls are safe today, but the exported Canny core API can still produce pathological edge maps or allocation failures when reused with bad numeric options. That makes the pure trace layer rely on every direct caller preserving UI-era constraints.

No fix made.

Pass result:

- S05 delta Pass 2 complete.
- Backend valid-path coverage is strong for Canny, edge ridge reconnection, deterministic spatial-grid acceleration, sub-pixel ridge snapping, potrace apex recovery, centerline loop closure, smoothing, and thick-blob recovery.
- S05 remains open for one remaining-gap pass over trace benchmarks, preprocessing/raster-prep edges, batch trace, trace-boundary/cropping, and audit-doc consistency.

### S05 Delta Pass 3 - Preprocess, Batch Trace, Boundary, and Closure Sweep

Scope planned:

- Recheck preprocessing, raster-prep image adjustments, trace boundary/crop helpers, batch trace SVG export, and the multi-file trace wrapper.
- Confirm user-facing trace option and raster adjustment paths still clamp their controls before they reach the core helpers.
- Note trace benchmark/perceptual harness files for S09, because they live under `src/__fixtures__/perceptual/**` and will be audited in that sector.
- Run focused support-path tests and close S05 if no major area remains unchecked.

Evidence inspected:

- `src/core/trace/preprocess.ts`, `src/core/trace/preprocess.test.ts`, and `src/core/trace/preprocess-auto-median.test.ts`.
- `src/core/trace/raster-prep.ts` and `src/core/trace/raster-prep.test.ts`.
- `src/core/trace/batch-trace.ts`, `src/core/trace/batch-trace.test.ts`, `src/core/trace/paths-to-svg.ts`, `src/core/trace/trace-boundary.ts`, and `src/core/trace/trace-boundary.test.ts`.
- `src/core/trace/potrace-params.ts`, `src/core/trace/potrace-bitmap.ts`, and their focused tests.
- `src/ui/commands/multi-file-trace-action.ts` and `src/ui/commands/multi-file-trace-action.test.ts`.
- `src/ui/state/raster-adjustment-actions.ts`, confirming UI/state raster adjustment patches clamp non-finite values to finite ranges before persistence.
- `git diff --name-only d603c01..HEAD -- src/core/trace src/ui/trace src/ui/commands src/__fixtures__/perceptual`, confirming perceptual trace benchmark additions are S09-owned.
- Focused command passed: `pnpm exec vitest run src/core/trace/preprocess.test.ts src/core/trace/preprocess-auto-median.test.ts src/core/trace/raster-prep.test.ts src/core/trace/batch-trace.test.ts src/core/trace/trace-boundary.test.ts src/core/trace/potrace-params.test.ts src/core/trace/potrace-bitmap.test.ts src/ui/commands/multi-file-trace-action.test.ts` (8 test files, 67 tests).

Findings:

#### D-S05-004 - Trace image-adjustment options do not fail closed on non-finite values

Severity: Low.

Evidence:

- `src/core/trace/trace-image.ts` includes optional `brightness`, `contrast`, and `gamma` fields in `TraceOptions`, and `applyImageAdjustments` calls `adjustBrightness`, `adjustContrast`, and `adjustGamma` whenever those fields are present and non-neutral.
- `src/core/trace/raster-prep.ts` clamps ordinary numeric ranges but does not explicitly handle `NaN` or `Infinity`.
- `adjustBrightness(image, NaN)` and `adjustContrast(image, NaN)` feed `NaN` into `clampByte`; assigning `NaN` to a `Uint8ClampedArray` channel stores `0`, silently blackening adjusted channels.
- `adjustGamma(image, NaN)` computes a `NaN` gamma clamp and then also writes `NaN`-derived channel values.
- The user-facing raster adjustment state path clamps non-finite values in `src/ui/state/raster-adjustment-actions.ts`, and the trace dialog does not currently surface brightness/contrast/gamma controls. Current tests cover valid adjustment ranges and clamping of finite out-of-range gamma values, not non-finite direct core options.

Risk:

The surfaced UI path is guarded, but direct trace callers or future trace-adjustment controls can turn invalid numeric options into corrupted all-black/zeroed preprocessing instead of a clear no-op or validation error. That makes trace output harder to diagnose if a bad option object reaches the worker/core boundary.

No fix made.

Pass result:

- S05 delta Pass 3 complete.
- S05 current-state delta sector closed after three passes.
- S05 delta findings are `D-S05-001` through `D-S05-004`, all low severity and all open.
- Move to S06 current-state delta audit.

### S06 Delta Pass 1 - Project Material Persistence Orientation

Scope planned:

- Audit the post-baseline S06 delta files: `src/io/project/deserialize-project.ts`, `src/io/project/normalize-layer.ts`, and `src/io/project/project-machine-cnc.test.ts`.
- Check ADR-112 project stock material persistence and ADR-111 layer material-key persistence.
- Cross-check the UI/state helper that creates material-key values so IO behavior is evaluated against its primary caller.
- Run focused project IO and project-material state tests.

Evidence inspected:

- `git diff --name-only d603c01..HEAD -- src/io src/platform`.
- `git diff --stat d603c01..HEAD -- src/io src/platform`.
- `src/io/project/deserialize-project.ts`, especially `normalizeMachineValue(...)` and `stock.materialKey` filtering.
- `src/io/project/normalize-layer.ts`, especially optional CNC layer `materialKey` filtering.
- `src/io/project/project-machine-cnc.test.ts`.
- `src/io/project/project-shape-validator.ts`, confirming optional `machine` config is normalized after the core project-shape gate.
- `src/io/project/serialize-project.ts`.
- `src/ui/state/cnc-project-material.ts`.
- Focused command passed: `pnpm exec vitest run src/io/project/project-machine-cnc.test.ts src/io/project/project.test.ts src/io/project/project-security-validation.test.ts src/io/project/project-air-assist.test.ts src/io/project/project-machine-profile.test.ts src/io/project/project-scan-offset.test.ts src/ui/state/cnc-project-material.test.ts src/ui/state/cnc-project-material-action.test.ts` (8 test files, 61 tests).

Findings:

- No new S06 delta findings in Pass 1.
- The changed stock material persistence path keeps only known chipload material keys and drops unknown stock material keys on deserialize.
- The changed layer CNC material persistence path keeps only known material keys and drops unknown layer material keys on deserialize.
- The focused project IO/security tests still pass around machine normalization, layer normalization, project budgets, scan offsets, and project-material store actions.

Pass result:

- S06 delta Pass 1 complete.
- S06 remains open for Pass 2 and Pass 3, with migration/backfill behavior, serializer/normalizer edge cases, and adjacent import/persistence contracts still to audit.

### S06 Delta Pass 2 - Migration, Backfill, and Adjacent Persistence Sweep

Scope planned:

- Recheck project migrations/backfill behavior and schema-version handling.
- Recheck project layer shape validation and sub-layer validation around optional fields that normalize later.
- Sweep adjacent persistence surfaces that can interact with CNC machine/material state: autosave, CNC library persistence, and material library IO.
- Run a broader IO persistence test slice.

Evidence inspected:

- `src/io/project/migrations.ts`.
- `src/io/project/project-layer-shape-validator.ts`.
- `src/io/project/project-layer-validator.ts`.
- Targeted `rg` over `src/io/project`, `src/io/material-library`, and `src/ui/state` for machine, stock, material key, serialize/deserialize, and migration references.
- Focused command passed: `pnpm exec vitest run src/io/project src/io/material-library src/ui/state/autosave.test.ts src/ui/state/cnc-library-actions.test.ts src/ui/state/cnc-library-persistence.test.ts src/ui/state/material-library-persistence.test.ts` (25 test files, 159 tests).

Findings:

- No new S06 delta findings in Pass 2.
- Project migrations remain intentionally empty at schema v1 and the migration dispatch tests pass.
- Project shape validation continues to enforce required project/layer structure while machine/layer CNC optional details are normalized afterward, matching the existing forgiving-load contract.
- Adjacent autosave, material library, and CNC library persistence tests pass.

Pass result:

- S06 delta Pass 2 complete.
- S06 remains open for one remaining-gap pass over direct diff review, project import/export edge contracts, and audit-doc consistency.

### S06 Delta Pass 3 - Direct Diff and Import/Export Edge Closure

Scope planned:

- Re-review the exact S06 diff since the completed audit/fix baseline.
- Recheck the shared chipload-material key predicate used by project stock material persistence and layer CNC material persistence.
- Recheck project import/export edge contracts: validator gate, normalizer behavior, deterministic serializer, adjacent material library IO, and G-code IO.
- Close S06 only if no major S06 areas remain unchecked.

Evidence inspected:

- `git diff --name-status d603c01..HEAD -- src/io src/platform`, confirming the S06 product delta is limited to `src/io/project/deserialize-project.ts`, `src/io/project/normalize-layer.ts`, and `src/io/project/project-machine-cnc.test.ts`.
- `git diff --unified=80 d603c01..HEAD -- src/io/project/deserialize-project.ts src/io/project/normalize-layer.ts src/io/project/project-machine-cnc.test.ts`.
- `src/core/cnc/feeds-calculator.ts`, especially `isChiploadMaterialKey(...)`.
- `src/io/project/project-shape-validator.ts`, `src/io/project/project-layer-shape-validator.ts`, and `src/io/project/project-layer-validator.ts`.
- `src/io/project/serialize-project.ts`.
- Targeted `rg` over `src/io/project`, `src/io/material-library`, and `src/io/gcode` for material, stock, machine, schema, migration, normalize, serialize, and deserialize references.
- Focused command passed: `pnpm exec vitest run src/io/project src/io/material-library src/io/gcode` (29 test files, 178 tests).

Findings:

- No new S06 delta findings in Pass 3.
- Direct diff review showed the added material-key persistence uses the same closed chipload key predicate for project stock and layer CNC fields.
- The serializer remains deterministic and intentionally unfiltered; stale-key rejection happens on deserialize, matching the existing project-load boundary.
- Project validators still reject malformed required project shape while allowing optional machine/CNC details to be normalized field-by-field after the shape gate.
- Project, material-library, and G-code IO tests all pass.

Pass result:

- S06 current-state delta sector closed after three passes.
- S06 delta opened no new findings.
- A later fast-forward introduced an S02 build-configuration delta, so the audit returns to S02 delta Pass 1 before moving on to S08/S09.

### S02 Delta Pass 1 - Deterministic Build-Time Configuration

Scope planned:

- Inspect the S02 delta introduced by the latest fast-forward: deterministic build-time metadata in `vite.config.ts`.
- Recheck the surrounding release/deploy gate and PWA policy tests that should protect production build behavior.
- Run the focused web platform policy tests and a production web build.

Evidence inspected:

- `git diff --name-status d603c01..HEAD -- package.json pnpm-lock.yaml vite.config.ts vitest.config.ts tsconfig.json tsconfig.*.json eslint.config.* scripts .github .npmrc index.html src/platform/web DECISIONS.md README.md`, showing S02 product/config delta in `vite.config.ts` plus S01 docs in `DECISIONS.md`.
- `git diff --unified=80 d603c01..HEAD -- vite.config.ts package.json src/platform/web/deploy-workflow-gate.test.ts`.
- `vite.config.ts`, especially `buildTimeIso()`, `__BUILD_TIME__`, `__GIT_SHA__`, `__APP_VERSION__`, PWA config, chunk splitting, and build target.
- `package.json`, especially `release:check`, `build:web`, and `deploy:web`.
- `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`.
- `src/platform/web/deploy-workflow-gate.test.ts` and `src/platform/web/pwa-precache.test.ts`.
- `DECISIONS.md` ADR-060 PWA update model notes.
- Targeted `rg` over TypeScript, scripts, workflows, JSON, and docs for `__BUILD_TIME__`, `buildTimeIso`, `new Date`, service-worker/precache, and deterministic build references.
- Focused command passed: `pnpm exec vitest run src/platform/web/deploy-workflow-gate.test.ts src/platform/web/pwa-precache.test.ts` (2 test files, 8 tests).
- Focused command passed: `pnpm build:web`; build completed and generated `dist/web/sw.js`, but Vite still emitted a chunk-size warning for `assets/three.module-*.js` at about 704.87 kB.

#### D-S02-001 - Deterministic build-time metadata has no direct regression test

Evidence:

- `vite.config.ts` now derives `__BUILD_TIME__` from `git show -s --format=%cI HEAD` through `buildTimeIso()` instead of `new Date().toISOString()`, fixing the intended same-commit rebuild determinism issue.
- Targeted search found no test or script that imports/exercises `buildTimeIso()`, stubs git metadata, or proves that two builds of the same commit keep the same `__BUILD_TIME__`/PWA precache identity.
- Existing deploy/PWA policy tests passed, but they cover deploy gating and precache inclusion, not the specific no-wall-clock-regression contract.

Risk:

A future config edit could reintroduce wall-clock build metadata, producing a new service worker/precache for a no-op redeploy and reviving the update-banner churn this delta is meant to prevent. The current implementation looks reasonable, but the release gate does not directly protect the new behavior.

Recommendation:

Add a small config/build-metadata regression test or script that proves same-commit build metadata is derived from commit data, not wall-clock time. If direct Vite config import is awkward, extract the build-info helpers into a tiny testable module.

#### D-S02-002 - Production web build still emits a Vite chunk-size warning

Evidence:

- `pnpm build:web` completed successfully but emitted Vite's large-chunk warning.
- The largest reported raw chunk was `dist/web/assets/three.module-*.js` at about 704.87 kB, above the configured `chunkSizeWarningLimit: 500`.
- `vite.config.ts` comments say the manual chunking keeps individual raw chunks below Vite's 500 kB warning threshold, but the current build output contradicts that.
- `README.md` still describes the local gate as having a "clean web build", which is too strong while the current production build emits the Vite warning.
- `release:check` treats this warning as non-fatal, so the production deploy path can remain green while the warning persists.

Risk:

This is not a correctness failure, but it weakens the release signal: a known production build warning can hide future size regressions, and the comment/config no longer describe the actual bundle shape.

Recommendation:

Either split or lazy-load the Three.js relief-preview path enough to remove the warning, or explicitly raise/document the chunk warning threshold and add a bundle-size check that reflects the accepted production budget.

Findings:

- Opened `D-S02-001` (low): deterministic build-time metadata has no direct regression test.
- Opened `D-S02-002` (low): production web build still emits a Vite chunk-size warning.

Pass result:

- S02 delta Pass 1 complete.
- S02 remains open for Pass 2 and Pass 3, with CI/deploy workflow semantics, config helper edge cases, and remaining release-policy drift still to audit.

### S02 Delta Pass 2 - Release Gate and Rebuild Determinism Sweep

Scope planned:

- Recheck CI/deploy workflow semantics around the changed build metadata.
- Verify same-commit rebuild output determinism directly from current `dist/web`.
- Recheck repo guard and raw-line/file-size release policy after the latest fast-forward.

Evidence inspected:

- `.github/workflows/deploy.yml`, especially checkout `ref: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || github.ref }}`, `fetch-depth: 0`, `pnpm release:check`, and `cloudflare/wrangler-action@v3`.
- `.github/workflows/ci.yml`, especially the shared `pnpm release:check` gate.
- `package.json`, especially `release:check`, `build:web`, `deploy:web`, and `deploy:web:preview`.
- `src/platform/web/deploy-workflow-gate.test.ts`, `src/platform/web/repo-policy.test.ts`, and `src/platform/web/pwa-precache.test.ts`.
- Targeted `rg` over `package.json`, `vite.config.ts`, workflows, scripts, and platform policy tests for release gate, checkout, build metadata, chunk splitting, and file-size references.
- Command passed: same-commit `dist/web` manifest comparison around a fresh `pnpm build:web`; result `DIST_TREE_MATCH_AFTER_REBUILD`.
- Command passed: `pnpm guard:repo`.
- Command passed: `pnpm check:file-size`.

Findings:

- No new S02 delta findings in Pass 2.
- Same-commit rebuild output matched byte-for-byte across `dist/web`, so the current build-time metadata implementation behaves deterministically in practice.
- Deploy workflow still checks out the CI-validated `workflow_run.head_sha` and uses full history, preserving the commit-count version badge and avoiding deploy-race drift.
- CI, deploy workflow, local `deploy:web`, and local `deploy:web:preview` all route through the shared `release:check` gate.
- Repo identity guard and raw-line/file-size backstop both pass.
- The two S02 risks already opened in Pass 1 remain: the deterministic build-time behavior is not pinned by a direct test, and the Vite large-chunk warning remains.

Pass result:

- S02 delta Pass 2 complete.
- S02 remains open for one remaining-gap pass over docs/ADR alignment, static policy-test coverage, and final release-tooling consistency.

### S02 Delta Pass 3 - Docs and Static Policy Closure

Scope planned:

- Recheck docs/ADR alignment for the PWA update model, build metadata, and production web build claims.
- Recheck the static policy tests that protect deploy, repo policy, and PWA precache behavior.
- Decide whether S02 has any major unchecked areas after the two prior passes.

Evidence inspected:

- `git diff --unified=60 d603c01..HEAD -- DECISIONS.md README.md AUDIT.md PROJECT.md WORKFLOW.md`.
- `DECISIONS.md` ADR-060 update-note correction for already-waiting service workers and per-build "Later" dismissal.
- `README.md`, `AUDIT.md`, `PROJECT.md`, and `WORKFLOW.md` references to build warnings, release checks, service-worker updates, bundle/chunk policy, and the current build/deploy path.
- `src/platform/web/repo-policy.test.ts`.
- `src/platform/web/pwa-precache.test.ts`.
- Focused command passed: `pnpm exec vitest run src/platform/web/deploy-workflow-gate.test.ts src/platform/web/repo-policy.test.ts src/platform/web/pwa-precache.test.ts` (3 test files, 16 tests).

Findings:

- No new S02 delta findings in Pass 3.
- The ADR-060 correction around already-waiting service workers is consistent with the S08 PWA implementation delta that will be audited in the UI sector.
- Static policy tests still pin shared `release:check`, deploy checkout safety, repo-policy expectations, and PWA precache coverage.
- Documentation review added supporting evidence to `D-S02-002`: README still says "clean web build" while current `pnpm build:web` emits a Vite large-chunk warning.
- Existing S02 delta findings remain `D-S02-001` and `D-S02-002`.

Pass result:

- S02 current-state delta sector closed after three passes.
- Move to S08 current-state delta audit; a later fast-forward reopened S04 before S08 could start.

### S04 Post-Fast-Forward Delta Pass 1 - CNC Machine Catalog and Default Bits

Scope planned:

- Inspect the S04 core delta introduced after the earlier S04 delta sector had already closed.
- Focus on `src/core/cnc/cnc-machine-catalog.ts`, `src/core/scene/machine.ts`, the core CNC public API, and the compiler/tool-selection call paths affected by the broader default bit library.
- Run focused core CNC, project round-trip, and machine-preset tests.

Evidence inspected:

- `git diff --unified=80 d0efd16..HEAD -- src/core/cnc/cnc-machine-catalog.ts src/core/cnc/cnc-machine-catalog.test.ts src/core/cnc/cnc-multi-tool.test.ts src/core/cnc/index.ts src/core/scene/machine.ts`.
- `src/core/cnc/cnc-machine-catalog.ts`.
- `src/core/scene/machine.ts`, especially `DEFAULT_CNC_TOOLS`, `DEFAULT_CNC_MACHINE_CONFIG`, `activeCncTool(...)`, and `layerCncTool(...)`.
- `src/core/cnc/compile-cnc-job.ts`, especially v-carve, drill, and tool-selection behavior.
- `src/io/project/deserialize-project.ts`, especially `normalizeCncTools(...)`.
- Targeted `rg` over S04/S08 callers for default CNC tools, machine catalog, machine preset application, spindle max, stock, active tool, and probe references.
- Focused command passed: `pnpm exec vitest run src/core/cnc/cnc-machine-catalog.test.ts src/core/cnc/cnc-multi-tool.test.ts src/core/cnc/compile-cnc-job.test.ts src/core/cnc/vcarve-ladder.test.ts src/core/cnc/vcarve-perceptual.test.ts src/io/project/project-machine-cnc.test.ts src/ui/state/cnc-machine-preset.test.ts` (7 test files, 40 tests).

#### D-S04-004 - Expanded default CNC tool library lacks an invariant test for its stable-ID contract

Evidence:

- `src/core/scene/machine.ts` now expands `DEFAULT_CNC_TOOLS` and documents that existing IDs are stable and that future changes should only append.
- The new catalog test validates `CNC_MACHINE_CATALOG`, but there is no equivalent invariant test for `DEFAULT_CNC_TOOLS`.
- Existing CNC tests exercise selected defaults indirectly, but they do not assert all built-in tool IDs are unique, all diameters are finite/positive, all v-bit/engraving angle fields are finite where required, or that the default `toolId` still exists in the library.

Risk:

The default tool library is persisted in `.lf2` machine configs and drives layer tool selection, tool-change comments, v-carve geometry, relief finishing, and feeds/material UI. A duplicate/stale ID or malformed built-in tool entry would be hard to spot because most tests cover only a few IDs.

Recommendation:

Add a focused default-tool-library invariant test next to `machine.ts` or the CNC catalog tests, pinning unique IDs, finite positive diameters, kind-specific angle rules, default `toolId` membership, and append-only/stable IDs for the existing built-ins.

Findings:

- Opened `D-S04-004` (low): expanded default CNC tool library lacks an invariant test for its stable-ID contract.
- Existing core compiler and project round-trip tests still pass after the new machine catalog and default bit names.

Pass result:

- S04 post-fast-forward delta Pass 1 complete.
- S04 remains open for two supplemental passes over catalog-to-state application, project/IO normalization, and CNC compiler edge behavior around the expanded tool set.

### S04 Post-Fast-Forward Delta Pass 2 - Catalog Application and Persistence Boundary

Scope planned:

- Recheck how the core CNC machine catalog crosses into application state without changing product code.
- Recheck project round-trip behavior around machine configs and the expanded default tool library.
- Recheck adjacent CNC library and Material & Bit panel tests for regressions around the new catalog row and project material row.

Evidence inspected:

- `src/ui/state/machine-actions.ts`, especially `applyCncMachinePreset(...)`.
- `src/ui/state/cnc-machine-preset.test.ts`.
- `src/ui/machine/CncMachineCatalogRow.tsx`.
- `src/ui/machine/CncSetupPanel.tsx`.
- `src/io/project/project-machine-cnc.test.ts`.
- Focused command passed: `pnpm exec vitest run src/ui/state/cnc-machine-preset.test.ts src/ui/state/cnc-library-actions.test.ts src/ui/state/cnc-library-persistence.test.ts src/io/project/project-machine-cnc.test.ts src/ui/machine/CncSetupPanel.material.test.tsx` (4 test files discovered, 21 tests).

Findings:

- No new S04 delta findings in Pass 2.
- `applyCncMachinePreset(...)` is CNC-only, undoable, marks the project dirty, and updates the shared device bed plus CNC `spindleMaxRpm` without rewriting stock dimensions.
- Project CNC machine round-trip tests still pass with the expanded default library.
- CNC library action tests and Material & Bit project-material tests still pass around adjacent tool/profile/material workflows.
- `D-S04-004` remains open as the default-tool-library invariant coverage gap found in Pass 1.

Pass result:

- S04 post-fast-forward delta Pass 2 complete.
- S04 remains open for one remaining-gap pass over direct compiler semantics, default tool shape invariants, and audit-doc consistency.

### S04 Post-Fast-Forward Delta Pass 3 - Compiler Semantics and Tool Boundary Closure

Scope planned:

- Recheck compiler, project, and state call paths that consume the expanded default CNC tool library.
- Recheck tool boundary assumptions around tool IDs, bit kinds, diameters, and angle fields without changing product code.
- Run a broader CNC core/project/state slice and close S04 only if no major S04 areas remain unchecked.

Evidence inspected:

- Targeted `rg` over `src/core`, `src/io/project`, and `src/ui/state` for `DEFAULT_CNC_TOOLS`, `CNC_MACHINE_CATALOG`, `FALLBACK_TOOL`, `tipAngleDeg`, `diameterMm`, engraving/v-bit kinds, layer tool IDs, relief finish tools, active CNC tools, and project tool normalization.
- `src/core/scene/machine.ts`, especially default tool definitions and fallback/default machine configuration.
- `src/core/cnc/compile-cnc-job.ts` and adjacent CNC operation compilers through the broad CNC test slice.
- `src/io/project/deserialize-project.ts`, especially `normalizeCncTools(...)`.
- `src/ui/state/cnc-machine-preset.test.ts`.
- Focused command passed: `pnpm exec vitest run src/core/cnc src/io/project/project-machine-cnc.test.ts src/ui/state/cnc-machine-preset.test.ts` (16 test files, 91 tests).
- Audit-doc whitespace check passed: `git diff --check -- audit/REPOSITORY-SECTOR-ARCHITECTURE-2026-07-03.md audit/REPOSITORY-SECTOR-AUDIT-2026-07-03.md audit/REPOSITORY-SECTOR-PROGRESS-2026-07-03.md`.

Findings:

- No new S04 delta findings in Pass 3.
- Broad CNC compiler/project/state coverage still passes across multi-tool, profile, pocket, tile, surfacing, v-carve, relief finishing, motion polish, depth-pass, catalog, feed, project round-trip, and preset tests.
- The remaining S04 post-fast-forward risk is still `D-S04-004`: the expanded built-in tool library needs a direct invariant test for its stable-ID and shape contract.

Pass result:

- S04 post-fast-forward delta refresh closed after three supplemental passes.
- S04 delta findings remain open in the audit ledger, but no major S04 audit area remains unchecked for the current tree.
- Move to S02 current-state delta refresh for the later `cd5c7f4` runner-speed CI test/config changes before S08.

### S02 Post-cd5c7f4 Delta Pass 1 - Vitest Runner-Speed Configuration

Scope planned:

- Inspect the S02 tooling/config delta introduced by `cd5c7f4`.
- Focus on `vitest.config.ts`, CI-only worker throttling, and the new test-budget helper surface that supports slower shared CI runners.
- Run focused local-mode and CI-mode test slices plus TypeScript checking.

Evidence inspected:

- `git diff --unified=100 17e11f8..cd5c7f4 -- vitest.config.ts src/__fixtures__/ci-budget.ts src/__fixtures__/ci-budget.test.ts src/__fixtures__/perceptual/centerline-perf.test.ts src/core/camera/calibrate-sweep.test.ts src/core/camera/detect-checkerboard.test.ts`.
- `vitest.config.ts`, especially `maxWorkers: process.env.CI ? 1 : 4`.
- `src/__fixtures__/ci-budget.ts` and `src/__fixtures__/ci-budget.test.ts`.
- Targeted `rg` over `src/platform/web`, `package.json`, `scripts`, `.github`, `vitest.config.ts`, and the CI budget helper files for `maxWorkers`, `vitest.config`, `onTaskUpdate`, `ciBudgetMs`, `CI runner`, and `release:check`.
- Focused local-mode command passed: `pnpm exec vitest run src/__fixtures__/ci-budget.test.ts src/__fixtures__/perceptual/centerline-perf.test.ts src/core/camera/calibrate-sweep.test.ts src/core/camera/detect-checkerboard.test.ts` (4 test files, 19 tests).
- Focused CI-mode command passed: `$env:CI='true'; pnpm exec vitest run src/__fixtures__/ci-budget.test.ts src/__fixtures__/perceptual/centerline-perf.test.ts src/core/camera/calibrate-sweep.test.ts src/core/camera/detect-checkerboard.test.ts; Remove-Item Env:CI -ErrorAction SilentlyContinue` (4 test files, 19 tests).
- Focused command passed: `pnpm exec tsc --noEmit --pretty false`.

#### D-S02-003 - CI-only Vitest worker throttling has no direct policy regression test

Evidence:

- `vitest.config.ts` now changes full-suite parallelism from a fixed `maxWorkers: 4` to `maxWorkers: process.env.CI ? 1 : 4` to avoid Vitest worker RPC timeout flakes on the two-vCPU private CI runner.
- The new `ciBudgetMs(...)` helper is directly unit-tested for unset, non-empty, and empty `CI` values.
- Targeted search found no equivalent policy/regression test that pins the actual `vitest.config.ts` worker throttle, the intended CI value of `1`, or the intended local value of `4`.
- `release:check` and the GitHub workflows exercise the config indirectly, but a future accidental config edit would be noticed only when CI runner contention returns.

Risk:

The change fixes an operational release blocker, not product logic. Without a direct guard, a later config cleanup or merge could silently restore excessive CI parallelism, causing flaky `[vitest-worker]: Timeout calling "onTaskUpdate"` failures and blocking the CI-gated auto-deploy even when tests themselves pass.

Recommendation:

Add a small static repo-policy test that reads `vitest.config.ts` or extract the worker-count decision into a tiny testable helper. Pin the CI worker count, local worker count, and the non-empty `CI` contract alongside the existing release/deploy policy tests.

Findings:

- Opened `D-S02-003` (low): CI-only Vitest worker throttling has no direct policy regression test.
- The current implementation behaves as intended in both local-mode and `CI=true` focused test slices.

Pass result:

- S02 post-`cd5c7f4` delta Pass 1 complete.
- S02 remains open for Pass 2 and Pass 3 over workflow/release-gate semantics, docs/config consistency, and remaining tooling-policy gaps.

### S02 Post-cd5c7f4 Delta Pass 2 - Release Gate and Policy Coverage Sweep

Scope planned:

- Recheck CI/deploy workflow semantics around the runner-speed configuration.
- Recheck static policy tests and local guard scripts that protect the release path.
- Decide whether Pass 1's `D-S02-003` is the only tooling-policy gap introduced by `cd5c7f4`.

Evidence inspected:

- `.github/workflows/ci.yml`.
- `.github/workflows/deploy.yml`.
- `src/platform/web/deploy-workflow-gate.test.ts`.
- `src/platform/web/repo-policy.test.ts`.
- `scripts/check-file-size-policy.mjs`.
- `eslint.config.mjs`, especially the pure-core `process` ban and test-file exemptions.
- `package.json` scripts and engines.
- Focused command passed: `pnpm exec vitest run src/platform/web/deploy-workflow-gate.test.ts src/platform/web/repo-policy.test.ts src/__fixtures__/ci-budget.test.ts` (3 test files, 17 tests).
- Focused command passed: `pnpm guard:repo`.
- Focused command passed: `pnpm check:file-size`.
- Focused command passed: `pnpm exec prettier --check vitest.config.ts src/__fixtures__/ci-budget.ts src/__fixtures__/ci-budget.test.ts .github/workflows/ci.yml .github/workflows/deploy.yml scripts/check-file-size-policy.mjs`.

Findings:

- No new S02 delta findings in Pass 2.
- CI and deploy workflows still route through the shared `pnpm release:check` gate.
- Deploy still checks out the CI-validated `workflow_run.head_sha` before publishing and forces the Cloudflare Pages production branch used by the current project.
- The file-size backstop explicitly includes `vitest.config.ts`, so the expanded explanatory comment remains within the root-config raw-line policy.
- The `ciBudgetMs(...)` helper remains isolated to test/fixture code; core production code is still protected from `process` by the pure-core ESLint rule.
- `D-S02-003` remains the only new S02 finding from the runner-speed delta.

Pass result:

- S02 post-`cd5c7f4` delta Pass 2 complete.
- S02 remains open for one remaining-gap pass over docs/config consistency, direct diff closure, and audit-doc consistency.

### S02 Post-cd5c7f4 Delta Pass 3 - Docs and Direct-Diff Closure

Scope planned:

- Recheck docs/config consistency around the S02 runner-speed change.
- Confirm the exact S02 delta from `cd5c7f4`.
- Re-run the focused release-policy/build checks needed to close S02.

Evidence inspected:

- Targeted `rg` over `README.md`, `AUDIT.md`, `PROJECT.md`, `WORKFLOW.md`, `DECISIONS.md`, `CLAUDE.md`, `docs/**`, and `audit/**` for CI runner, `maxWorkers`, Vitest, `release:check`, web-build, chunk warning, Cloudflare Pages, and deploy references.
- `git diff --name-status 17e11f8..cd5c7f4 -- package.json pnpm-lock.yaml vite.config.ts vitest.config.ts tsconfig.json tsconfig.*.json eslint.config.* scripts .github .npmrc index.html public src/platform/web src/__fixtures__/ci-budget.ts src/__fixtures__/ci-budget.test.ts`, confirming the S02/tooling part of `cd5c7f4` is `vitest.config.ts` plus the CI budget helper tests.
- `git diff --name-status cd5c7f4..HEAD`, confirming post-`cd5c7f4` local changes are audit docs only.
- Audit-doc whitespace check passed: `git diff --check -- audit/REPOSITORY-SECTOR-ARCHITECTURE-2026-07-03.md audit/REPOSITORY-SECTOR-AUDIT-2026-07-03.md audit/REPOSITORY-SECTOR-PROGRESS-2026-07-03.md`.
- Focused command passed: `pnpm exec vitest run src/platform/web/deploy-workflow-gate.test.ts src/platform/web/repo-policy.test.ts src/platform/web/pwa-precache.test.ts src/__fixtures__/ci-budget.test.ts` (4 test files, 19 tests).
- Focused command passed: `pnpm build:web`; build completed, generated the PWA service worker, and still emitted the known Vite large-chunk warning for `assets/three.module-*.js` at about 704.87 kB.

Findings:

- No new S02 delta findings in Pass 3.
- The exact S02/product-tooling delta has been covered across the three supplemental passes.
- `D-S02-001` remains open for missing direct regression coverage on deterministic build-time metadata.
- `D-S02-002` remains open; current `pnpm build:web` still emits the `three.module` chunk warning while docs still describe a clean web build.
- `D-S02-003` remains open for missing direct policy coverage of the CI-only Vitest worker throttle.

Pass result:

- S02 post-`cd5c7f4` delta refresh closed after three supplemental passes.
- Move to S04 current-state delta test-only refresh for the camera calibration/detection test flake changes from `cd5c7f4`.

### S04 Post-cd5c7f4 Camera-Test Delta Pass 1 - Changed Assertions and Core Camera Slice

Scope planned:

- Inspect the S04 test-only delta in `src/core/camera/calibrate-sweep.test.ts` and `src/core/camera/detect-checkerboard.test.ts`.
- Verify the timeout changes do not weaken the camera behavior assertions.
- Re-run the broad core camera test slice.

Evidence inspected:

- `git diff --unified=120 17e11f8..cd5c7f4 -- src/core/camera/calibrate-sweep.test.ts src/core/camera/detect-checkerboard.test.ts src/core/camera/calibrate-sweep.ts src/core/camera/detect-checkerboard.ts src/core/camera/calibrate.ts src/core/camera/calibration-session.ts`.
- `src/core/camera/calibrate-sweep.test.ts`.
- `src/core/camera/detect-checkerboard.test.ts`.
- `src/core/camera/calibrate-sweep.ts`.
- `src/core/camera/detect-checkerboard.ts`.
- `src/core/camera/calibrate.ts`.
- Targeted `rg` over `src/core/camera`, `src/ui/camera`, and `src/ui/laser` for focal-sweep, checkerboard detection, mapping-error assertions, `ciBudgetMs`, timeouts, RMS, and calibration call paths.
- Focused command passed: `pnpm exec vitest run src/core/camera` (29 test files, 159 tests).

Findings:

- No new S04 delta findings in Pass 1.
- The `cd5c7f4` S04 changes are test-only and keep the behavioral gates intact: focal recovery, sub-pixel mapping error, RMS/principal-point bounds, typed failures, deterministic detection, noise handling, and full camera-module regression coverage still pass.
- The changed timeout values are now delegated to the test-only `ciBudgetMs(...)` helper; the production calibration and detection implementations are unchanged in this delta.

Pass result:

- S04 post-`cd5c7f4` camera-test delta Pass 1 complete.
- S04 remains open for two more passes over UI camera wizard/session integration, test-only import boundaries, and remaining audit-doc consistency.

### S04 Post-cd5c7f4 Camera-Test Delta Pass 2 - Wizard Integration and Import Boundary Sweep

Scope planned:

- Recheck the UI camera wizard/session path that consumes `calibrateWithFocalSweep(...)` and checkerboard detection.
- Recheck whether the new `ciBudgetMs(...)` helper leaks from test/fixture space into production core/UI code.
- Run the camera UI/session slice adjacent to the changed camera tests.

Evidence inspected:

- `src/ui/camera/wizard/camera-wizard-store.ts`.
- `src/ui/camera/wizard/use-live-detection.ts`.
- `src/ui/camera/wizard/CameraCalibrationWizard.tsx`.
- `src/core/camera/calibration-session.ts`.
- `src/core/camera/calibration-trust.ts`.
- `src/core/camera/index.ts`.
- Targeted `rg` over `src/core`, `src/ui`, and `src/__fixtures__` for `ciBudgetMs`, `process.env`, fixture imports, camera API imports, focal-sweep calls, session solves, and checkerboard detection.
- Focused command passed: `pnpm exec vitest run src/ui/camera src/ui/laser/MachineSetupCameraPreview.test.tsx src/ui/laser/MachineSetupCamera.test.tsx src/ui/laser/MachineSetupDialog.test.tsx src/core/camera/calibration-session.test.ts src/core/camera/calibration-trust.test.ts src/core/camera/pose-diversity.test.ts` (13 test files, 58 tests).
- Focused command passed: `pnpm exec vitest run src/core/camera/calibrate-sweep.test.ts src/core/camera/detect-checkerboard.test.ts src/__fixtures__/ci-budget.test.ts` (3 test files, 18 tests).

Findings:

- No new S04 delta findings in Pass 2.
- Production core and UI camera code still consume the normal `core/camera` APIs; `ciBudgetMs(...)` remains in test/fixture-only call paths.
- The wizard/session flow still routes solves through `solveSession(...)`, which calls `calibrateWithFocalSweep(...)`, then applies calibration trust and pose-diversity checks before the UI presents the result.
- Adjacent UI camera tests passed. The UI slice still emits jsdom canvas `getContext` stderr while passing; that is a UI/test-harness signal to recheck during S08 rather than a new S04 core finding.

Pass result:

- S04 post-`cd5c7f4` camera-test delta Pass 2 complete.
- S04 remains open for one remaining-gap pass over direct diff closure, camera-test audit consistency, and docs/audit-ledger consistency.

### S04 Post-cd5c7f4 Camera-Test Delta Pass 3 - Direct Diff and Closure

Scope planned:

- Prove the current `cd5c7f4` S04 delta footprint is test-only.
- Rerun the smallest camera/session slice that exercises the changed timeout-bearing tests and their UI-session consumer.
- Close S04 if no major S04 areas remain unchecked.

Evidence inspected:

- `git diff --name-status 17e11f8..cd5c7f4 -- src/core/camera src/ui/camera src/ui/laser src/__fixtures__/ci-budget.ts src/__fixtures__/ci-budget.test.ts vitest.config.ts`, confirming S04-owned changes are limited to `src/core/camera/calibrate-sweep.test.ts` and `src/core/camera/detect-checkerboard.test.ts`.
- Focused command passed: `pnpm exec vitest run src/core/camera/calibrate-sweep.test.ts src/core/camera/detect-checkerboard.test.ts src/core/camera/calibration-session.test.ts src/ui/camera/wizard/camera-wizard-store.test.ts src/ui/camera/wizard/CameraCalibrationWizard.test.tsx` (5 test files, 28 tests).
- Focused command passed: `pnpm exec tsc --noEmit --pretty false`.
- Audit-doc whitespace check passed: `git diff --check -- audit/REPOSITORY-SECTOR-ARCHITECTURE-2026-07-03.md audit/REPOSITORY-SECTOR-AUDIT-2026-07-03.md audit/REPOSITORY-SECTOR-PROGRESS-2026-07-03.md`.

Findings:

- No new S04 delta findings in Pass 3.
- The later camera-test delta has been covered with three passes; it did not introduce production core changes and did not weaken camera correctness assertions.
- Existing S04 delta findings remain `D-S04-001`, `D-S04-002`, `D-S04-003`, and `D-S04-004`.

Pass result:

- S04 post-`cd5c7f4` camera-test delta refresh closed after three passes.
- Move to S08 current-state delta audit for CNC material UI/state changes, PWA update dismissal, box numeric-input/dogbone toggle changes, probe/device-setup catalog UI changes, and UI canvas-test stderr noted during S04 Pass 2.

### S08 Delta Pass 1 - PWA Update and CNC Material/Machine UI

Scope planned:

- Map the current S08 delta files.
- Inspect the PWA update-dismissal workflow and the CNC material/machine UI/state workflow.
- Run focused tests for PWA prompt behavior, CNC project-material seeding, CNC machine presets, adjacent layer-seeding hooks, and debounced UI commits.

Evidence inspected:

- `git diff --name-status d603c01..HEAD -- src/ui`.
- `git diff --unified=80 d603c01..HEAD -- src/ui/app/PwaUpdatePrompt.tsx src/ui/app/PwaUpdatePrompt.test.tsx src/ui/app/pwa-update-dismissal.ts src/ui/machine/CncSetupPanel.tsx src/ui/machine/CncSetupPanel.material.test.tsx src/ui/machine/CncMachineCatalogRow.tsx src/ui/machine/CncLibraryPanels.tsx src/ui/state/cnc-project-material.ts src/ui/state/cnc-project-material.test.ts src/ui/state/cnc-project-material-action.test.ts src/ui/state/cnc-material-seeding.test.ts src/ui/state/cnc-machine-preset.test.ts src/ui/state/machine-actions.ts`.
- `src/ui/app/PwaUpdatePrompt.tsx`.
- `src/ui/app/pwa-update-dismissal.ts`.
- `src/ui/app/PwaUpdatePrompt.test.tsx`.
- `src/ui/state/cnc-project-material.ts`.
- `src/ui/state/machine-actions.ts`.
- `src/ui/machine/CncSetupPanel.tsx`.
- `src/ui/machine/CncMachineCatalogRow.tsx`.
- Targeted `rg` over `src/ui`, `src/core`, and `src/io` for PWA dismissal helpers, `updatefound`, project CNC material actions, material seeding, machine preset application, and catalog UI wiring.
- Focused command passed: `pnpm exec vitest run src/ui/app/PwaUpdatePrompt.test.tsx src/ui/machine/CncSetupPanel.material.test.tsx src/ui/state/cnc-project-material.test.ts src/ui/state/cnc-project-material-action.test.ts src/ui/state/cnc-material-seeding.test.ts src/ui/state/cnc-machine-preset.test.ts` (6 test files, 29 tests).
- Focused command passed: `pnpm exec vitest run src/ui/state/layer-actions.test.ts src/ui/state/object-insert-actions.test.ts src/ui/layers/use-debounced-commit.test.tsx` (2 test files discovered, 26 tests).

#### D-S08-001 - PWA update dismissal re-arm clears storage without invalidating the mounted prompt render

Evidence:

- `PwaUpdatePrompt` computes `isDismissed` directly during render by comparing `loadDismissedUpdateVersion()` with `__APP_VERSION__`.
- The `updatefound` listener registered in `onRegisteredSW(...)` calls only `clearDismissedUpdateVersion`; it does not update component state, call `setNeedRefresh(...)`, or otherwise force the mounted prompt to re-render.
- The regression test for re-arming simulates `updatefound`, then creates a second render and asserts the banner appears in that fresh render. It does not prove that the already-mounted suppressed prompt becomes visible when a newer service worker is found.
- In a realistic deferred-update session, `needRefresh` can already be true while the prompt returns `null` because the running build version was dismissed. Clearing localStorage alone does not invalidate that rendered `null` state; a later `setNeedRefresh(true)` for the newer waiting worker may also be a no-op if the hook state is already true.

Risk:

A genuinely newer service worker can remain hidden after a prior "Later" dismissal until some unrelated state change or full app reload causes a render. That undermines the intended "strictly-newer SW re-arms the prompt" behavior and can leave users on an older bundle longer than intended.

Recommendation:

Track the dismissed marker in React state or add a small local revision counter that the `updatefound` handler increments after clearing storage. Extend the test to assert the same mounted component shows the banner after `updatefound`, without creating a fresh root.

Findings:

- Opened `D-S08-001` (medium): PWA update dismissal re-arm clears storage without invalidating the mounted prompt render.
- No CNC material/machine UI finding was opened in Pass 1; focused state/UI tests passed, stock material seeding stays CNC-only and undoable, and machine preset loading is CNC-only and undoable.

Pass result:

- S08 delta Pass 1 complete.
- S08 remains open for Pass 2 and Pass 3 over box numeric-input/dogbone toggle changes, probe/device-setup UI changes, and UI canvas-test stderr.

### S08 Delta Pass 2 - Box Dogbone, Probe Setup, and Canvas Test Signal

Scope planned:

- Inspect the box generator dogbone toggle, draft parsing, persisted-draft restore path, and related dialog tests.
- Inspect the reusable probe controls and Device Setup probe-step integration.
- Reproduce and classify the UI canvas/WebGL stderr seen during the broader release gate.

Evidence inspected:

- `src/ui/box/box-draft.ts`.
- `src/ui/box/BoxGeneratorDialog.tsx`.
- `src/ui/box/BoxGeneratorFields.tsx`.
- `src/ui/calibration/calibration-draft-storage.ts`.
- `src/ui/box/box-draft.test.ts`.
- `src/ui/box/BoxGeneratorDialog.test.tsx`.
- `src/ui/laser/ProbeControls.tsx`.
- `src/ui/laser/ProbePanel.test.tsx`.
- `src/ui/laser/device-setup/DeviceSetupProbeStep.tsx`.
- `src/ui/laser/device-setup/DeviceSetupProbeStep.test.tsx`.
- `src/ui/laser/device-setup/DeviceSetupWizard.test.tsx`.
- `src/ui/laser/device-setup/device-setup-flow.ts`.
- Focused command passed: `pnpm exec vitest run src/ui/box/box-draft.test.ts src/ui/box/BoxGeneratorDialog.test.tsx src/ui/laser/ProbePanel.test.tsx src/ui/laser/device-setup/DeviceSetupProbeStep.test.tsx src/ui/laser/device-setup/DeviceSetupWizard.test.tsx` (5 test files, 35 tests).
- Focused command passed: `pnpm exec vitest run src/ui/camera/WorkspaceCameraOverlay.test.tsx src/ui/camera/trace-from-camera.test.ts src/ui/relief-viewer/Relief3DViewerDialog.test.tsx src/ui/relief-viewer/Cut3DPreviewDialog.test.tsx` (4 test files, 9 tests).

#### D-S08-002 - UI canvas/WebGL tests pass while emitting jsdom canvas errors and async `act(...)` warnings

Severity: Medium.

Evidence:

- `BoxGeneratorDialog.test.tsx` passes all 7 tests while every preview render emits `Error: Not implemented: HTMLCanvasElement.prototype.getContext` from `src/ui/box/BoxPreview.tsx`.
- `trace-from-camera.test.ts` passes while `buildCameraTraceImage(...)` emits the same jsdom canvas `getContext` error from `src/ui/camera/trace-from-camera.ts`.
- `WorkspaceCameraOverlay.test.tsx` passes while its captured-still projection path emits the same jsdom canvas `getContext` error from `src/ui/camera/WorkspaceCameraOverlay.tsx`.
- `Relief3DViewerDialog.test.tsx` and `Cut3DPreviewDialog.test.tsx` pass while Three.js emits repeated canvas/WebGL context errors and `THREE.WebGLRenderer: Error creating WebGL context.`.
- The same focused run also emits React `act(...)` warnings from `ProbeControls`, `DeviceSetupConnectStep`, and the relief-viewer dialog shell while the files still report green.

Risk:

The release gate and focused UI tests can be green while meaningful canvas, camera, preview, and 3D viewer paths are throwing at runtime in the test environment. That makes the test output noisy and lowers confidence that these tests would catch a real preview/canvas regression instead of silently exercising fallback or partially failed render paths.

Recommendation:

Add an explicit canvas/WebGL test harness boundary: either mock the expected 2D/WebGL APIs and assert the drawing/fallback behavior cleanly, or make unexpected `console.error` / React `act(...)` warnings fail the affected tests after known fallbacks are intentionally captured. The aim is not to require real WebGL in jsdom; it is to keep green tests from tolerating unclassified rendering errors.

Findings:

- Opened `D-S08-002` (medium): UI canvas/WebGL tests pass while emitting jsdom canvas errors and async `act(...)` warnings.
- No box dogbone/default finding was opened in Pass 2; old persisted drafts are merged over fresh defaults, so missing `relief` falls back to `off`, and the dialog tests cover CNC relief off/on visibility and warning behavior.
- No probe workflow product finding was opened in Pass 2; the shared controls remain CNC-only, Idle-gated at the button, and covered by the probe panel plus Device Setup wizard tests.

Pass result:

- S08 delta Pass 2 complete.
- S08 remains open for Pass 3 over direct-diff closure, adjacent UI state actions, and any remaining unchecked S08 delta files.

### S08 Delta Pass 3 - Direct Diff Closure and Adjacent State Actions

Scope planned:

- Enumerate every S08 file changed since the audited baseline and close remaining coverage gaps.
- Inspect the remaining debounced input, project material, machine preset, layer creation, and fresh-import seeding changes.
- Run the full focused S08 delta test bundle and TypeScript check.

Evidence inspected:

- `git diff --name-status d603c01..HEAD -- src/ui`.
- `git diff --unified=80 d603c01..HEAD -- src/ui/state/object-insert-actions.ts`.
- `git diff --unified=80 d603c01..HEAD -- src/ui/state/layer-actions.ts src/ui/state/machine-actions.ts src/ui/layers/use-debounced-commit.ts`.
- `git diff --unified=80 d603c01..HEAD -- src/ui/machine/CncSetupPanel.tsx src/ui/machine/CncLibraryPanels.tsx src/ui/machine/CncMachineCatalogRow.tsx src/ui/machine/CncSetupPanel.material.test.tsx`.
- `src/ui/layers/use-debounced-commit.ts` and `src/ui/layers/use-debounced-commit.test.tsx`.
- `src/ui/state/cnc-project-material.ts`.
- `src/ui/state/machine-actions.ts`.
- `src/ui/state/layer-actions.ts`.
- `src/ui/state/object-insert-actions.ts`.
- `src/ui/state/cnc-project-material.test.ts`, `src/ui/state/cnc-project-material-action.test.ts`, `src/ui/state/cnc-material-seeding.test.ts`, and `src/ui/state/cnc-machine-preset.test.ts`.
- `src/ui/machine/CncSetupPanel.tsx`, `src/ui/machine/CncLibraryPanels.tsx`, `src/ui/machine/CncMachineCatalogRow.tsx`, and `src/ui/machine/CncSetupPanel.material.test.tsx`.
- Focused command passed: `pnpm exec vitest run src/ui/app/PwaUpdatePrompt.test.tsx src/ui/box/box-draft.test.ts src/ui/box/BoxGeneratorDialog.test.tsx src/ui/laser/ProbePanel.test.tsx src/ui/laser/device-setup/DeviceSetupProbeStep.test.tsx src/ui/laser/device-setup/DeviceSetupWizard.test.tsx src/ui/layers/use-debounced-commit.test.tsx src/ui/machine/CncSetupPanel.material.test.tsx src/ui/state/cnc-project-material.test.ts src/ui/state/cnc-project-material-action.test.ts src/ui/state/cnc-material-seeding.test.ts src/ui/state/cnc-machine-preset.test.ts src/ui/state/layer-actions.test.ts` (13 test files, 90 tests).
- Focused command passed: `pnpm exec tsc --noEmit --pretty false`.

Findings:

- No new S08 delta findings in Pass 3.
- Remaining direct-diff S08 files are covered by Passes 1-3: PWA prompt/dismissal, box dogbone/defaults, probe controls and Device Setup, project material and CNC machine catalog UI/state, debounced commit behavior, and fresh-layer/import material seeding.
- The S08 delta findings remain `D-S08-001` and `D-S08-002`, both medium severity and open.

Pass result:

- S08 current-state delta sector closed after three passes.
- Move to S09 current-state delta audit for fixtures, perceptual harness changes, underscore-prefixed audit tests, CI budget helpers, and centerline runner-speed changes.

### S09 Delta Pass 1 - Fixture Delta Orientation and Diagnostic Test Signal

Scope planned:

- Map the S09 files changed since the audited baseline.
- Inspect the CI budget helper, trace benchmark loop additions, Arch House edge benchmark additions, centerline perf budget changes, shared star fixture, and underscore-prefixed diagnostic tests.
- Separate release-gated benchmark coverage from opt-in audit diagnostics.

Evidence inspected:

- `git diff --name-status d603c01..HEAD -- src/__fixtures__ audit/fixtures audit/evidence`.
- `src/__fixtures__/ci-budget.ts` and `src/__fixtures__/ci-budget.test.ts`.
- `src/__fixtures__/perceptual/trace-benchmark-loop.ts` and `src/__fixtures__/perceptual/trace-benchmark-loop.test.ts`.
- `src/__fixtures__/perceptual/arch-house-edge-benchmark.ts` and `src/__fixtures__/perceptual/arch-house-edge-truth.test.ts`.
- `src/__fixtures__/perceptual/centerline-perf.test.ts` and `src/__fixtures__/perceptual/star-fixture.ts`.
- `vitest.config.ts`, confirming the normal test include is `src/**/*.test.{ts,tsx}` plus `electron/**/*.test.ts`, with no special exclusion for underscore-prefixed diagnostics.
- `rg -n --glob "_*.test.ts" "TRACE_AUDIT|return;|it\(" src/__fixtures__/perceptual`, confirming the underscore diagnostic tests are normal `.test.ts` files that return early unless `TRACE_AUDIT=1`.
- Focused diagnostic check passed without running the diagnostic body: `pnpm exec vitest run src/__fixtures__/perceptual/_arch-a-scale.test.ts` (1 test file, 1 test, 2ms, no `TRACE_AUDIT` environment flag).
- Focused release-gated slice passed: `pnpm exec vitest run src/__fixtures__/ci-budget.test.ts src/__fixtures__/perceptual/arch-house-edge-truth.test.ts src/__fixtures__/perceptual/trace-benchmark-loop.test.ts src/__fixtures__/perceptual/centerline-perf.test.ts` (4 test files, 14 tests). The centerline performance gauge logged `4441ms`, below both the local regression budget and the 30s worker ceiling.

#### D-S09-001 - `TRACE_AUDIT` diagnostic tests count as passing tests when the diagnostic environment flag is absent

Severity: Low.

Evidence:

- `vitest.config.ts` includes every `src/**/*.test.{ts,tsx}` file in the normal test run.
- The new underscore-prefixed diagnostic files under `src/__fixtures__/perceptual` are still named `.test.ts`, and each top-level test body begins with `if (process.env['TRACE_AUDIT'] !== '1') return;`.
- Running `pnpm exec vitest run src/__fixtures__/perceptual/_arch-a-scale.test.ts` without `TRACE_AUDIT=1` reports `1 passed` even though the diagnostic sweep body exits immediately.

Risk:

Normal `pnpm test` and release-gate output can count audit diagnostics as green tests even when those diagnostics did not execute. That makes the test totals look stronger than the actual exercised coverage and can confuse maintainers about whether opt-in reference/audit comparisons were run.

Recommendation:

Move these diagnostics to a non-`.test.ts` suffix, exclude `src/__fixtures__/perceptual/_*.test.ts` from the default Vitest include, or use a visible skip mechanism when `TRACE_AUDIT` is absent. Add a dedicated documented script for `TRACE_AUDIT=1` audit runs if these diagnostics should remain runnable through Vitest.

Findings:

- Opened `D-S09-001` (low): `TRACE_AUDIT` diagnostic tests count as passing tests when the diagnostic environment flag is absent.
- No release-gated fixture benchmark finding was opened in Pass 1; the CI helper, trace benchmark loop, Arch House edge metrics, and centerline performance gauge passed their focused tests.

Pass result:

- S09 delta Pass 1 complete.
- S09 remains open for Pass 2 over artifact paths, generated evidence ownership, and benchmark helper invariants.

### S09 Delta Pass 2 - Artifact Path and Opt-In Evidence Sweep

Scope planned:

- Verify the current real-logo fixture ownership and opt-in artifact output locations.
- Check ignored/generated evidence paths and stale references to the old audit fixture tree.
- Run the trace artifact harness and Arch House baseline tests.

Evidence inspected:

- `src/__fixtures__/perceptual/trace-artifact-runner.ts`.
- `src/__fixtures__/perceptual/trace-artifacts.test.ts`.
- `.gitignore`.
- `git diff --unified=80 d603c01..HEAD -- src/__fixtures__/perceptual/trace-artifact-runner.ts src/__fixtures__/perceptual/trace-artifacts.test.ts src/__fixtures__/perceptual/arch-house-baseline.test.ts src/__fixtures__/perceptual/arch-house-edge-quality.test.ts .gitignore`.
- `rg -n "audit/evidence|audit/fixtures|perceptual-artifacts|trace-audit-artifacts|DEFAULT_TRACE_ARTIFACT|TRACE_ARTIFACT|arch-house-langebaan-source|writeTraceArtifactEvidence|requiredArchHouseFixtureStatus" src/__fixtures__ .gitignore audit docs README.md package.json`.
- Fixture path check: `Test-Path audit/fixtures/trace/arch-house-langebaan-source.png` returned `False`; `Test-Path src/__fixtures__/perceptual/assets/arch-house-langebaan-source.png` returned `True`; `git ls-files audit/fixtures/trace src/__fixtures__/perceptual/assets` listed only `src/__fixtures__/perceptual/assets/arch-house-langebaan-source.png`.
- `src/__fixtures__/perceptual/_edge-zoom.test.ts`.
- Opt-in diagnostic command failed as expected: `$env:TRACE_AUDIT='1'; pnpm exec vitest run src/__fixtures__/perceptual/_edge-zoom.test.ts -t "renders zoomed edge-trace"; Remove-Item Env:TRACE_AUDIT` failed with `ENOENT` opening `audit\fixtures\trace\arch-house-langebaan-source.png`.
- Focused command passed: `pnpm exec vitest run src/__fixtures__/perceptual/trace-artifacts.test.ts src/__fixtures__/perceptual/arch-house-baseline.test.ts` (2 test files, 16 tests).
- `git status -sb --ignored trace-audit-artifacts perceptual-artifacts audit/fixtures/trace src/__fixtures__/perceptual/assets` reported only ignored `perceptual-artifacts/`; no tracked `audit/fixtures/trace` fixture remains.

#### D-S09-002 - `_edge-zoom` TRACE_AUDIT diagnostic still hardcodes the removed `audit/fixtures/trace` logo path

Severity: Low.

Evidence:

- The current tracked real-logo fixture is `src/__fixtures__/perceptual/assets/arch-house-langebaan-source.png`; the old `audit/fixtures/trace/arch-house-langebaan-source.png` path is absent.
- `src/__fixtures__/perceptual/_edge-zoom.test.ts` calls `decodePngFile('audit/fixtures/trace/arch-house-langebaan-source.png')` in all four `TRACE_AUDIT=1` diagnostic tests.
- Running the first `_edge-zoom` diagnostic with `TRACE_AUDIT=1` fails immediately with `ENOENT` for the old audit fixture path.

Risk:

The normal release-gated benchmark path is healthy, but the standing visual zoom diagnostic cannot be used after the fixture ownership move. That weakens the opt-in trace audit toolkit precisely when a maintainer wants to inspect letter-level edge/centerline regressions.

Recommendation:

Route `_edge-zoom.test.ts` through `requiredArchHouseFixtureStatus()` or the shared fixture asset path, matching the current Arch House benchmark helpers. Pair that with the `D-S09-001` runner-signal cleanup so opt-in diagnostics are visibly skipped or explicitly run.

Findings:

- Opened `D-S09-002` (low): `_edge-zoom` TRACE_AUDIT diagnostic still hardcodes the removed `audit/fixtures/trace` logo path.
- No new finding on the main trace artifact/evidence path; current tests pin the default trace-artifact output under ignored `perceptual-artifacts/trace-artifacts`, and the active Arch House baseline uses the fixture under `src/__fixtures__/perceptual/assets`.

Pass result:

- S09 delta Pass 2 complete.
- S09 remains open for Pass 3 over direct-diff closure, underscore diagnostic inventory, and the remaining perceptual benchmark files.

### S09 Delta Pass 3 - Direct Diff Closure, Diagnostic Inventory, and Remaining Perceptual Files

Scope planned:

- Close the direct diff over `src/__fixtures__` since the audited baseline `09047e1`.
- Build an exhaustive inventory of underscore-prefixed and env-gated opt-in diagnostic files, checking silent-pass behavior, stale paths, output locations, and Vitest inclusion.
- Read or usage-map every remaining perceptual benchmark/helper file not yet scrutinized.
- Run the flag-off fixture suite and record pass counts.

Evidence inspected:

- `git diff 09047e1..HEAD -- src/__fixtures__` returned empty; no fixture changes since the audited baseline.
- Focused command passed without env opt-in flags: `pnpm vitest run src/__fixtures__` (31 test files, 129 tests, 0 failed/skipped), including all 12 underscore diagnostics reporting green without executing their bodies (live confirmation of `D-S09-001`).
- Diagnostic inventory: 12 `TRACE_AUDIT`-gated files (`_arch-a-scale`, `_arch-house-edge-audit`, `_edge-rough-smoothness`, `_edge-zoom`, `_letter-a-counter`, `_letter-b-smoothness`, `_reference-export`, `_reference-iou`, `_sharp-candidates`, `_small-letter-facet`, `_trace-audit-render`, `_tracer-upgrade-audit`) all silently pass with the flag off and all write only under ignored `trace-audit-artifacts/`; only `_edge-zoom.test.ts` references a stale path (`audit/fixtures/trace/...` at lines 69/82/98/127, already `D-S09-002`). Three additional files (`arch-house-baseline.test.ts`, `box-sheet.test.ts`, `png.ts`) use `PERCEPTUAL_ARTIFACTS` as a write-only evidence side channel; their assertions run unconditionally.
- `vitest.config.ts` has no exclusion for underscore files; all 12 diagnostics run in every `pnpm test`.
- Remaining perceptual set read or usage-mapped: `trace-fixtures.ts`, `trace-artifact-runner.ts`, `trace-benchmark-loop.ts` plus test, `trace-benchmark-regression-cases.ts`, `arch-house-edge-benchmark.ts`, `arch-house-baseline.test.ts`, `arch-house-edge-quality.test.ts`, `arch-house-edge-truth.ts`, `trace-artifacts.test.ts`, `centerline-perf.test.ts`, `compare.ts`, `png.ts`, `png-decode.ts`, `rasterize.ts`, `edge-truth.ts`, `box-sheet.test.ts`, `import-fidelity.ts`, `render-overlay.ts`, `procedural-ink.ts`, `star-fixture.ts`, and consumer mapping for `gcode-rasterize`/`toolpath-rasterize`/centerline helpers. No dead helpers; no `.skip`/`.only`/`.todo` anywhere under `src/__fixtures__`; budgets remain meaningful (IoU 0.9-0.99 gates, precision/recall gates, `ciBudgetMs(8s,15s)` plus a hard 30s worker ceiling); `arch-house-baseline.test.ts:29` hard-asserts fixture presence so a deleted PNG cannot silently soften the benchmark.
- `TRACE_AUDIT=1` was not re-run this pass; the `_edge-zoom` failure is already pinned by `D-S09-002` and opt-in outputs stay under ignored directories.

#### D-S09-003 - `.gitignore` documents the wrong trace-audit opt-in flag name

Severity: Low.

Evidence:

- `.gitignore:21` documents the opt-in flag as `TRACE_AUDIT_ARTIFACTS=1`.
- Every diagnostic gates on `process.env['TRACE_AUDIT'] !== '1'` (for example `src/__fixtures__/perceptual/_trace-audit-render.test.ts:59`).
- The ignored directory name itself (`trace-audit-artifacts/`) is correct, so there is no tracked-path pollution.

Risk:

A maintainer following the `.gitignore` comment runs `TRACE_AUDIT_ARTIFACTS=1 pnpm vitest run ...`; every diagnostic silently no-ops (compounding `D-S09-001`), and they either conclude the toolkit is broken or, worse, that the audit ran clean.

Recommendation:

Correct the `.gitignore` comment to name `TRACE_AUDIT=1`, ideally when addressing the `D-S09-001` runner-signal cleanup so the flag has one documented spelling.

#### D-S09-004 - Benchmark rating/finding helpers are copy-pasted across three files

Severity: Low.

Evidence:

- `pushFindingIf` and `ratingFromFindings`/`capFromFindings` are duplicated in `src/__fixtures__/perceptual/trace-benchmark-loop.ts:342-361`, `src/__fixtures__/perceptual/trace-benchmark-regression-cases.ts:250-276`, and `src/__fixtures__/perceptual/arch-house-edge-benchmark.ts:179-192`.
- `countInk` is duplicated between `arch-house-baseline.test.ts:139` and `trace-benchmark-regression-cases.ts:258`; `polylineLength` appears in three modules.
- This matches the deferred "helper dedup" follow-up already recorded from the trace rebuild, so it is a known-debt confirmation rather than a novel defect.

Risk:

Severity-to-rating mapping tuned in one copy can diverge from another, producing a benchmark whose overall rating and per-case ratings are computed under different rules while all tests stay green.

Recommendation:

Extract the shared rating/finding helpers into one perceptual benchmark utility module and import it from the loop, regression cases, and edge benchmark.

Findings:

- Opened `D-S09-003` (low): `.gitignore` documents the wrong trace-audit opt-in flag name.
- Opened `D-S09-004` (low): benchmark rating/finding helpers are copy-pasted across three files.
- No high or medium findings; no stale paths beyond `D-S09-002`; no tracked-path artifact writes; no weak or vacuous budgets in the always-on suite.
- Not re-audited here because they belong to other sectors' suites: `src/__fixtures__/controllers/**` internals and `property/box-benchmark.test.ts` beyond confirming they pass.

Pass result:

- S09 current-state delta sector closed after three passes.
- The 2026-07-04 current-state delta audit is complete across all sectors. Open delta findings: D-S01-001..003, D-S02-001..003, D-S04-001..004, D-S05-001..004, D-S08-001..002, D-S09-001..004 (19 total; 6 medium, 13 low). No fixes were made during this audit.

## Delta Fix Phase - 2026-07-05

The maintainer opened the fix phase ("start fixing all the findings"). All 19 delta findings are fixed and verified in the working tree (uncommitted). A shared finite-guard module was added at `src/core/util/finite.ts` (`finiteOr`, `finitePositiveOr`, `isFinitePositive`, with its own test) and reused by the S04/S05 numeric fixes.

Verification (whole-tree): `pnpm exec tsc --noEmit` clean; `pnpm lint` clean; `pnpm check:file-size` pass; `pnpm exec prettier --check` clean on new files; `pnpm build:web` clean with no chunk-size warning; full `pnpm exec vitest run` = 580 files passed / 3607 tests passed, 12 files (15 tests) now visibly skipped instead of vacuously passing. `pnpm release:check` was not re-run as a single command; its component gates were each run and passed.

Per-finding resolution:

- D-S01-001 (sector map) - resolved by the delta audit itself; the architecture map was refreshed to classify all current files. No code change.
- D-S01-002 (completion ledger coverage) - resolved by the delta audit itself; post-baseline commits were audited sector by sector. No code change.
- D-S01-003 (Phase H header stale) - `PROJECT.md` Phase H header updated to reflect H.13/H.14 (ADR-111/112) landing on top of G1-G8, keeping the "hardware passes CLAIMED" caveat. CRLF-preserved single-line diff.
- D-S02-001 (build-time metadata untested) - extracted git build-metadata helpers into `src/platform/web/build-info.ts` with `build-info.test.ts` proving same-commit metadata derives from commit time, not wall clock; `vite.config.ts` imports the helper.
- D-S02-002 (Vite chunk warning) - `chunkSizeWarningLimit` raised to a documented budget covering the Three.js relief-preview chunk; stale `vite.config.ts` comment and `README.md` "clean web build" wording corrected. `pnpm build:web` now emits no chunk warning.
- D-S02-003 (CI worker throttle untested) - worker-count decision extracted to `src/__fixtures__/vitest-workers.ts` (`vitestMaxWorkers(env)`) with `vitest-workers.test.ts` pinning CI=1 / local=4; `vitest.config.ts` uses the helper.
- D-S04-001 (surfacing finite guards) - `src/core/cnc/surfacing.ts` normalizes dimensions/feeds/step and bounds `surfacingRowYs`/`depthLadder` so an Infinite height cannot hang and no `NaN`/`Infinity` reaches emitted G-code. Tests added to `surfacing.test.ts`.
- D-S04-002 (grid/heightmap sizing) - `src/core/sim/removal-grid.ts` and `src/core/relief/heightmap.ts` guard non-finite dimensions and fail closed to a well-formed minimal grid; `mesh-to-heightmap.ts` rejects non-finite target/depth. New `removal-grid.test.ts` and `heightmap.test.ts`.
- D-S04-003 (material feed non-finite) - `src/core/cnc/feeds-calculator.ts` sanitizes rpm/flutes/diameter so feed/plunge/depth are always finite and floored. Tests added to `feeds-calculator.test.ts`.
- D-S04-004 (default tool invariant test) - new `src/core/scene/machine-default-tools.test.ts` pins unique IDs, finite positive diameters, kind-specific angle rules, and default `toolId` membership. Test-only.
- D-S05-001 (auto-upscale factors) - `src/core/trace/auto-upscale.ts` validates the scale factor is a finite integer >= 1 and returns identity output otherwise. Tests added.
- D-S05-002 (RawImageData shape) - `src/core/trace/trace-image.ts` adds `isValidRawImageData` and `preprocessForTrace` fails closed (returns input unchanged) on a malformed buffer. Tests in the new `trace-image-guards.test.ts`.
- D-S05-003 (Canny bounds) - `src/core/trace/canny-edges.ts` clamps blur sigma to a bounded finite range and threshold ratios to finite [0,1]. Tests added.
- D-S05-004 (non-finite adjustments) - `applyImageAdjustments` treats non-finite brightness/contrast as neutral and non-finite gamma as 1.0 (no silent blackening). Tests in `trace-image-guards.test.ts`.
- D-S08-001 (PWA re-arm) - `src/ui/app/PwaUpdatePrompt.tsx` tracks the dismissed marker in React state so `updatefound` invalidates the mounted render and a strictly-newer SW re-shows the banner. Test asserts the same mounted component re-shows without a fresh root.
- D-S08-002 (canvas/WebGL test signal) - global jsdom canvas stub added at `src/__fixtures__/jsdom-canvas-setup.ts` (wired via `vitest.config.ts` setupFiles) removing the pervasive `getContext` "Not implemented" flood and stubbing `ImageData`/2D draw paths. Two residual signals are deliberately classified and documented in that file (Three.js WebGL-unavailable fallback; `toDataURL` left to jsdom to avoid hiding PNG-encoding regressions) - fully silencing them is an optional follow-up.
- D-S09-001 (diagnostics vacuously green) - the 12 `TRACE_AUDIT` diagnostics now use `it.skipIf(!RUN_TRACE_AUDIT)` and report as skipped, not passed, when the flag is absent.
- D-S09-002 (`_edge-zoom` stale path) - routed through `requiredArchHouseFixtureStatus()`/the shared fixture asset instead of the removed `audit/fixtures/trace` path.
- D-S09-003 (`.gitignore` flag name) - corrected the documented opt-in flag to `TRACE_AUDIT=1`. CRLF-preserved single-line diff.
- D-S09-004 (benchmark helper dedup) - shared rating/finding/geometry helpers extracted to `src/__fixtures__/perceptual/benchmark-rating.ts` and imported by the loop, regression-cases, and edge-benchmark consumers.

Process note: much of the work ran as parallel per-sector fix agents; several were terminated mid-run by an Anthropic session limit, leaving a partially applied, unverified tree. The tree was recovered and completed directly: finishing `_edge-zoom` skip/path wiring, the `.gitignore` flag, and four CI-blocking lint fixes the agents introduced (`jsdom-canvas-setup` as-const + `any`, `trace-image` complexity via a `despeckleIfEnabled` extraction, and splitting the over-length `trace-image.test.ts` into `trace-image-guards.test.ts`). No changes are committed; all remain in the working tree for maintainer review.

## After-Fix Audit - 2026-07-05

Maintainer requested an audit of the fix phase ("audit the fixes"). Three independent read-only audit passes ran over the uncommitted diff vs `46889ca`: core (S04/S05), tooling/UI (S02/S08), and fixtures/docs (S09/S01 + ledger accuracy). Method: `git diff` / `git show HEAD:` before-after comparison per file, valid-path preservation checks against live preset/caller values, test-quality review (would the new tests fail on HEAD?), focused vitest/eslint/tsc slices, and ledger claim spot-checks. No files were modified by the audit.

Verdict: 18 of 19 fixes verified-correct; 1 fix has a genuine regression (D-S04-001). Ledger spot-checks found no overclaims.

### After-fix finding index

| ID | Severity | File | Short description |
|---|---|---|---|
| AF-CORE-001 | High | `src/core/cnc/surfacing.ts:100` | `depthLadder` replaced HEAD's `Math.max(MIN_STEP_MM, x)` clamp with `finitePositiveOr(x, MIN_STEP_MM)`: finite sub-0.05mm depth inputs now emit different G-code (0.02mm/pass: 25 passes vs HEAD's 10), and a tiny/denormal finite step reintroduces the hang the fix targeted (`depth += step` no-ops once `depth/step > 2^53`). Fix: `Math.max(MIN_STEP_MM, finiteOr(x, MIN_STEP_MM))`. |
| AF-CORE-002 | Medium | `src/core/cnc/surfacing.ts:46` | Exported `surfacingRowYs` still non-terminating/OOM for pathological finite inputs (`1e16` height, `1e-20` step); "can't hang" holds only for non-finite inputs. Floor step at `MIN_STEP_MM`; consider a row-count cap. |
| AF-CORE-003 | Low | `src/core/cnc/surfacing.ts:62` | Feed fallbacks reuse `MIN_STEP_MM` (0.05, a distance) as a feed rate, emitting `F0.050`; name a minimum-feed constant. |
| AF-CORE-004 | Low | `src/core/cnc/surfacing.ts:64` | Finite negative rpm still emits `M3 S-…` (same as HEAD; residual, not regression). |
| AF-CORE-005 | Low | `src/core/sim/removal-grid.ts:57` | `coarsenedCellSize` overflow for ~1e308 finite dims can yield `mmPerCell: Infinity` (pathological-finite only; non-finite scope correctly closed). |
| AF-CORE-006 | Low | `src/core/trace/canny-edges.test.ts` | One vacuous assertion (`count >= 0`); the "valid-path unchanged" test compares new-code-to-new-code so it could not catch a default-shifting clamp. Infinity-sigma case does pin the real hang. |
| AF-CORE-007 | Low | `src/core/trace/trace-image.ts:235` | Fail-closed guard protects preprocessing only; malformed buffers still flow to tracer backends downstream (matches finding scope; residual noted). |
| AF-CORE-008 | Low | `src/core/trace/trace-image.ts` | File remains over the 250 soft counted-line limit (319→330; no lint error). |
| AF-TOOL-001 | Low | `src/platform/web/build-info.test.ts:39` | Wall-clock guard spies `Date.now`, which `new Date()` never calls; only the exact-value test actually pins determinism. Use `vi.setSystemTime`. |
| AF-TOOL-002 | Low | `vite.config.ts:52` | Unit tests guard the module, not the wiring; re-inlining wall-clock into `define` would stay green (inherent to extraction; note-only). |
| AF-TOOL-003 | Low | `src/ui/app/PwaUpdatePrompt.tsx:45` | Inline `updatefound` listener never removed on unmount and loses HEAD's same-reference dedup; StrictMode dev double-mount accumulates listeners (benign: idempotent clear + no-op setState). |
| AF-TOOL-004 | Info | `src/ui/app/PwaUpdatePrompt.test.tsx:17` | Mock invokes `onRegisteredSW` on every render (real hook: once per registration); timing divergence, no current assertion affected. |
| AF-TOOL-005 | Low | `src/__fixtures__/jsdom-canvas-setup.ts:58` | Prospective masking risks in the 2D proxy: unstubbed property reads return functions, set-trap discards writes, `getImageData` returns 0x0 empty regardless of request, proxy is thenable. Nothing regressed today; risk is future tests passing through impossible states. |
| AF-TOOL-006 | Low | `src/platform/web/build-info.ts` | Name collides with unrelated `src/ui/app/build-info.ts`; Node-only module in a browser-adapter folder, deep-imported bypassing `index.ts` without in-code justification. Consider rename (`build-metadata.ts`) or header note. |
| AF-TOOL-007 | Low | `src/__fixtures__/jsdom-canvas-setup.ts:59` | `as ImageData` / `as TextMetrics` casts lack the per-cast justifying comment CLAUDE.md requires. |
| AF-FIX-001 | Low | `src/__fixtures__/perceptual/benchmark-rating.ts:33` | Extraction mints a second exported `polylineLength` alongside `centerline-geometry.ts:44`'s identical helper (third private copy in `edge-curve-quality.test.ts:237`); consolidate to one home. |

### Verified-correct highlights

- Core: D-S04-002/003/004 and D-S05-001..004 exactly preserve valid-path behavior (feeds algebraically verified; Canny clamps checked against live preset/slider ranges; `despeckleIfEnabled` branch-by-branch identical; `machine.ts` byte-identical). New guard tests genuinely fail on HEAD.
- Tooling/UI: `build-info.ts` command-for-command equivalent to the HEAD inline logic (safer `execFileSync`); `vitestMaxWorkers` reproduces `process.env.CI ? 1 : 4` truthiness exactly (`''`→4, `'0'`→1); PWA re-arm test is genuinely same-mounted-root and fails on the old implementation; config diffs contain nothing beyond the stated extractions.
- Fixtures/docs: all 12 diagnostic conversions body-identical with timeouts preserved in correct vitest arg positions; `benchmark-rating.ts` has zero numeric/logic drift (all three HEAD variants were already identical) and all seven consumers deduplicated; `_edge-zoom` matches sibling fixture-resolution pattern; docs diffs each exactly one line with no EOL flips; ledger spot-checks (8 claims) accurate with one harmless understatement.

Audit-run verification: focused core slice 12 files / 89 tests pass; tooling slice 3 files / 26 tests pass; perceptual suite 16 passed / 12 skipped files (95/15 tests); whole-tree `tsc` clean; scoped eslint clean on all audited files. Not verified by this audit: full-tree vitest/lint/build re-run, `TRACE_AUDIT=1` diagnostic execution, and any perceptual/hardware output fidelity.

No fixes were made during this audit; findings await maintainer disposition.
