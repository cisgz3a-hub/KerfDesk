# SECTORS.md — Audit sector division

> Phase 1 deliverable. Divides the whole repo into disjoint, file-exhaustive
> sectors so "all files checked" is verifiable. Adopts the recent evidence-based
> **S01–S09** partition from `audit/REPOSITORY-SECTOR-ARCHITECTURE-2026-07-03.md`
> (which covers every file from `git ls-files -co --exclude-standard`), re-verified
> against this session's directory listing and file counts.

## How cross-cutting concerns map (reconciliation with the requested rubric)

The requested example sectors included cross-cutting themes (Security/auth,
Performance/debt, Tests/CI, Dead code). Rather than make those separate sectors —
which would double-count files — they are applied as **rubric dimensions inside every
sector** (`RUBRIC.md` items 9–13, 14, 17, 19). Exceptions that get a *dedicated*
home because they own real files:
- **Tests/CI/build tooling** → **S02** (owns the config + `scripts/` + `.github/`).
- **Security trust boundary** → concentrated in **S03** (Electron) + **S06** (untrusted
  parsers) + **S07** (permissions), but the security rubric item applies everywhere.
- **Fixtures/harness quality** → **S09**.

File membership is by path pattern; a file is audited in the sector that owns its
production behavior. Co-located `.test.ts` files are audited with their source.

---

## Sector table (audit order = table order)

| # | Sector | ~Files | Risk | Rationale for risk |
|---|---|---:|---|---|
| S01 | Governance, audit history, product contracts | 231 | **Medium** | Claim-vs-reality drift; contradictory docs mislead every future change; "Built/CLAIMED" honesty gates release. Not executable, so low *runtime* risk. |
| S02 | Tooling, build, release, CI, static shell | 24 | **High** | CI gates are the *only* enforcement of the invariants; a gap here lets defects ship. Deploy/branch correctness. |
| S03 | Electron desktop runtime + local bridge | 14 | **High** | Trust boundary (contextIsolation/sandbox/serial permissions); native FS + RTSP bridge handle real OS resources. |
| S04 | Core domain models + controller/device/material primitives | 292 | **High** | Geometry + controller drivers + device profiles; clipper2 NaN exposure; purity invariants; feeds directly into output. |
| S05 | Core job compile, preflight, raster/trace, output | 219 | **Critical** | The G-code + all 9 safety invariants live here. A defect = wrong/dangerous machine action. Trace fidelity gap. |
| S06 | IO formats and persistence | 97 | **High** | Untrusted-input parsers (SVG/DXF/STL/G-code/.rd) + `.lf2` persistence/migration (silent data loss). |
| S07 | Platform adapters | 15 | **High** | WebSerial connect/disconnect lifecycle (disconnect-burn history); deploy gate; PWA update semantics. |
| S08 | UI application workflows | 722 | **High** | Largest surface; E-stop reachability; state slices + coupling; god-file candidates; operator-facing failure. |
| S09 | Fixtures, perceptual harness, test assets | 77 | **Medium** | Determines what the suite actually proves; harness that only checks structure (not fidelity) is a false-confidence risk. |

> File counts are the 2026-07-03 pattern counts (whole tracked+untracked inventory,
> ~1,691 files). This session verified the `src/` subset: core 299+212, io 50+45,
> platform 6+9, ui 435+285, electron 6+6. Counts are re-checked at each sector's Step 1.

---

## Sector detail

### S01 — Governance, audit history, product contracts · Risk: Medium
**Members:** `CLAUDE.md`, `PROJECT.md`, `WORKFLOW.md`, `DECISIONS.md`, `AUDIT.md`,
`README.md`, `CONTRIBUTING.md`, `LICENSE`, `RESEARCH_LOG.md`, `THIRD_PARTY_NOTICES.md`,
`HANDOFF-*.md`, `PHASE-*.md`, `AUDIT-*.md`, `FEATURE-AUDIT-*.md`, `FIXES-*.md`,
`LIGHTBURN-*.md`, `MATERIAL-*.md`, `docs/**`, `audit/**`.
**Responsibility:** the source-of-truth contracts + historical audit evidence.
**Likely risk areas:** ADR numbering collisions (memory notes several); doc/code drift
(`platform/electron/` reference; feature status columns); "Built" vs hardware-verified
honesty; contradictory scope claims across 130+ report files.
**Add-on rubric:** claim-verification honesty; ADR integrity; internal contradiction.

