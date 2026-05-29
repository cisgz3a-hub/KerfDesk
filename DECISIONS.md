# DECISIONS.md — LaserForge 2.0

> Architecturally significant decisions only. A future maintainer should understand the *why* without needing to ask.

## Decision index

| ID | Date | Status | Title |
|---|---|---|---|
| ADR-001 | 2026-05-26 | Accepted | Adopt LightBurn workflow as the product model |
| ADR-002 | 2026-05-26 | Accepted | Fully clean rewrite — no port from LF1 |
| ADR-003 | 2026-05-26 | Accepted | Ship both web app and Windows desktop from one codebase |
| ADR-004 | 2026-05-26 | Accepted | Streaming to laser is in MVP; delivered in phases |
| ADR-005 | 2026-05-26 | Accepted | Color-driven layers (multi-op); only Line mode in MVP |
| ADR-006 | 2026-05-26 | Accepted | GRBL v1.1+ only; extensible strategy for future controllers |
| ADR-007 | 2026-05-26 | Accepted | Windows-only desktop; web app covers macOS and Linux |
| ADR-008 | 2026-05-26 | Superseded | MIT open source, public from first commit (see ADR-018) |
| ADR-009 | 2026-05-26 | Accepted | TypeScript + React + Vite + Vitest stack |
| ADR-010 | 2026-05-26 | Accepted | Architectural discipline to prevent cascading regressions |
| ADR-011 | 2026-05-26 | Accepted | Platform adapter pattern for web vs Electron |
| ADR-012 | 2026-05-26 | Accepted | Text + fonts as Phase D; bundle MIT fonts |
| ADR-013 | 2026-05-26 | Accepted | Image vectorize as Phase E feature, not MVP |
| ADR-014 | 2026-05-26 | Accepted | SceneObject as discriminated union, extensible from day one |
| ADR-015 | 2026-05-26 | Accepted | File-size discipline and anti-god-file enforcement |
| ADR-016 | 2026-05-26 | Accepted | Documentation-as-spec: WORKFLOW.md and CLAUDE.md |
| ADR-017 | 2026-05-26 | Accepted | Third-party library evaluation policy; DOMPurify pinned for Phase A |
| ADR-018 | 2026-05-27 | Accepted | Proprietary license, private repo (supersedes ADR-008) |

---

## ADR-001 — Adopt LightBurn workflow as the product model

**Status:** Accepted | **Date:** 2026-05-26

### Context
LaserForge 2.0 enters a category dominated by LightBurn with credible open-source contenders. Users moving between tools expect a recognizable mental model.

### Decision
Adopt LightBurn's user-facing workflow and naming: workspace with bed dimensions, color-as-layer, Cuts/Layers window, preview in-viewport, Laser window for streaming control, `.lf2` project files analogous to `.lbrn`.

### Alternatives considered
- **Rayforge model:** rejected — smaller install base.
- **Invent a new workflow:** rejected — no evidence LightBurn's model is the bottleneck.
- **Clone LightBurn 1:1:** rejected — feature breadth contradicts ADR-010, ADR-015.

### Verification
A LightBurn user completes Phase A's primary flow on first launch without docs.

---

## ADR-002 — Fully clean rewrite — no port from LF1

**Status:** Accepted | **Date:** 2026-05-26

### Context
LF1 audit scored 9/10 on pipeline correctness, but the user's lived experience is shotgun surgery (Q10). A 9/10 module that breaks under maintenance is not 9/10.

### Decision
No code carries over from LF1. ADR-010 and ADR-015 govern.

### Alternatives considered
- **Port the pipeline:** rejected — coupling carried forward.
- **Refactor in place:** rejected — user explicitly chose "from scratch."
- **Port only pure modules:** rejected — drawing the line is itself coupling analysis.

### Verification
- **Clean-room confirmation:** `git log --diff-filter=A` shows every source file authored in the 2.0 repo; no file imported from LF1.
- **Behavioral parity sanity check (separate goal):** an LF1 fixture set is run through 2.0's pipeline; G-code output matches LF1 byte-for-byte where the two specify the same behavior, or each divergence is documented in `RESEARCH_LOG.md` with rationale. This is a correctness signal, not a re-implementation of the "no port" decision.

---

## ADR-003 — Ship both web app and Windows desktop from one codebase

**Status:** Accepted | **Date:** 2026-05-26

### Decision
One codebase, two build targets. Both share `core/`, `ui/`, `io/`. They differ only in `platform/web/` vs `platform/electron/`.

### Verification
Phase A: both builds open and complete primary flow; same `.lf2` opens losslessly in both.

---

## ADR-004 — Streaming to laser is in MVP; delivered in phases

**Status:** Accepted | **Date:** 2026-05-26

### Decision
Phase A file-only, Phase B streaming, Phase C polish. Each independently shippable.

### Verification
Phase A merges with all acceptance green before Phase B starts.

---

## ADR-005 — Color-driven layers; only Line mode in MVP

**Status:** Accepted | **Date:** 2026-05-26

### Decision
Color-driven Layers. Mode dropdown matches LightBurn's three options; only **Line** enabled in MVP. Fill and Image visible-but-disabled with tooltip. UI contract stable; future modes are `core/output` strategy implementations.

### Verification
SVG with five colors → five rows.

---

## ADR-006 — GRBL v1.1+ only; extensible strategy for future controllers

**Status:** Accepted | **Date:** 2026-05-26

### Decision
- MVP ships **GRBL v1.1+ only**.
- `OutputStrategy` interface designed for multi-controller.
- Connection handshake refuses non-GRBL with clear error.
- **MIT availability of alternative controllers (CNCjs has Marlin/Smoothie/g2core/TinyG) does not change this.** ADR-017 explicitly notes that library availability is not a scope-expansion trigger.

### Verification
Connection handshake rejects non-GRBL. `OutputStrategy` is implementable by a stub `TestStrategy`.

---

## ADR-007 — Windows-only desktop; web app covers macOS and Linux

**Status:** Accepted | **Date:** 2026-05-26

### Decision
- Desktop: Windows 10 and 11 only.
- macOS / Linux: web app only in MVP.
- electron-builder packages all three for free, but this ADR says ship one in MVP — same discipline rationale as ADR-006.

### Verification
Phase A: Windows `.exe` opens and runs on Windows 10 and 11.

---

## ADR-008 — MIT open source, public from first commit

**Status:** Superseded by ADR-018 (2026-05-27) | **Date:** 2026-05-26

### Decision
- License: **MIT**.
- Repo public from first commit.
- Permitted dependency licenses: MIT, BSD-2/3, Apache-2.0, MPL-2.0, ISC, Unlicense, 0BSD.
- Rejected: GPL family (GPL-2, GPL-3, AGPL, LGPL), proprietary, source-available (BSL, Elastic).
- Enforcement: `license-checker` runs in CI; GPL transitive deps fail the build.

### Verification
`LICENSE` in repo root. CI dependency audit fails on GPL.

### Why superseded
Phase B hardware verification on a real Falcon A1 Pro changed the
project's posture from "open-source from day one" to "private hobby
project that may become a commercial product." Public-then-private is
not reversible (forks persist), so the cautious option is private now
with the license decision deferred. The dependency policy (MIT-compatible
deps only) survives unchanged — that's about what we *consume*, not how
we *publish*. See ADR-018.

