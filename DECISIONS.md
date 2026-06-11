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
   kickoff. The set that actually shipped (LU34 doc correction): Roboto
   (Apache-2.0), Inconsolata, Pacifico, and Dancing Script (all OFL-1.1),
   at `src/ui/text/fonts/`. (The kickoff note named Inter and Source Code
   Pro and a `src/fonts/` path that never shipped.)

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

> **Amendment (2026-05-29, same day).** The *mechanism* below was revised by
> the image-flow unification (ADR-027, LightBurn model): an image is no longer
> traced-and-deposited in one step. It is imported first as a standalone
> `RasterImage` (Toolbar "Import Image"), and **Trace** runs as a tool on the
> *already-selected* bitmap, overlaying the vector on it. The mutation is
> `applyTraceToExisting` and the store action `traceExistingImage` (replacing
> the `applyTracedWithSource` / `importTracedWithSource` named below); the trace
> adopts the bitmap's transform with the bitmap's mm-per-pixel folded into its
> scale so the pixel-space vectors register on the mm-space bitmap. ADR-026's
> *goal* is unchanged — retain the source, overlay pixel-for-pixel, delete the
> source to keep the trace. The original mechanism is preserved below as the
> decision record.

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

## ADR-028 — Raster engrave preview renders in scene space via the compile path's dither

**Status:** Accepted | **Date:** 2026-05-29

### Context

Preview mode (F-A8) rendered nothing for raster (image-mode) layers: an image-only scene previewed as a blank bed. Three causes, all in the preview path:

1. `draw-scene.ts` ran `drawObjectsFaint` + `drawPreview` in the preview branch and skipped `drawObjects` — the only path that draws rasters.
2. `drawObjectsFaint` (`draw-preview.ts`) draws only `imported-svg` ghosts.
3. `buildToolpath` (`toolpath.ts`) skips non-`cut` groups, so a raster-only job has `totalLength === 0` and `drawPreview` returns early.

LightBurn's Preview "shades according to power" — darker pixel = more laser power = deeper burn (LIGHTBURN-STUDY.md §1.4). Under ADR-027 a blank raster preview is a **divergence/defect**, not a missing feature: the engrave object exists and compiles to G-code, but the operator can't see what it will burn.

`RasterGroup.sValues` (dithered **and** power-scaled) is exactly that signal, but `RasterGroup.bounds` is a machine-coord AABB with the front-left origin's Y-flip already applied and **no rotation** (`compile-job.ts` `rasterBoundsInMachineCoords`). Rendering the preview from those bounds would mis-register and drop object rotation/mirror.

### Decision

1. **Reuse the compile path for WYSIWYG.** Preview calls core `dither()` then a new pure `rasterPreviewRgba()` (the reserved `core/raster` F.2.c "preview-data" slot) — the same `dither()` call `compileRasterGroup` makes, with the same `sMax = round(clamp(power,0,100)/100 × maxPowerS)` and the same `layer.ditherAlgorithm` (layer wins over per-image settings). The preview is therefore byte-for-byte the schedule that gets emitted. This mirrors `drawFillHatches`, which already calls core `fillHatching` directly for the fill preview.

2. **Render in scene space, not machine space.** `drawRasterPreview` (`src/ui/workspace/draw-raster-preview.ts`) blits the grayscale-sim bitmap through `drawBitmapAtTransform` (extracted from `drawRasterImage`), so it registers pixel-for-pixel with the on-canvas bitmap and honours rotation/mirror. The machine-coord Y-flip stays confined to the G-code path. `imageSmoothingEnabled = false` keeps threshold/Floyd dots crisp under upscale.

3. **Same gate as compile.** Only output-enabled, image-mode layers render, matched to rasters by `obj.color === layer.color` — exactly `compileJob`'s filter. `layer.visible` is intentionally ignored: preview shows *what burns*, not what's shown on the design canvas.

4. **Pure/DOM split.** `rasterPreviewRgba` is pure (`S → grayscale RGBA`, property-tested in core); the DOM concerns (luma `atob` decode, offscreen canvas, `putImageData`) live in the UI file and are cached per `dataUrl|algorithm|sMax` since the sim is static until one of those changes.

5. **Design view is unchanged.** Design mode still shows the bitmap itself (no dither overlay — WORKFLOW F-F2 step 6). Preview shows **only** the sim, not a faint original underneath (unlike the SVG ghost), matching LightBurn — its preview shows the simulated burn, not the source photo.

6. **Increment 1 scope.** The scrubber animates vectors only; the raster sim renders complete regardless of `scrubberT`. Feeding raster rows into the scrubber (a `'raster'` `ToolpathStep` variant) is **deferred to a separate PR** (Increment 2) — it requires a core toolpath-union change, which this diff deliberately avoids.

### Consequences