### S02 — Tooling, build, release, CI, static shell · Risk: High
**Members:** `.editorconfig`, `.gitattributes`, `.gitignore`, `.prettierignore`,
`.prettierrc`, `.github/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
`tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.mjs`,
`eslint.electron.config.mjs`, `scripts/**`, `public/**`, `index.html`.
**Responsibility:** build, verification gates, release/deploy automation, static shell.
**Likely risk areas:** does `release:check` actually run every guard the docs claim?
file-size policy authority vs raw counts; license-checker transitive coverage; deploy
branch (`master` vs `main`); PWA/service-worker config; Playwright absence.
**Add-on rubric:** CI gate completeness; deploy correctness; enforcement authority.
**Baseline health checks are executed at the START of this sector** (and a repo-wide
baseline before S01): `test`, `lint`, `lint:electron`, `typecheck`, `check:file-size`,
`license-check`, `audit:deps` — outputs saved to `audit/` evidence and cited.

### S03 — Electron desktop runtime + local bridge · Risk: High
**Members:** `electron/**` (main.ts, serial-port-choice, trusted-renderer-policy,
rtsp-camera-bridge[-policy][-cli], csp/source-map policy tests), `electron-builder.yml`.
**Responsibility:** desktop shell, security policy, native serial + camera bridge.
**Likely risk areas:** literal hardening config (contextIsolation/sandbox/nodeIntegration);
`setPermissionRequestHandler` scope (serial + fileSystem only); RTSP bridge input
validation/command injection; CSP via `onHeadersReceived`; source-map exposure.
**Add-on rubric:** trust-boundary config as literal; permission scope; bridge input safety.

### S04 — Core domain models + controller/device/material primitives · Risk: High
**Members:** `src/core/`: `app-branding.ts`, `box/**`, `camera/**`, `cnc/**`,
`controllers/**`, `devices/**`, `geometry/**`, `grbl-streaming.ts`, `material-library/**`,
`relief/**`, `scene/**`, `shapes/**`, `sim/**`, `text/**`, `util/**`.
**Responsibility:** pure domain models + geometry + controller/device/material primitives.
**Likely risk areas:** purity violations (clock/rng/IO/globals in `core`); clipper2 NaN
& degenerate-geometry exposure; discriminated-union exhaustiveness (`assertNever`);
device-profile catalog correctness (`$30`/origin); controller-driver capability policy.
**Add-on rubric:** purity; NaN/degenerate handling; union exhaustiveness.

### S05 — Core job compile, preflight, raster/trace, output · Risk: Critical
**Members:** `src/core/`: `invariants/**`, `job/**`, `output/**`, `preflight/**`,
`raster/**`, `trace/**`.
**Responsibility:** compile scene→job, safety preflight, raster/trace pipelines, G-code emit.
**Likely risk areas:** all 9 invariants (laser-off, bounds, power, determinism, no-partial);
trace outline-vs-centerline fidelity; raster S-modulation + overscan; NaN into emitter;
snapshot integrity; performance (quadratics at scene/pixel scale).
**Add-on rubric:** all invariants I1–I9 + CNC Z/overdeep; fidelity gap; determinism.

### S06 — IO formats and persistence · Risk: High
**Members:** `src/io/**`: `dxf/`, `gcode/`, `lightburn/`, `machine-profile/`,
`material-library/`, `project/` (`.lf2`), `rd/`, `stl/`, `svg/`.
**Responsibility:** file formats, parse/serialize, import/export boundaries.
**Likely risk areas:** SVG sanitize completeness (DOMPurify config + custom hook);
clean-room DXF/STL/`.nc`/`.rd` parsers on hostile/malformed input; `.lf2` migration
correctness + version skew; round-trip determinism; unbounded allocation.
**Add-on rubric:** untrusted-input safety; migration correctness; round-trip fidelity.

### S07 — Platform adapters · Risk: High
**Members:** `src/platform/**`: `types.ts`, `web/` (web-adapter, web-serial, web-camera,
camera-bridge, pwa-precache, cloudflare-pages-routing, deploy-workflow-gate, repo-policy, favicon).
**Responsibility:** browser platform adapter behavior behind the `PlatformAdapter` interface.
**Likely risk areas:** WebSerial connect/disconnect/reconnect lifecycle + cleanup;
adapter interface conformance vs Electron side; deploy-workflow gate; PWA precache /
update-nag semantics; Brave WebSerial gating hint.
**Add-on rubric:** serial lifecycle; interface conformance; deploy/PWA correctness.

### S08 — UI application workflows · Risk: High
**Members:** `src/ui/**`, `src/vite-env.d.ts`.
**Responsibility:** React workflows, state glue, commands, canvas viewport, all windows.
**Likely risk areas:** E-stop reachability (#9) across window states; Zustand slice
discipline + hidden coupling; component/file size limits; render performance (60fps @
5k segments); floating promises in async UI; side-effect-free live-verification discipline;
god files (`scene-mutations`, `store`, `laser-store`).
**Add-on rubric:** E-stop reachability; state discipline; component-size; render perf.

### S09 — Fixtures, perceptual harness, test assets · Risk: Medium
**Members:** `src/__fixtures__/**` (controllers sims, perceptual IoU harness + assets,
property, svg/malicious).
**Responsibility:** shared test resources; the harness that defines what tests prove.
**Likely risk areas:** does the perceptual harness assert *fidelity* or only IoU/structure?
simulator realism vs real firmware; malicious-SVG corpus coverage; fixture drift from source.
**Add-on rubric:** fidelity-vs-structure gap; simulator realism; corpus completeness.

---

## Completion bar (per sector)

A sector is complete only when: every in-scope file was inspected; ≥3 passes recorded
(broad → adversarial → regression/integration); candidates verified with evidence;
false positives removed; `MEMORY.md` updated; remaining uncertainty documented; the
verifier pass agrees. Tracked in `AUDIT_STATE.md`.