---

## ADR-009 — TypeScript + React + Vite + Vitest stack

**Status:** Accepted | **Date:** 2026-05-26

### Context
The stack needs to: (a) compile to both a static web bundle and an Electron renderer; (b) support strict typing with discriminated unions (required by ADR-010 and ADR-014); (c) host a snapshot/property/E2E test pyramid with low ceremony; (d) keep cold-start budgets achievable (web < 2 s, desktop < 3 s); (e) be familiar to a wide solo-dev contributor pool so the first outside PRs are not blocked by tooling.

### Decision
TypeScript strict, React 18 hooks, Vite, Vitest, `fast-check`, Playwright, Zustand, CSS Modules, ESLint with `eslint-plugin-boundaries`, Prettier.

### Alternatives considered
- **Svelte / SolidJS:** rejected — smaller talent pool; less battle-tested with `eslint-plugin-boundaries`-style module isolation; not worth the migration cost from a React-first plan.
- **Webpack instead of Vite:** rejected — slower dev loop; not necessary for our bundle size; Vite's ESM-first dev server keeps cold reload under a second.
- **Jest instead of Vitest:** rejected — Vitest is Vite-native, runs the same TS pipeline as the app, and has equivalent snapshot semantics.
- **Redux instead of Zustand:** rejected — Redux toolkit's boilerplate fights ADR-015 file-size limits; Zustand slices map naturally to one-responsibility-per-file.
- **Tailwind / Chakra / Mantine instead of CSS Modules:** rejected for MVP — UI surface is small and bespoke; UI frameworks impose a class-name namespace and runtime cost not justified by Phase A scope (revisit at Phase D).