- Raster-only and mixed scenes now preview a faithful burn simulation; the blank-canvas defect is fixed without touching the `SceneObject` union, the toolpath union, or the `.lf2` schema.
- All three dither modes render from one `S → grayscale` mapping: threshold/Floyd-Steinberg produce crisp black/white dots, grayscale a smooth ramp.
- **Verification (per CLAUDE.md #2):** core math is property-tested (`preview-data.test.ts`) and the dither↔preview agreement is content-checked against the compile call. On-canvas registration (the sim overlaying the bitmap pixel-for-pixel, including rotation) is **maintainer-eyeball only** — not asserted by the suite, and not driven from the live file `<input>` per CLAUDE.md #4.
- Gated by ADR-027 (divergence fix) and ADR-025 (perceptual harness is the fidelity gate for raster output).

---

## ADR-029 — Convert to Bitmap (vector → raster engrave source)

**Status:** Accepted (A1 Fill-All rasterizer + A2 UI/PNG/`RasterImage` shipped — Fill All only; A3 Outlines / A4 Use Cut Settings / A5 placement-brightness polish pending) | **Date:** 2026-05-29

### Context

LightBurn has a **Convert to Bitmap** tool (Edit menu, `Ctrl/Cmd+Shift+B`, or right-click) that rasterizes selected vector graphics into a bitmap on an Image-mode layer — the inverse of Trace. LaserForge has **no vector→raster tool at all** (LIGHTBURN-STUDY §7.4; §8.5 GAP). Under ADR-027 this is a scope **gap** (a feature we haven't built), not a divergence — so *whether* we build it is governed by `PROJECT.md`, and *how it behaves once built* must match LightBurn.

Official behavior, re-confirmed against the docs on 2026-05-29 (`docs.lightburnsoftware.com/latest/Reference/ConvertToBitmap/`) and the maintainer's screenshots:

- **Render Type** — three options: **Outlines** (contours only), **Fill All** (solid fill of areas between outlines), **Use Cut Settings** (outline vs solid fill *per object*, depending on whether its layer is Line mode).
- **DPI** — numeric field + slider (screenshots show a 10–2000 range; 254 for Outlines/Fill All, 84 for Use Cut Settings). The docs state **no default**; the per-render-type values seen are live UI state, not documented defaults.
- Every rendered pixel's brightness is **automatically set to 50% gray**.
- **The source vector is deleted.** Docs warn: duplicate first to keep it.
- Result lands on **the last selected layer** (Image mode).
- Solid fill requires a **closed shape**.

We already have an even-odd scanline polygon rasterizer — but it is **test-only** (`src/__fixtures__/perceptual/rasterize.ts`, boundary/coverage-exempt), pixel-space, scale = 1, **binary** (ink/bg), with no DPI/mm mapping. It is a proven geometric reference, not a reusable production module. The output target `RasterImage` (PNG `dataUrl` + base64 luma + `bounds` + `transform`) already exists (`scene-object.ts`).

### Decision (proposed)

1. **New pure-core module** `src/core/raster/rasterize-vector.ts` — `rasterizeVectorToLuma(...) → { luma: Uint8Array; width; height }`, deterministic and pure (no DOM/canvas), generalizing the test fixture's even-odd fill + DDA stroke to **grayscale** output on a **mm-bounds × DPI** pixel grid. Property-tested (even-odd holes, determinism). `width = round(widthMm / MM_PER_INCH × dpi)` with `MM_PER_INCH = 25.4` a named constant.

2. **Luma convention:** ink pixel = **50% gray (`128`)** to match LightBurn; background = white (`255` = unburned). This is the same luma `dither()` consumes downstream (high luma = light = less burn), so a converted bitmap flows through the existing F.2 engrave path unchanged.

3. **Render Type → our model.** `Outlines` → stroke each contour. `Fill All` → even-odd fill of closed shapes (open paths cannot fill — match LightBurn's closed-shape rule; the open-path behavior, skip vs outline-fallback, is pinned in the UI increment). `Use Cut Settings` → per source object: outline if its layer mode is `line`, else fill (we have no Offset Fill; `fill` mode → fill), which requires reading each object's layer mode.

4. **PNG encode + `RasterImage` build is UI/io, not core** (ADR-010). Core returns the luma grid; the UI wraps it in an offscreen canvas → `toDataURL('image/png')` for `dataUrl` and base64-encodes the luma for `lumaBase64`, then constructs the `RasterImage` exactly as the existing image-import path does.

5. **The source vector is DELETED** (maintainer decision 2026-05-29 — match LightBurn). The selected vector object(s) are removed and replaced by the new `RasterImage` in **one undo entry**. Undo replaces LightBurn's manual "duplicate first" guidance — same net behavior, better ergonomics.
   - **Asymmetry is intentional, not a contradiction with ADR-026:** Trace *keeps* its source (ADR-026); Convert to Bitmap *deletes* its source (this ADR). Both are faithful — LightBurn keeps the image on Trace by default but deletes the vector on Convert.

6. **Placement** on an Image-mode layer. LightBurn uses "the last selected layer"; our layers are color-keyed, so the UI increment maps this to the `DEFAULT_RASTER_LAYER_COLOR` image layer (or the object's own layer if already image-mode), consistent with how image import picks its layer.

7. **DPI default is ours, not LightBurn's** (docs state none). The UI increment picks a sane named-constant default and labels it as a LaserForge choice — no invention of a LightBurn default.

8. **Scope:** outside explicit Phase F → gated by the accompanying `PROJECT.md` entry. Staged tight-leash: **A1** core Fill-All → **A2** UI + PNG + `RasterImage` → **A3** Outlines → **A4** Use Cut Settings → **A5** placement/brightness polish. Each is its own individually-verified diff.

### Consequences

- New production surface in `core/raster` (the real, non-test rasterizer), reusing geometry proven in the test fixture but with its own co-located tests.
- Source deletion is undo-recoverable; no duplicate-first dance required.
- **Perceptual gate (CLAUDE.md #2 / ADR-025):** the rasterized bitmap must be eyeballed (or IoU-diffed) against the source vector at the chosen DPI — green property tests are *not* fidelity proof.
- Does **not** touch the `SceneObject` union (`RasterImage` already exists), the toolpath union, or the `.lf2` schema.
- Composes cleanly with the `TracedImage`-elimination backlog (#1): "Use Cut Settings" reads layer mode, so it is agnostic to which vector kinds exist.

---

## ADR-030 — Trace control model realigned to LightBurn (Cutoff/Threshold band)

**Status:** Proposed (documentation gate; pending maintainer scope/order ratification) | **Date:** 2026-05-29

### Context

LaserForge's Trace dialog (`src/ui/trace/ImportImageDialog.tsx`) already runs as a tool on a *selected* bitmap (ADR-027 ✓) and keeps its source (ADR-026 ✓ — which matches LightBurn's default). But its **control model diverges** from LightBurn (ADR-027 → a defect to redesign), distinct from the already-tracked output-kind divergence (`TracedImage`, §8.6 #1):

- **Ours:** `PresetPicker` (imagetracerjs `numberOfColors` + Otsu/median/despeckle presets) + `AdjustmentControls` (brightness / contrast / gamma / invert) folded into the Trace dialog.
- **LightBurn** (re-confirmed 2026-05-29, `docs.lightburnsoftware.com/latest/Reference/TraceImage/`, plus the maintainer's screenshot defaults):

| LightBurn control | Default | LaserForge today |
|---|---|---|
| **Cutoff** + **Threshold** (brightness *band*: trace iff `Cutoff ≤ brightness ≤ Threshold`) | 0 / 128 | no explicit band (a threshold is baked into presets) — **missing** |
| **Ignore Less Than** (min traced area) | 2 | ≈ despeckle (rough) |
| **Smoothness** (0 lines → 1.33 curves) | 1.000 | ≈ curve fitting (rough) |
| **Optimize** (node reduction) | 0.2 | ≈ node reduction (rough) |
| **Trace Transparency** (trace alpha) | off | **missing** |
| **Sketch Trace** (local-contrast adaptive threshold) | off | **missing** |
| Fade Image / Show Points / Boundary–Clear Boundary | — | preview exists; these actions **mostly missing** |
| **Delete Image After Trace** (opt-in) | off | we always keep (ADR-026); the *opt-in* toggle is **missing** |

LaserForge additionally has **extra** controls LightBurn's Trace dialog lacks: `numberOfColors`/multi-color presets (LightBurn's trace is a single brightness band) and brightness/contrast/gamma/invert (LightBurn does image adjustment in a *separate* Adjust Image dialog, §2.2 / §7.6 — not the Trace dialog).

Separately and *not solved here*: imagetracerjs is outline-only (a pen stroke → two parallel contours — the centerline gap, PROJECT.md Phase E "known open gap"), and `DEFAULT_TRACE_OPTIONS` degenerates on already-binary input.

### Decision (proposed)

1. **Adopt LightBurn's control vocabulary** as the Trace dialog's primary model — Cutoff + Threshold, Ignore Less Than, Smoothness, Optimize, Trace Transparency, Sketch Trace — replacing `numberOfColors` + presets. Defaults match LightBurn (0 / 128 / 2 / 1.000 / 0.2 / off / off).

2. **The brightness band is the core semantic:** a pixel is "ink" iff `Cutoff ≤ brightness ≤ Threshold` — a pure-core predicate producing a binary mask the tracer then vectorizes. (imagetracerjs is multi-color by design; realigning to a single band means either configuring it to a 2-color/threshold mode or pre-binarizing to a mask and tracing that — pinned in the implementation increment.)

3. **Image adjustment is separate from Trace** (LightBurn-faithful): move brightness/contrast/gamma/invert out of the Trace dialog toward a dedicated Adjust-Image surface (its own small diff), rather than leaving them mixed into Trace.

4. **Add the missing actions** incrementally — Show Points, Fade Image (extend the existing preview), Boundary/Clear Boundary, and an **opt-in** Delete Image After Trace (default keep, per ADR-026). Sketch Trace and Trace Transparency are the two genuinely new algorithms.

5. **Separable from backlog #1.** This ADR governs the *input controls*; §8.6 #1 governs the *output kind* (`TracedImage` → plain vectors). Both are needed for fully faithful Trace, but neither forces the other's order — the maintainer sequences them.

6. **Scope:** this is a **redesign of a shipped feature** (Phase E) → higher risk than ADR-029's additive work, so lower autonomy / higher scrutiny (ADR-027). Staged: **B1** brightness-band core + Cutoff/Threshold dialog → **B2** Ignore Less Than / Smoothness / Optimize mapped to real tracer params → **B3** Sketch Trace + Trace Transparency → **B4** Show Points / Boundary / Fade / Delete-after. Each its own verified diff with a perceptual before/after.

### Consequences

- A working feature's UX changes → must not regress trace quality without the maintainer seeing before/after renders (CLAUDE.md #2).
- Dropping `numberOfColors`/multi-color presets narrows us toward LightBurn's single-band trace; if multi-color trace is valued it needs its own ADR exception (ADR-027 §4).
- The centerline/outline gap (Phase E known issue) is **not** addressed here — control vocabulary ≠ centerline algorithm; kept separate.
- Touches `ImportImageDialog.tsx` + trace option types + tracer config; the control swap itself needs no scene-union or schema change (that is backlog #1).

---

## ADR-031 - Fill hatch overscan lead-in/out

**Status:** Accepted | **Date:** 2026-06-01

### Context

The first real logo burn after the trace/fill fixes produced correct
geometry and smooth motion, but showed visible darker marks at the sides
of filled regions. The burn photo (`C:\Users\Asus\Downloads\191275.jpg`)
matches the standard Fill/Image endpoint-overburn failure: hatch lines
start and stop at the object boundary while the gantry is accelerating or
decelerating.

Research on 2026-06-01 re-confirmed the LightBurn model:

- Fill mode is scan-line engraving inside closed shapes.
- GCode Fill/Image overscanning adds extra laser-off moves at the start
  and end of scan lines.
- Missing or insufficient overscanning causes darker burned edges.
- LightBurn defaults GRBL devices to Variable Power (`M4`), while
  Constant Power (`M3`) is a compatibility option.

LaserForge Image mode already has the right primitive in
`src/core/raster/emit-raster.ts`: rapid to the overscan zone, feed to the
active span with `S0`, burn the active span, then exit overscan with
`S0`. Fill mode does not. ADR-019 intentionally let Fill hatches flow
through `CutGroup` unchanged, which was the right smallest-first ship
decision, but it now prevents output from distinguishing a Fill scan line
from a Line/outline cut.

### Decision

1. **Add a distinct `FillGroup` to `Job`.** Keep Fill hatch generation in
   `compile-job.ts`, but compile Fill layers to `kind: 'fill'` instead
   of `kind: 'cut'`. Line output remains `CutGroup`.

2. **Add `fillOverscanMm` to `Layer`.** Default to `5` mm, matching the
   current Image overscan baseline. Back-fill missing values from
   `LAYER_DEFAULTS`; no schema bump.

3. **Emit Fill with S0 lead-in/out.** Each two-point hatch expands to:
   lead start, burn start, burn end, lead end. G-code shape:

   ```gcode
   G0 XleadStart YleadStart S0
   G1 XburnStart YburnStart Ffeed S0
   G1 XburnEnd YburnEnd Spositive
   G1 XleadEnd YleadEnd S0
   ```

   Positive power stays on a moving `G1`, never on a stationary modal
   command.

4. **Keep `M3` in the first increment.** LightBurn's GRBL default is
   `M4`, and GRBL documents speed-scaled dynamic power. However, changing
   Fill from `M3` to `M4` also changes cut-depth behavior on short
   hatches and increases the diff's blast radius. The next surgical step
   is overscan under the existing M-mode; `M4` Fill becomes a separate
   hardware experiment if edge marks remain.

5. **Keep Frame/job bounds on burn geometry.** Overscan is runway, not
   engraved artwork. Frame should still trace the active burn area, while
   preflight checks emitted G-code so out-of-bed overscan is caught before
   writing or streaming.

### Consequences

- `Group` becomes `CutGroup | FillGroup | RasterGroup`. Exhaustive switch
  failures are expected and useful in output, bounds, toolpath, and
  planner modules.
- Fill preview/toolpath must keep showing burn hatches and may represent
  overscan as traversal moves. Raster remains skipped by the preview
  scrubber until its own row model is added.
- Jobs near a bed edge can fail preflight after overscan is enabled.
  This is correct; the operator can move the artwork inward or lower Fill
  Overscan.
- More overscan increases runtime. This is the same speed/quality tradeoff
  LightBurn documents.

### Verification

- Unit tests for the shared fill-overscan geometry helper.
- Compile tests for `line -> CutGroup`, `fill -> FillGroup`.
- G-code tests that pin S0 lead-in/out and active positive-S hatch spans.
- Property/invariant tests for no positive-S travel and no stationary
  positive-S modal commands.
- Bounds/preflight tests proving emitted overscan outside the bed is
  reported.
- Toolpath/planner tests so preview and duration do not silently drop Fill
  after the new discriminant lands.
- Hardware test: same logo or a 20 mm cropped sample at 0, 2, and 5 mm
  Fill Overscan, same material/power/speed/focus.

---

## ADR-032 - Bidirectional raster rows after overscan runtime regression

**Status:** Accepted | **Date:** 2026-06-01

### Context

After ADR-031-style overscan fixed the visible side burn marks, the next
hardware observation was that a print took roughly three times longer.
The runtime cost is expected if overscanned engraving remains
unidirectional: every row burns left-to-right, exits the right overscan
zone, then wastes a return move to the left overscan zone before the
next row.

Research on 2026-06-01 checked the LightBurn model and one open-source
reference:

- LightBurn documents Bi-directional Fill as side-to-side engraving with
  the laser on in both directions; disabling it engraves one way and
  returns without engraving.
- LightBurn documents overscanning as laser-off runway before/after each
  row so the marked span happens at steadier speed.
- Rayforge documents the same tradeoff for raster: bidirectional is
  faster, while unidirectional can be more consistent if the machine has
  backlash.
- LightBurn's Scanning Offset Adjustment page documents the calibration
  caveat: at high speeds, bidirectional rows can show ghosted or shifted
  edges if machine response delay or belt stretch is not compensated.

Local code evidence matched the slow path: `fill-hatching.ts` already
snakes Fill hatches, but `emit-raster.ts` explicitly deferred
serpentine alternation and emitted every active raster row left-to-right.

### Decision

1. Keep overscan enabled. It fixed the endpoint-overburn failure and is
   still required for even engraving.
2. Change only raster/Image row emission to serpentine movement:
   emitted active row 0 sweeps left-to-right, emitted active row 1
   sweeps right-to-left, and so on.
3. Alternate by emitted active-row count, not raw pixel row index, so
   skipped blank rows do not force a long return sweep.
4. Preserve active-span clipping. A row still runs only from first
   nonzero pixel to last nonzero pixel, plus overscan on the entry and
   exit sides.
5. Preserve M4 dynamic-power raster mode and S0 runway at both ends.
6. Do not add a UI toggle in this patch. If hardware shows
   bidirectional ghosting, add a later Image-layer option for
   unidirectional mode and/or scanning offset calibration.

### Consequences

- Raster jobs should recover most of the avoidable row-return time added
  by overscan, especially tall images with many active rows.
- G-code remains deterministic and modal: feed is emitted on the first
  raster G1, S changes are still run-length compressed, and G0 travels
  remain S0.
- Hardware may reveal backlash/offset artifacts at high speed. That is a
  calibration follow-up, not a reason to keep the default slow path.

### Verification

- `emit-raster.test.ts` pins that active rows alternate direction even
  when blank rows are skipped.
- `emit-raster.test.ts` pins right-to-left S-run order on reverse rows.
- Existing raster invariants still cover S0 G0 travel, deterministic
  output, bounds plus overscan, validation, and RLE behavior.

---

## ADR-022 - Origin-aware job placement and physical Frame/Start preflight

**Date:** 2026-06-01
**Status:** Accepted, code shipped, hardware verification pending.

**Context.** ADR-021 shipped the controller half of Set origin here:
`G92 X0 Y0` makes the current head position work-coordinate (0,0).
The missing half was job placement. Fresh imports are auto-centered on
the bed, so absolute `G90` output still asked GRBL to move to the
artwork's canvas coordinates after G92. The user-visible failure was a
centered imported/traced image framing and burning offset from the
physical point the operator had just set as origin.

LightBurn separates these concerns: Start From chooses the placement
reference, while Job Origin chooses which point of the job bounds is
anchored there. LaserForge does not yet have that full UI surface, but
the existing Set origin here workflow must still do the safe expected
thing.

**Decision.**

1. Keep `G92 X0 Y0` as the controller command. The bug was not the GRBL
   command.
2. Add a pure job-placement helper that can translate compiled job
   geometry by a chosen bounds anchor.
3. For active custom-origin sessions, use a front-left job anchor and
   translate the compiled job so that anchor is work-coordinate (0,0).
   Absolute mode remains the default when no custom origin is active.
4. Share the adjusted geometry between Start and Frame. Start emits
   adjusted G-code; Frame traces adjusted bounds.
5. Track `workOriginActive` immediately after a successful Set origin
   write so Frame/Start do not wait for GRBL's next intermittent WCO
   status frame. If the current machine position is known, seed
   `wcoCache` immediately from it.
6. When WCO is known, run physical Frame/Start bounds checks on
   `adjustedJobBounds + WCO`. This catches the near-edge custom-origin
   case that ADR-021 deferred.
7. Do not add a `.lf2` schema field in this patch. The full LightBurn
   Start From dropdown plus 9-dot Job Origin selector remains a future
   UI expansion.

**Consequences.**

- A centered imported/traced image now starts relative to the Set origin
  point instead of its canvas-center placement.
- `emitGcode(project)` still preserves absolute coordinates for export
  and no-origin flows. `emitGcode(project, { jobOrigin })` is the
  origin-aware path used by Start.
- Physical off-bed detection is only as fresh as `wcoCache`. The common
  path is covered because Set origin infers WCO from the latest MPos; if
  the controller has not provided any position yet, LaserForge can still
  origin-adjust output but cannot prove physical machine extents.

**Verification.**

- `src/core/job/job-origin.test.ts` pins lower-left anchor translation
  and WCO bounds offset.
- `src/ui/laser/start-job-readiness.test.ts` pins the regression: a
  centered traced image under custom origin no longer emits centered
  X/Y coordinates, and a near-edge custom origin blocks Start.
- Focused pass: job-origin, start-job-readiness, laser-store,
  laser-line-handler, and frame-preflight tests.
- `pnpm run typecheck`.

---

## ADR-033 - Skip fill overscan on short hatch runs; emit runway as rapid

**Status:** Accepted, code shipped, hardware verification pending. | **Date:** 2026-06-03

### Context

A traced-image Fill burn took ~2 h on hardware versus ~5 min for the same
artwork, size, and settings in LightBurn (~24x). A multi-agent audit
(`audit/FILL-SPEED-DIAGNOSIS-2026-06-03.md`) traced the dominant cost to the
ADR-031 overscan runway, not streaming (the streamer is character-counting):

- The lead-in/lead-out (default 5 mm/side = 10 mm runway) were emitted as
  `G1 ... S0` at the *cutting* feed (default 1500 mm/min), so ~0.4-0.5 s of
  laser-off travel was spent per hatch run, independent of burn length.
- A traced image fragments each 0.2 mm scanline into thousands of short runs.
  On a short run the fixed 10 mm runway dwarfs the actual burn, and the per-run
  runway is paid N times with no merging (Fill is also excluded from
  `optimize-paths`). LightBurn burns the same art as a continuous raster:
  overscan once per row, not per run.

### Decision

This is the first of two fixes (the second — merging collinear runs into
continuous laser-on sweeps — is tracked separately).

1. **Emit the overscan runway as a `G0` rapid, not a `G1` at cutting feed.** The
   runway is laser-off (`S0`); GRBL still decelerates to the burn feed by
   `burnStart` across the collinear junction, so the burn span stays at constant
   velocity and ADR-031's edge-evening purpose is preserved. The burn `G1` now
   carries `F` explicitly because the lead-in is no longer a `G1` that sets the
   modal feed. The planner prices the runway at travel velocity to keep the ETA
   honest.
2. **Skip the runway entirely on short runs.** When the burn is shorter than
   `OVERSCAN_MIN_BURN_RATIO` (= 2) x the per-side overscan — i.e. the runway
   would be longer than the burn — `effectiveOverscanMm` returns 0 and the run
   emits just a seek `G0` to `burnStart` and the burn `G1`. The threshold lives
   in one helper so the emitter, the planner ETA, and the preview scrubber agree.

This refines ADR-031: overscan still protects long fill spans, but short runs
trade edge-evening for the large speed win. M3/M4 is unchanged (ADR-020); Fill
stays on M3.

### Consequences

- Long fill runs are unchanged in coverage; their runway is faster (rapid).
- Short fill runs lose accel/decel edge-evening. On those the burn is brief and
  the head is in its accel ramp regardless, so the quality cost is expected to be
  small — but it is a real tradeoff and needs hardware confirmation.
- Burn geometry (the positive-S `G1` spans) is byte-identical to before; only
  laser-off travel changed.
- `OVERSCAN_MIN_BURN_RATIO` is a tunable constant if hardware shows short-run
  edge marks.

### Verification

- `fill-overscan.test.ts`: `effectiveOverscanMm` applies at >= 2x, skips below,
  and returns 0 for disabled/degenerate input.
- `grbl-strategy.test.ts`: long run keeps the rapid runway; short run emits only
  seek + burn; no `G1` laser-off move; the burn carries `F`.
- Empirical (Karpathy's law): the real emitted G-code for a mixed long/short
  fill was inspected — long run has the rapid runway, short run skips it, and the
  burn endpoints match the input hatch exactly.
- Full suite + `tsc --noEmit` + lint on touched files green.
- **Hardware verification needed:** re-burn the original traced logo on the
  Falcon A1 Pro and confirm (a) the wall-clock drop and (b) no new edge marks on
  small filled features.

---

## ADR-034 - Continuous-sweep fill: one G1 per scanline, S0-blanked gaps

**Status:** Accepted, code shipped, hardware verification pending. | **Date:** 2026-06-03

### Context

ADR-033 made the per-run overscan cheap, but the dominant structural cost of the
~2h-vs-LightBurn-~5min traced-image Fill remained: every interior hatch run was
emitted as its own G0-seek + burn, and the planner forced a full
decel-to-zero / accel-from-zero at every cut<->travel boundary. A traced image
fragments each 0.2 mm scanline into many short runs, so the head stopped
thousands of times. LightBurn (and our own raster path, emit-raster.ts) instead
burn a row as one continuous sweep, crossing interior gaps with the laser blanked.

### Decision

Emit each scanline as ONE continuous laser-on sweep.

1. **New pure module `fill-sweeps.ts`.** `groupFillSweeps()` regroups
   fillHatching's flat per-run output into one FillSweep per scanline: runs on
   the same infinite line (collinear within 1e-6 mm) are one sweep; a change of
   line (the next, parallel scanline) starts a new one. The sweep direction is
   taken from the group's first run, preserving fillHatching's snake.
   fillHatching, compile-job, the caches, and the FillGroup type are unchanged —
   the regrouping happens at consumption.
2. **Emitter (grbl-strategy.ts).** Per sweep: G0 into the optional overscan
   runway (laser off; 1a rapid + 1b short-run skip preserved), then a single G1
   chain — each ink span at S{s}, each interior gap at S0 (diode dark, head
   still at feed so it never stops over a hole), then the G0 lead-out. S is
   modal, so every ink span re-asserts S{s} and every gap asserts S0.
3. **Planner (planner.ts).** A sweep is one cut block from the first span's
   start to the last span's end at cut velocity — no per-run full stop. Gaps run
   at feed too, so one block is accurate for total time.
4. **Preview (toolpath.ts).** Each ink span is a cut step; each interior gap is
   a laser-off travel step, matching the emitted path.

Single-run scanlines (convex fills) emit byte-identically to before, so 1a/1b
behavior is preserved; only multi-span scanlines (holes) change.

### Consequences

- A traced-image fill collapses from thousands of short stop-start runs to a few
  hundred continuous sweeps — the structural fix for the 24x gap.
- SAFETY: a missed S-reset would fire the beam across an interior hole at full
  power. The per-segment S sequence is asserted exhaustively, including a
  multi-hole (>=3 spans) fixture. Every G0 still carries S0; positive S only
  rides a moving G1 (PROJECT.md #3, unchanged).
- The ETA breakdown counts gap time as cut time (gaps move at feed, laser off);
  total time is accurate, the cut/travel split is slightly biased toward cut.
- Grouping is collinearity-based, so it is correct for angled hatches and never
  merges two parallel scanlines (they are >= MIN_HATCH_SPACING_MM apart).

### Verification

- `fill-sweeps.test.ts`: forward, reverse-snake, multi-hole, scanline-boundary,
  angled-collinear, parallel-offset (no merge), and degenerate inputs.
- `grbl-strategy.test.ts`: a multi-hole scanline emits one continuous G1 chain
  with the exact S sequence S{s},S0,...,S{s}; single-run output unchanged relative
  to the post-ADR-033 emitter (the ADR-033 runway G1->G0 swap shipped in the same
  commit). Zero-length / coincident-span guard covered (touching spans; degenerate
  interior span) — added after the 2026-06-03 change audit.
- `grbl-strategy.property.test.ts`: the 100-seed determinism and
  laser-off-on-travel fuzz now include fill groups (PROJECT.md Phase-A gate that
  previously only fed cut groups).
- `estimate-duration.test.ts`: a multi-span sweep is priced as one continuous cut
  block over the envelope (the planner appendFillGroupBlocks path), plus per-pass
  repetition.
- `toolpath.test.ts`: a multi-hole sweep renders cut / gap-travel / cut steps so
  the preview scrubber matches the emitted path.
- Empirical (Karpathy's law): the real emitted G-code for a 3-span / 2-hole
  scanline was inspected — one G1 chain, holes blanked at feed, no G0 between ink
  spans.
- Full suite + tsc --noEmit + lint on touched files green.
- **Hardware verification needed:** re-burn the original traced logo on the
  Falcon A1 Pro and confirm (a) the wall-clock drops toward the LightBurn
  reference and (b) holes are clean (no beam bleed across gaps, no scorch).

---

## ADR-035 - Split a fill scanline at large gaps so the emitter rapids across them

**Status:** Accepted, code shipped, hardware verification pending. | **Date:** 2026-06-03

### Context

ADR-034 made each scanline ONE continuous laser-on sweep, crossing every interior
gap with the laser blanked at feed (G1 ... S0). That is the right move for a true
interior hole — a few tenths of a mm wide — where lifting to a rapid and stopping
would cost more than it saves. But the very first hardware burn after ADR-034 (the
user's traced "arch house" logo) printed cleanly EXCEPT for one stray line where
"the laser should've been switched off to move to a second part."

Karpathy's-law audit of the actual burned G-code (`Gcode arch house.gcode`,
reproduced byte-for-byte from `untitled archii.lf2` by the live pipeline) found the
cause: a single scanline can have ink in two regions of the image that are far
apart — here up to **20.94 mm** of empty space between regions, with **164** such
inter-region gaps wider than 5 mm. ADR-034 grouped ALL of one scanline's collinear
runs into one sweep, so those wide gaps were crossed as slow `G1 ... S0`
cutting-feed moves. A diode laser has a small turn-off lag; held at S0 but moving
slowly across 20 mm, the residual/again-on transient marks a faint line — exactly
the stray "move to a second part" line. LightBurn crosses such inter-region gaps
with a G0 rapid (laser forced off in GRBL laser mode), not a feed move.
`findLaserOnTravelIssues` stayed 0 throughout — the G-code was never *invalid*
(every S0 gap is a legal blanked move); it was a feed-vs-rapid quality choice.

### Decision

Amend ADR-034's grouping: a scanline still groups collinear runs, but
`buildSweeps()` (was `buildSweep()`) now SPLITS the ordered spans into multiple
sweeps wherever the gap between consecutive spans exceeds
`GAP_RAPID_THRESHOLD_MM` (5 mm). Small gaps (true interior holes) stay in one
continuous sweep exactly as ADR-034 intended; wide inter-region gaps become a
sweep boundary, and the emitter's existing per-sweep G0 seek crosses them as a
rapid (hard laser-off, faster than feed). No change was needed in the emitter,
planner, or preview — they already iterate sweeps and treat the space between
sweeps as a G0 rapid. 5 mm sits above the rapid-vs-feed time break-even (~3.3 mm
at the default feed) and cleanly separates an inter-region gap from a hole.

### Consequences

- The stray-line failure mode is structurally removed: no fill gap wider than
  5 mm is ever crossed at cutting feed. The laser is hard-off (G0, forced off in
  laser mode) across every inter-region move.
- Marginally faster: wide gaps now move at rapid rate, not cut feed.
- SAFETY: still PROJECT.md #3-clean — every G0 carries S0, positive S only on a
  moving G1. Splitting a sweep only ever turns a blanked feed move into a blanked
  rapid; it never extends a laser-on span.
- A 5 mm-to-feed-break-even mismatch means gaps between 3.3 and 5 mm still feed
  (a deliberate hysteresis so small detail does not stop-start); this is the
  smoothness/speed trade ADR-034 chose, now bounded so it cannot mark.

### Verification

- `fill-sweeps.test.ts`: large-gap split (15 mm gap -> 2 sweeps), small-gap
  continuity preserved (2-3 mm gaps stay one sweep), reverse-snake small-gap
  ordering, plus all ADR-034 cases unchanged.
- `grbl-strategy.test.ts`: a 15 mm inter-region gap emits `G0 ... S0` across it
  and asserts NO `G1 ... S0` crosses it; the multi-hole (3 mm gaps) continuous
  chain from ADR-034 is unchanged.
- Empirical (Karpathy's law) on the user's real file: re-emitting
  `untitled archii.lf2` through the live pipeline dropped the longest laser-off
  FEED move from **20.94 mm -> 4.87 mm** and inter-region G1-S0 gaps > 5 mm from
  **164 -> 0**; `findLaserOnTravelIssues` 0 before and after. The 16.6 mm gap that
  produced the stray line is now crossed by G0 rapids.
- Full suite + tsc --noEmit + lint on touched files green.
- **Hardware verification needed:** re-burn the "arch house" logo on the Falcon
  A1 Pro and confirm the stray cross-region line is gone.

---

## ADR-036 - Fill engraving emits M4 dynamic power (was M3 constant); supersedes ADR-020 #4

**Status:** Accepted, code shipped, hardware verification pending. | **Date:** 2026-06-03

### Context

After ADR-034/035 fixed fill *speed* and the stray line, the user reported small
traced text ("langebaan", a few mm tall) burning with **uneven density** -
blobby, "not smooth" - while large shapes were clean. The
`burn-perfection-research` workflow (docs/research/burn-perfection-small-text.md)
root-caused the density half to **Cause A: M3 constant power**.

With `M3`, GRBL holds the programmed laser power regardless of head speed
(`laser_mode.md`: *"keeps the laser power as programmed, regardless if the
machine is moving, accelerating, or stopped"*). A short engrave stroke spends a
large fraction of its length below the commanded feed: at 1500 mm/min (25 mm/s)
and the default accel 500 mm/s^2, the ramp-to-speed distance is
`v^2/(2a) = 0.625 mm` at *each* end - ~30% of a 4 mm glyph stem. Constant power
over those slow zones deposits more energy/mm -> the dark, irregular density. The
canonical GRBL remedy is **M4 dynamic power**, which scales S by
`actual_feed / programmed_feed` so energy/mm stays constant through accel/decel,
with **no** offset calibration. LightBurn's GRBL default is M4 for fill/scan.

The raster path already emitted M4 (`emit-raster.ts:76-77`); fill did not. The
M3-for-fill choice was an explicit deferral in **ADR-020 decision #4**, which
warned the change "also changes cut-depth behavior on short hatches" and parked
it as "a separate hardware experiment if edge marks remain." Those edge marks
are exactly this symptom. This ADR supersedes ADR-020 #4.

### Decision

Fill groups emit **M4 dynamic power**; cut groups keep **M3 constant power** (a
slow corner must still cut fully through). Laser power mode is modal across
groups, so `emitJob` now tracks the current mode (`'M3' | 'M4' | 'off'`,
initialised to M3 by the preamble) and emits a flip ONLY when the required mode
changes:

- **cut** when not already M3 -> `M3 S0`.
- **fill** when not already M4 -> from M3, `M5` then `M4 S0` (the M5 clears
  constant mode, mirroring emit-raster's documented reason); from `off` (after a
  raster group, which already issued its trailing M5), `M4 S0` alone.
- **raster** manages its own M4 internally and ends in M5; we mark mode `off`.

This generalises the old single rule (`raster -> cut/fill emits M3`) into a
proper state machine. The fill *body* (sweeps, S-sequence, overscan, the
PROJECT.md #3 guards) is unchanged - only the mode word that precedes it.

### Consequences

- Small/short engrave strokes hold constant energy/mm; the density unevenness
  flattens with no per-machine calibration.
- **Safer on travel/pause:** under M4 the diode is dark whenever the head is
  stopped (dynamic power -> 0 at 0 feed). M3 keeps firing a stopped head. So fill
  is now strictly safer for the "laser firing during pause" failure mode, on top
  of the unchanged PROJECT.md #3 invariant (every G0 carries S0; positive S only
  on a moving G1).
- **Cut-only jobs are byte-identical** (the flip never fires); vector cutting
  behaviour is untouched. Raster is untouched.
- A fill-only job starts `M3 S0` / `M5` / `M4 S0` - a one-time, laser-off
  redundancy from keeping the documented M3-priming preamble intact rather than
  rippling a preamble change through every determinism baseline.
- This is a g-code-emission (safety-path) change: the M3->M4 contract was
  reviewed against all callers; only `emitJob`'s mode management changed.

### Verification

- `grbl-strategy.fill-power-mode.test.ts`: fill-only job arms M4 after the M3
  preamble and burns under it; fill->cut restores M3; consecutive fills emit a
  single M4 flip; cut-only never emits M4.
- `grbl-strategy.test.ts`: the raster->fill transition now asserts `M5\nM4 S0`
  (was M3); raster->cut still asserts `M5\nM3 S0`.
- `grbl-strategy.property.test.ts`: determinism + laser-off-travel fuzz (incl.
  fill groups) still green - the M4 S0 line sets sticky S=0, never false-flags.
- `pipeline.snapshot.test.ts`: byte-identical (the SVG fixtures compile to vector
  cuts, not fills) - confirms the change is fill-scoped.
- Empirical (Karpathy's law) on the user's real `untitled archii.lf2`: the fill
  group's emitted mode went **M3 -> M4** (M4 count 0 -> 1), the burn G1s follow
  the M4 flip, `findLaserOnTravelIssues` 0 before and after.
- Full suite + tsc --noEmit + lint on touched files green.
- **Hardware verification needed:** re-burn the "langebaan" small text on the
  Falcon A1 Pro and confirm the density is even (no blobby slow-zone over-burn).
  Note: M4 fixes the *density* half; the *wavy-edge* half is trace faceting
  (Cause B / Fix 2), a separate change.

---

## ADR-037 - Raise the image-trace decode cap 1024 -> 2048 px for small-feature fidelity

**Status:** Accepted, code shipped, visual verification pending. | **Date:** 2026-06-03

### Context

The *wavy-edge* half of the small-text burn defect (docs/research/burn-perfection-
small-text.md, **Cause B**): the user image-traced a raster that contained small
text ("langebaan"); the glyphs came out wavy/faceted. A trace can be no smoother
than the bitmap it is handed - potrace/imagetracer fit curves to a pixel-boundary
staircase, and a few-px-tall glyph has almost no boundary to work with.

`image-loader.ts` downscaled every imported image to a **1024 px** longest edge
before tracing (`MAX_EDGE_PX`, `scaleToCap`). A detailed source (logo/photo with
small lettering) was therefore crushed to 1024 px *before potrace ever saw it*,
discarding exactly the resolution the small text needed. LightBurn's own guidance
is the inverse: feed the tracer MORE pixels (upscale before tracing) for fine
detail / small text.

### Decision

Raise `MAX_EDGE_PX` from **1024 to 2048** (4x the pixels, ~4x trace time). This
doubles the linear resolution the tracer sees, recovering small-feature fidelity
while staying interactive on modest hardware in the trace Worker (with the 300 ms
preview debounce).

Deliberately **NOT** done: upscaling images that are already *below* the cap.
Bilinear-upscaling a deliberately low-res input (pixel art / blueprints - the
"Sharp" preset, "every notch matters") would blur the notches the user wants
kept. Raising the *downscale* cap only ever *keeps more* real detail, so it never
degrades any input; upscaling-below-source can. `scaleToCap` therefore still
passes sub-cap images through untouched.

### Consequences

- **Registration- and size-safe.** The overlaid trace's mm size is
  `traceCoord / source.pixelWidth x widthMm` (`overlayTransformForRaster`,
  scene-mutations.ts), where `widthMm` derives from the NATURAL size at 96 DPI
  (`rasterImportGeometry`, image-import.ts) and `pixelWidth` is the sampled size.
  Raising the cap scales `pixelWidth` and the trace coordinates together, so the
  final mm geometry is invariant - only detail density rises. Source bitmap and
  trace both sample through the same `loadImageAsRawData`, so they stay aligned.
- ~4x trace/preview CPU + transient memory on the largest inputs (a 2048x2048
  RGBA frame is 16 MB; preprocessForTrace clones it a few times). Bounded by the
  Worker + debounce; 2048 is the chosen quality/perf knee (4096 would be ~16x and
  risk multi-hundred-MB transients). The constant is the single tuning point.
- No persistent `.lf2` bloat for the trace workflow: the source bitmap (which
  stores luma at the sampled size) is deleted once the trace is committed
  (LightBurn model), leaving only vector paths.

### Verification

- `image-loader.test.ts`: `scaleToCap` keeps a 1500 px source (crushed to 1024
  before) full-size, downscales 4096 -> 2048, and never upscales a 300 px source;
  `PREVIEW_MAX_EDGE_PX` is 2048 so preview and commit still see identical pixels.
- Empirical (Karpathy's law): tracing a crisp disc through the real potrace
  backend at increasing resolution monotonically reduces the trace's max radial
  deviation from the true circle - **1024 px 0.27% -> 2048 px 0.11%** (halved);
  the small-feature regime (256 -> 512 px) improves 2.2x. Higher decode
  resolution provably yields truer, smoother curves.
- Full trace suite (potrace, imagetracer, integration, import geometry) + full
  suite + tsc --noEmit + lint green.
- **Visual verification needed:** re-import and re-trace the original "langebaan"
  artwork and confirm the small text traces smooth (not faceted). If the source
  itself is low-res, the remedy is a higher-res source or native vector text
  (the report's alternative Cause-B fix), which this change does not replace.

---

## ADR-038 - Per-layer unidirectional fill option (was: snake hardcoded)

**Status:** Accepted, code shipped, hardware verification pending. | **Date:** 2026-06-03

### Context

The "amplifier" third of the small-text burn defect (docs/research/burn-perfection-
small-text.md, **Cause C**). Fill hatching alternated each scanline's direction
unconditionally (snake fill, `fill-hatching.ts` `pushScanlineHatches`), and the
emitter applies no scan-offset compensation. A diode's laser-on lag is a fixed
*time*; at feed it becomes a fixed *distance* offset that flips sign on each
alternating row, so a vertical edge lands at two alternating X positions - a
"zipper" / serration. On a glyph only a handful of scanlines tall there is no
spatial averaging to hide it. LightBurn exposes both a Scanning Offset Adjustment
table and a bi-/uni-directional fill toggle; LaserForge had neither, and snake was
not even user-togglable (no per-layer flag in `src/core`).

### Decision

Add a per-layer **`fillBidirectional`** boolean (default `true` = the existing
snake). When `false`, `fillHatching` emits every row in the SAME direction
(unidirectional): the per-sweep G0 in the emitter rapids the head back between
rows with the laser off, so the alternating firing-lag offset cannot form. The
flag threads layer -> `compile-job` -> `memoizedFillHatching` -> `fillHatching`'s
`HatchInput.bidirectional`, is part of BOTH fill cache keys (`layerFillCacheKey`
and the inner hatch cache - else flipping it would silently reuse the old path),
is back-filled to `true` for pre-ADR-038 `.lf2` files (`deserialize-project.ts`),
and is exposed as a "Bidirectional" checkbox in the layer panel (`LayerRow.tsx`).

A full scan-offset *compensation* table (correcting bidirectional rows rather
than serialising them) is deliberately deferred - unidirectional is the simpler,
calibration-free lever and the right first step.

### Consequences

- Unidirectional removes the zipper entirely at the cost of one laser-off
  return-rapid per row (slower fill). It is opt-in; the default (snake) preserves
  the current speed and is byte-identical, so no existing output changes.
- This is the SMALLEST of the three small-text levers: at the user's 1500 mm/min
  the lag zipper is ~0.025-0.075 mm. M4 dynamic power (ADR-036) and the trace
  decode cap (ADR-037) are the larger levers; this finishes the set.
- Old projects reopen unchanged (back-filled to snake). New layers default to
  snake. Determinism preserved (the flag is pure input to a pure function).

### Verification

- `fill-hatching.test.ts`: with `bidirectional: false`, EVERY row runs
  left-to-right (no alternation) - the zipper cannot form; the snake default test
  is unchanged.
- `compile-job-fill-cache.test.ts`: the compile path threads the layer flag into
  `fillHatching` (`bidirectional: false` observed) AND flipping it re-hatches
  rather than serving a stale cache entry (both cache keys include it).
- `project.test.ts`: a pre-ADR-038 layer back-fills `fillBidirectional` to `true`.
- `layer.test.ts`: `createLayer` default includes `fillBidirectional: true`.
- Full suite + tsc --noEmit + lint green.
- **Hardware verification needed:** burn the "langebaan" small text with the layer
  set unidirectional and confirm the edge serration is reduced. Expect a subtle
  effect at 1500 mm/min (the zipper is small at this feed); the bigger small-text
  wins are ADR-036 (density) and ADR-037 (trace fidelity).

---

## ADR-039 - Split a raster row at wide white gaps so the emitter rapids across them

**Status:** Accepted, code shipped, hardware verification pending. | **Date:** 2026-06-03

### Context

ADR-035 split a FILL scanline at gaps > 5 mm so the emitter crosses inter-region
gaps with a G0 rapid instead of a slow G1 S0 feed move (the stray-line class). The
raster (image-mode) emitter had the same latent defect: emit-raster swept one
active span per row from the first ink pixel to the last, and any interior white
run inside that span became a `G1 ... S0` feed move. For a row with two separated
ink islands (a logo with a gap, text with a space), the head crawled across the
white gap at cutting feed with the beam nominally off - the diode turn-off-lag
marking risk, and a long blank feed that the P0-A `findLongBlankFeedMoves`
preflight (added the same day) would flag in raster output.

### Decision

Replace the single per-row `activeSpan` with `activeSpans(row, pixelWidthMm)`:
walk the row's ink and split into separate ink islands wherever the white gap
between consecutive ink exceeds `RASTER_GAP_RAPID_THRESHOLD_MM` (5 mm, matching
ADR-035 and the P0-A threshold). The row loop emits each island as its own sweep
(`emitSpanSweep`, the former `emitRow`), so the G0 lead-in to the NEXT island
crosses the wide gap as a rapid. A small interior gap (<= 5 mm) stays within one
sweep, blanked at feed exactly as before. Snake direction still alternates per
emitted ROW (within a reverse row the islands sweep right-to-left); F still rides
only the very first G1 of the group.

### Consequences

- A wide interior white gap is a G0 rapid (laser hard-off, faster), not a G1 S0
  crawl - so raster output now passes the P0-A long-blank-feed invariant.
- Single-island rows (and rows whose gaps are all <= 5 mm) emit byte-identically
  to before; only multi-island rows change. The 28 pre-existing raster emit +
  property tests pass unchanged.
- Each split island keeps its own overscan runway; the extra G0 between islands
  is the intended trade (a few rapids vs. marking the gap).

### Verification

- `emit-raster.test.ts`: a two-island row (12 mm gap) crosses to the second
  island with `G0 X16.000 Y1.000 S0` and emits NO `G1 X16...`; a 4 mm gap stays
  one sweep (one G0, the gap blanked as `G1 X8.000 S0`).
- Empirical (Karpathy's law) cross-check: `findLongBlankFeedMoves` on the
  two-island emit returns [] (before this change the 12 mm gap was a `G1 S0`
  that the invariant flags). The two safety modules corroborate each other.
- `emit-raster.property.test.ts` (determinism + laser-off) unchanged; full suite
  + tsc --noEmit + lint green.
- **Hardware verification needed:** engrave an image with two separated dark
  regions on one row and confirm the gap is travelled dark (no faint line) and
  faster.

---

## ADR-040 - Shared prepared-output pipeline (preview = save = start = estimate)

**Status:** Accepted, code shipped. | **Date:** 2026-06-03

### Context

The canvas Preview built its toolpath from RAW `compileJob` - no `optimizePaths`,
no job-origin - while Save/Start emitted from the OPTIMIZED job (`emitGcode` ran
compile -> applyJobOrigin -> optimizePaths). The live Estimate had yet a third
copy of the compile+optimize sequence. So the operator could approve one path
order in the preview and burn a different (re-ordered) one, and the three
copies could drift independently (P1-C; the audit's "approve one, burn another"
risk). The pre-emit raster budget guard (P1-A) was also wired into emit and
estimate separately.

### Decision

Introduce `prepareOutput(project, options): PreparedOutput` (src/io/gcode) as the
ONE place that turns a Project into the machine Job:
`runPreEmitPreflight -> compileJob -> optional applyJobOrigin -> optimizePaths`.
It returns `{ ok: true, job }` or `{ ok: false, preflight }` (over-budget raster).
Every output-facing consumer now derives from it:

- `emitGcode` emits `prepared.job`, then runs the full gcode preflight on the
  body (unchanged external behaviour).
- `buildPreviewToolpath` builds from `prepared.job`, so the preview shows the
  exact optimized order the machine runs (an over-budget raster -> empty preview
  via EMPTY_JOB, never a freeze).
- `estimateLiveJob` times `prepared.job` (its cheap vector pre-counts still gate
  the compile first; the standalone preEmit call from P1-A.2 folded into
  prepareOutput).

Frame is intentionally NOT routed through prepareOutput: it computes a bounding
box for the framing pass (not a toolpath order) and keeps its own physical-bounds
/ WCO checks.

### Consequences

- Preview, Save, Start, and Estimate cannot diverge in path order or budget
  verdict - they are the same function. The optimize step moved INTO the shared
  path, so the preview's travel lines now match the burn (cut geometry was always
  identical; only ordering changed).
- emitGcode is behaviour-identical (the inline compile/place/optimize moved into
  prepareOutput verbatim). The pre-emit budget guard is now applied once, in
  prepareOutput, for all consumers.

### Verification

- `prepare-output.test.ts`: ok + non-empty job for a vector project; ok:false +
  raster-too-large for an over-budget raster; deterministic (same project ->
  deep-equal job).
- `draw-preview.parity.test.ts`: `buildPreviewToolpath(project)` deep-equals
  `buildToolpath(prepareOutput(project).job)` on a project the optimizer reorders
  - a regression lock that fails the moment the preview reverts to raw compileJob.
- emit-gcode + live-job-estimate tests unchanged and green (behaviour preserved).
- Full suite + tsc --noEmit + lint green.

---

## ADR-041 - A GRBL error:N ack is terminal for the stream (stop sending + safety notice)

**Status:** Accepted, code shipped. Hardware verification needed. | **Date:** 2026-06-04

### Context

When GRBL replied `error:N` to an in-flight line mid-job, the streamer treated it
exactly like `ok`: `onAck` popped the head line, freed its bytes, and left
`status: 'streaming'`, so the next `step()` pushed the next queued line. The only
error-specific action was setting `lastError`, which no path read to stop the job.
Captured empirically before the fix (tiny rx buffer so lines stay queued):

    initial step:  status=streaming inFlight=2 queued=3 toSend="G21\nG90\n"
    onAck(error):  status=streaming acked="G21\n" completed=1 inFlight=1 queued=3
    next step:     toSend="M3 S255\n" (length=8)

i.e. after GRBL rejected `G21`, the very next bytes the sender emitted were
`M3 S255` (laser on) - at a position the head may never have reached, because the
move that should have positioned it was the rejected line. A passing test
(`streamer.test.ts` "treats error like ok") locked this in. This is P0-1 in
docs/REMAINING-WORK-ROADMAP-2026-06-04.md; flagged by LF-CV-001 and the
2026-06-04 LightBurn parity audit. LightBurn treats any controller error as job
failure.

### Decision

Make a controller error terminal for the stream, parallel to the existing alarm
path:

- streamer.ts: add a terminal `'errored'` status to `StreamerStatus`; `onAck`
  maps `kind === 'error'` to `'errored'` (alarm stays `'cancelled'`; the
  user-initiated stop stays distinct); `step()` early-returns `toSend: ''` for
  `'errored'` like the other terminal states. The rejected line is still consumed
  for buffer accounting (GRBL freed its bytes when it replied), but no further
  bytes are sent.
- laser-line-handler.ts: the `error` branch now also raises a `controller-error`
  safetyNotice. `advanceStream` is otherwise unchanged - because the acked state
  is `'errored'`, `step()` returns empty and no follow-up `safeWrite` fires.
- laser-safety-notice.ts: new `controller-error` notice variant + builder (blunt
  copy naming the physical control, like the P0-B notices).
- SafetyNoticeBanner.tsx: a distinct title ("Controller rejected a command").

After the fix, the same repro prints `status=errored` and `next toSend=""`.

### Consequences

- The sender no longer turns a rejected line into a laser-on line at the wrong
  place, and the operator gets a persistent safety alert.
- KNOWN RESIDUAL (follow-up ticket, hardware-gated): GRBL does NOT halt on
  `error:N` by default - it discards the bad line and keeps executing the lines
  already in its ~120-byte RX buffer. Stopping our sender prevents NEW burn lines,
  but a complete halt (and turning a currently-firing laser off) requires issuing
  a real-time feed-hold (`!`) and/or soft-reset (0x18) on error - a change to the
  safety-critical send path that earns its own ticket plus hardware verification.
  This ADR is scoped to sender termination + notification, matching the P0-1
  done-criteria.
- `'errored'` is terminal, so the existing `status === 'streaming' || 'paused'`
  active-job checks (autosave, LaserWindow, buildPortClosePatch) correctly read it
  as not-active. No exhaustive switch on `StreamerStatus` exists, so the new member
  needed no other call-site changes.

### Verification

- streamer.test.ts: the old "treats error like ok" test is inverted to assert
  `status === 'errored'` and `step().toSend === ''`; a second test feeds an error
  with lines still queued (tiny rx buffer) and asserts the next line is NOT sent
  (the no-laser-on-after-reject regression).
- laser-line-handler.test.ts: feeding `error:7` mid-stream asserts streamer
  `'errored'`, no follow-up `safeWrite`, `lastError === 7`, and a
  `controller-error` safetyNotice carrying the code.
- Full suite 981/981; tsc --noEmit 0; eslint 0 on touched files.
- Hardware verification needed: on the Falcon A1 Pro, inject a rejected line and
  confirm the stream halts and the beam does not fire after the rejection (this HV
  also reveals whether the GRBL-buffer residual above needs the soft-reset
  follow-up).

### Correction (2026-06-10, H5 fix-verification)

As shipped, `'errored'` was NOT fully terminal: `onAck` computed the ok-path
status without checking the current one, so when the error landed while later
lines were still in flight (the final RX window), the trailing `ok` acks
drained the queue and promoted the status back to `'done'` — the UI reported a
clean finish over a real rejection. `step()` did refuse to send after the
error, so the no-new-bytes safety property above always held; only the
reported outcome was wrong. Fixed by making all terminal statuses absorbing in
`onAck` (`isTerminal` guard, shared with `step()`), pinned by the
"keeps errored terminal when trailing oks drain the in-flight tail" tests in
`streamer.test.ts`. The same guard stops a straggler ack from flipping
`'cancelled'` (alarm) to `'errored'` or vice versa.

---

## ADR-042 - Ack-driven follow-up write failure raises the disconnect safety notice (P0-3)

**Status:** Accepted, code shipped. | **Date:** 2026-06-04

### Context

`advanceStream` (laser-line-handler.ts) pushes the next buffer chunk after each
ack. When that follow-up `safeWrite` rejected (port lost mid-job), the `.catch`
marked the streamer `disconnected` but raised NO `safetyNotice`. GRBL keeps
executing the lines already in its ~120-byte buffer, so the head can keep moving
while the UI silently leaves the streaming state with no alert to hit the physical
E-stop. Every other write-failure path in laser-store.ts (pause/resume/stop,
around lines 290/388/398/423) raises a notice; this one did not. The existing
test asserted `status === 'disconnected'` but never checked the notice, which is
why the gap survived. Captured red before the fix:

    expected null to deeply equal { kind: 'disconnect-during-job', ... }
    Received: null

P0-3 in docs/REMAINING-WORK-ROADMAP-2026-06-04.md; whole-repo-lightburn-parity-
audit-2026-06-04, karpathy-whole-repo-audit-2026-06-02 (KF-012).

### Decision

In the `advanceStream` `.catch`, set BOTH the disconnected streamer and a
disconnect-during-job safetyNotice. The disconnect-during-job message is the
correct one (not write-failed): it names the real danger - buffered motion
continuing after the link is gone - matching the message the onClose path already
raises. A new builder `disconnectDuringJobNotice()` in laser-safety-notice.ts is
the single source of that notice; buildPortClosePatch (laser-store-helpers.ts) now
uses it too, removing the duplicated inline literal. No soft-reset is sent on this
path: the write itself failed, so there is no live link to send one over (recovery
state is already preserved by disconnect()).

### Consequences

- A mid-stream follow-up write failure now shows the operator the physical E-stop
  banner, closing the silent-teardown gap.
- The disconnect-during-job notice has exactly one constructor, used by both the
  onClose patch and the stream-write-failure catch; they cannot drift.

### Verification

- laser-line-handler.test.ts: the existing follow-up-write-failure test now also
  asserts the disconnect-during-job safetyNotice is set (the assertion that was
  red before the fix).
- laser-store.test.ts: the onClose disconnect-during-job test stays green through
  the builder refactor (same kind + message).
- Full suite green; tsc --noEmit 0; eslint 0 on touched files.
- No hardware verification needed (write-failure path + UI banner; the underlying
  disconnect behavior is already hardware-exercised).

---

## ADR-043 - Trace is vector-only; remove the Photo and Detailed trace presets

**Status:** Accepted, code shipped. | **Date:** 2026-06-05

### Context

The Trace dialog surfaced six presets. Four (Line Art, Centerline, Smooth, Sharp)
binarize the image to pure black/white (fixedPalette ['#ffffff','#000000'] + a
threshold) and emit clean black vector ink. Two (Detailed: numberOfColors 4; Photo:
numberOfColors 8) set NO fixedPalette and NO threshold, so applyThreshold returns
the image unchanged (trace-image.ts) and imagetracerjs adaptive-quantizes a
continuous-tone image into filled light-grey tone regions. The operator reported
that Photo and Detailed "do not trace - the whole white page remains, it looks like
a bitmap photo." Confirmed empirically: tracing a gray-disk-on-light-gradient image
produced, for Line Art/Smooth, paths with fill rgb(0,0,0) (real ink); for Detailed,
only rgb(200,200,200)/rgb(220,220,220) (near-white, no ink); for Photo,
rgb(195,195,195)/rgb(90,90,90)/rgb(225,225,225) (posterized greys). The output is
vectorized posterization, not line-art tracing, and is useless as laser engrave
geometry.

This is also off-model versus LightBurn, the reference. Per the in-repo
LIGHTBURN-STUDY.md (citing docs.lightburnsoftware.com): LightBurn's Trace Image is a
VECTOR-ONLY tool; photo/grayscale engraving is a separate path - the Image layer
mode, which engraves the raster directly with dithering. LightBurn has no
multi-colour "Photo"/"Detailed" trace. Making the vector tracer posterize a photo is
neither real tracing nor the correct way to engrave a photo.

### Decision

Trace is vector-only. Remove the Photo and Detailed presets from TRACE_PRESETS
(trace-image.ts). The surfaced presets are now Line Art, Centerline, Smooth, Sharp -
all binarized vector traces. Photos and continuous-tone images engrave via the
Image/raster path (Image layer mode + dithering, per the operator-workflow plan), not
Trace. The PresetHint copy now points the operator there.

The multi-colour CAPABILITY (numberOfColors > 2, no fixedPalette -> adaptive
quantization) stays in the engine for any direct/programmatic caller; it is simply no
longer surfaced as a preset. Its engine path remains covered by tests via inline
TraceOptions instead of the removed presets.

### Consequences

- The Trace dialog no longer offers options that produce a blank/posterized result.
- Photo engraving has one correct home (the Image/raster path), matching LightBurn.
- Tests that referenced TRACE_PRESETS['Photo']/['Detailed'] now use inline
  multi-colour TraceOptions, preserving >2-colour engine coverage without the
  surfaced presets.
- Photo-quality work (dither breadth, min power) belongs in Convert-to-Bitmap /
  Image-mode (operator-workflow plan), not Trace.

### Verification

- trace-image.test.ts, trace-options.test.ts, trace-pipeline.integration.test.ts
  green; the multi-colour engine path is exercised via inline TraceOptions.
- Empirical pre-removal repro: Photo/Detailed emit near-white posterized fills with
  no black ink; Line Art/Smooth emit rgb(0,0,0) ink (see the trace research notes).
- Full suite + tsc --noEmit + eslint on touched files: green.
- No hardware verification needed (UI preset removal; no g-code emission change).

---

## ADR-044 - Minimal Material/Interval Test calibration workflow

**Status:** Accepted; scope approved, implementation staged. | **Date:** 2026-06-09

### Context

The operator has now hardware-burned real material and observed quality changes
from power, scan strategy, line interval, and material response. Code cannot pick
universal burn settings. LightBurn treats this as a first-class calibration
workflow: Material Test generates a configurable grid, usually 10x10 by default,
varying parameters such as Power, Speed, Interval, and Passes; Interval Test
generates sample squares to find raster line spacing for a speed/power/material
combination. The official LightBurn Material Test documentation also says the
grid location follows Start From / Job Origin behavior, and the Interval Test
documentation directs users to run a speed/power material test first when they do
not already know those settings.

Before this ADR, `PROJECT.md` listed "Material library, cut tests,
power/speed wizards" as out of scope. The maintainer has now explicitly approved
continuing the LightBurn-parity roadmap step by step, so the scope line needs to
move from "forbidden" to "staged and bounded."

### Decision

Promote a minimal calibration workflow to Phase F.5:

1. Build a pure Material Test generator first. It produces ordinary
   `Project`/`Scene` data, not ad hoc G-code, so Preview, Save G-code, Frame, and
   Start all use the same existing pipeline.
2. Start with speed/power grids. Speed can be represented by row layers; power
   can be represented by the object-level `powerScale` field introduced for
   Shape Properties. This avoids inventing per-object speed before the model
   needs it.
3. Add Interval Test after the Material Test foundation. Interval Test should
   generate image/fill swatches using the existing line interval / DPI controls
   and should not bypass raster/fill preflight.
4. Add UI after the pure generator has tests. The UI may live under a
   LightBurn-style Laser Tools menu entry, but the generated scene is the source
   of truth.
5. Keep full Material Library storage deferred. LightBurn's library supports
   saved material/thickness presets, Assign vs Link behavior, shared library
   files, and multi-device library switching. LaserForge should add that only
   after generated calibration grids are useful on hardware.

### Consequences

- `PROJECT.md` now scopes minimal Material Test and Interval Test generators,
  while full Material Library storage and linked presets remain out of scope.
- The next implementation slice must be pure-core and test-first. No hardware
  control should be added until generated project output is deterministic and
  preview/save/start-compatible.
- Hardware verification is required before claiming the feature produces useful
  settings: run a small grid on scrap and record whether labels, ordering, and
  chosen settings are readable.

### Sources

- LightBurn Material Test reference:
  https://docs.lightburnsoftware.com/Tools/MaterialTest.html
- LightBurn Interval Test reference:
  https://docs.lightburnsoftware.com/Tools/IntervalTest.html
- LightBurn Material Library reference:
  https://docs.lightburnsoftware.com/UI/MaterialLibrary.html

### Verification

- Documentation-only scope change. No production code changed in this ADR.
- `PROJECT.md` and `DECISIONS.md` must pass formatting and whitespace checks.

---

## ADR-045 - Native Material Library IO foundation

**Status:** Accepted; implementation staged. | **Date:** 2026-06-09

### Context

LightBurn's Material Library stores reusable Cut Settings presets and exposes
Load Library, Save Library, Save Library As, Create New Library, and Merge
Library With. The official docs identify `.clb` as LightBurn's saved library
extension and distinguish Assign from Link: Assign copies settings to the active
layer, while Link keeps the layer synced and disables normal Cut Settings
editing.

LaserForge now has Material Test / Interval Test generators and a pure
MaterialRecipe model. It still lacks the storage and file-document foundation
needed to preserve calibrated settings across projects. Public LightBurn docs do
not describe a stable `.clb` interchange schema, so treating `.clb` as our
canonical format would be reverse-engineering first and product work second.

### Decision

Add a native deterministic Material Library document format:

- Extension: `.lfml.json`.
- Format marker: `laserforge-material-library`.
- Schema version: `librarySchemaVersion: 1`.
- Content: library ID, display name, optional device hint, and entries.
- Entry metadata: ID, material name, either thickness or no-thickness title,
  description, recipe, and revision.
- IO behavior: two-space JSON, LF endings, trailing newline, structured
  deserialization errors, duplicate-ID rejection, and deterministic merge that
  preserves the base library while reporting skipped duplicate IDs.

Keep `.clb` import/export deferred until fixture-based research proves a stable
and safe compatibility path. Keep Link deferred until `.lf2` schema, missing
library UX, read-only layer controls, and preset revision handling exist.

### Consequences

- LaserForge can save, load, validate, and merge native material libraries
  without UI or hidden persistence.
- The IO foundation does not bypass preview, save, start, or preflight. Applying
  a recipe still happens through the layer model in later UI/store work.
- Device hints are advisory safety metadata. Later UI can warn when the active
  machine differs, but this ADR does not block cross-machine reuse.
- Full Material Library UI, LightBurn `.clb` compatibility, manufacturer
  profiles, and linked presets remain out of scope.

### Sources

- LightBurn Material Library reference:
  https://docs.lightburnsoftware.com/latest/Reference/MaterialLibrary/
- Repo research:
  `audit/reports/lightburn-material-library-research-2026-06-05.md`

### Verification

- `src/io/material-library/material-library-io.test.ts` covers deterministic
  serialization, round-trip deserialization, malformed documents, duplicate IDs,
  invalid recipes, device hints, and merge behavior.
- Full typecheck, lint, format, file-size, test, build, and browser smoke gates
  are required before this ADR is considered implemented.

---

## ADR-046 - SVG import unit resolution (viewBox scaling + 96 DPI px)

**Status:** Accepted. | **Date:** 2026-06-10

### Context

Audit finding H9 (AUDIT-2026-06-10): the import boundary assumed 1 SVG user
unit = 1 mm in every case. `<svg width="50mm" viewBox="0 0 500 500">` — the
standard Inkscape/Illustrator export shape — imported 10× too large because
the declared physical size was ignored whenever a viewBox existed, and
px-authored files (no viewBox) imported 1 px = 1 mm where LightBurn's default
import DPI (96) sizes 96 px at 25.4 mm. PROJECT.md non-negotiable #6 requires
explicit conversion at the import boundary. `fitObjectToBed`'s shrink-to-90%
masked oversize imports with plausible-looking but physically wrong sizes.

### Decision

Resolve units once at the root of the import (`resolveUnitScale`,
`src/io/svg/parse-svg.ts`), seeding the transform stack so geometry and
bounds scale together:

- viewBox + physical width/height: user units scale by physical/viewBox per
  axis; a single declared axis drives both (preserve aspect); `%` and other
  unparseable lengths count as undeclared.
- viewBox only: 1 user unit = 1 mm (the long-standing Phase A assumption,
  kept — matches mm-authored plotter/laser exports).
- No viewBox: user units are CSS px at 96 DPI (`CSS_PX_PER_INCH = 96`,
  matching LightBurn's default import DPI), applied to geometry and to
  width/height bounds alike.

### Consequences

- Inkscape/Illustrator mm-sized exports import at true physical size; an
  import DPI *setting* (LightBurn offers one per format) stays future work.
- px-authored viewBox-less files now import 3.78× smaller than before —
  the previous size was the defect, not a compatibility surface.

### Verification

- `parse-svg.test.ts` "physical size + viewBox scaling (H9)": per-axis
  scaling, single-axis aspect preservation, 96 DPI px geometry + bounds,
  and the unchanged viewBox-only mm assumption.

---

## ADR-047 - Design tokens + shared chrome classes (dark chrome, light bed)

**Status:** Accepted. | **Date:** 2026-06-10

### Context

The UI was ~260 ad-hoc inline `React.CSSProperties` objects across 77 files
with zero CSS: no hover/focus/active/disabled styling anywhere (inline styles
cannot express pseudo-states), an inconsistent chrome (dark menubar/toolbar/
statusbar over light panels), eight dialogs each duplicating the same
backdrop+panel shell, and ~15 duplicated button styles. The maintainer chose
a unified dark chrome with the canvas bed kept light (WYSIWYG against white
material), zero new dependencies, hand-rolled SVG icons.

### Decision

- **`src/ui/theme/tokens.css`** — the single global stylesheet, imported once
  in `src/ui/app/main.tsx`. Defines `--lf-*` custom properties (surfaces,
  text levels, semantic fills + text-on-dark variants, focus, type/space/
  radius scales, z-order map) and shared chrome classes (`.lf-btn` +
  variants, `.lf-input`/`.lf-select`, `.lf-dialog*`, `.lf-rail`, `.lf-card`,
  `.lf-banner--*`, `.lf-menu*`, `.lf-chip`, scrollbars, global
  `:focus-visible`). `color-scheme: dark` is scoped to dark-surface classes,
  not `:root`, so native controls flip per-surface during the migration.
- **`src/ui/theme/canvas-theme.ts`** — the Canvas2D palette as TS constants
  (custom properties cannot reach raw ctx calls). Values byte-identical to
  the literals they replace; the workspace viewport deliberately keeps its
  light look. The two genuinely shared values (selection ↔ `--lf-accent`,
  out-of-bounds ↔ `--lf-danger`) are pinned by `theme-sync.test.ts`.
- **Policy:** static presentational styling migrates to classes/tokens;
  DYNAMIC styling stays inline (drag-readout position, layer color swatches,
  progress width %, preview opacity). After the migration completes, a scoped
  `no-restricted-syntax` lint bans raw hex/`rgb(` literals in `src/ui/**`
  (theme files and tests excluded; scene-data colors like
  `DEFAULT_NEW_LAYER_COLOR` carry a justified disable).
- **Primitives** live in a new `src/ui/kit/` module (Dialog composing the
  existing `use-dialog-a11y`, Button, Field, NumberInput, IconButton,
  PanelHeading, icons) — `common/index.ts` stays within its export budget.
- A future light theme is a `[data-theme='light']` block re-declaring the
  custom properties; no component changes.

### Consequences

- Hover/focus/disabled affordances exist for the first time; dialogs share
  one a11y shell (the calibration dialogs gain the Escape/focus-trap they
  lacked); duplicated style objects collapse into classes.
- Visual output is invisible to jsdom — every migration batch requires a
  maintainer eyeball pass on the dev server, stated plainly in reports.
- Perf-sensitive surfaces (250 ms status poll, per-mousemove overlays,
  canvas draw loop) get flat colors only: no blur, no shadows, transitions
  limited to background/border color on interactive elements.
- Bundle cost ≈ +10 KB raw CSS (budget: <1 MB gzip total, currently ~205 KB).

### Alternatives rejected

- `theme.ts`-only typed constants: cannot express pseudo-states — the
  core deficiency would remain.
- TS→CSS codegen: build machinery for exactly two shared values; the sync
  test is cheaper and honest.
- CSS-in-JS / CSS modules / Tailwind: new dependency (ADR-017 gauntlet) or
  77-file churn for no additional capability at this scale.

### Verification

- `src/ui/theme/theme-sync.test.ts` pins the shared values; existing suite
  stays green per batch; `pnpm build:web` confirms the stylesheet lands in
  the bundle; per-batch maintainer eyeball checklist on `pnpm dev:web`.

---

## Future ADRs (anticipated, not yet written)

- ADR-023 — Web-app deployment target (covered ad-hoc in the current
  Cloudflare Pages setup commits; promote to formal ADR if the deploy
  config grows further).
- ADR-024 — Update mechanism for Windows desktop (before first signed
  release).
- (Earlier reservations for ADR-019..023 were stale — Phase B / E
  shipped without formal ADRs at those slots. ADR-019 / ADR-020 /
  ADR-021 are the first three slots since reused.)