### Verification
- `tsconfig.json` enforces `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (verified by intentional-error fixture in CI).
- `pnpm test` runs Vitest unit + property + snapshot suites green.
- `pnpm dev:web` cold-loads in < 2 s on a developer laptop; documented in Phase A acceptance.

---

## ADR-010 — Architectural discipline to prevent cascading regressions

**Status:** Accepted | **Date:** 2026-05-26

### Context
Q10's pain is shotgun surgery. Paired with ADR-015 which addresses the same problem from the file-size angle.

### Decision
Enforced in code, tests, CI:
1. Pure-function pipeline core. `core/` is pure.
2. No platform imports in core (ESLint boundaries).
3. Module public APIs explicit (only `index.ts` exposed).
4. Invariants property-tested via `fast-check`.
5. G-code output snapshot-tested.
6. Discriminated unions over flags, with exhaustiveness.
7. State updates reducer-pure.
8. Tests before fixes.
9. Exceptions require new ADRs.

### Verification
Deliberately-coupled commit rejected by CI. Bug-fix PR without regression test rejected. Snapshot diff acknowledged.

---

## ADR-011 — Platform adapter pattern for web vs Electron

**Status:** Accepted | **Date:** 2026-05-26

### Decision
One `PlatformAdapter` interface, two implementations. Responsibilities: file I/O, serial port, dialog, drag-and-drop. Adapter narrow (~12 methods). Adapter injected at React root.

### Verification
`MockAdapter` lets entire app run headless. Phase A E2E uses both real adapters.

---

## ADR-012 — Text + fonts as Phase D; bundle MIT fonts

**Status:** Accepted | **Date:** 2026-05-26

### Decision
- Phase D feature, not MVP.
- **Bundled MIT-licensed fonts only.** No system font access. No user-uploaded fonts in MVP-D.
- `opentype.js` (MIT) for text-to-path.
- `TextObject` variant of `SceneObject` (ADR-014). Flows through Line pipeline.

### Verification
Phase D acceptance: typing each bundled font produces G-code that cuts at correct dimensions. Web and desktop produce byte-identical G-code.

### Open question
Specific font set TBD at Phase D kickoff. Likely candidates from OFL/MIT collections.

---

## ADR-013 — Image vectorize as Phase E feature, not MVP

**Status:** Accepted | **Date:** 2026-05-26

### Decision
- Phase E feature, not MVP.
- `imagetracerjs` (Unlicense — MIT-compatible). `potrace-wasm` rejected (GPL-2).
- `TracedImage` Scene object flows through Line pipeline.

---

## ADR-014 — SceneObject as discriminated union, extensible from day one

**Status:** Accepted | **Date:** 2026-05-26

### Decision
`SceneObject` is a tagged union: `imported-svg` (Phase A), `text` (Phase D), `traced-image` (Phase E). `JobCompiler` exhaustively pattern-matches with `assertNever` default arm.

### Verification
Phase A acceptance: stub `TextObject` variant compiles through `JobCompiler` without modifying existing tests.

---

## ADR-015 — File-size discipline and anti-god-file enforcement

**Status:** Accepted | **Date:** 2026-05-26

### Context
LF1's `App.tsx` was 1,631 lines. AI-assisted coding tends to pile into existing files. Enforcement (not aspiration) prevents recurrence.

### Decision
Hard limits enforced by ESLint:
- File: 400 lines hard, 250 soft
- React component: 250 hard, 150 soft
- Function: 80 hard, 40 soft
- Cyclomatic complexity per function: 12 hard, 8 soft
- Default exports per file: 1
- `index.ts` public exports: 20 hard, 10 soft

Plus: co-located tests required, single responsibility (no "and" in description), new-file-first default. See `CLAUDE.md` for operational rules.

### Verification
ESLint's `max-lines` rule is the authoritative gate and fails CI on violation: 400 lines **excluding blank and comment lines** (`skipBlankLines: true, skipComments: true`). CI additionally runs a coarse raw-line backstop (`wc -l`, threshold 600) that counts *every* line — including the explanatory comments CLAUDE.md mandates — purely as a guard against catastrophic bloat; its threshold is deliberately looser than the 400 code-line rule and is not the real limit.

---

## ADR-016 — Documentation-as-spec: WORKFLOW.md and CLAUDE.md

**Status:** Accepted | **Date:** 2026-05-26

### Decision
Five spec documents, each with single audience and purpose, plus a README entry index:
- `README.md` — entry index (audience: humans landing on the repo)
- `PROJECT.md` — scope, non-negotiables, phase plan
- `WORKFLOW.md` — detailed user flows (4 states each)
- `DECISIONS.md` — ADRs
- `CLAUDE.md` — Claude Code operating manual
- `RESEARCH_LOG.md` — external claims and library adoptions

`PROJECT.md` references the others rather than duplicating. `README.md` is an index, not a spec — it must never carry decision rationale or workflow details (those live in the dedicated docs).

### Verification
Reviewer answers "what should this UI do?" from `WORKFLOW.md` alone; "why this architecture?" from `DECISIONS.md` alone. Claude Code session opens by reading `CLAUDE.md`.

---

## ADR-017 — Third-party library evaluation policy; DOMPurify pinned for Phase A

**Status:** Accepted | **Date:** 2026-05-26

### Context
The project source code is proprietary (ADR-018) but uses MIT-compatible dependencies freely (the dep-policy half of the original ADR-008 survived into ADR-018 unchanged). The user has indicated that "if there is proven MIT code for extra features, we can do research and add it." This is a powerful capability — well-maintained libraries reduce bug surface, and proven implementations are often safer than hand-rolled equivalents.

It is also the most common cause of project drift. "We can add X because the library is free" is the most common rationalization that leads to scope explosions, dependency bloat, and the exact cascading-bug pattern Q10 warned against. Library availability does not change product scope. The phase plan in `PROJECT.md` is what determines what ships when.

This ADR defines the policy that lets us adopt third-party code safely.

### Decision

**Policy.** A third-party library may be adopted as a runtime dependency only when **all** of the following are true:

1. **It serves a use case in the current phase or an earlier phase's debt.** Not "it might be useful later." Speculative dependencies are rejected. Future-phase libraries are *evaluated* at the start of their phase, not adopted preemptively.

2. **Its license is in the permitted list** (ADR-008): MIT, BSD-2/3, Apache-2.0, MPL-2.0, ISC, Unlicense, 0BSD. The license is verified against the package's actual `LICENSE` file, not just the npm metadata.

3. **It is actively maintained.** Last release within 12 months, no unresolved security advisories in the version we'd pin, issue response time visible in the repo.

4. **It fits the architecture.** Specifically:
   - Does not require global state.
   - Does not throw for control flow (or its throws are catchable at a clear boundary).
   - Works in both web and Electron with no platform-specific patches.
   - If it lives in `core/`, it is pure (no I/O, no side effects). If it does I/O, it lives in `platform/` or `io/`.
   - Does not introduce a competing pattern for state, routing, styling, or data flow.

5. **Bundle-size impact is acceptable.** Web bundle target is < 1 MB compressed. New dependency must show its compressed contribution. If it pushes past budget, alternatives must be evaluated.

6. **CVE status is clean.** The pinned version must have no unfixed critical or high CVEs. Recent CVEs in earlier versions are acceptable if the fix is in the pinned version and noted in `RESEARCH_LOG.md`.

7. **Adoption is logged.** Every adopted dependency gets a `RESEARCH_LOG.md` row: name, version, license, last release date, justification, evaluation date, who evaluated, alternatives considered.

**Anti-policy.** A library is *not* adopted because:
- "It's the standard." (Investigate why; the standard may not fit our architecture.)
- "It would be nice to have feature X." (Feature X is in or out per the phase plan, not per library availability.)
- "Everyone uses it." (Audit it like anything else.)
- "It saves time." (Maybe — measure the time saved against the maintenance, dependency-update, and CVE-watching tail.)

**Phase-by-phase evaluation, not bulk adoption.** Library decisions are made at the start of each phase, against a concrete acceptance bar. Libraries pinned for phases not yet started are anticipations, not commitments.

### Phase A library decisions (pinned now)

| Use case | Library | Version | License | Notes |
|---|---|---|---|---|
| SVG parsing | native `DOMParser` | n/a | n/a | Available in browser and via jsdom in Node tests. No dependency. |
| SVG sanitization | **DOMPurify** | **>= 3.3.2** | MPL-2.0 OR Apache-2.0 | Verified MIT-compatible. CVE-2026-0540 fixed in 3.3.2. Used with `USE_PROFILES: { svg: true, svgFilters: true }` and a custom hook stripping external `xlink:href` and non-image data URIs. |

That's the only new runtime dependency Phase A adds. Everything else in Phase A is in `package.json` already from the stack choice (React, Vite, Zustand, Vitest, fast-check, ESLint plugins).

### Phase B library candidates (evaluated at Phase B kickoff)

| Use case | Candidate | Notes |
|---|---|---|
| GRBL protocol reference | **CNCjs** source code | MIT (github.com/cncjs/cncjs). Read for protocol details. **Not adopted as a dependency** — too large, brings its own architecture. |
| Serial port (Electron) | `serialport` | MIT, the standard for Node serial. Phase B-only. |
| Serial port (web) | native `Web Serial API` | n/a, no dependency |

### Phase C library candidates

| Use case | Candidate | Notes |
|---|---|---|
| Path simplification | `simplify-js` | BSD-2-Clause (compatible). Douglas-Peucker; tiny. |
| Polyline flattening | `flatten-svg` | ISC (verified via npm metadata; ISC is in the permitted list per ADR-008). Alternative to hand-rolled bezier subdivision. |

### Phase D / E candidates already pinned in ADR-012 / ADR-013

- `opentype.js` (MIT) — Phase D text-to-path.
- `imagetracerjs` (Unlicense — MIT-compatible) — Phase E raster trace.

### What this policy explicitly rejects

- Adopting `cncjs` as a dependency to "support more controllers in MVP" — ADR-006 stands.
- Adopting raster-dither libraries to "add Fill mode to MVP" — ADR-005 stands.
- Adopting `paper.js` or `fabric.js` to "make rendering easier" — they introduce a competing data model and would require pipeline changes. Our Canvas2D approach is sufficient.
- Adopting `electron-builder` macOS / Linux targets to "support more OSes" — ADR-007 stands.

### Alternatives considered for the policy itself

- **No policy (treat every dep as a one-off decision):** rejected — exactly the kind of unrigorous adoption that bloats projects.
- **Stricter policy (no new deps without a full RFC):** rejected — too heavyweight for solo development.
- **Centralized "dependency review" step in CI:** considered. The `license-checker` plus `RESEARCH_LOG.md` discipline plus this policy provides the same protection at lower process cost.

### Consequences
- Easier: justifiable adoption decisions; clean license audit; CVE tracking; bounded bundle size.
- Harder: no quick "throw a library at it" shortcuts. Every new dep is a small ADR-shaped artifact in `RESEARCH_LOG.md`.

### Verification
- Phase A CI includes `license-checker` step.
- `RESEARCH_LOG.md` has an entry for DOMPurify before the first PR that imports it lands.
- Future PR that adds a runtime dependency without a `RESEARCH_LOG.md` entry is rejected by CI lint (custom rule).

---

## Open items

1. ~~**Phase A fixture corpus.** Five SVG fixtures for snapshot tests.~~ ✅
   Shipped — see `src/__fixtures__/svg/` (rectangle-single-color,
   two-color-paths, multi-shape, closed-polygon, zigzag).
2. ~~**Bundled MIT fonts list** for Phase D~~ ✅ Resolved at Phase D
   kickoff — bundled fonts are Inter, Roboto, Source Code Pro, Pacifico
   (all OFL/MIT, see `src/fonts/`).

## ADR-018 — Proprietary license, private repo (supersedes ADR-008)

**Status:** Accepted | **Date:** 2026-05-27

### Context
ADR-008 committed the project to MIT and a public repo from the first
commit. That made sense when the project was "open-source CAM tool for
GRBL lasers." After Phase B verified on real hardware (Creality Falcon
A1 Pro: connect, autofocus, frame, full burn cycle all working), the
owner's posture shifted: this may become a commercial product, and the
monetization model isn't decided yet.

The asymmetry is the deciding factor:
- **Public-then-private is not reversible.** Forks of an MIT version
  persist forever; you can re-license future versions but cannot
  retract the prior one.
- **Private-then-public is one toggle.** Costs nothing to defer.

Per the safety principle in CLAUDE.md ("when you don't know — say
so"), choosing irreversibly in either direction without a clear
monetization plan would be premature.

### Decision
- **License: All Rights Reserved.** `LICENSE` is a proprietary notice;
  no permission granted to use, copy, modify, or redistribute.
- **Repo visibility: private.** GitHub Free supports unlimited
  private repos, so this costs nothing.
- **Dependency policy preserved from ADR-008.** Permitted licenses:
  MIT, BSD-2/3, Apache-2.0, MPL-2.0, ISC, Unlicense, 0BSD. Rejected:
  GPL family, source-available (BSL, Elastic), proprietary.
  Rationale: deps are about what we consume, not how we publish; an
  MIT-compatible dep tree keeps every future license option open
  (commercial, dual, OSS, hybrid).
- **`LICENSE` carries a note** that third-party deps remain governed
  by their own upstream licenses — covers redistribution mechanics
  cleanly without re-licensing the deps under our notice.

### Alternatives considered
- **Keep MIT, go private.** Confusing: MIT permits everyone to use the
  software but private repo hides the source, defeating the OSS
  contract. Mixed signal.
- **MIT + public + dual-license commercial later.** Works for some
  projects (Qt) but locks the upstream-OSS version forever; anyone
  building a competing product just forks the MIT version. Wrong
  default for "might monetize, no plan yet."
- **AGPL public.** Preserves commercial leverage (SaaS competitors
  must open their stack) but burns the goodwill of "free hobby tool"
  framing and is hostile to the diode-laser hobbyist audience.
- **BUSL / source-available.** Closest to "I'll decide later." Heavier
  legal footprint than a simple proprietary notice and we don't need
  source-available framing for a private repo.

### Verification
- `LICENSE` in repo root reads "All Rights Reserved" (verified at
  initial commit).
- New GitHub repo created with visibility set to Private.
- `README.md` License section names the proprietary status.
- `pnpm license-check` still enforces the dependency-license allow-list
  (the ADR-008 dependency policy survives unchanged).

### Reversal triggers
Promote to a permissive license (MIT, Apache-2.0) or source-available
(BSL, Elastic) when *any* of the following becomes true:
1. Monetization model is decided and an OSS release supports it
   (e.g., open-core, hosted-paid, support-paid).
2. External contributors materially help and need a contributor
   license that proprietary doesn't allow.
3. A community fork would help adoption more than control does.

Reversal requires a new ADR superseding this one.

---

## ADR-019 — Phase F kickoff: Fill is a geometry decision in `compileJob`

### Status | Date
Accepted | 2026-05-28

### Context

PROJECT.md flagged Phase F (raster engrave) as needing a new revision +
DECISIONS.md entry before code. Phase F has two sub-modes — Fill (hatch
lines inside a closed contour) and Image (per-pixel S-modulation raster)
— that share dispatch infrastructure but produce very different G-code
shapes.

The dormant `LayerMode = 'line' | 'fill' | 'image'` enum (added in ADR-005
for forward compatibility) is the natural activation point. `compileJob`
currently switches only on `SceneObject.kind` (`imported-svg`, `text`,
`traced-image`) and ignores `layer.mode`. `grbl-strategy` hardcodes M3
and emits one S-value per CutGroup.

Phase F has been split into F.1 (Fill) and F.2 (Image). F.1 ships first
per the surgical-changes principle: it adds no new G-code shape, only
more polylines. F.2 will introduce the harder pieces (RasterImage scene
object, M4 mode, dithering, overscan, streaming) in a follow-up kickoff.

### Decision

For **Fill (F.1)**: hatch-line generation happens at **compile time** in
`compile-job.ts`, NOT at G-code emit time in `grbl-strategy.ts`. When a
layer's mode is `'fill'`, `appendPathSegments` replaces the per-color
polylines with the output of `fillHatching()` (scanline polygon fill,
even-odd rule) BEFORE applying the object's transform. The resulting
hatch lines flow through the existing CutSegment → grbl-strategy emit
path unchanged.

For **Image (F.2)**: separate emit path in `core/output/emit-raster.ts`
(not yet written). The CutGroup's source object kind will discriminate
between vector emit (line/fill, M3) and raster emit (image, M4).
Decisions deferred to F.2 kickoff.

Two new fields on `Layer`: `hatchAngleDeg: number` (0..180, default 0)
and `hatchSpacingMm: number` (default 0.2 mm ≈ 5 lines/mm). Pre-F.1
`.lf2` files back-fill defaults in `deserializeProject`'s
`normalizeLayer` — additive-with-default, no `schemaVersion` bump
(matches the D.1.a `letterSpacing` precedent).

### Alternatives considered

1. **Push Fill dispatch into `grbl-strategy`** — would require passing
   `layer.mode` into the strategy + duplicating the scanline math in any
   future OutputStrategy (Marlin etc.). Rejected: violates single
   responsibility (G-code emit shouldn't do geometry decisions).
2. **New SceneObject variant `FilledRegion`** — would require the user
   to explicitly create fill objects rather than flipping a layer mode.
   Rejected: every other CAM tool (LightBurn, LaserGRBL) keeps Fill as
   a layer attribute on existing geometry. Mode-on-layer matches user
   expectation and reuses the existing color-layer plumbing.
3. **Adopt `polygon-fill` / `flatten-svg` for the scanline math** —
   evaluated per ADR-017. `flatten-svg` doesn't do hatching. No
   maintained MIT-licensed JS library covers exactly our use case
   (closed polyline + hatch angle + spacing → hatch lines). Self-implement
   in ~150 LOC; documented in RESEARCH_LOG.md Phase F entry.

### Consequences

- `compile-job.ts` grows by ~30 LOC (the mode branch + the fillHatching
  invocation). Still well under file-size caps.
- `fill-hatching.ts` is a new pure-core module (no new dependencies).
- Existing G-code invariants (`findLaserOnTravelIssues`,
  `findOutOfBoundsCoords`) keep working unchanged — hatch lines are
  ordinary CutSegments.
- `Layer` gains two fields, surfaced in the UI only when `mode === 'fill'`.
  Older `.lf2` files load with defaults via the existing back-fill pattern.
- F.2 sketches a separate emit path; this ADR explicitly does NOT commit
  the image-engrave architecture. A future ADR-020 will cover it.

### Verification

- 10 unit + property tests for `fillHatching` cover: angle 0/90 symmetry,
  donut holes (even-odd rule), open polylines (skipped), degenerate input,
  spacing clamp, angle normalization, determinism.
- `compile-job.test.ts` proves that `layer.mode='fill'` on a 10mm square
  emits multiple 2-point segments (hatches) instead of the original 5-point
  outline, and that open polylines emit nothing.
- `project.test.ts` proves pre-F.1 `.lf2` files back-fill `hatchAngleDeg=0`
  and `hatchSpacingMm=0.2`.
- Hardware: F.1.f checklist on the Falcon (20mm square + 30mm letter "O").

---

## ADR-020 — Phase F.2 raster image engrave (kickoff)

### Status | Date
Accepted (kickoff — no code yet) | 2026-05-28

### Context

ADR-019 sketched F.2 as deferred. PROJECT.md Phase F.2 description
captures the surface — `RasterImage` SceneObject variant, M4 dynamic
mode, per-pixel S-modulation, dithering, overscan, streaming. The
research plan parked five open questions for this kickoff:

1. M3 vs M4 wiring — Layer field, DeviceProfile field, or hardcoded
   per layer.mode?
2. Dithering library vs roll-our-own — re-evaluate `floyd-steinberg`
   npm package vs ~30 LOC self-implementation?
3. Streaming vs materialize — at what byte-threshold do we switch
   from string concatenation to a generator-emit?
4. Preview rendering — Canvas2D drawing a million tiny lines is slow.
   Need a downsampled / image-blit preview.
5. Hardware test — real engrave of a 50×50 mm photo on the Falcon.

This ADR commits answers to 1-4 so F.2 implementation has a clear
target. Question 5 is hardware verification, not an architecture
decision; it lives in the F.2.f acceptance checklist.

### Decision

**Q1 — M-mode wiring: hardcoded per `layer.mode`.** Image groups emit
M4 (dynamic — power scales with feed); line/fill groups emit M3
(constant). No Layer field, no DeviceProfile flag. Rationale: the
M3/M4 choice is dictated by what the laser is doing (cut/engrave vs
raster), not the operator's preference. Exposing it as a knob invites
misconfiguration. If a controller variant later needs M3 for raster,
add a `forceMMode` field on DeviceProfile then.

**Q2 — Dithering: roll our own.** Three reasons:
- The `floyd-steinberg` npm package was last published 2017; would
  fail ADR-017 maintenance check.
- The algorithm is ~30 LOC of well-known math (error-diffusion table
  + serpentine scan) — every CAM tool implements it inline.
- Three modes ship: `threshold` (single-cutoff), `floyd-steinberg`
  (greyscale error-diffusion), `grayscale` (direct luma → S, no
  dithering — for lasers that support 256-level S). Pure functions in
  `src/core/raster/dither.ts`.

**Q3 — Streaming: write the full string up to 100 KB; generator past
that.** A 50×50 mm photo at 5 lines/mm is ~250 lines × ~30 chars =
7.5 KB — fits in memory. A 200×200 mm photo at 10 lines/mm balloons
to ~6 MB — must stream. The 100 KB threshold matches the heuristic
the AUDIT.md A6 mitigation already uses for bundle splits (the order
where allocation becomes user-visible). Implementation: emit-raster
returns either a `string` or an `AsyncIterable<string>`; the file/
serial writer adapts.

**Q4 — Preview: Canvas2D `drawImage` of the source raster, scaled to
the object's mm-bounds.** No per-pixel paths in the draw loop. The
RasterImage carries an `<img>`-loadable data URL — drawing it through
Canvas2D's `drawImage` with a matrix transform is hardware-accelerated
and avoids the million-line problem. Engraving G-code visualisation
(the "what will burn") is a separate render layer we'll add later if
needed; for the MVP, "here is the image at the right place and size"
is the preview.

**New SceneObject variant `RasterImage`:**
```ts
{ readonly kind: 'raster-image';
  readonly id: string;
  readonly source: string;        // filename
  readonly dataUrl: string;       // PNG data URL, embedded in .lf2
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly bounds: Bounds;        // mm bounds (mm-per-pixel from DPI)
  readonly transform: Transform;
  readonly dither: 'threshold' | 'floyd-steinberg' | 'grayscale';
  readonly linesPerMm: number;    // 5..25 typical; user-settable
}
```

**New Layer mode arm** — when `layer.mode === 'image'` and the layer's
group source is a RasterImage, `compileJob` emits a `RasterGroup`
discriminant that `emit-gcode.ts` dispatches to `emitRaster` instead
of the existing `emitGroup`. Non-RasterImage objects on an image-mode
layer warn and skip (similar to the Fill+open-polyline pattern).

### Alternatives considered

1. **Inline-base64 elsewhere or external file references.** Keeping
   the image data IN the `.lf2` was confirmed by the user this session
   for self-containment — losing the source raster would lose
   re-trace / re-dither ability.
2. **One generator-only emit path.** Always-stream is simpler but
   pessimises the common case (small image). The 100 KB threshold
   adds ~10 LOC and avoids the heap pressure on big jobs.
3. **`canvg` for image-on-canvas preview.** Heavier than necessary —
   we already have a decoded `HTMLImageElement` from `image-loader.ts`,
   so `drawImage` is the surgical-changes answer.

### Consequences

- New module `src/core/raster/` (dither, emit-raster, preview-data).
  Stays pure-core; no I/O.
- `scene-object.ts` gains the `RasterImage` variant; `compileJob`,
  `draw-scene`, and `serializeProject` get one new switch arm each.
  ESLint's exhaustiveness rule (ADR-019) makes the missing arms
  surface as TypeScript errors — the same enforced TODO list.
- `Layer` mode UI: enable the third dropdown option ('Image'), gate
  the dither + lines-per-mm inputs on it.
- `.lf2` schema gains the `raster-image` SceneObject. Back-fill is
  one-way (old files have no RasterImage). Bump schemaVersion only
  if old code needs to refuse new files; for now, additive-only.
- Bundle impact: zero. We don't adopt a new lib. The base64 image
  bytes live in user data, not in the build.
- Hardware verification (F.2.f) goes on the Falcon checklist before
  ship: 50×50 mm photo at 5 lines/mm, threshold + floyd-steinberg
  modes both burn without overheating.

### Verification

To be written WITH the implementation, not before:

- Unit tests for `dither.ts`: each algorithm round-trips a known
  luma-to-S mapping; property-test bounds + power-scale invariants.
- Unit tests for `emit-raster.ts`: a 4×4 fixture → known byte stream;
  overscan adds N mm of S0 travel at each row end.
- Snapshot test: a 16×16 fixture image at 5 lines/mm produces
  byte-identical G-code to a recorded snapshot.
- Determinism property: same RasterImage + same options → identical
  G-code over 100 fuzz seeds (the dither itself is deterministic
  given seed; we use 0 as the default seed).
- Hardware: 50×50 mm photo on the Falcon at 5 lines/mm and 10 lines/mm
  with each of the three dither modes.

### Out of scope for F.2

- Multi-pass raster (deep engrave). Single pass only.
- Per-row feed/power schedules (uniform across the image).
- Photo presets ("portrait", "landscape", "logo"). User picks
  dither + lines-per-mm; everything else uses Layer defaults.
- Multi-image compositing on the same layer. One RasterImage per
  layer for v1.
- Rotary-axis raster. PROJECT.md "Out of scope" still applies.

### Post-kickoff additions (decided during F.2 implementation)

These tweaks landed AFTER the kickoff Decision section was written,
in response to observed UX and hardware behaviour. Recording them
here so the ADR reflects what actually shipped.

1. **Skip blank rows during emit.** When a raster row contains no
   non-zero S-values, `emitRasterGroup` emits zero G-code for it
   (no G0, no G1). The controller plans an oblique rapid from the
   end of one active row to the start of the next. Saves time on
   banner-shaped images with empty bands above / below content.
   Rationale: matches what LightBurn / LaserGRBL do in practice
   for image-mode emit; ADR-020 originally specified "every row
   sweeps" which over-emits for sparse content.

2. **Clip rows to their active span.** For non-blank rows, the
   sweep starts at the first non-zero pixel (minus overscan) and
   ends at the last non-zero pixel (plus overscan). Was: full
   `bounds.minX - overscan` → `bounds.maxX + overscan` regardless
   of where pixels actually fell. Combined with #1, removes all
   wasted travel-at-feed across white space.

3. **draw-raster.ts transform composition.** `drawRasterImage`
   originally composed its Canvas2D `translate / rotate / scale`
   around the bounding-box centre and drew at `(-w/2, -h/2)`. That
   diverged from `applyTransform`'s scale-then-translate-around-
   origin math by `w * (1 - scaleX) / 2` for any `scaleX != 1`,
   so the rendered image drifted away from the selection box when
   `fitObjectToBed` auto-scaled a large import. Replaced with
   `translate(t.x, t.y) → rotate → scale → drawImage(bounds.minX,
   bounds.minY, w, h)` which mirrors `applyTransform` exactly.
   Regression test in `src/ui/workspace/draw-raster.test.ts` pins
   the convention against future refactors.

### Verification (now landed, not deferred)

Tests covering the items above:

- `src/core/raster/dither.test.ts` — 12 unit tests for the three
  algorithms (threshold / FS / grayscale).
- `src/core/raster/emit-raster.test.ts` — 20 unit tests: preamble
  / postamble, row layout, S-modulation, invariants, validation,
  skip-blank-rows, clip-active-span.
- `src/core/raster/emit-raster.property.test.ts` — 5 fast-check
  property tests, 100 fuzz seeds each: laser-off-on-travel
  (#3 non-negotiable), determinism (#5), X and Y coords inside
  bounds ± overscan, G0-per-row count never exceeds non-zero-rows
  count.
- `src/ui/workspace/draw-raster.test.ts` — 9 regression tests
  covering the transform-composition fix: identity, translated,
  scaled-down, scaled+translated, rotated 30°/90°, mirrored X/Y,
  full combo. Each asserts the draw-raster math matches
  `applyTransform` for all four image corners.

Hardware (F.2.f) is still user-driven per the WORKFLOW.md F-F2
checklist; not gated by these tests.

---

## ADR-021 — Phase F.3 set-work-origin via G92 (kickoff)

**Date:** 2026-05-28
**Status:** Accepted, code shipped, hardware verification pending.

**Context.** PROJECT.md's "Future feature notes" listed an operator
flow where the user jogs the laser head to a corner of the workpiece
and presses a button to declare "this is (0, 0) for the next job."
Standard CAM convention; LightBurn ships it as "Set Job Origin to
Current Position." Closes a gap experienced operators expect.

GRBL supports two mechanisms for this:

- `G92 X0 Y0` — transient; modifies the active WCS's machine-to-work
  offset. Cleared by GRBL on alarm, soft reset (`\x18`), power-cycle,
  or `$RST=#`. Matches LightBurn / LaserGRBL UX (each session starts
  with a clean origin).
- `G10 L20 P1 X0 Y0` — persistent; sets the G54 origin itself.
  Survives reset / reconnect. Reset is more involved (`G10 L2 P1
  X0 Y0` with head at machine zero, or `$RST=#`).

**Decision.**

1. **Ship G92 only.** Defer G10 L20 P1 (persistent mode) until a user
   requests it. Karpathy smallest-first; two modes is two UX surfaces
   to design and document, and we lack signal that anyone wants the
   persistent variant.
2. **Don't change the compile pipeline.** GRBL applies the WCS offset
   to absolute-G90 G-code at run time, so emitted coordinates already
   honour the offset. No new SceneObject fields, no `.lf2` schema
   change.
3. **Cache WCO in laser-store across status frames.** GRBL reports
   the WCO field intermittently (every Nth status per the WCO bit of
   `$10`), so the most recent frame's WCO is null ~29 times out of 30.
   UI consumers read `wcoCache` (last-seen value), never the raw
   `statusReport.wco`. The two-sources-of-truth boundary is documented
   in the parser's JSDoc; a future lint rule could enforce it.
4. **Defer preflight + Frame updates.** Bed-bounds preflight currently
   assumes origin = machine zero. A job that "fits the bed" in
   scene-mm may still run off-machine if the operator set origin near
   the workpiece edge. Mitigation: existing Frame button traces the
   actual machine path (post-WCS-offset), so framing AFTER set-origin
   reveals off-bed risk before the laser fires. Documented gap;
   surface origin-aware preflight in a follow-up if users hit it.
5. **Don't auto-write `$10`.** Adding a runtime check on connect is
   cheap, but toasting "your config is unusual" for a non-default
   `$10` is operator-hostile. WCO is reported on a separate bit from
   MPos/WPos so origin math works regardless.

**Cache invalidation.** `wcoCache` is cleared in three places, matching
the three ways GRBL clears G92 itself:

- `disconnect()` and the `onClose` callback (port drop / reconnect).
- `stopJob` (sends `\x18` soft reset).
- `'alarm'` branch in laser-line-handler (GRBL clears G92 on alarm 1).

Together these match GRBL's actual behaviour — operators never see a
"stale cache shows custom origin while GRBL says machine zero" state.

**MIT references consulted** (per ADR-017; algorithms / protocol
docs only, no code copied):

- CNCjs (`cncjs/cncjs`, MIT) — `src/server/controllers/Grbl/GrblController.js`
  caches WCO across status frames and surfaces "WCS offset active"
  in its UI. We re-implement the pattern, not the code.
- gnea/grbl wiki (public-domain) — `Interface.md` documents the WCO
  emission cadence and `$10` mask bits;
  `Grbl-v1.1-Configuration.md` documents G92 / G92.1 semantics under
  alarm and reset.
- grblHAL `core/grbl.md` (public-domain) — confirms vanilla GRBL 1.1
  behaviour.
- NOT consulted: LaserGRBL, gSender (both GPLv3). UX choices
  observable but no code reading per ADR-017.

**Consequences.**

- Operators get LightBurn-parity workpiece-relative jobs.
- Two new buttons (`Set origin here` / `Reset origin`) in
  `JobControls.tsx`, status-bar readout in `StatusDisplay.tsx`.
- `laser-store.ts` gains `wcoCache` field + two thin action wrappers.
- `StatusReport.wco` is parsed but UI must not read it directly
  (flicker). Comment in `status-parser.ts` flags this; convention
  enforced socially.
- Bed-bounds preflight gap remains; operators framing first remains
  the recommended safety check.
- 1 toast per Set/Reset action provides immediate feedback during
  the WCO-frame latency window (~0.25-7.5s).

---

## ADR-025 — Perceptual fidelity harness for the trace pipeline

**Date:** 2026-05-29
**Status:** Accepted, harness shipped, scope limits documented below.

**Context.** Every trace test we had asserted *structure* — path
counts, polyline lengths, SVG prefixes, contour topology. None rendered
the output and asked the only question an operator actually cares about:
"does the trace cover the source image's ink?" A test suite can be fully
green while the trace is visibly wrong, because nothing measured the
rendered result against the input. This is exactly the gap behind the
recurring "you keep telling me it works, but vs LightBurn it's faulty"
complaint: green `pnpm test` was never evidence of perceptual quality.
The standing rule (see CLAUDE.md "When you don't know — say so", and the
session feedback constraint) is to never call trace / fill / engrave
"working" on the basis of a green structural suite alone.

We needed a measuring instrument: render trace output back to pixels and
diff it against a known-correct mask.

**Decision.**

1. **Build a render-and-diff harness under `src/__fixtures__/perceptual/`,
   zero new dependencies, pure TypeScript.** It lives in `__fixtures__`
   (boundary- and coverage-exempt per `eslint.config.mjs`), so it may use
   `node:fs` / `node:zlib` / `process` for the opt-in artifact dump
   without violating the pure-core globals rule. No runtime dependency is
   added, so no RESEARCH_LOG / ADR-017 evaluation is required.

2. **Ground truth is analytic, not a stored golden file.** Each synthetic
   fixture (`shapes.ts`) is a black-on-white bitmap whose inked region is
   a closed-form predicate sampled at pixel centres. The *same* predicate
   fills both the source image the tracer sees and the truth mask. So the
   truth is, by construction, exactly the set of black pixels in the
   source — it cannot drift out of sync with the fixture, and there are no
   golden PNGs to re-bless on every discretization tweak.

3. **Rasterize trace output with an even-odd scanline fill**
   (`rasterize.ts`), modelled on the existing `fill-hatching.ts` parity
   rule (half-open `[yLo, yHi)`, pixel inked iff its centre is inside an
   odd number of closed contours). Even-odd is load-bearing: it keeps hole
   topology correct, so a letter "O" / ring / square-glyph stays hollow
   instead of flooding.

4. **Compare via IoU + precision / recall / f1 / agreement**
   (`compare.ts`). IoU (Jaccard) is the headline number; precision and
   recall separate over-inking from missed ink when it regresses.

5. **Test the measuring instruments themselves first.** `rasterize.test.ts`
   and `compare.test.ts` pin the rasterizer and comparator against
   hand-computed pixel counts and overlaps *before* either is trusted to
   judge the tracer. If the instrument is wrong, the harness lies — so the
   instrument gets the first, strictest tests.

6. **Opt-in visual proof, off by default.** `png.ts` writes a
   `[ground truth | predicted | diff]` PNG per fixture to
   `perceptual-artifacts/` only when `PERCEPTUAL_ARTIFACTS=1` (self-
   contained 8-bit-RGB encoder via `node:zlib`; diff legend green=TP,
   red=FP, blue=FN). Normal `pnpm test` writes nothing; the directory is
   gitignored. A green "IoU=0.97" is still invisible — this makes the
   result eyeballable on demand.

**Measured baselines** (2026-05-29, Line Art preset — the import dialog's
default — imagetracerjs current pin):

| Fixture | IoU | Residual cause |
|---|---|---|
| solid-square | 1.000 | — |
| plus-stroke | 1.000 | — |
| square-glyph | 1.000 | hole preserved |
| filled-disc | 0.986 | circle → polygon discretization |
| ring-annulus | 0.978 | curved boundary, both edges |

Per-fixture floors in `trace-perceptual.test.ts` sit just under these
(square/plus/glyph 0.97, disc/ring 0.95): a real fidelity regression
trips the test while normal discretization noise does not.

**Finding — `DEFAULT_TRACE_OPTIONS` degenerates on binary input.** While
baselining, the harness *measured* (did not assume) that the bare
`DEFAULT_TRACE_OPTIONS` collapses to IoU ≈ 0.25 on a solid square: the
imagetracerjs adaptive 2-colour quantizer degenerates to a single palette
colour on an already-binary image and traces the whole image frame
instead of the shape. The `Line Art` preset pins a fixed `[white, black]`
palette (`colorsampling:0` + `pal`) and sidesteps it. This is captured as
a characterization test (`lineArtIoU - defaultIoU > 0.5`). Real-world
impact is limited because `ImportImageDialog` already defaults to
`Line Art`; but `DEFAULT_TRACE_OPTIONS` remains a latent footgun for
`traceImageToSvgString` and the zero-paths relax-retry fallback. Left
as-is here — changing trace defaults is its own decision, not a rider on
a test-harness ADR.

**Scope — what IoU here does and does NOT measure.** IoU measures
*geometric area coverage of the outline trace*. A high score means "the
filled contours cover the right pixels," NOT "as good as LightBurn." It
deliberately does **not** measure:

- The **outline-vs-centerline gap** — imagetracerjs is outline-only, so a
  single pen stroke still becomes two parallel contours. This is the core
  "faulty vs LightBurn" issue and a coverage metric cannot see it (the
  doubled outline still covers the right pixels). Measuring it needs a
  different instrument (skeleton / centerline distance).
- **Curve smoothness** or node economy.
- **Raster-engrave quality** (dithering, power mapping).
- **Photographic / noisy input** — fixtures are synthetic clean line art.

So a green perceptual suite is necessary, not sufficient: it rules out
gross coverage regressions, not perceptual parity with LightBurn. When
reporting trace work, that distinction must be stated plainly rather than
implied away.

**Consequences.**

- New `src/__fixtures__/perceptual/` module: `shapes.ts`, `rasterize.ts`,
  `compare.ts`, `png.ts` (+ co-located tests), and the payload test
  `src/core/trace/trace-perceptual.test.ts`.
- `perceptual-artifacts/` added to `.gitignore`.
- No runtime dependency, no API change, no compile-pipeline change.
- Future work, if signal warrants: a centerline-distance metric to put a
  number on the outline-vs-centerline gap; the `DEFAULT_TRACE_OPTIONS`
  degeneracy fix; non-synthetic fixtures.

---

## ADR-026 — Trace keeps its source image (LightBurn-style overlay)

Date 2026-05-29. Status Accepted.

**Context.** Committing a trace (`ImportImageDialog`) used to create only a
`TracedImage` (vector) and discard the source bitmap. Users coming from
LightBurn expect the source image to remain as a first-class object together
with the trace, so they can eyeball the vector against the original and then
delete the source to keep the trace. With no source retained — and the
transparent-PNG decode bug (ADR-fix in `image-loader.ts`) producing an
all-black trace — the reported experience was "I traced an image and got a
blank canvas with nothing to compare against."

The scene model already supports the two-object world: `RasterImage` (pixels)
and `TracedImage` (vector) both carry `bounds` + `transform` and can coexist;
`drawRasterImage` stretches the bitmap into its `bounds` rect. So no new
`SceneObject` variant is needed.

The audit surfaced the real blocker: the two import paths use **different
coordinate spaces**. Trace bounds come from `boundsFromColoredPaths` — pixel
space. The raster path (Engrave Image) builds **mm** bounds via a 96-DPI
assumption. `fitObjectToBed` fits each object independently from its own
bounds, so naively inserting both yields two different sizes that do not
overlap.

**Decision.**

1. After a trace, insert **both** objects from one decode — the vector
   `TracedImage` and the source as a real `RasterImage` (burnable, on the
   `DEFAULT_RASTER_LAYER_COLOR` image layer, exactly like Engrave Image).
2. **Alignment by shared transform.** Compute one fit transform from the full
   decoded image frame `(0,0,W,H)` and apply that *same* transform to both
   objects. The raster's bounds are the full frame; the trace's bounds are its
   content bbox within that frame. Sharing the transform makes them overlay
   pixel-for-pixel. New mutation `applyTracedWithSource` does this; it
   deliberately bypasses `applyFreshImport`'s per-object `fitObjectToBed`.
3. **Z-order + selection.** Insert the raster first (bottom), the trace second
   (top), so the vector renders over the source; select the trace.
   "Delete source to keep the trace" is just deleting the raster
   (`removeSceneObject` + `pruneOrphanLayers`, already exist).
4. **One undo entry** covers the pair (single `pushUndo`).
5. The retained source is **output-eligible** (appears in G-code) until the
   user deletes it or toggles its image layer's output off — matching
   LightBurn, where the retained image is a real object on its own layer.

**Consequences.**

- **Trace sizing changes:** a trace is now fit to the *source frame*, not to
  its own content bbox. If artwork doesn't fill the frame, the trace lands
  smaller on the bed than it did before — but correctly sized and positioned
  relative to the source (the faithful LightBurn behavior).
- **Double-burn risk:** because the source is burnable and coincident with the
  trace, compiling without deleting the source engraves the raster *and* cuts
  the vector. Mitigated by the source living on its own image-mode layer
  (output toggle) and the trace being the default selection. Chosen over a new
  non-output "reference object" concept to avoid expanding the union; revisit
  if users double-burn in practice.
- **New store surface:** `importTracedWithSource`. To stay under the 400-line
  file cap (CI `wc -l` gate), the raster/traced image import actions move from
  `store.ts` into `src/ui/state/import-actions.ts`.
- **Not addressed here:** re-trace-from-source, dimming/opacity of the retained
  source, and grouping the pair so they move as one (each is independently
  selectable for now).

---

## ADR-027 — LightBurn is the source of truth; divergences are defects to redesign

**Status:** Accepted | **Date:** 2026-05-29

### Context

ADR-001 adopted "LightBurn's user-facing workflow and naming" as the product model, and `CLAUDE.md` collaboration rule #3 states "LightBurn is the reference for every behavior." In practice these have been read as *aspirational guidance*, and LaserForge has accumulated divergences from LightBurn — several flagged in the code itself:

- 3 layer modes (Line / Fill / Image) vs LightBurn's 4 — no Offset Fill (`src/core/scene/layer.ts`).
- A single `power` per layer vs LightBurn's Min Power + Max Power (`src/core/scene/layer.ts`, `src/core/output/grbl-strategy.ts`).
- An inline per-layer card editor vs LightBurn's separate Cut Settings Editor with Common / Advanced tabs (`src/ui/layers/LayerRow.tsx`).
- 3 dither algorithms vs LightBurn's ten (`src/core/scene/layer.ts`; LIGHTBURN-STUDY §1.4, §4.8).
- Two import buttons ("Trace Image" + "Engrave Image") producing two SceneObject variants vs LightBurn's single image object (`src/ui/common/Toolbar.tsx`, `src/core/scene/scene-object.ts`).
- A grey default raster-layer color whose own code comment reads "LightBurn uses black, but black collides with line-art SVG imports" (`src/core/scene/scene-object.ts:167`).

The maintainer's directive (2026-05-29) makes the posture binding: **LightBurn is the *source of truth*, not merely a reference.** Where LaserForge's workflow, tab/window architecture, or pipeline diverges from LightBurn, the divergence is a **defect to be redesigned toward LightBurn**, unless a specific ADR records it as a deliberate, justified exception.

This work proceeds under the maintainer's operating discipline — Andrej Karpathy's guidance on LLM-assisted coding (paraphrased, not a verbatim quote): keep the AI on a *tight leash* with small, individually-verified increments; keep a human in the loop reviewing every diff; dial autonomy to the risk of the change (an architectural redesign is the lowest-autonomy, highest-scrutiny case); and *verify, don't trust* — a green test suite is not evidence a feature is correct. See `CLAUDE.md` collaboration rules #1–#3.

### Decision

1. **LightBurn is canonical** for workflow, tab/window architecture, layer & cut semantics, the four layer modes (Line / Fill / Offset Fill / Image), defaults, optimization behavior, and G-code semantics. The authoritative behavior reference is `LIGHTBURN-STUDY.md` §§1–7.

2. **A divergence is a defect by default.** Where LaserForge's behavior differs from LightBurn's, we treat it as a bug and redesign LaserForge to match — we do not defend it as a design choice. The running ledger is `LIGHTBURN-STUDY.md` §8 (gap / divergence + the redesign action per area).

3. **Scope ≠ behavior.** This ADR governs *how a feature behaves once we build it* (match LightBurn), **not** *whether* we build it. Which features exist at all, and in what order, remains governed by `PROJECT.md` phases and the scope ADRs (e.g. ADR-006 GRBL-only, ADR-007 Windows-only desktop). "We haven't built LightBurn feature X yet" is a scope **gap**; "we built X but it behaves differently from LightBurn" is a **divergence**.

4. **Deliberate divergences require an ADR exception.** A divergence may stand only if an ADR records it with an explicit **"Divergence from LightBurn"** note and rationale (e.g. the narrower GRBL-only scope is justified by ADR-006). Any divergence not so recorded is a defect on the §8 backlog. (The grey raster-layer color is the current example: it must now be either ADR-justified or fixed to match LightBurn.)

5. **Documentation first, then tight-leash redesign.** This decision and the §8 ledger are recorded *before* any code redesign. Each redesign item lands as its own small, individually-verified PR per rule #1 — never a batched rewrite. Perceptual verification (rule #2) gates anything touching trace / fill / engrave / raster output.

### Consequences

- Existing divergences become an explicit, prioritizable backlog in `LIGHTBURN-STUDY.md` §8 rather than implicit drift.
- Some shipped code is now formally flagged divergent (grey image-layer color, 3 dither modes, single power, inline layer editor, dual import buttons). Each needs either an ADR exception or a fix — but **not in this diff**; this pass is documentation only.
- New work inherits a clear tie-breaker: when a design question arises, the answer is "what does LightBurn do?" unless an ADR says otherwise.
- This ADR **strengthens ADR-001** (which adopted the workflow) and operationalizes `CLAUDE.md` rule #3 (which named LightBurn the reference) into a binding source-of-truth-with-exceptions rule.
- It does **not** authorize implementing the whole LightBurn feature surface — that would violate scope discipline (point 3). The backlog is worked in `PROJECT.md` phase order.

---

## Future ADRs (anticipated, not yet written)

- ADR-022 — Origin-aware preflight + Frame (lift the deferral in
  ADR-021). Requires WCO threading into `framePreflight` and the
  Frame trace.
- ADR-023 — Web-app deployment target (covered ad-hoc in the current
  Cloudflare Pages setup commits; promote to formal ADR if the deploy
  config grows further).
- ADR-024 — Update mechanism for Windows desktop (before first signed
  release).
- (Earlier reservations for ADR-019..023 were stale — Phase B / E
  shipped without formal ADRs at those slots. ADR-019 / ADR-020 /
  ADR-021 are the first three slots since reused.)
