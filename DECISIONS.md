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
| ADR-024 | 2026-07-04 | Accepted | Windows desktop distribution + auto-update (revises non-negotiable #8 "no network calls") |
| ADR-135 | 2026-07-12 | Accepted | Gate desktop auto-update on a trusted, code-signed channel |
| ADR-136 | 2026-07-12 | Superseded | CNC interruption recovery rewinds to a retract-first safe boundary (see ADR-141) |
| ADR-137 | 2026-07-11 | Accepted | Trace reliability: latest request wins and completed work is reusable |
| ADR-138 | 2026-07-13 | Accepted | Primary toolbar is icon-first and never wraps |
| ADR-139 | 2026-07-13 | Accepted | Right workspace rails collapse independently with fail-visible machine controls |
| ADR-140 | 2026-07-13 | Accepted | CNC profile finish allowance and finishing pass |
| ADR-141 | 2026-07-13 | Accepted | Disable executable CNC checkpoint and start-from-line recovery |

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
Hard limits enforced by ESLint (the soft tier is surfaced report-only, not by ESLint — see ADR-131):
- File: 400 lines hard, 250 soft
- React component: 250 hard, 150 soft
- Function: 80 hard, 40 soft
- Cyclomatic complexity per function: 12 hard, 8 soft
- Default exports per file: 1
- `index.ts` public exports: 20 hard, 10 soft

Plus: co-located tests required, single responsibility (no "and" in description), new-file-first default. See `CLAUDE.md` for operational rules.

### Verification
ESLint's `max-lines` rule is the authoritative gate and fails CI on violation: 400 lines **excluding blank and comment lines** (`skipBlankLines: true, skipComments: true`). CI additionally runs a coarse raw-line backstop (`wc -l`, threshold 600) that counts *every* line — including the explanatory comments CLAUDE.md mandates — purely as a guard against catastrophic bloat; its threshold is deliberately looser than the 400 code-line rule and is not the real limit.

The **soft** tier (250 counted lines/file) is **not** an ESLint warning — ESLint keys rules by name, so a second `max-lines` config for the same files *replaces* the error/400 one (last-wins) rather than stacking, so warn/250 and error/400 cannot coexist on the built-in rule (ADR-131). The soft tier is instead surfaced by the report-only `check:soft-size` script (`scripts/check-soft-line-limit.mjs`), which lists non-test files over 250 counted lines and **always exits 0** — it never blocks CI; only the ESLint error/400 rule does.

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

**Status:** Accepted (A1 Fill-All rasterizer + A2 UI/PNG/`RasterImage` + A3 Outlines + A4 Use Cut Settings + A5 Default Brightness shipped; see 2026-07-07 amendment) | **Date:** 2026-05-29

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

### Amendment 2026-07-07 — audit fixes, brightness (A5), and pinned divergences

An audit of the shipped feature (findings fixed the same day) pins the following, superseding the original text where they differ:

1. **Ink luma is 127, not §2's 128.** Both boundary behaviors were individually correct — 50% gray ink, and `ditherThreshold` burning strictly below its 128 cutoff — but they composed to zero output: a converted bitmap on a Threshold layer dithered to all-zero S (M7, AUDIT-2026-06-10). 127 keeps the 50% intent within rounding and always burns. Regression-pinned in `rasterize-vector.test.ts`.
2. **Default Brightness shipped (the A5 brightness half).** The dialog exposes LightBurn's Default Brightness (percent, default 50). Mapping is `floor(255 × pct/100)` — floor, not round, so 50% stays at 127 per (1). LightBurn's own default is 50% (§7.4).
3. **Conversion DPI range is 127–635, derived, a deliberate divergence.** LightBurn's dialog offers 10–2000 DPI, but LightBurn keeps image resolution and the Image layer's interval independent; our model stamps the conversion DPI onto the created image layer's `linesPerMm` (§6 placement). The legal range therefore derives from the app-wide raster density limits (`MIN/MAX_RASTER_LINES_PER_MM` = 5–25 lines/mm) — outside it, Convert would mint layers the Cuts panel clamps to a different density on the next edit. Revisit if image resolution and layer interval are ever decoupled.
4. **Size estimates are full-transform.** The dialog's pixel estimate uses the rotated AABB (`transformedBounds`), matching what the builder rasterizes — the original scale-only estimate approved rotated conversions the builder then refused. The bake itself (per the 2026-06-09 transform-bake plan) emits baked bounds + IDENTITY transform, which also sidesteps the raster output path's no-rotation limitation.
5. **Single-selection gate.** The command (and `Ctrl/Cmd+Shift+B`, now bound — LightBurn's shortcut, §7.4) is enabled only for a selection of exactly one convertible vector. LightBurn converts a whole multi-selection into **one** bitmap; that merge is a scoped follow-up feature, not a gate relaxation — the pre-fix behavior (silently converting only the primary object of a multi-selection) was a defect. _(Superseded by amendment ii below: the merge shipped.)_
6. **Menu placement divergence.** LightBurn houses Convert to Bitmap under **Edit**; ours lives under **Tools**, grouped with Convert to Path and the other conversions. Deliberate (one conversions home), per ADR-027 §4.

### Amendment 2026-07-07 (ii) — multi-selection merges into one bitmap

The follow-up from amendment (i) §5 shipped the same day:

1. **The whole selection converts as ONE `RasterImage`** spanning the union of the members' rotation-aware AABBs, LightBurn-faithful. Every source vector is deleted; the swap is a **single undo entry**, and the merged bitmap becomes the sole selection (stale additional-selection ids are cleared).
2. **Cross-object even-odd.** Fill All rasterizes the concatenated baked contours of the whole selection with one even-odd pass — a shape nested inside _another object's_ shape reads as a hole. This matches LightBurn's "solid fill of areas between outlines" **and** our own Fill mode, which hatches a layer's contours together (`collectFillContoursForLayer`). Use Cut Settings groups per path color across all members, as before.
3. **Gate: every selected object must be a convertible vector** (`selectedConvertibleVectors`, scene order). A mixed selection (e.g. a raster among vectors) stays disabled rather than converting an ambiguous subset. Same gate for the menu command, toolbar, context bar, and `Ctrl/Cmd+Shift+B`.
4. **Naming:** a multi-object result is labeled `N objects (bitmap)`; the dialog shows `N objects` and estimates from the combined bounds, so the size preview still matches exactly what the builder produces.
5. The worker protocol carries the full selection (`vectors`); budget refusal (4 M px) applies to the combined grid, refusing up front in the dialog.

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
of filled regions. The burn photo (a local hardware test capture)
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

**Status:** Superseded by ADR-049 (chrome is now light; the token/class
architecture, kit primitives, and styling policy below remain in force — only
the dark color values and the `[data-theme='light']` future-theme mechanism are
replaced). | **Date:** 2026-06-10

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

## ADR-048 — Metadata-less bitmap imports default to 254 DPI (LightBurn parity)

**Status:** Accepted. | **Date:** 2026-06-11

### Context

A raster import with no embedded density metadata (the common case —
screenshots, web images, WhatsApp-stripped JPEGs) was sized at a hardcoded
96 DPI (`DEFAULT_DPI`, `src/ui/common/image-import.ts`). LightBurn's reference
default for the same input is **254 DPI** (0.1 mm/pixel). That is a 2.65×
physical-size divergence on the most common bitmap input, on a tool whose
declared user is a LightBurn switcher (PROJECT.md) and whose ADR-027 treats an
undocumented divergence from LightBurn as a defect. The 96 value was never
weighed against the reference: ADR-046 chose 96 DPI deliberately, but only for
**SVG** user units (LightBurn's separate SVG-import convention), and the bitmap
path inherited the same number without a decision (the feature audit,
FEATURE-AUDIT-2026-06-10.md, flagged this). The oversize-masking fit-to-bed
rescale hid the wrong physical size further.

### Decision

The metadata-less **bitmap** import default becomes **254 DPI** (a single named
constant, `DEFAULT_DPI = 254`). A 1000 px image now lands at 100 mm, matching
LightBurn. Images that *do* carry density metadata (PNG `pHYs`, JPEG JFIF/EXIF)
continue to import at their embedded DPI; the poison-density guard (the 10–10000
DPI sane range) still applies before the default is reached.

This changes the **bitmap** default only. **SVG px stay at 96 DPI per ADR-046** —
that is a separate LightBurn convention for vector user units and is unaffected.

### Consequences

- No-metadata bitmaps import 2.65× smaller than before — correct, but a behavior
  change for existing muscle memory. Surfaced in WORKFLOW.md F-F2.
- The trace overlay (`overlayTransformForRaster`) is unaffected: it reads the
  bitmap's stored mm bounds and px grid, so it is density-agnostic by
  construction (the stale "fixed 25.4/96 ratio" comments were refreshed).
- No change to images with real density metadata, which is the fidelity-critical
  path (scans, exports).

### Alternatives rejected

- **Keep 96 + record it as a deliberate divergence** (screenshots are authored at
  96 DPI): rejected — the maintainer chose LightBurn parity; a switcher's files
  and expectations are calibrated to 254, and ADR-027 makes parity the default.
- **Adopt a user-configurable import-DPI setting** (LightBurn has one): deferred —
  a preferences surface is a separate piece of work; 254 is the right default
  until then.

### Verification

- `src/ui/common/image-import.test.ts` pins the 254 fallback for absent/poison
  DPI; the explicit-DPI test is unchanged (it passes its own dpi). The
  `importImageFile` decode path stays jsdom-untestable and rests on the live
  pass / a LightBurn side-by-side, which is **not yet done**.

---

## ADR-049 — Unified light chrome (supersedes ADR-047's dark-chrome decision)

**Status:** Accepted. | **Date:** 2026-06-13

### Context

ADR-047 built the design-token system with a **unified dark chrome** over a
deliberately **light canvas bed** (WYSIWYG against white material), and
anticipated a future light theme as a `[data-theme='light']` block re-declaring
the custom properties. ADR-047 itself named "inconsistent chrome (dark menubar/
toolbar over light panels)" as part of the original problem. The maintainer has
since decided the app should have a **single light chrome** — unifying the
chrome with the always-light bed into one consistent surface, rather than dark
chrome contrasting a light bed.

This decision records a switch the code already implements (the working-tree
change the 2026-06-13 audit flagged as contradicting ADR-047's then-current
"Accepted" dark-chrome text — finding CQ-004).

### Decision

- **`src/ui/theme/tokens.css`** — the `--lf-*` custom properties at `:root` are
  redefined to a **light palette**: surfaces `#f8fafc / #ffffff / #f1f5f9`,
  inputs `#ffffff`, borders `#d0d7de / #9aa4af`; text `#111827 / #4b5563 /
  #6b7280`; light semantic text-on-surface (`--lf-*-fg`), light tints
  (`--lf-tint-*`), light `--lf-focus`, `--lf-backdrop`, `--lf-shadow`. The base
  semantic **fills** (`--lf-accent` `#1976d2`, `--lf-danger`, `--lf-success`,
  `--lf-warning`, `--lf-trace`) are **unchanged**.
- The light values live directly at `:root`; the dark values are **removed**,
  not kept behind a toggle. This **replaces ADR-047's `[data-theme='light']`
  mechanism** — there is one chrome, not a dark+light pair, so a second theme
  block would be dead complexity. The six per-surface `color-scheme: dark`
  declarations (`.lf-input`, `.lf-checkbox`, `.lf-dialog*`, `.lf-menu`,
  `.lf-chip`) become `light`; the three hardcoded dark hexes in `.lf-btn:hover`,
  `.lf-btn--primary:active`, and `.lf-chip` background move to light equivalents.
- **`index.html`** — `color-scheme` narrows from `light dark` to `light`.
- **`public/404.html`** — the static error page flips to the light palette
  (`#f8fafc` bg, `#111827` text, `#1976d2` link) to match.
- **Unchanged from ADR-047:** the token architecture and shared `.lf-*` classes,
  the `src/ui/kit/` primitives, the static-vs-dynamic styling policy, the
  `no-restricted-syntax` color-literal ban, and `src/ui/theme/canvas-theme.ts`
  (the canvas bed was already light; the two shared values `--lf-accent` ↔
  selection and `--lf-danger` ↔ out-of-bounds are unchanged, so
  `theme-sync.test.ts` is unaffected).

### Consequences

- One consistent light surface across chrome and canvas bed; WYSIWYG against
  white material is preserved and the chrome no longer contrasts the bed.
- Native form controls render light (`color-scheme: light` per surface), and the
  `color-scheme: light` meta means an OS dark-mode preference no longer flips the
  chrome — deliberate, since there is no dark theme to flip to.
- No component code changes — only token/values plus the two static HTML files.
- ADR-047's dark-specific guidance (dark-scoped `color-scheme`, dark tints) is
  superseded; future theme work re-declares the `:root` tokens here, centrally.

### Alternatives rejected

- **Keep dark chrome (ADR-047 as-is):** rejected — the maintainer chose a light
  UI; leaving the ADR "Accepted" while the code shipped light is the CQ-004
  docs-as-spec contradiction this ADR resolves.
- **Implement light as a `[data-theme='light']` block alongside dark** (ADR-047's
  anticipated mechanism): rejected — a single chrome makes a second theme block
  dead complexity; the light values live at `:root`.

### Verification

- `src/ui/theme/theme-sync.test.ts` still pins the canvas-shared values
  (unchanged) and passes; the full suite stays green (197 files / 1411 tests);
  `prettier --check` clean; `pnpm build:web` lands the stylesheet.
- Visual output is jsdom-invisible (per ADR-047) — the rendered light chrome
  rests on a maintainer eyeball pass on `pnpm dev:web`. The token values here are
  the maintainer's authored change; this ADR records the decision, it does not
  re-design it.

---

## ADR-050 — Module-level memoization caches in core/job (narrow exception to "no module-level mutable")

**Status:** Accepted. | **Date:** 2026-06-13

> Numbered after ADR-049 (light chrome), which lands via a separate change.

### Context

CLAUDE.md bans module-level mutable variables, and `src/core/` must be pure. Two
module-level `WeakMap` caches exist in the compile path:
`src/core/job/compile-job.ts` (`layerFillCache`) and
`src/core/job/fill-hatching-cache.ts` (`hatchCache`). The 2026-06-13 code-quality
audit flagged these (finding CQ-005) as contradicting the policy. This ADR
records why they are a **narrow, allowed exception** rather than a violation — so
future maintainers and audits stop re-flagging them.

### Decision

Module-level caches are permitted in `src/core/job` **only** when they are
*observationally-pure transparent memoization*, i.e. all of:

- **Identity-keyed via `WeakMap`** on an input object — `ReadonlyArray<Polyline>`
  / `ReadonlyArray<SceneObject>`. Entries are GC-bounded (they vanish when the
  input is collected) and scoped to specific inputs; no unbounded growth, no
  leakage across documents/sessions.
- **Output-invariant.** The cache key includes *every* setting that affects the
  result (`hatchAngleDeg`, `hatchSpacingMm`, `fillBidirectional`,
  `fillCrossHatch`). A settings change can never return a stale geometry; the
  function's output is identical whether or not the cache hits.
- **Bounded inner map.** The per-input `Map` caps at 8 entries
  (`MAX_SETTINGS_PER_POLYLINE_SET` / `MAX_LAYER_FILL_CACHE_ENTRIES`) with
  oldest-entry eviction.
- **Test-protected.** `src/core/job/compile-job-fill-cache.test.ts` pins the
  hit / stale-bust / eviction behavior.
- **Justified by the hot path.** Fill hatching recompute is expensive and the
  compile path runs on every preview / estimate / save / start (ADR-040), so
  memoization keeps interactive recompiles responsive.

This is **not** a general license for module state. It does **not** permit caches
that change output, time- or seed-dependent state, unbounded maps, or state keyed
by anything other than input identity. Any other module-level mutable still
violates the rule and needs its own ADR. Each cache declaration carries a comment
pointing here.

### Consequences

- The two caches stay in place; no refactor to a caller-threaded cache.
- Auditors who see the `WeakMap` find this ADR (and the in-file comment) instead
  of re-opening CQ-005.
- A future cache here that changes output or grows unbounded falls **outside**
  this exception and is a real violation.

### Alternatives rejected

- **Thread an explicit `CompileJobCache` through `compileJob` /
  `memoizedFillHatching` callers:** rejected — pushes a cache parameter through
  the UI / preview / estimate call chain for zero behavioral change; the WeakMap
  identity-keying already gives correct invalidation and GC bounding.
- **Remove the caches:** rejected — measurable recompute cost on a path ADR-040
  runs on every preview and estimate.

### Verification

- `src/core/job/compile-job-fill-cache.test.ts` passes (a cache hit returns
  identical geometry; a settings change busts the key; eviction bounds the inner
  map). Full suite green.

---

## ADR-051 — Phase G: on-canvas drawing tools (shape SceneObject variant + tool-mode)

**Status:** Accepted. | **Date:** 2026-06-14

### Context

LaserForge is a "LightBurn-style CAM app" (PROJECT.md), but geometry can ONLY
enter via SVG / image / text import — there are zero drawing tools (no rectangle,
ellipse, polygon, or line). The 2026-06-13/14 LightBurn parity audits confirmed
this is the single largest divergence: journey J1 ("draw a sign from nothing") is
*impossible*, and J3 ("batch 20 keychains") is effectively impossible.

Parametric primitive creation is NOT on PROJECT.md's out-of-scope list, but adding
it is past-Phase-F work, so it needs this ADR + a PROJECT.md phase entry. This ADR
covers **parametric primitive creation only**. The geometry *kernel* — weld,
boolean ops, offset, node editing — stays out of scope (a future phase + its own
ADR + an ADR-017 polygon-clipping library evaluation).

### Decision

- **`src/core/shapes/`** — a new pure module: shape → polylines geometry.
  Rectangle (with corner radius), Ellipse (adaptive flattening, reusing
  `io/svg/flatten-curves` math), regular Polygon, and open/closed Polyline. Pure,
  deterministic, unit-tested; imports from `core/` only.
- **A `kind: 'shape'` `SceneObject` variant** carrying a discriminated parametric
  block — `{ kind: 'rect'; widthMm; heightMm; cornerRadiusMm } | { kind: 'ellipse';
  widthMm; heightMm } | { kind: 'polygon'; sides; radiusMm } | { kind: 'polyline';
  points; closed }` — PLUS materialized `paths: ColoredPath[]`. This is exactly the
  `TextObject` precedent (`scene-object.ts`): `compileJob` / preview / emit /
  serialize iterate `paths` **unchanged**, and `assertNever` forces exactly one new
  switch arm per consumer (the ADR-014 extensibility contract). The `.lf2` schema
  change is additive (new variant) — `schemaVersion` stays 1
  (additive-with-default, like every prior variant); `project-shape-validator`
  gains a `validateShapeObject` arm.
- **Tool-mode** in the UI store: a discriminated union
  `{ kind: 'select' } | { kind: 'draw'; shape: 'rect' | 'ellipse' | 'polygon' |
  'polyline' }`. A vertical tool strip sets it; **Esc always returns to Select**.
  `Workspace` mousedown dispatches on tool-mode BEFORE the existing select/drag
  logic; a drag creates the shape on the **currently-selected layer** with a live
  mm readout (reusing the existing DragReadout).
- **Staged, each its own reviewed diff:** B1 `core/shapes` rect→polylines → B2
  'shape' variant + Rectangle + all `assertNever` arms → B3 ellipse + polygon → B4
  tool-mode + tool strip + Esc → B5 `Workspace` draw-on-drag (rect) → B6 ellipse /
  polygon / pen → B7 migrate `Ctrl+E` (Save G-code → Alt+Shift+L) to Ellipse, the
  LightBurn binding, before muscle memory entrenches.

### Consequences

- J1 (draw a sign) flips impossible → possible after B5; the full primitive set
  lands at B6. J3 (batch) is unblocked by the follow-on layout increment (clipboard
  / group / align / grid array), a separate ADR/phase.
- `compile` / preview / emit / save are **untouched** — a shape materializes
  `paths` like `TextObject`, so new shapes flow through the existing pipeline
  (line / fill / image modes, path optimization, preflight, undo/redo, transform,
  selection) for free. The `SceneObject` union grows to five variants; `assertNever`
  keeps every consumer honest.
- Interactive parametric handles (drag corner-radius / sides) and Convert-to-Path
  are deferred (P2 — they need the variant first). Text-on-path, node editing, and
  the geometry kernel remain out of scope.

### B7 as-built (2026-06-14)

The staging line above proposed *Ellipse-only* on `Ctrl+E` with Save G-code moving
to `Alt+Shift+L`. As shipped (maintainer-approved), B7 instead binds LightBurn's
**full tool set** — `Ctrl+R` rectangle, `Ctrl+E` ellipse, `Ctrl+L` pen — and moves
export G-code to **`Ctrl+Shift+E`**, not `Alt+Shift+L`. Reason: a LightBurn-binding
check found `Alt+Shift+L` is *not* a LightBurn shortcut and collides conceptually
with LightBurn's `L` = Line tool; `Ctrl+Shift+E` keeps the export mnemonic without
colliding with the tool keys. `Ctrl+R` / `Ctrl+L` deliberately override the browser
reload / address-bar defaults in the web build (acceptable on a CAD surface).

### Alternatives rejected

- **A generic node-edited "path" object:** rejected — needs a node editor (out of
  scope) and gives no parametric W/H/radius. The parametric variant is the
  LightBurn model and the smaller build.
- **Draw by emitting SVG and re-importing:** rejected — loses parametric
  editability and round-trips through the importer for no benefit.
- **A separate non-`SceneObject` "shapes layer":** rejected — breaks the
  single-pipeline model; shapes must be ordinary `SceneObject`s so compile /
  preview / emit / select / transform all work unchanged.

### Verification

- `core/shapes` geometry is unit-tested (shape→polylines correctness, closure,
  adaptive ellipse tolerance). The 'shape' variant adds a G-code snapshot + a
  round-trip `.lf2` test. Per CLAUDE.md rule 2, drawn shapes are verified by
  **rendering** — draw a 50×80 mm box, confirm it appears and compiles to the
  expected G-code — not by green tests alone.

---

## ADR-052 — Scanning offset compensation: a per-speed table cancels the bidirectional zipper

**Status:** Accepted; core model, emitters, bounds, IO, tests, and opt-in UI landed. Calibration workflow pending. | **Date:** 2026-06-17

### Context

ADR-038 added a per-layer unidirectional fill toggle to remove the bidirectional
firing-lag "zipper" (Cause C, docs/research/burn-perfection-small-text.md) by
*serialising* the rows — every row in one direction, a laser-off return-rapid
between them. It explicitly deferred "a full scan-offset *compensation* table
(correcting bidirectional rows rather than serialising them)" as the heavier
lever.

Field report makes that lever worth building now: the same GRBL output that
burns clean text on a Creality Falcon A1 Pro doubles / serrates letters on a
heavier `neotronics-4040-max`-class gantry (the "PRT 4040"). Our output is
machine-independent except for power scale (`grbl-strategy.ts`), so the variable
is the machine: a heavier gantry has more firing/motion lag, so the per-direction
offset that the Falcon hides is large enough on the 4040 to split every vertical
edge. Unidirectional (ADR-038) fixes it but halves fill throughput. We want the
zipper gone *and* bidirectional speed kept.

Reference check (recorded in RESEARCH_LOG): `barebaric/raygeo` (Rayforge's Rust
raster core) structures bidirectional sweeps as `is_reversed = index % 2` plus an
endpoint swap and applies **no** lag compensation — same blind spot we have, and
it is unlicensed, so nothing is borrowed. The serpentine-by-parity idea is the
standard unprotectable technique; the implementation here is written fresh
against our own `Vec2` / sweep types.

### Decision

Add scan-offset compensation as a **pure geometry transform**, decoupled from the
GRBL emitter so Fill and Image (raster) share one implementation and a future
controller (ADR-006) inherits it for free. Two pure functions in
`src/core/job/scan-offset.ts`:

- **`offsetForSpeed(table, feed)`** — piecewise-linear lookup over a per-device
  calibration table (`ScanOffsetPoint[]`, sorted by speed). Off-end behaviour is
  *defined*, not implementation-specific: linear from rest below the first point
  (lag distance is ~proportional to speed), clamped above the last; empty table
  or non-positive speed returns 0.
- **`shiftAlongTravel(from, to, offsetMm)`** — translate a sweep along its own
  `from -> to` vector. Applied to reverse rows only, this slides the lagging row
  back into registration. Following the travel vector (not the X axis) makes the
  correction correct at **any hatch angle** — the differentiator over an
  X-only/horizontal-only correction.

Storage: a new `DeviceProfile.scanningOffsets: ReadonlyArray<ScanOffsetPoint>`,
default `[]` (= feature off, output byte-identical). We correct **reverse rows
only** (not half-to-each): forward rows and all vector cuts stay at exact design
coordinates, so mixed line+fill registration is preserved, and the calibration
value is exactly the measured forward-vs-reverse separation.

Delivered in reviewable slices (CLAUDE.md "tight leash"):

1. the pure module + co-located unit/property tests;
2. `DeviceProfile.scanningOffsets` + project/material IO normalization;
3. raster reverse-row X shifts and fill reverse-sweep `shiftAlongTravel` wiring;
4. scan-offset-aware job/frame bounds so Frame placement and safety checks see
   compensated output extents;
5. the device-settings table UI.

The calibration-pattern workflow and machine-specific default tables remain
future work. The Neotronics 4040 profile still ships with `[]` rather than a
guessed default.

### Consequences

- Keeps bidirectional speed while removing the zipper, once calibrated — the
  complement to ADR-038's calibration-free unidirectional lever. The two compose:
  bidirectional ON + a populated table = the fast, registered path.
- Default `[]` means zero behaviour change until a user calibrates; determinism
  (#5) holds — both functions are pure inputs to pure functions.
- One shared transform for fill + raster avoids the duplication raygeo carries
  (direction handling baked into each `rasterize_*`).
- Requires a per-machine calibration burn; an uncalibrated or mis-measured table
  can *worsen* registration, so the UI must ship with the test pattern and the
  feature stays opt-in. A wrong table is a user-visible regression, not a crash.

### Alternatives rejected

- **Unidirectional-only (ADR-038) as the final answer:** rejected — it halves
  fill throughput; this ADR is specifically the "keep the speed" path ADR-038
  deferred.
- **Borrow/port raygeo's raster sweep:** rejected — it has no compensation to
  borrow, is unlicensed (fails the ADR-008/018 dependency policy), and is coupled
  to its own `Ops` type.
- **Single global offset (not speed-indexed):** rejected — lag is ~constant time,
  so the distance error scales with feed; one number is wrong at every speed but
  one.
- **X-axis-only shift:** rejected — breaks for angled and cross-hatch fill;
  shifting along the sweep vector is barely more code and generalises.
- **Split the offset half-to-each-direction:** rejected for v1 — moves forward
  rows off design coordinates and complicates line+fill registration; reverse-only
  keeps the design position authoritative. Revisit only if a machine shows
  asymmetric lag.

### Verification

- `src/core/job/scan-offset.test.ts`: unit cases pin empty-table, non-positive
  speed, exact calibration points, linear interpolation, from-rest below the
  first point, clamp above the last, and a single-point table; property tests
  (100 seeds) assert the lookup stays within `[0, maxOffset]` and is monotonic in
  speed for an ascending table, and that `shiftAlongTravel` is a rigid translation
  that moves each endpoint by exactly `|offsetMm|`.
- Step-1 output is byte-identical (nothing imports the module) — existing
  snapshots unchanged by construction.
- `tsc --noEmit` + lint green.
- **Hardware verification (gates step 2):** burn the calibration pattern on the
  4040, populate the table, then re-burn the "langebaan" small text bidirectional
  and confirm the edge serration is gone at full fill speed — green tests prove
  the math, not the fidelity (CLAUDE.md rule 2).
---

## ADR-053 — Verified Origin: hand-set origin + mandatory verified frame for no-homing / hand-positioned machines

**Status:** Accepted; P1–P4 code shipped, hardware verification pending. | **Date:** 2026-06-17

> Numbered after ADR-052 (scan-offset compensation), which lands via a separate
> branch. 052/053 are concurrent feature branches off the same main.

### Context

On machines without usable homing, the operator positions the head by hand (or
jogs it) and uses **Set origin here** (`G92`, ADR-021), then Start/Frame reject
with "design overhangs the bed." Disabling Homing in the device profile does
**not** fix it. Root cause, traced through the code:

- Bed-bounds preflight needs **absolute machine position**, which only exists
  after `$H` homing. ADR-022 added a `relative-origin` mode that checks job
  **size** (does it fit the bed) instead of **position** (where on the bed) when
  no trusted offset exists.
- But that relative path is entered only when **both** (a) a job origin is set
  (`jobOrigin !== undefined`, i.e. User Origin / Current Position) **and**
  (b) `trustedMotionOffsetForPreflight` returns `undefined` (which it does only
  when `device.homing.enabled === false`). In the **default Absolute** start
  mode, `jobOrigin` is undefined, so `describeFrameMotionPreflightIssue`
  (`JobControls.tsx`) and `findPlacementBoundsIssue` (`start-job-readiness.ts`)
  fall through to the absolute `framePreflight` against the artwork's *canvas
  placement* — and the homing flag is never consulted on that path. So "Homing
  off" alone does not stop the false block.
- Worse: **hand-jogging desyncs GRBL's step counter.** After a hand-move the
  reported machine position is fiction, so on a homing-*capable* machine the
  `homing.enabled === true` path trusts a bogus `mPos`/WCO and maps the job to a
  confidently-wrong absolute location — also a false "overhangs."

There is no first-class, discoverable, *safe* workflow for "I put the head here
by hand; trust me; just check it fits, and let me frame it." User Origin +
homing-off approximates it but is a side-effect, still trusts position when
homing is enabled, and provides no frame gate or limit-switch safety.

### Decision

Introduce a first-class **Verified Origin** start mode. Four parts:

1. **New `JobStartMode = 'verified-origin'`.** Placement resolves like
   `user-origin` (anchor → `G92` work-zero) but is **always position-untrusted**:
   `trustedMotionOffsetForPreflight` returns `undefined` for this mode
   *regardless of* `device.homing.enabled`, forcing the relative / size-only
   preflight. The absolute "overhangs the bed" **position** block cannot fire in
   this mode.

2. **Mandatory frame-verified gate.** Start is disabled until a clean **Verified
   Frame** has run from the current origin. New laser-store state
   `frameVerification` records a signature over `{ WCO/origin, anchor,
   prepared-job identity }`; a successful frame sets it, Start checks it.

3. **Invalidation rules — the core correctness burden.** `frameVerification`
   clears on ANY of: origin moved (WCO change / Set origin / Reset origin), job
   or output scope changed (signature mismatch), controller `Alarm` or
   soft-reset (which itself clears `G92`), disconnect / streamer reset, or
   start-mode change. A stale verification must **never** authorize a burn.

4. **Limit-switch-aware Verified Frame.** Extend the GRBL status parser to read
   the `Pn:` field (currently unparsed — `status-parser.ts:16`) into
   `StatusReport.pins`. During the Verified Frame: if a limit pin reports active,
   or hard-limit `ALARM:1` fires (already modeled, `alarm-codes.ts`), abort and
   name the edge ("Verified frame hit the X+ limit — move the origin or shrink
   the job"). Reliability scales with hardware: best with switches wired and
   `$21` hard limits enabled (we already parse `hardLimitsEnabled`); with
   `$21=0` it is best-effort plus the operator's eyes.

**Keeps (safety preserved or strengthened):**
- The **size / envelope** check stays a HARD block — a job larger than the bed
  can never fit and would slam both travel ends; always-correct, cheap, kept.
- The frame becomes **required** (stronger than today's optional frame).
- Hard-limit `ALARM:1` abort is surfaced as a frame failure.

**Drops (only the unknowable check):**
- The absolute bed-**position** block — meaningless after a hand-set origin — no
  longer fires *in this mode*. Other modes are unchanged.

**Hand-jog support (sub-decision, phased).** A "Release motors" control
de-energizes the steppers so the gantry can be pushed by hand. Captured caveat:
`$SLP` sleep needs a soft-reset to resume, and a soft-reset **clears the `G92`
origin** — so the UI sequence MUST be release → hand-move → wake → **Set Verified
Origin last**, never the reverse. Where the GRBL build supports a gentler
stepper-disable (`$MD` / `M18`) without a reset, prefer it.

**Phasing (smallest reviewable diffs, CLAUDE.md "tight leash"):**
- **P1** — `'verified-origin'` mode + force-relative preflight (fixes the false
  block). Pure core (`job-origin` / `job-placement`) + the UI mode toggle.
- **P2** — `frameVerification` state + invalidation + the Start gate.
- **P3** — `Pn:` parsing + limit surfacing during the Verified Frame.
- **P4** — Release-motors control + the hand-jog sequence UI.

### Consequences

- The false "overhangs" disappears for hand-positioned machines **without**
  weakening protection — net safety is *higher* (mandatory + limit-aware frame).
- The new `frameVerification` state with strict invalidation is the main
  complexity and the main test surface; a verification bug authorizes a wrong
  burn, so it is treated as safety-critical.
- `Pn:` parsing is a small, well-scoped status-parser extension that also unlocks
  a live limit/probe-pin display later.
- Decoupling trust from `device.homing.enabled` also fixes homing-capable
  machines that were hand-jogged (previously mis-trusted).
- Mirrors LightBurn's User Origin + framing model (clears the ADR-027
  source-of-truth bar) and stays GRBL-generic (ADR-006) — no homing required.

### Alternatives rejected

- **Tell users to use User Origin + homing-off:** rejected — a non-obvious
  side-effect, still trusts position when homing is enabled, no frame gate, no
  limit safety; the field problem persists (reported still-blocking).
- **Relax bed-bounds globally:** rejected — destroys the only crash protection on
  `$20=0` machines (`frame-preflight.ts` rationale). We drop only POSITION, only
  in this mode, and keep SIZE.
- **Trust GRBL position without homing (assume boot-zero):** rejected —
  hand-jogging desyncs the step counter; the position is fiction and yields
  confidently-wrong bounds.
- **Make the frame optional in verified mode:** rejected — the frame *is* the
  safety substitute for the dropped position check; optional = no net safety.
- **Require homing instead:** rejected — these machines have no `$H`-usable
  switches (or the operator is deliberately hand-positioning); ADR-006 keeps us
  GRBL-generic, not homing-required.

### Verification

- **Core unit tests:** `'verified-origin'` resolves to a relative placement with
  an undefined trusted offset **even when `homing.enabled === true`**; a
  size-too-big job still blocks; a position-off-bed job does NOT block.
- **State-machine tests:** a clean frame sets verification; each invalidation
  trigger (origin move, job edit, alarm, soft-reset, disconnect, mode change)
  clears it; Start is blocked until verified and allowed after.
- **status-parser tests:** `Pn:XYZ` / `Pn:X` / field-absent parse into
  `pins` correctly; a Verified Frame aborts on an active limit pin and on
  `ALARM:1` with the right edge message.
- Full suite + `tsc --noEmit` + lint green. This mode changes placement / preflight
  gating, not emitted toolpath geometry for a given origin — confirm no existing
  G-code snapshot moves.
- **Hardware (gates "done"):** on a no-homing machine, hand-position, Set Verified
  Origin, run a Verified Frame that trips a limit and confirm it names the edge;
  then a clean frame enables Burn; confirm Start is blocked until framed and after
  any origin nudge.
---

## ADR-057 — Registration Box: camera-free placement jig

**Status:** Accepted; core + IO shipped, UI in progress, hardware verification pending. | **Date:** 2026-06-24

### Context

On a no-homing, no-camera machine (the tester's PTR 4040), centering a burn on a
physical object (a keychain blank, a coaster) is trial-and-error: the operator
pencils a square on a board to mark where the object sits, jogs the head to it,
test-burns, finds it off-center, jogs again. It wastes time and scrap. LightBurn
users solve this with a physical jig + Set Origin; we already had Set Origin
(ADR-021) and Frame, but no first-class jig workflow.

### Decision

A **registration box** is a real, locked rectangle `ShapeObject` on a **reserved
registration layer**, burned once as a physical placement reference. The operator
then places the workpiece inside the burned outline and positions artwork relative
to the box on the canvas; both burn from the same origin so the art lands where it
sits relative to the box. Three parts:

1. **Box + reserved layer (no schema change).** `createRegistrationBox`
   (`core/shapes/registration-box.ts`) builds a locked rectangle via
   `createRectangle` with the reserved color `REGISTRATION_LAYER_COLOR`.
   `createRegistrationLayer` (`core/scene/registration-layer.ts`) is a line-mode
   layer with the reserved id `'registration'` — identified by id, NOT color, the
   same pattern as the calibration-label layers (`material-test-labels`,
   `scan-offset-calibration-labels`). The object->layer join stays by color
   (`compile-job.ts`). Box + layer persist in `.lf2` for free (`locked` already
   round-trips; confirmed by `project-registration-jig.test.ts`), so there is no
   `SceneObject` / schema / `schemaVersion` change.

2. **Two runs via the per-layer `output` toggle.** Run 1 outputs only the
   registration layer (burns the box); the operator places the object; run 2
   outputs only the artwork. This reuses the existing `if (!layer.output) continue;`
   mechanism (`compile-job.ts`) — no new run/sequencing concept.

3. **Box-anchored placement — the correctness crux.** `jobOriginOffset` normally
   anchors to the *output-enabled* bounds, so run 1 (box) and run 2 (art) would
   re-anchor to *different* bboxes and the art would land at the bed corner. When a
   jig is present, `prepareOutput` (`resolveJobOriginOffset`) instead anchors EVERY
   run to the box via `computeRegistrationBoxBounds`
   (`core/job/registration-placement.ts`) plus the existing
   `jobOriginOffsetFromBounds` / `applyJobOriginOffset`. Both runs receive an
   identical box-anchored offset, so the art keeps its position relative to the
   box. This lives in the single shared prepared-output pipeline (ADR-040), so
   preview = save = start = estimate all agree.

Pairs with Set Origin (ADR-021) / Verified Origin (ADR-053) for the physical
anchor on no-homing machines.

### Amendment (registration jig UI + movable box)

Two follow-ups refined the above after the maintainer tested it:

- **UI consolidated into one panel.** The four flat Tools-menu commands
  (Registration Box / Center in box / Burn Box Only / Burn Artwork Only) read as a
  confusing button soup, not one stateful two-run workflow. They are replaced by a
  single `tools.registration-jig` toolbar toggle that opens a persistent,
  **non-modal** `RegistrationJigPanel` pinned top-right of the canvas: a live
  "next burn" banner (`registrationRunState`), inline box create/replace/remove,
  center-in-box, the Box/Artwork output toggle, and built-in how-to. It stays open
  while the operator works on the canvas (it never calls `useRegisterModal`).

- **The box is movable, not locked.** Identifying the jig box now keys on the
  reserved color alone (`findRegistrationBoxes` / `isRegistrationBox`), NOT on the
  `locked` flag, so `createRegistrationBox` no longer locks it. The operator can
  drag it onto the material — essential on a homing machine, where the box's
  on-canvas position *is* its absolute bed position — and delete it via the panel's
  **Remove box** button (`removeRegistrationBox`, which drops the box and the
  reserved layer). Note the box-anchored offset (#3 above) only applies in an Origin
  start mode; in **Absolute** mode both runs emit at their true on-canvas positions,
  so a homed machine aligns the two runs with no Set-Origin step.

### Consequences

- The jig is a composition of existing machinery — reserved-id layer (ADR-005
  color-keyed, calibration-layer precedent), `createRectangle` (ADR-051), per-layer
  output, and the ADR-040 placement pipeline — so the new surface is small (two
  pure-core files plus a one-branch change in `resolveJobOriginOffset`).
- Box-anchored placement is **safety/correctness-critical** (origin honesty,
  non-negotiable #2): a wrong offset burns the art in the wrong place. It is
  property-tested for alignment invariance across both runs
  (`registration-placement.property.test.ts`).
- No-op for every non-jig project: `computeRegistrationBoxBounds` returns null when
  no registration layer is present, falling through to existing placement.
- The reserved color is a documented sentinel; identification keys on the reserved
  id, so a color collision is cosmetic, not a mis-placement.

### Alternatives rejected

- **A non-object canvas overlay region (Measure-tool style):** rejected — the box
  would not flow through compile/preview/emit, the art would not sit in real scene
  space relative to it, and the two-run burn would need bespoke sequencing instead
  of the existing output toggle.
- **A new `SceneObject` kind or a persisted `registrationJig` field:** rejected for
  v1 — both add union/schema surface (and a `schemaVersion` bump) for no gain over
  a reserved-id layer that already persists.
- **Re-anchor each run to its own output bbox (do nothing):** rejected — this is
  exactly the bug; the art would burn at the corner, not in the box.
- **Burn box + art in one pass:** rejected — removes the physical placement step
  that is the entire point of the jig.

### Verification

- **Core/IO tests:** generator + reserved-layer predicates
  (`registration-box.test.ts`, `registration-layer.test.ts`);
  `computeRegistrationBoxBounds` measures only the box and is stable across the
  output toggle (`registration-placement.test.ts`); `.lf2` round-trip
  (`project-registration-jig.test.ts`).
- **Property test (alignment invariance):** box-run and art-run receive an
  identical box-anchored offset; the box anchors to work-zero; the art lands at its
  offset relative to the box, not at the corner
  (`registration-placement.property.test.ts`).
- Full suite + `tsc --noEmit` + lint green; no existing G-code snapshot moves
  (non-jig placement unchanged).
- **Hardware (gates "done"):** on the 4040, Set Origin, burn the box, place the
  object, center the art, burn the art, and confirm it lands centered in the box.

---

## ADR-058 — Centerline trace rework: a measured pixel-centering bar + junction chaining

**Date:** 2026-06-25
**Status:** Accepted. Measurement harness, junction chaining, allocation-free
thinning, and preset-aware mask thresholding have landed; EDT-driven thinning
quality and iterative spur pruning are pending slices.

**Context.** Centerline trace (`traceMode: 'centerline'`) produced fragmented,
broken glyphs and was reported to lag/time out on big images. Causes — confirmed
by a code audit + algorithm research and reproduced on the maintainer's real
Arch House logo (1024px → **229** disconnected polylines from 745 points):

- `extractCenterlinePolylines` walked the skeleton pixel-by-pixel and **stopped
  at every junction**, emitting one fragment per edge; a collinear-only
  `mergeCollinearOpenPolylines` (O(n³)) glued straight pieces back but left every
  curve/bend split — the broken letters.
- Zhang-Suen `thinMask` is O(iterations × W×H) and allocates a neighbour array
  per ink pixel per pass (the big-image cost); it also leaves **multi-pixel
  junction clusters** (a crossing's edges end at different adjacent pixels) plus
  gaps and spurs.
- The ink threshold was a hard global `128`, independent of the preset.

Green structural tests (path counts) never measured centering, so the defect was
invisible to CI — the standing "looks faulty vs the source" gap (see ADR-025).

**Decision.**

1. **Measure the bar.** A test-only harness under `src/__fixtures__/perceptual/`
   (ADR-025 family): ground-truth stroke fixtures with analytically-known
   centerlines + a deviation metric (max/mean centering deviation, coverage gaps,
   fragment & spur counts), a self-contained `node:zlib` PNG decoder, and a
   real-logo baseline that renders `[source | centerline | diff]`. Bar: synthetic
   strokes centered ≤1px, connected through junctions, spur-free; the real logo's
   text clean + connected (re-rendered each iteration); big images fast.
2. **Replace the algorithm** (graph-based, full-resolution to preserve
   pixel-perfect centering — downscale only as an extreme-tail safety valve):
   - **a. Junction chaining** (`centerline-chain.ts`) — treat the skeleton as a
     graph; cluster branch ends within a small radius into one node (absorbs the
     Zhang-Suen clusters); pair the straightest-through edges by least turning
     angle so a stroke stays one polyline through junctions. Replaces the
     collinear-only O(n³) merge. **[LANDED]**
   - **b. Allocation-free thinning.** Zhang-Suen rewritten with inline neighbour
     reads (no per-pixel array) + a compacting active-ink list — O(ink) per pass,
     not O(W·H). Skeleton byte-identical, ~2.4× faster at 16MP. **[LANDED]** A
     frontier queue and/or an EDT-driven thinner (cleaner skeleton: fewer
     gaps/spurs, better corners) is the pending quality+perf follow-up.
   - **c. Iterative spur pruning** by branch length AND EDT radius (drop the
     all-branches re-admit fallback). **[PENDING]**
   - **d. Preset-driven ink threshold.** `centerlineMaskFromImage` now accepts
     caller threshold/cutoff settings instead of baking every mask at 128.
     `traceImageToCenterlinePaths` still lets `preprocessForTrace` own manual
     threshold bands, Otsu, alpha masks, and despeckle before mask extraction so
     cutoff bands are not applied twice. **[LANDED]**
3. Salvage the exact O(N) distance transform, RDP simplify, and curve fit — fed
   graph-extracted strokes.

**Consequences.** Chaining alone dropped the real logo from 229 → **155**
polylines (longer, connected strokes), removed the O(n³) merge, and reconnects
crossings (synthetic cross 4 → 2). Remaining gaps — arc fragmentation across a
skeleton break, corner centering ~1.5px, and thin-text breaks are
thinning-quality and are the pending slices (2b/2c). The harness
gates every step. References ADR-025 (perceptual harness), ADR-026/027 (trace
overlay / divergence).

### Amendment — divide-and-conquer extraction replaces the graph-walk (2026-06-25)

Slice 2's "fix the graph-walk node classification" was abandoned: classifying
skeleton pixels by 8-neighbour degree over-reports junctions on curves, and
every patch (crossing number; `degree>=2 && crossingNumber<=2`) traded one
regression for another (spurs vs. shifted junction fits). After studying the
open-source tracers, we switched paradigms to the **divide-and-conquer** method
(the LingDong/skeleton-tracing technique): recursively split the skeleton at the
lowest-crossing line of its longer dimension, and per small chunk read only
where strokes CROSS the chunk border (0→none, 1→stub to the tip, 2→a chord or a
through-the-bend route for corners, ≥3→crossroad to the centroid). Reading
border crossings is immune to the 8-connectivity imperfections that shattered
the graph walk. **Clean-room: our own implementation of the (non-copyrightable)
algorithm — no port, no third-party code/license.** Modules: `centerline-chunk.ts`
(base case) + `centerline-divide.ts` (recursion); `extractCenterlinePolylines`
is now a thin pipeline (segments → `chainBranches` → fit). Result on the harness:
the arc fixture (4 fragments + 3.3px gap, never passed) is now 1 connected stroke
within the bar; the real logo drops 229→137 polylines with the small text
("LANGEBAAN") readable. The remaining l-corner ~1.5px is Zhang-Suen rounding the
corner (a thinning limit, slice 2c — not the extraction).

---

## ADR-059 — Edge Detection trace mode: clean-room Canny → single-stroke vectors

**Date:** 2026-06-25
**Status:** Accepted. Landed end-to-end on `feat/edge-detection`: clean-room
Canny engine, the `traceMode: 'edge'` pipeline, and the "Edge Detection" preset
(auto-listed in the Import dialog). An edge-sensitivity UI control mapping to the
Canny thresholds is a follow-up.

**Context.** Our trace presets (Line Art / Smooth / Sharp, `traceMode:
'filled-contours'`) all reduce the image to a brightness **silhouette** (Otsu
threshold → outline) — the equivalent of the reference tool's "Brightness
Cutoff". On a full-colour logo (the maintainer's Arch House) that flattens the
internal detail away. The reference's "Edge Detection" mode instead finds every
brightness transition and traces those, producing a clean line drawing of the
whole image (house, arch, windows, sunset, waves, text). We had no equivalent.

The engine behind that mode is the **Canny edge detector** (J. Canny, 1986) — a
universal, textbook computer-vision algorithm, not the reference tool's
invention. The reference tool itself, and potrace, are **GPL**; copying either
would force LaserForge to GPL (viral copyleft) and break its salability. Canny,
the *algorithm*, is not copyrightable.

**Decision.**

1. **Add an "Edge Detection" trace mode** (`traceMode: 'edge'`) on a **clean-room**
   Canny detector built from the standard algorithm — grayscale → Gaussian blur →
   Sobel gradient → non-maximum suppression → double-threshold hysteresis — pure
   core, deterministic, no GPL/third-party code. Modules: `canny-gradient.ts`
   (gradient) + `canny-edges.ts` (NMS + hysteresis) → a 1px binary edge map.
   **[LANDED]**
2. **Trace the edge map as single strokes, not outlines.** Feed the 1px edge map
   to the **reworked centerline extraction** (ADR-058 divide-and-conquer) so each
   edge becomes ONE polyline, not a doubled potrace loop. Single-stroke output is
   the correct laser semantics (each line engraved once, no double-cut) and is
   why this mode depends on the ADR-058 extraction. **[LANDED]**
3. **Expose it as an "Edge Detection" preset** alongside the others. The Smooth
   preset and all `filled-contours` behaviour are untouched. **[LANDED]**

**Consequences.** Full-colour art traces into clean line-art usable for engraving,
closing the gap with the reference tool's edge mode — with no GPL exposure, so a
license scan stays clean and salability is preserved. The mode reuses both the
new Canny and the ADR-058 extraction (hence it branches off
`feat/centerline-rework`). Verified at the engine level on the real logo: the
rendered edge map matches the reference edge-detection preview. References
ADR-058 (centerline extraction), ADR-025 (perceptual harness), ADR-026/027
(trace overlay / divergence).

---

## ADR-092 — Connect-time Device Setup wizard (manual, draft-commit, guarded firmware sync)

**Status:** Accepted; shipped (`src/ui/laser/device-setup/DeviceSetupWizard.tsx` + tests; field-editor extraction `DeviceProfileFields.tsx`). | **Date:** 2026-06-24

> Numbering note: the body's previous highest is ADR-057. The active build plan
> (`.claude/plans/plan-a-full-build-sparkling-kazoo.md`) reserves ADR-054..091 for its
> tickets, so this independent, maintainer-requested feature takes the next free number
> above that range (ADR-092) to avoid colliding with a build-plan ticket. (The build
> plan's table also lists 057 = Offset fill, but 057 was already written here as the
> Registration Box — a pre-existing build-plan numbering drift, not introduced by this ADR.)

### Context

Getting a freshly connected GRBL machine ready to cut means setting bed size, origin corner,
power scale ($30), laser mode ($32), homing, and air-assist wiring correctly. Today those
fields are scattered across the inline Device Profile panel (`DeviceSettings.tsx`) and the
seven-tab Machine Setup dialog (`MachineSetupDialog.tsx`); a new operator has to know which
tab each field lives in. LightBurn solves first-run with its "Find My Laser" wizard.

The key realization: we already have most of the data such a wizard asks for. On connect the
handshake queries `$$` and `core/controllers/grbl/parse-settings.ts` parses bed ($130/$131),
power ($30/$31), laser mode ($32), feed ($110/$111), accel ($120/$121), junction ($11), and Z
($132) into a `Partial<DeviceProfile>`, plus a `ControllerSettingsSnapshot` of homing/limit
hints. The audit (`AUDIT-2026-06-10.md`, P1 item #11) frames the opportunity: "your laser
told us its settings" beats every competitor's brand-locked detection. The gap is
presentation and guidance, not detection.

### Decision

Add a **Device Setup wizard**: a multi-step `Dialog` launched from a manual "Set up device"
button in the Laser rail. It reads what `$$` already reported, asks the operator only for what
`$$` cannot report (origin corner, air-assist wiring, Z presence, autofocus, machine name),
optionally writes corrected values back to the controller, and ends with a "ready to cut"
checklist. Three maintainer-chosen decisions fix its shape:

1. **Manual trigger, not auto-open.** The wizard never opens on its own; the operator clicks a
   button. This sidesteps WORKFLOW.md F-A1 ("no welcome/onboarding modal on first run")
   entirely — F-A1 governs app launch over an empty workspace, and a manually-invoked,
   connect-time editor is neither a launch event nor automatic. It realizes the F-A1 promise
   that "the user can override [the default profile] in Settings → Device Profile (Phase C)".

2. **Multi-step wizard with Back/Next** (Connect & read → Identify machine → Confirm detected
   settings → Placement & safety → Sync to controller → Review & finish), modeled on
   LightBurn's Find My Laser.

3. **Draft-and-commit for the profile; guarded in-step writes for firmware.** The operator
   edits a draft `DeviceProfile` seeded from `project.device` + `detectedSettings`; the profile
   commits only on Finish (via `replaceDeviceProfile`), so Cancel is clean and the project undo
   stack isn't spammed per keystroke. Firmware writes are the exception — an EEPROM write can't
   be drafted — so the Sync step writes through the existing guarded `writeGrblSetting` action
   (which already requires connected + Idle + a prior `$$` read, validates the value, writes
   `$id=value`, then re-reads `$$` and verifies the echo). It inherits that action's
   `COMMON_WRITE_IDS` allowlist ($30/$31/$32); bed-size writes, if wanted, go through the
   existing batch `configureGrblLaserSetup` path.

The wizard is **composition, not new plumbing**: it reuses the `$$` detection pipeline
(`detectedSettings`/`controllerSettings`, `describePatch`/`describeReviewItems`), the profile
catalog (`core/devices/profile-catalog.ts`), the guarded write path, and the field editors
extracted to `DeviceProfileFields.tsx`. Pure logic (step reducer, readiness checklist, firmware
diff) lives in its own unit-tested modules under `src/ui/laser/device-setup/`.

### Consequences

- First-connect setup becomes near-zero-input on machines that answer `$$`: the operator
  confirms a prefilled draft rather than typing values. This is the audit's beats-LightBurn
  angle, made real with code we already had.
- Two profile-editing surfaces now coexist: the inline `DeviceSettings` panel (live-write) and
  the wizard (draft-commit). Acceptable for now; folding the panel into the wizard is a later
  roadmap question, not this work.
- The wizard can change the operator's machine (firmware writes). That power is fenced by the
  existing guard + an explicit per-setting confirm; the default path only updates the local
  profile.
- Delivered as a sequence of small PRs (tidy-first field extraction → this ADR + WORKFLOW →
  pure logic → profile-only wizard → firmware step → brand presets) so each diff is reviewable
  and the side-effecting firmware step ships isolated.

### Alternatives rejected

- **Auto-open on connect:** rejected by the maintainer — even gated on "unconfirmed," an
  automatic modal risks the nag that F-A1 exists to prevent. Manual keeps the operator in
  control.
- **Single consolidated scroll page (no steps):** rejected — the maintainer chose a guided
  wizard; steps hand-hold a first-run operator through safety-critical fields one decision at a
  time.
- **Local-profile-only (no firmware writes):** rejected — the maintainer wants the wizard to be
  able to correct the controller, not just tell the app about it; the existing guarded write
  path makes this safe to include.
- **A LightBurn-style fully-manual work-area wizard:** rejected — it ignores the `$$` data we
  already have; prefilling from the controller is the differentiator.
- **New store slice for wizard state:** rejected for v1 — open/close is a `useState` in
  LaserWindow (mirrors `machineSetupOpen`); step/draft is a local `useReducer` over a pure
  reducer, so no global state and the transition logic stays unit-testable.

### Verification

- **Pure unit tests** for the step reducer (next/back/edit-merge/apply-preset/can-advance/
  `assertNever` exhaustiveness), the readiness checklist, and the firmware diff (writable vs
  info-only).
- **Component tests** (following `MachineSetupDialog.test.tsx` / `DetectedSettingsBanner.test.ts`):
  steps render; seeding `useLaserStore.detectedSettings` shows confirm rows; a preset edits the
  draft, not the live store, until Finish; Finish commits via `replaceDeviceProfile`; the
  firmware step calls `writeGrblSetting` only when the guard passes.
- **NOT covered by tests (must be hardware-verified before "done"):** that the wizard reads
  `$$` correctly on a real GRBL connect (2 s handshake), that writing $30/$32 to a real
  controller verifies, and that the chosen origin corner flips Y correctly in emitted G-code.
  Per CLAUDE.md these stay explicitly unverified until a maintainer hardware pass.

---

## ADR-093 — In-app multi-library Material Library UI: create/edit wizard, Saved Libraries browser, auto-save

**Status:** Accepted; staged in small PRs. | **Date:** 2026-06-26

> Numbering note: ADR-092 is the previous highest. The active build plan reserves
> ADR-054..091 for its tickets, so this independent, maintainer-requested feature takes the
> next free number above that range (ADR-093).

### Context

ADR-044/045 landed the calibration generators, the pure `MaterialRecipe` model, and the native
`.lfml.json` IO, then deliberately stopped short of a full Material Library UI. A minimal UI was
since wired into the Cuts/Layers rail (`MaterialLibraryPanel.tsx`, WORKFLOW F-ML1), but the
maintainer reports it is confusing, and the code confirms three concrete problems:

1. **Creation is inverted.** The only authoring path is "Create from Layer"
   (`createMaterialPresetFromLayer`): the operator must import a design, pick a layer, edit that
   layer's cut settings elsewhere, then snapshot it into a preset. The natural mental model is the
   reverse — create a material, name it, then type its power/speed/passes directly.
2. **File-system wording.** `Load... / Save... / Unload` and `Assign` are jargon; the layer-target
   dropdown shows a raw hex color; preset labels are verbose.
3. **No library browser.** Exactly one library exists in memory at a time, persisted to a single
   `localStorage` slot (`laserforge.material-library.v1`) plus a manual `.lfml.json` picker. There
   is no way to keep or switch between several libraries.

The 2026-06-05 research (`audit/reports/lightburn-material-library-research-2026-06-05.md`)
established LightBurn semantics (group by Material → Thickness/No-Thickness → Description; Assign
copies a recipe onto the active layer) and recommended native deterministic storage. This ADR
keeps those semantics and the existing recipe/IO/apply pipeline; it redesigns only the UX shell,
the authoring flow, and the storage breadth.

### Decision

Build the Material Library UI as **composition over the existing core/IO**, in two maintainer-
chosen shapes:

1. **In-app, auto-saved multi-library storage.** Replace the single-library slot with a keyed
   collection in `localStorage` (`laserforge.material-libraries.v1`): `activeLibraryId` plus a map
   of `libraryId → { payload, updatedAt }`, where `payload` is the byte-identical
   `serializeMaterialLibrary` output (stored == exported == validated on read). The legacy slot is
   migrated in once and removed. Mutating the active library auto-saves; there is no manual Save
   button. File Save/Load survive only as **Export... / Import...** for sharing.

2. **Guided multi-step create/edit wizard.** Replace the snapshot form with a `Dialog`-based
   wizard (Identity → Cut settings → Mode details → Review & Save) whose draft commits only on the
   final Save, modeled on the ADR-092 Device Setup wizard's draft-commit pattern. Settings are
   typed directly into the preset. The wizard reuses the layer cut-settings field components
   (`CutSettingsFillFields`, `CutSettingsImageFields`, `readCutSettingsPatch`) over a synthetic
   `Layer`, plus a new `PresetCommonFields` that omits the layer-session fields `visible`/`output`
   (the research doc's rule: never store session fields in a reusable preset). "New from current
   layer" remains an optional prefill, not the primary path.

3. **Saved Libraries browser.** A `Dialog` page lists every library (name, device hint, preset
   count, last updated) with Open / New / Rename / Duplicate / Delete (job-aware confirm) /
   Export / Import.

4. **Reworded rail.** `Assign` → **Apply to layer**; the layer dropdown shows the layer name +
   color swatch, not hex; `Load.../Save.../Unload` give way to **Saved Libraries...** + auto-save.

The apply pipeline is unchanged: `assignMaterialPresetToLayer` still copies the recipe onto the
layer via the scene mutation path, so Preview / Save / Frame / Start stay identical. Wizard step
state is a discriminated union with an `assertNever` default arm (CLAUDE.md state rule); pure
helpers and the persistence collection are unit-tested independently of React.

Staged as small, independently-verified PRs (CLAUDE.md collaboration rule #1): this ADR +
PROJECT/WORKFLOW docs (no code) → persistence collection + management actions → create/edit
wizard → Saved Libraries page → rail rewording → dead-code cleanup. Each diff keeps the app
working.

### Consequences

- Operators author materials the obvious way (type the numbers) and can keep per-machine or
  per-material-family libraries that survive reloads without touching files.
- This advances past ADR-045's "Full Material Library UI ... out of scope" line and the matching
  PROJECT.md scope entry; both are updated. LightBurn `.clb` compatibility, manufacturer profiles,
  and linked presets ("Link", ADR-045's deferral) remain out of scope.
- The new wizard fields and the layer Cut Settings dialog now share field components; a change to a
  field control affects both surfaces. Acceptable and intended (single source of truth for recipe
  inputs).
- Storage breadth grows (N libraries vs 1). Quota failure keeps the existing single-warning,
  edit-continues posture; a corrupt collection slot is discarded silently.
- The legacy "Create from Layer" form, the "Update from layer" button, and the
  calibration-from-test-swatch create path are removed (maintainer decision, Phase 5): the
  wizard is the sole authoring path. The Material/Interval Test generators and the
  recipe/IO model are unchanged; turning a selected test swatch into a calibrated preset can
  be reintroduced later through the wizard if wanted.

### Alternatives rejected

- **File-based libraries (each a `.lfml.json` the operator manages):** rejected by the maintainer
  in favor of in-app auto-save; files remain available as Export/Import for sharing.
- **Single guided form instead of a wizard:** rejected — the maintainer chose step-by-step; the
  wizard hand-holds identity → settings → details → review.
- **Keep "Create from Layer" as the primary authoring path:** rejected — it is the reported
  confusion; demoted to an optional prefill.
- **Hidden auto-applied per-user library (no browser):** rejected — the operator explicitly wants
  to see and switch libraries.
- **New Zustand slice for wizard state:** not needed — open/close is local `useState`, step/draft
  is a local `useReducer` over a pure reducer (mirrors ADR-092), so transition logic stays
  unit-testable with no global state.

### Verification

- **Pure/unit tests:** the persistence collection (round-trip, migration from the legacy slot,
  corrupt-slot discard, quota failure returns false), the management actions (list/open/create/
  rename/duplicate/delete), the wizard step reducer (next/back/edit-merge/can-advance/
  `assertNever`), and `upsertMaterialPreset` (add vs replace; recipe normalization).
- **Component tests:** wizard validation gating and draft-commit-on-Save; Saved Libraries Open
  sets active; Apply-to-layer copies the recipe; Export/Import reuse the IO error paths.
- **Output parity (perceptual, CLAUDE.md #2):** applying a preset must change emitted feed/power
  (Line), hatch spacing (Fill), and lines-per-mm (Image) through the existing prepared-output
  pipeline — checked in Preview / Save G-code, not just by green structural tests.
- **NOT covered (must be hardware-verified before "done"):** that the chosen settings actually
  burn correctly on real material. Per CLAUDE.md this stays explicitly unverified until a
  maintainer hardware pass.

---

## ADR-060 — Offline-first PWA: installable service worker + safe update model

**Date:** 2026-06-26
**Status:** Accepted. Slices 1–3 landed on `feat/offline-pwa` (app-shell precache,
safe update prompt, connection badge + Install button). Hardware verification
(Web Serial driving the laser with the network down) is the standing gap.
Service-worker registration is **web-only**: on the desktop shell (the `app://`
scheme, where Chromium refuses SW) the update prompt is gated off at its mount
(`PwaUpdatePromptGate`, ELE-06), so the desktop auto-update path (ADR-024) is the
single updater and no cached precache can mask its on-disk swap.

**Context.** PROJECT.md already mandates this — the web app is "PWA-installable"
(line 35) and "The app must work fully offline. No analytics, no error reporting
service, no cloud sync" (line 211). It was simply unbuilt. The app was already
~90% offline: machine control is local USB via `navigator.serial`
(`platform/web/web-serial.ts`) — zero internet, a dropped Wi-Fi mid-burn is a
non-event; compute is pure client-side (`core/` is network-free by rule) on a
static deploy; and work persists via `autosave.ts` (localStorage). The only gap
was a service worker to cache the app shell so a fresh load works offline.

Researched distinctiveness: Kiri:Moto is an offline CAM PWA but has no machine
control; CNCjs / LaserWeb need a Node server; Easel is cloud-only; LightBurn is
desktop. A single installable, offline, no-server browser app doing full CAM +
direct Web Serial control is a genuine gap.

**Decision.**

1. **vite-plugin-pwa + Workbox `generateSW`** precaches the app shell (incl. the
   trace worker and all chunks; `maximumFileSizeToCacheInBytes` raised) so the app
   loads and runs offline after the first online load. Web-only — Electron is
   already offline natively and a SW is a no-op over `file://`.
2. **`registerType: 'prompt'` — never auto-update.** An auto-reload could abort a
   live burn. A new SW enters `waiting` (no `skipWaiting`); `PwaUpdatePrompt` shows
   a Reload banner that is **suppressed while the laser is streaming** (mirrors the
   autosave streaming guard). The update applies on the user's Reload, or
   automatically once all tabs close. (Corrected 2026-07-04: an already-`waiting`
   SW **is** re-surfaced on every load — workbox-window 7.4.1's `register()`
   re-fires `waiting` with `wasWaitingBeforeRegister` whenever a matching SW is
   already waiting. The original claim here was wrong, and a bare `setNeedRefresh(false)`
   "Later" therefore re-nagged on every reload. Fix: `PwaUpdatePrompt` persists a
   per-build "Later" dismissal keyed to `__APP_VERSION__` (`pwa-update-dismissal.ts`)
   and clears it on the next `updatefound`, so the same waiting update stays quiet
   while a strictly-newer SW still prompts; it still activates on full close.)
3. **`injectRegister: false`; register via the `virtual:pwa-register/react`
   hook.** A bundled hook is same-origin, satisfying the strict CSP
   (`script-src 'self'`, `public/_headers`) where the inline registration form is
   blocked. `workbox-window` is a dev dep so the hook resolves in the Rollup build.
4. **Relative `base: './'` verified to register the SW at root scope** on the web
   deploy (no `base: '/'` fallback needed). Web Serial is available offline
   (top-level docs default to `serial=self`; `_headers` sets it explicitly) —
   verified live.
5. **Installable + legible:** a manifest (icon from `favicon.svg`), a
   `ConnectionBadge` (shows "Offline" only when disconnected), and an explicit
   `InstallButton` (captures `beforeinstallprompt`).

**Consequences.** Closes the PROJECT.md offline + PWA-installable mandate and
realizes the differentiator. License stays clean (Workbox / vite-plugin-pwa are
MIT — ADR-008). The headline claim — Web Serial driving the machine with no
internet — is software-confirmed (the API is local) but **not yet
hardware-verified** (the standing gap). References PROJECT.md offline mandate,
ADR-003 (web + desktop from one codebase), ADR-008 (MIT / license discipline),
ADR-009 (Vite stack), ADR-047 (design tokens).

---

## ADR-094 — Phase H multi-controller architecture: ControllerDriver seam + capability-gated UI

**Status:** Accepted; shipped (Phase H build, branch `claude/angry-mcnulty-bc6bfe`). | **Date:** 2026-07-02

**Context.** ADR-006 shipped GRBL v1.1 only and promised an extensible strategy for
future controllers. The maintainer directed Phase H: support grblHAL, FluidNC,
Marlin, Smoothieware, and Ruida. The store layer hardcoded GRBL bytes ($J=, $X,
!, ~, ?, Ctrl-X) across nine ui/state files; only the G-code emitter was abstract.

**Decision.**

1. **ControllerDriver seam** (`src/core/controllers/`): per-firmware pure object —
   command vocabulary, realtime bytes (nullable), line classifier into a shared
   `ControllerEvent` union (superset: adds `busy`/`resend`), console rules, jog/frame
   builders, default baud. `selectControllerDriver(kind)` resolves from the profile's
   `controllerKind`; the driver lives in the store's non-serializable refs.
2. **Capability gating, never kind-checking, in ui/**: a declarative
   `ControllerCapabilities` snapshot in LaserState (transport, jog, realtimePause,
   statusQuery, settings, unlock, sleep, wcs, homing, console, firmwareSetupPanel).
   `kind === 'grbl'` in ui/ is the same anti-pattern class as platform conditionals.
3. **Byte-identical proof for the refactor**: firmware simulators
   (`src/__fixtures__/controllers/`) + store-level lifecycle integration tests landed
   BEFORE the seam; the refactor kept G-code snapshots and sim transcripts identical.
4. **Detection is advisory**: welcome banners (and unknown lines) run through a
   detection registry; a mismatch with the selected profile logs a warning, never
   silently switches drivers.
5. `.lf2`/.lfmachine round-trip `controllerKind` + optional `baudRate`; unknown
   values are dropped to the GRBL default at the deserialize boundary
   (`isKnownControllerKind` is the single source of truth).

**Consequences.** grblHAL/FluidNC land as capability deltas on the GRBL driver
(FluidNC: settings read-only, no $-writes). One family per sub-phase (keeps
ADR-006's discipline). Supersedes ADR-006's GRBL-only scope; everything else in
ADR-006 stands. grblHAL is hardware-verifiable on the Falcon A1 Pro; FluidNC is
simulator-verified only.

---

## ADR-095 — Marlin controller support (queued status, stream-side pause, inline/fan dialects)

**Status:** Accepted; shipped, simulator-verified only. | **Date:** 2026-07-02

**Context.** Marlin has NO realtime bytes: no `?` report, no `!`/`~`, no soft-reset
char, no `$` vocabulary, text errors, `ok`-per-line acks, `echo:busy` keepalives.
Laser wiring is fragmented: LASER_FEATURE builds take M3/M4/M5 + per-move S
(0–255); fan-mosfet rigs only know M106 Sn/M107.

**Decision.** Status = queued `M114` (synthesized Idle report), polled ONLY while
no stream acks are outstanding and no controller command is pending — a queued
query consumes planner space and emits its own `ok`, so polling mid-stream would
desync the character accounting. Pause = stream-side (stop sending; buffered
motion drains; UI copy says so). Stop = stop sending + `M5`/`M107` beam-off lines.
Jog = `G91`/`G0`/`G90`; frame = absolute `G0` legs; home = `G28 X Y` (never bare
G28 — Z would crash a laser rig); settle marker = `M400`. Two output dialects:
`marlin-inline` (GRBL wire shape at S 0–255) and `marlin-fan` (per-move S →
`M106/M107` between moves; the laser-off-on-travel checker treats `M107` as
beam-off). Checksum `Resend:` is a terminal stream error (no line-number replay
in v1). Start readiness passes with an explicit power-scale-unverified warning
instead of demanding $30/$32 proof.

**Consequences.** Ping-pong streaming only (profile default). Raster in fan mode
is slow/coarse by physics — documented, not hidden. NOT hardware-verified; the
catalog profile carries `unverified` evidence saying exactly that.

---

## ADR-096 — Smoothieware controller support (fractional S power scale)

**Status:** Accepted; shipped, simulator-verified only. | **Date:** 2026-07-02

**Context.** Smoothie speaks GRBL-flavored realtime (`?` status, `!`/`~`, Ctrl-X)
but has no `$J`/`$$`/`$X`/`$SLP`; halt recovery is `M999`; homing is `G28.2`; and
the laser module's S scale defaults to **0–1.0** — the GRBL emitter's integer
rounding would collapse every power to 0 or 1.

**Decision.** Reuse the GRBL status-parser and realtime bytes; jog/frame like
Marlin (G91/G0/G90); `!!`/text errors classify as terminal stream errors (halt
state arrives via status reports; there are no numeric alarm codes).
`smoothiewareStrategy` emits against a virtual S-1000 scale and rescales every S
word to the profile maximum (S0.500 at max 1.0; integers at large scales) —
non-negotiables #3/#5/#7 property-tested at fractional scale. Realtime pause is
allowed WITHOUT the $32 proof on firmwares that cannot report $-settings
(Smoothie's laser module ties beam power to motion); grbl-dollar firmwares keep
the strict gate. `config-set`/`config-load` are blocked in console and payloads.

**Consequences.** NOT hardware-verified (catalog evidence says so). `maxPowerS`
may now be fractional; consumers were audited for integer assumptions.

---

## ADR-097 — Ruida: experimental .rd export, file-only transport

**Status:** Accepted; shipped as EXPERIMENTAL (file export only), NOT accepted by real hardware yet. | **Date:** 2026-07-02

**Context.** Ruida DSP controllers (RDC644x class, most Chinese CO2 lasers) speak
a proprietary swizzled binary protocol over USB/UDP — no serial G-code link
exists. Byte meanings come from public reverse-engineering (MeerK40t, EduTech
wiki); LaserForge reimplements clean-room (ADR-017 discipline, no code copied).

**Decision.**

1. `core/controllers/ruida/`: swizzle (round-trip property-tested), 35-bit
   coordinate / 14-bit power encodings, a minimal command vocabulary, and a
   deterministic `.rd` encoder that REFUSES raster groups rather than guessing.
2. **Verification is round-trip, honestly labeled**: a decoder test-instrument
   proves encode→decode fidelity (geometry, power, speed, passes, layers) —
   internal consistency, NOT real-device acceptance. Every save shows an
   EXPERIMENTAL toast; the catalog evidence repeats it.
3. **Transport `file-only`**: a new capability disables Connect and all live
   controls for Ruida profiles; Save G-code routes to `io/rd` → `.rd` (Blob).
4. A pure UDP session state machine (checksum datagram framing, ACK advance,
   ERR retry budget, port 50200) is implemented and sim-tested as groundwork.
   The Electron UDP socket + IPC bridge is deliberately NOT built: streaming
   never-hardware-validated bytes to a live CO2 laser fails the Phase H honesty
   rules. Profiles stay file-only until a real controller accepts the output.

**Consequences.** Ruida users get preview/estimate/export today with explicit
warnings. Next steps (in order): validate a generated `.rd` against a real
controller or reference files, then wire the UDP transport.

**Limitation — layer Min/Max power collapsed to one value (recorded 2026-07-10, CTL-04 part 2).**
LightBurn exposes two separate per-layer power values on a Ruida layer, Min Power
and Max Power. Our `Job` cut-groups carry a single `power`, and the encoder writes
that one value into BOTH the `layerMinPower` (0xC6 0x31) and `layerMaxPower`
(0xC6 0x32) commands (`core/controllers/ruida/rd-encoder.ts:68-69`) — we always
emit Min == Max. Decision (CTL-04): record this as a deliberate current limitation
(option a) and DEFER plumbing a separate min power (option b), because a true split
is a cross-cutting change to the core `Job` cut-group model (a second power field
threaded through to the encoder) and — with no reference `.rd` from real hardware or
LightBurn — there is no byte snapshot that would catch a regression in the emitted
bytes. We record the divergence from LightBurn's separate Min/Max now; we do NOT
assert what a Ruida controller does with Min == Max, as that is unverified.

---

## ADR-100 — Trace quality rebuild: medial-axis Centerline, chained Edge Detection, true Sharp params

**Date.** 2026-07-03. **Status.** Accepted (replaces the Centerline
implementation; amends ADR-059 Edge Detection).

**Context.** The perceptual IoU/structure suite was green while traced art
looked wrong (the Karpathy failure mode). A visual audit harness
(`src/__fixtures__/perceptual/_trace-audit-render.test.ts`, `TRACE_AUDIT=1`)
exposed: Centerline vanished whole strokes, retracted tips, tangled
junctions, and chamfered every drawn corner; Edge Detection outlined its 1-px
Canny mask with the filled-contour backend, doubling every line (the preset
was hidden from the UI for exactly that reason); Sharp reached the potrace
backend with Smooth's curve params (its imagetracerjs-era fields are inert
there), so small features traced as blobs.

**Decision.**

1. **Centerline** is rebuilt from scratch in `src/core/trace/centerline/`:
   exact squared EDT (Felzenszwalb–Huttenlocher) → distance-ordered homotopic
   thinning with an exact (8,4) simple-point LUT, phase 1 anchored on centres
   of maximal discs, phase 2 plateau reduction with a more-neighbours-first
   tie-break (even-width ribbons cannot unzip tip-first) → junction-cluster
   stroke graph → pinched-tip spur pruning (tip radius ≤ 1.6 px AND
   protrusion beyond the trunk under budget; a component's last chain is
   never pruned) → assembly: straightest-continuation junction pairing,
   tangent-anchored ridge-walk tip extension to the ink cap apex, T-junction
   seam repair (the medial axis genuinely dents toward every branch — seams
   are stitched straight and branch ends welded back on), windowed corner
   sharpening (chamfers and round-nib joins rebuild their vertex; fillets
   of roughly 2 stroke radii and up stay round), Douglas-Peucker.
2. **Edge Detection** keeps Canny but with interpolating non-max suppression
   (bilinear along the true gradient — 4-bucket NMS starved diagonal ridges)
   and feeds the edge map through the same chain machinery, emitting single
   sub-pixel polylines: open for lines, closed for loops. Sliver loops
   (area ≤ 4 px²) drop as debris. Tangent-ALIGNED continuations may
   bridge/close up to 3× the join gap (hysteresis dropouts exceed the knob;
   perpendicular welds stay capped). Preset minimum line is now chain length
   (12 px), not two-sided contour perimeter (24 px). The preset is back in
   the UI dropdown.
3. **Sharp** sets the potrace params that actually apply: smoothness 0.55,
   optimize 0.15 — corners stay vertices, genuine large arcs still curve.
   Chosen from three rendered candidates (today-smooth / corner-faithful /
   pure-polygon) over corner, pixel-art, curve, and fine-detail fixtures
   (`_sharp-candidates.test.ts`, gated on `TRACE_AUDIT=1`).
4. **Perceptual contracts updated to the single-line reality:** coverage
   metrics sample the drawn path (not simplified vertices), closed polylines
   have endpoint gap 0, centerline tips must reach the visible ink cap apex,
   a dashed stroke traces as one closed outline per dash (LightBurn-
   consistent; the old fused blob was a dilate/erode artifact), and open
   polylines are a feature of Edge Detection, not a defect.

**Consequences.** All five presets render correctly on the audit fixtures and
the arch-house real logo (benchmark loop 10/10 across six benchmarks). Known
limitation: at very shallow crossings, chain pairing can hand the connector
to the wrong continuation — geometry stays correct, only travel-path grouping
is affected. The audit harness stays in the tree, gated on `TRACE_AUDIT=1`,
as the standing perceptual eyeball tool.

**Amendment (2026-07-03) — sub-pixel smoothing + corner loop closure.** The
maintainer's perceptual pass on the arch-house logo found Edge Detection
still lumpy on turns (raw chain vertices sit on the integer pixel lattice)
and letter outlines left open with small gaps (every closure/bridge gate
assumed tangent continuation, which a loop whose ends meet at a drawn CORNER
never satisfies). Fixes, within the same chained-edge architecture:

1. Every raw chain vertex snaps to the parabolic peak of the blurred Sobel
   magnitude along the gradient normal before smoothing (Devernay-style
   sub-pixel refinement, shift clamped to 0.6 px — never invents edges;
   `edge-subpixel.ts`, plumbed via `ChainAssemblyOptions.snapPoint`).
2. Loop closure is one shared three-tier decision
   (`centerline/loop-closure.ts`): touching ends (≤ 1.5 px), tangent-ALIGNED
   ends (≤ 3× join knob, as before), and NEW corner-meeting ends (≤ 1× knob,
   gap ≤ 15% of loop, hairpin-guarded; tangent evidence is distrusted under
   3 px where weld kinks corrupt it). Applied at assembly, again after
   welds, and after ridge reconnection. Centerline strict mode still closes
   touching ends only.
3. An open end stopping just short of its OWN chain now self-welds
   (arc-exclusion window keeps neighbouring segments out of reach), and a
   sub-minimum-length chain whose both ends land on other geometry is kept
   as a weld connector instead of being dropped (dropping it reopened the
   very gap the weld closed).
4. Output Chaikin refinement pins the bend sharpener's rebuilt vertices
   (dense-chain corner evidence) plus ≥ 60° turns, instead of every ≥ 35°
   vertex — small letter bowls now smooth while drawn corners stay exact.

Regression gates on the real fixture: `nearlyClosedOpenCount = 0` and
`langebaanExcessTurnPer100Px ≤ 12` (excess turn — back-and-forth bending
that cancels over a 6 px window; genuine corners score zero), plus a
sub-pixel disc-roundness test (radial RMS ≤ 0.12 px). Standing eyeball
harness for this fixture: `_arch-house-edge-audit.test.ts` (TRACE_AUDIT=1).

**Amendment (2026-07-03, second) — adaptive potrace corner threshold +
Smooth auto-median.** A cross-tracer audit against the official potrace
1.16 binary (run out-of-process on identical preprocessed bitmaps as a
measurement reference only) showed our potrace backend already matches the
reference 1:1 on curve fidelity (disc radial RMS 0.135 px vs reference
0.139) and corner fidelity (star apex error 1.00/2.17 px vs 0.99/2.03) —
but both melt small text at the default alphamax 1.0, because ~16 px glyphs
yield 2–4 px polygon legs whose raw corner alpha falls below the global
threshold. Two changes:

1. **Per-vertex adaptive alpha limit** (`potrace-curve.ts`): the corner
   test uses `min(alphaMax, 0.55 + 0.45·t)` where `t` ramps over the
   shorter adjacent polygon leg from 3 px to 7 px. Small features keep
   drawn corners (glyph corner count 2 → 12 on the pinned fixture); long
   legs are unchanged, so large arcs stay smooth (disc RMS byte-identical),
   and any alphaMax ≤ 0.55 (the Sharp preset) is provably unaffected.
   Result: small-text tracing now EXCEEDS reference potrace, which
   ships `mkbitmap` upscaling precisely because it melts at this scale.
2. **Smooth preset median is now `'auto'`** (`TraceOptions.medianFilter:
   boolean | 'auto'`): the impulse-noise detector moved from edge-trace to
   `preprocess.ts` (`hasImpulseNoise`, shared, behavior identical) and the
   median only runs when measured noise justifies it — the unconditional
   median was destroying clean small glyphs. The median itself was
   rewritten allocation-free (Smith median-of-9 sorting network,
   byte-identical output, property-tested against a naive reference):
   Smooth on the 1024² logo fixture went ~959 ms → ~247 ms with IoU up
   0.974 → 0.978.
3. **Auto-upscale of small thin-featured sources** (`auto-upscale.ts`,
   wired in `traceImageToColoredPaths`, opt-in flag set on all five
   presets): when the source is ≤ 1.5 M px AND its ink area/perimeter
   ratio indicates strokes under ~3 px, the image is 2× bilinear-
   supersampled before tracing and the traced vectors divided back —
   the approach potrace's own `mkbitmap` exists for. Edge Detection on
   the half-scale letter fixture went from 9 closed + 4 fragmented-open
   outlines to 15 closed / 0 open; the potrace presets gain proportional
   detail. Bold/large sources (the arch-house fixture) never trigger it,
   so all landed benchmarks are unaffected.
4. **Apex snap** (`potrace-apex.ts`): acute traced corners (turn ≥ 50°,
   local maxima) are rebuilt by intersecting the two straight flank
   lines, ink-supported and capped at 2.5 px — the rasterized ink ends
   ~2 px short of a thin analytic apex, so extrapolating the flanks is
   the only route to the true corner. Star-tip error 1.00/2.17 px →
   ~0.5/1.0 px (reference potrace: 0.99/2.03 — now beaten ~2×); square
   overshoot 0, disc unchanged.
5. **Spur-budget cap** (`spur-pruning.ts`, `MAX_SPUR_BUDGET_PX = 12`):
   the protrusion budget scaled with the JUNCTION radius uncapped, so a
   fat hub (a blob's inscribed disc) inflated the budget past real
   stroke lengths and Centerline collapsed thick shapes (12-spoke star
   → one 2-point chain). Capping at fat-stroke scale (the same 12 px
   junction-condense uses) restores all 12 spokes; corner-wedge
   artifacts (~3-6 px protrusion) still prune. Bug vs ADR-100's
   documented rule, not a redesign.
6. **Spatial-grid acceleration** (`centerline/spatial-grid.ts`): the
   ridge-reconnect arrival test and open-end weld search now query a
   uniform cell hash instead of scanning every segment (222× fewer
   candidates); candidate order is re-sorted to the original scan order
   so selection/tie-breaking is BYTE-IDENTICAL (proven by full-output
   deep-equal on three fixtures plus a permanent determinism test).
   Edge trace ~955 → ~639 ms on the 1024² fixture; the remaining floor
   is canny/median/distance-field/thinning — documented future work.

**Amendment (2026-07-03, third) — closed rings must return to their start
point.** The maintainer's live-app trace of the ARCH "A" showed the counter
(and other letter counters) with small seam gaps, while every offline metric
reported the counter CLOSED. Root cause: the corner/aligned closure tiers mark
a ring `closed: true` while leaving its endpoints up to a join gap (~1.5–5 px)
apart — the closing edge is left IMPLICIT. potrace and text glyphs close their
rings by making the last point coincide with the first (potrace explicitly
appends the start point); the canvas line-stroke renderer
(`strokePolylinesBatched`) and the G-code toolpath emitter both draw a closed
polyline's points AS GIVEN and never synthesise the closing edge, relying on
that convention. Edge/centerline rings violated it, so a stroked/engraved
closed loop showed — and would have CUT — a gap the size of the endpoint
separation (fill rendering hid it, which is why the perceptual IoU/coverage
metrics, which rasterize via fill, never caught it). Fix: `closeRingEndpoints`
(centerline/loop-closure.ts) appends the start point to any closed ring whose
ends are not already coincident; applied at the final output of both
`edge-trace.ts` and `trace-centerline.ts`. Verified end-to-end in the live
browser: all 41 closed rings of the arch logo now return to start
(max endpoint self-gap 0). The closure metrics were also strengthened — an
edge-trace invariant now asserts every closed ring returns to start, the class
of bug the old flag-trusting metrics missed.

**Amendment (2026-07-04) — even-curvature smoothing (edge/centerline bowls).**
The maintainer reported curved letter parts (a "B" bowl) tracing as faceted
polygonal chords. Measured against a VERIFIED reference — the real Roboto "B"
glyph outline rasterized and traced (`_letter-b-smoothness.test.ts`), scored
by facet ratio (% of 1px steps kinking ≥14°, corners excluded) — ours was
1.9% at 100px vs the official potrace binary's 0.5% on the identical bitmap.
Two experiments proved the faceting was baked into the CHAIN, not the
DP/Chaikin end-stage: disabling Douglas-Peucker still left 1.5%. Root cause:
independent per-vertex sub-pixel snapping + only two Taubin passes leave
pixel-scale curvature noise (the line does not turn evenly like a fitted
Bézier); the Chaikin output stage then froze a kink at every pinned
soft-turn vertex. Fix (both halves, `src/core/trace/centerline/`):
`chain-smoothing.ts` evens the dense chain with corner-anchored Taubin (8
passes, shrink-free λ/μ, the sharpener's corners + hard turns + endpoints
pinned) between sharpening and DP; `curve-fit.ts` replaces the Chaikin body
of `refineChainForOutput` with a centripetal Catmull-Rom resample (corners
break the spline and stay exact). DP epsilon 0.55→0.45 to give the spline
control points on tight bowls. Result: 100px facet ratio 1.9% → **0.5%
(matches the potrace reference)**, 160px 0.9% → 0.2%, 60px 4.1% → 2.6%;
deviation from the true glyph unchanged (mean ≤0.23px). Verified perceptually
on the synthetic B and the real logo's "O" (a smooth ellipse) and ARCH HOUSE
letters. Corner/apex/disc/closure/determinism gates all hold; both Edge
Detection and Centerline benefit (shared `finalizeChains`). Known residual:
60px glyphs sit at 2.6% (improved, not yet potrace parity) — a stem/arm
junction sub-pixel artifact, not bowl faceting.

**Amendment (2026-07-04, second) — apex snapping for Edge Detection.** Edge
traced sharp convex silhouette tips ~1.8-2.8px short of the true corner (star
apex 1.80/2.81), while Line Art already reconstructs them (0.66/0.96). Reused
`potrace-apex.ts` `snapCornersToInk` on Edge's closed rings, with the
outward-ink guard built from a FILLED source-luma bitmap (`edge-ink-support.ts`
- Edge's own Canny mask is a hairline and would reject every move). A
`minRingPerimeterPx` gate (250px) confines recovery to genuine large
silhouettes; small text (30-185px rings, already well-localised by Canny+ridge)
is left untouched so its crowded corners do not re-facet. potrace's own apex
behavior is byte-identical (the gate defaults to 0). Result: Edge star apex
1.80/2.81 -> 0.96/1.54 (beats the potrace 1.16 binary 0.99/2.03); disc RMS
0.035 and B-bowl facet 0.2% unchanged (no collateral); verified sharp by eye.
Edge Detection now sits at or above the potrace reference on every axis it
shares - curves (best of all presets), corners, bowls, and ring closure.

**Direct 1:1 verification.** `_reference-iou.test.ts` rasterizes OUR
Line-Art output and the reference potrace 1.16 output on the identical
bitmap (disc + star, where auto-upscale does not fire) and measures area
overlap: **disc IoU 0.9989, star IoU 0.9983** (≈ 99.9 % pixel-for-pixel
agreement at 4× supersample; 189/518400 and 312/640000 mismatched
sub-pixels). Recall 0.9996–0.9999 (we cover essentially all reference
ink); the sub-0.2 % residual is precision — the sharper apex tips we
push past potrace's blunted corners — i.e. where we exceed the reference,
not miss it. This is the measured "1:1 match against a reference": the
two vectorizations are indistinguishable except where ours is better.

---

## ADR-024 — Windows desktop distribution + auto-update mechanism

**Status:** Accepted | **Date:** 2026-07-04

### Context

The Electron desktop shell has existed and been CI-typechecked since Phase A
(`electron/main.ts`, `electron-builder.yml`, `pnpm build:desktop`), but it was
never packaged into a distributable installer, never hosted for download, and
had no update path (`publish: null`). This ADR was reserved from the start
("before first signed release") and is written now to launch **KerfDesk as a
downloadable Windows installer alongside the online web app**.

Three constraints shaped it:
- **Non-negotiable #8** — "No telemetry, no network calls — local-first. Ever."
  An auto-updater necessarily makes a network call.
- **Security posture** — "No auto-update from arbitrary URLs," plus the
  deliberate no-preload / no-`ipcMain` hardening of the Electron shell.
- **Non-negotiable #9 / burn-safety** — an update must never interrupt a job.

The maintainer chose **full auto-update** (over notify-only) for the desktop app.

### Decision

1. **Distribution.** electron-builder produces an **NSIS x64 installer**
   (unchanged target; per-user `perMachine:false`, assisted `oneClick:false`),
   built in CI on annotated **SemVer tags `vX.Y.Z`** (not per-commit). The tag
   drives the artifact version via `-c.extraMetadata.version=$VERSION` so the
   installer, `app.getVersion()`, and the update feed agree. Hosted on
   **Cloudflare R2** (bucket `kerfdesk-downloads`, served at
   `https://dl.kerfdesk.com/desktop/`), linked from `https://kerfdesk.com/download`.
   **Not GitHub Releases** — the repo is private (ADR-018); public asset URLs
   would need a separate public repo or tokens. **Not** bundled into the Pages
   deploy — keeps the web deploy small and decoupled.

2. **Auto-update = `electron-updater`, main-process, self-hosted.**
   `electron-builder.yml` `publish: { provider: generic, url:
   https://dl.kerfdesk.com/desktop }` makes the build emit `latest.yml` +
   `.blockmap`. In `electron/main.ts` (packaged only, `app.isPackaged`):
   `autoDownload = true`, `autoInstallOnAppQuit = true`, then
   `checkForUpdatesAndNotify()` — a background check + OS-native "update ready"
   notification that installs on the next natural quit. The check runs in the
   **main process** (Node `net`), so the locked renderer CSP is unchanged and no
   renderer update-UI is required.

3. **Burn-safety (non-negotiable #9).** The app **never** calls
   `autoUpdater.quitAndInstall()`. Updates apply only on a user-initiated quit,
   which cannot happen mid-burn without the operator stopping/closing the app
   (existing `src/ui/app/use-unload-stop.ts` soft-resets the machine on unload).
   No mid-stream interruption is possible.

4. **This revises non-negotiable #8's "no network calls."** #8 is amended (this
   ADR) to permit exactly one call: the desktop updater's check/download against
   our **own pinned `kerfdesk.com`-family origin**. It transmits **no user data
   and no telemetry** and is user-disablable; the web app and every CAM/streaming
   path stay fully offline. The separate posture "no auto-update from
   **arbitrary** URLs" is **honored** — the feed URL is pinned at build time.

5. **Code signing deferred.** v1 ships **unsigned**: the `/download` page
   documents the Windows SmartScreen "unknown publisher" step. Auto-update still
   functions unsigned, and per-user install-on-quit largely avoids UAC. Signing
   (Azure Trusted Signing ~$10/mo, or an OV/EV cert) slots into the release
   workflow later behind env-var/secret gating with no code rework; once signed,
   `electron-updater` verifies the publisher signature, hardening the channel.

6. **Dependency.** `electron-updater` (MIT, electron-builder ecosystem) is added
   to `dependencies` (it is `require`d by the packaged main process).
   RESEARCH_LOG.md entry per ADR-017.

### Consequences

- KerfDesk launches as a real downloadable Windows app that keeps itself current
  while the web app is unchanged.
- The strict "local-first, no network, ever" posture gains one narrow,
  self-hosted, no-user-data exception, recorded here and in PROJECT.md #8.
- The no-preload/no-IPC shell is preserved: `checkForUpdatesAndNotify` + OS
  notification needs no IPC. An **in-app** "restart to update" banner would need
  a hardened `contextBridge` and its own ADR — deferred.
- Green tests never prove the installer runs (CLAUDE.md): a workflow-shape test +
  an auto-update-config unit test guard structure, but install / serial / update
  behavior is verified manually on Windows 10 and 11 (WORKFLOW.md desktop flow,
  AUDIT.md CLAIMED row) before the launch is called done.

### References
ADR-007 (Windows-only desktop), ADR-011 (platform adapter), ADR-018 (private
repo → not GitHub Releases), ADR-060 (offline-PWA update model this mirrors),
ADR-017 (dependency policy), PROJECT.md non-negotiables #8 / #9.

---

## Future ADRs (anticipated, not yet written)

**Numbering.** The contiguous body runs ADR-001..057 (ADR-057 = Registration Box).
The active build plan (`.claude/plans/plan-a-full-build-sparkling-kazoo.md`) reserves
ADR-054..091 for its tickets — note its allocation table lists 057 as "Offset fill,"
which collides with the already-written Registration Box, so that table needs
reconciling before those tickets land. Independent (non-build-plan) ADRs should take
the next free number **above** the reserved range (ADR-092 and up); ADR-092 (Device
Setup wizard) is the first.

- ADR-023 — Web-app deployment target (covered ad-hoc in the current
  Cloudflare Pages setup commits; promote to formal ADR if the deploy
  config grows further).
- ADR-024 — Update mechanism for Windows desktop. **Written (Accepted
  2026-07-04) — see the ADR-024 section above.** Full auto-update via a
  self-hosted `electron-updater` feed on Cloudflare R2; v1 ships unsigned.
- (Earlier reservations for ADR-019..023 were stale — Phase B / E
  shipped without formal ADRs at those slots. ADR-019 / ADR-020 /
  ADR-021 are the first three slots since reused.)

## ADR-098 — CNC router mode becomes a first-class product track (Phase H "Router")

**Status:** Accepted
**Date:** 2026-07-02

### Context

Commit `032d476` landed an experimental CNC router mode: a `MachineConfig`
discriminated union on `Project`, per-layer `CncLayerSettings`, a pure
`compileCncJob` pipeline (profile / pocket / engrave with depth passes and
tabs), a spindle/Z-aware `cncGrblStrategy` emitter, CNC preflight, and UI
wiring. The independent parity audit
(`audit/reports/cnc-easel-parity-audit-2026-07-02.md`) verified it is a real
CNC MVP — not renamed laser UI — but landed without a scope-gating ADR, and
PROJECT.md remained laser-only with DXF import explicitly out of scope.

The maintainer has decided to build this into LaserForge's own full
professional CNC/router mode — not a thin Easel clone — including true
V-carving, toolpath simulation, DXF / STL / G-code import, 3D relief carving
(first-class from the start), tool + feeds/speeds libraries, multi-tool jobs,
motion polish (ramps, climb/conventional, leads, parking), and tiling.

### Decision

1. CNC router mode is adopted into the canon roadmap as **Phase H ("Router",
   v0.8)**, sub-phased H.0–H.10. The previously anticipated phases renumber:
   Marlin et al output strategies H→I, macOS/Linux desktop I→J (precedent:
   ADR-051 renumbered Marlin G→H when drawing tools took Phase G).
2. **All parsers are clean-room.** DXF, STL, and G-code (.nc) parsers are
   hand-written in `src/io/` — no parser libraries. clipper2-ts (already
   adopted) remains the only geometry dependency; no new runtime dependencies
   are planned for Phase H.
3. **Hardware verification targets the 4040 machine.** Every output-affecting
   sub-phase ends with an air-cut checklist executed by the maintainer;
   AUDIT.md rows stay CLAIMED until that evidence exists.
4. The laser non-negotiables extend to CNC with analogs: bounds check, origin
   honesty, no partial output, deterministic G-code (snapshot + fuzz), units
   honest, pure core — plus two CNC-specific invariants enforced on emitted
   text: **no XY rapid below safe Z** (`findPlungedTravelIssues`, shipped) and
   **no cut below stock bottom + 1 mm** (`findOverdeepCutIssues`, Phase H.1).

#### Standing 4040 air-cut protocol (referenced by every sub-phase)

Home → clamp scrap / set work XY zero → set Z zero ~30 mm above the
spoilboard (air gap) → feed override 50% → run the job end-to-end → verify:
retract before every travel, pass ordering (pockets/engraves before profiles,
inner before outer), spindle spin-up dwell before first plunge, correct park.
Log the result in AUDIT.md; only then may a row flip CLAIMED → VERIFIED.

### Alternatives considered

- **Thin Easel-parity clone.** Rejected — the maintainer wants LaserForge's
  own professional CNC surface; Easel is a reference point, not the spec.
- **Parser libraries for DXF/STL (`dxf-parser`, MIT etc.).** Rejected by
  maintainer mandate: clean-room everything. ADR-017 evaluation is therefore
  moot for Phase H parsers; it still applies if a geometry library is ever
  proposed.
- **Keeping CNC as an experimental side branch.** Rejected — an unmerged
  track rots against main and evades the governance the rest of the repo
  follows.
- **A separate CNC application.** Rejected — the Scene/Job pipeline, canvas,
  and GRBL streaming are shared; the discriminated `MachineConfig` union
  already isolates the differences cleanly.

### Consequences

- PROJECT.md gains the Phase H sub-phase table; DXF import moves in-scope
  (AI / PDF import stay out).
- WORKFLOW.md gains F-CNC flow IDs (F-CNC1–3 document the existing surface;
  F-CNC4–19 are reserved for the sub-phases).
- `CncPass` must become a discriminated union (contour | path3d) before
  variable-Z features land (H.1 tidy-first refactor).
- The G-code snapshot corpus grows CNC fixtures; CI time increases.
- Two machine families now share the UI; every layer-panel change must be
  checked in both modes.

### Verification

- Per diff: full CI gate (`pnpm test / lint / typecheck / format:check`);
  refactor diffs prove byte-identical G-code snapshots.
- Per feature: fast-check property tests (100 seeds) for each new invariant;
  perceptual tests (ADR-025 analytic-ground-truth pattern) for every
  geometric claim (V-carve depth field, relief terraces/scallops, pocket IoU).
- Per output-affecting sub-phase: the standing 4040 air-cut protocol above.

### Reversal triggers

- 4040 air-cut failures traced to compiled toolpaths (not machine setup) in
  two consecutive sub-phases → halt Phase H, re-audit the CNC core.
- The clean-room DXF parser cannot reach usable real-world compatibility
  within its sub-phase budget → revisit the no-library mandate via ADR-017.
- Maintenance burden: if CNC-attributable regressions in laser mode exceed
  ~1 per sub-phase, revisit the shared-UI decision.

## ADR-101 — CNC/laser UI separation policy: gate-and-hide

**Status:** Accepted
**Date:** 2026-07-02

> **Numbering note:** ADR-101 follows ADR-098 on this branch by design, not
> by accident. ADR-095–098 are reserved for the multi-controller track's
> renumbered ADRs and ADR-099 is the Phase-H collision resolution, both
> recorded on branch `claude/nice-fermat-55d508` (see
> `HANDOFF-CNC-2026-07-02.md` §2). Do not fill the gap.

### Context

ADR-098 chose one shared shell for both machine families and rejected a
separate CNC application. The CNC MVP and H.1–H.5 established a first
gating precedent — the Material Library hides in CNC mode, the
CncSetupPanel hides in laser mode, layer rows swap field sets — but the
command registry (`src/ui/commands/`) has zero machine-kind awareness. In
CNC mode today, the operator can invoke laser calibration generators
(Material/Interval/Scan-Offset/Focus tests), Fill Selection, Convert to
Bitmap, Trace, image-mask tools, and the Registration Jig; the per-object
Power Scale editor renders and silently does nothing (CNC compile ignores
`powerScale`); raster images import but are silently dropped by CNC
compile (`compile-cnc-job.ts` ignores `raster-image` objects by design);
and the right rail is laser-branded.

The maintainer decided (2026-07-02 session): laser-only surfaces hide in
CNC mode; there is no separate CNC workspace, no CNC-only shapes, and no
parallel CNC tools palette — shapes and text are machine-agnostic geometry
sources consumed by both compilers.

### Decision

1. **Policy — gate-and-hide.** A UI surface whose effect exists only in one
   machine family's output pipeline is *hidden* (not disabled) while the
   other family is active. Machine-agnostic surfaces — drawing tools, text,
   vector import, edit/arrange, preview, save — are never gated.
2. **The command registry gates at its single choke point.**
   `AppCommandContext` gains `machineKind`; `buildAppCommands` filters a
   laser-only ID set when the project machine is CNC
   (`src/ui/commands/machine-command-gate.ts`). All command surfaces (menu
   bar, toolbar, workspace context menu) already tolerate absent IDs, so
   hiding is uniform and shortcut dispatch is unaffected (no gated command
   has a hotkey). Laser-only set:
   - From the separation audit list: `tools.material-test`,
     `tools.interval-test`, `tools.scan-offset-test`, `tools.focus-test`,
     `tools.fill-selection`, `tools.convert-to-bitmap`,
     `tools.trace-image`, `tools.apply-image-mask`, `tools.crop-image`,
     `tools.remove-image-mask`, `tools.registration-jig`.
   - Same principle, beyond the audit list (each verified laser-only in
     the current tree): `tools.retrace-original` and
     `tools.multi-file-trace` (Trace family — the maintainer's directive
     hides "Trace" in CNC), `tools.adjust-image` and
     `tools.save-processed-bitmap` (laser Image-mode raster processing;
     CNC compile never consumes rasters), `tools.close-open-fill-contours`
     and `tools.close-fill-contours-with-tolerance` (Fill-mode repair),
     `tools.optimization-settings` (its only lever, `reduceTravelMoves`,
     is applied by `optimizePaths`, which passes `kind: 'cnc'` groups
     through untouched — verified in `src/core/job/optimize-paths.ts`).
3. **Laser-output-only object editors hide in CNC:** the per-object Power
   Scale input and image-adjustment editors
   (`src/ui/layers/SelectedObjectProperties.tsx`).
4. **Raster images stay importable in CNC mode** (maintainer's chosen fix):
   CNC preflight advisories gain a non-blocking warning when an
   output-enabled layer carries raster images, naming what is dropped —
   following the H.2 stock-footprint advisory pattern
   (`detectMachineJobWarnings`).
5. **Auto-focus hides in CNC mode.** *Provisional* — flagged for maintainer
   review: auto-focus is a laser focus routine; the CNC Z-zeroing flow
   arrives as its own H.7 surface.
6. **Device-profile laser-only fields hide in CNC mode:** the $30/$31/$32
   power range, air assist, scanning offsets (laser Image raster timing),
   and the autofocus command editor. *Provisional* — H.7 CNC machine
   profiles add the CNC counterparts. The connect-time Device Setup wizard
   keeps its laser steps for now (its firmware writes are individually
   confirmed, unlike the one-click path already gated in CNC); wizard
   behavior on a CNC connect is an open H.7 question.
7. **Shared chrome re-labels machine-aware** (right-rail heading, connect
   copy, "Estimated burn time" wording, "Laser:" shortcut hint, menu
   family label). The internal `'laser'` command-family key does NOT
   rename — only user-visible labels — to avoid churn across help topics
   and tests.
8. Relief-objects-in-laser-mode UX (warn/strip/block) is a separate
   decision, not part of this ADR.

### Alternatives considered

- **Disable-with-reason instead of hide.** Rejected — disabled laser
  concepts would still advertise themselves inside a router workspace; the
  maintainer chose hiding, extending the Material-Library precedent.
- **Per-surface filtering (menu, toolbar, context menu each filter).**
  Rejected — N surfaces × M commands drifts; one choke point in
  `buildAppCommands` cannot.
- **A separate CNC workspace.** Considered and rejected by the maintainer
  this session (re-affirming ADR-098).
- **Hiding raster import in CNC mode.** Rejected — the maintainer's
  separation audit chose a preflight advisory; images may still serve as
  visual reference, and projects opened from laser mode carry them.

### Consequences

- Every future command must be classified at birth: laser-only (add to the
  gate set), CNC-only (gate the other way when the first such command
  lands), or machine-agnostic. The gate module carries this checklist.
- Laser-mode behavior is byte-identical: the gate is an identity function
  for laser projects.
- WORKFLOW.md F-CNC1 documents the hidden surfaces; the PROJECT.md Phase H
  intro references this ADR between H.5 and H.6 (the maintainer-approved
  integrated build order).

### Verification

- Unit tests pin the gate: laser context exposes every command; CNC
  context hides exactly the laser-only set; machine-agnostic survivors
  present in both.
- Component tests for Power Scale and panel visibility in both modes;
  preflight advisory unit test.
- Full CI gate. No G-code change ⇒ no 4040 air-cut row (UI-only).

### Reversal triggers

- Operators report needing a hidden tool in CNC mode (e.g. Trace for
  cut-a-logo workflows) → revisit per-command with the maintainer.
- The laser-only set grows past ~25 entries → the shared-shell decision
  itself is under strain; re-open ADR-098's shared-UI clause.

## ADR-102 — three.js for the 3D relief viewer (explicit ADR-098 §2 override)

**Status:** Accepted
**Date:** 2026-07-03

### Context

Relief carving (H.4/H.5) renders on the canvas as a 2D grayscale depth
map. The maintainer approved a REAL 3D viewer for reliefs in the
2026-07-02 session, with the explicit condition that it stay blocked
behind this ADR: ADR-098 §2 says "no new runtime dependencies are planned
for Phase H," and a WebGL scene graph is exactly the kind of wheel the
clean-room mandate does not extend to — hand-rolling camera math, depth
buffers, and lighting is weeks of risk for zero product differentiation.

### Decision

1. Adopt **three.js** (MIT) as a runtime dependency, explicitly overriding
   ADR-098 §2 for this one library. The clean-room mandate is about
   PARSERS and GEOMETRY (data fidelity we must own); presentation is not
   canon-critical.
2. **three.js is UI-only.** It may be imported beneath
   `src/ui/relief-viewer/` and nowhere else — never in `core/` or `io/`.
   clipper2-ts remains the only geometry dependency of the core. The
   heightmap→mesh conversion stays a PURE core function returning plain
   `Float32Array`s (positions/indices/normals feed three's BufferGeometry
   at the UI boundary), so the viewer's geometry is testable without
   WebGL.
3. **Lazy-loaded.** The viewer dialog imports three via dynamic
   `import()` so the ~150 KB gzip lands in its own chunk and the base
   bundle is unchanged until the first 3D view opens.
4. Environments without WebGL (jsdom, headless CI) get a graceful
   fallback message, which is what component tests assert.

### Alternatives considered

- **Clean-room WebGL viewer.** Rejected — violates the spirit of
  ADR-017 (don't rebuild commodity infrastructure); high defect surface.
- **Keep the 2D depth map only.** Rejected by the maintainer — a relief
  workflow without a 3D read of the carve is guesswork.
- **babylon.js.** Heavier, Apache-2.0, no advantage at this scope.
- **regl / raw-gl wrappers.** Lighter but shifts scene/camera/lighting
  boilerplate back onto us.

### Verification

- RESEARCH_LOG.md dependency row (version, license re-verified) — CI
  cross-checks package.json against it.
- Pure mesh-builder unit tests against analytic heightmaps; component
  fallback test in jsdom; full gate.
- Visual check of the rendered relief in the isolated preview browser.

### Reversal triggers

- Bundle-size or supply-chain audit flags three.js → replace the viewer
  with a static isometric canvas projection (pure core, no dependency).


## ADR-103 — Market-parity build-out: sender workflows, vector booleans, 3D cut preview (2026-07-03)

**Status:** accepted (maintainer session directive). Individual G-items
marked PROVISIONAL where this session applied judgment; review welcome.

### Context

Maintainer directive: "build a full working CNC app with everything the
best CNC app on the market has." The grounded comparison
(`audit/reports/cnc-market-gap-audit-2026-07-03.md`, researched against
VCarve 12 / Easel / Carbide Create+Motion / gSender 1.6 / OpenBuilds)
shows the post-Phase-H CAM core is competitive, and the remaining
table-stakes (T1) and differentiator (T2) gaps cluster in sender
workflows, vector editing, and 3D visualization. Per CLAUDE.md, scope
lands here before code.

### Decision — build now (Phase H.11, in priority order)

- **G1. Vector booleans + offset.** Union / subtract / intersect /
  exclude on selected closed paths, plus inward/outward offset with a
  distance field. Implemented on **clipper2-ts, already the approved
  geometry dependency** (ADR-098 §2) — this deliberately supersedes the
  Phase-G note that deferred the "geometry kernel" to a future
  evaluation: the evaluation happened (ADR-017 pattern) when clipper2
  was adopted for pockets/v-carve; booleans use the same engine. Weld
  = union. Node-level editing beyond this stays future work.
- **G2. Probing wizard.** Guided touch-plate probing: **Z** (plate
  thickness compensated) and **XYZ corner** (plate edge offsets + bit
  diameter). Two-stage G38.2 (fast seek, retract, slow re-probe),
  `G10 L20` work-offset zeroing, ALARM:4/5 decoded, Idle-only
  preflight, 30 s watchdog. PROVISIONAL defaults: seek 150 mm/min,
  re-probe 25 mm/min, retract 2 mm, max travel 25 mm.
- **G3. Real-time overrides.** GRBL 1.1 realtime bytes: feed
  0x90–0x94, rapid 0x95–0x97, spindle 0x99–0x9D, surfaced as
  +/-10 / +/-1 / reset controls during a running job, with the live
  `Ov:` values from status reports shown when present. Machine-agnostic
  (GRBL overrides apply to laser jobs too).
- **G4. General 3D cut preview.** The H.2 material-removal grid
  rendered as a shaded heightfield in the ADR-102 three.js viewer for
  ANY CNC job (not just reliefs). UI-only, same lazy chunk, same jsdom
  fallback.
- **G5. Feeds & speeds calculator.** Chipload-based: RPM x flutes x
  chipload = feed; plunge as a percentage; starter chipload chart
  (softwood / hardwood / plywood-MDF / acrylic / aluminum x bit
  diameter bands) with every value editable. Writes into the layer
  card; composes with H.7 presets. PROVISIONAL: chart values are
  industry-typical starting points, clearly labeled as such.

### Stretch (build if session capacity allows, same rules)

- **G6. Dogbone / T-bone corner fillets** for interior square corners.
- **G7. Start-from-line job recovery** (gSender-style, with safe-Z
  preamble reconstruction).
- **G8. Spoilboard surfacing generator** (pure G-code wizard).

### Explicit roadmap — NOT silently skipped (each needs its own ADR)

Arc/curved text; system-font import; drag-placeable tabs; pocket raster
strategy + pocket rest-machining; v-carve inlay automation; macros /
quick actions; keymap editor + gamepad; remote mode; diagnostics
dashboards; G2/G3 arc **output**; adaptive clearing; nesting; rotary;
two-sided; thread milling; photo/sketch carve; keep-out zones; firmware
flashing. The standing "do not market as Easel-equivalent" directive
stays until the maintainer lifts it.

### Constraints carried over

ADR-098 §1/§3 unchanged: clean-room, no new runtime deps (G1–G8 add
none; G4 reuses ADR-102's three.js), every output-affecting feature
lands CLAIMED until a 4040 air-cut. Defaults must keep existing G-code
byte-identical; the one intentional exception is the **CNC banner fix**
(the laser-worded `$32=1` header line in router exports — an E2E-run
defect), which will carry the snapshot acknowledgment line.

### Verification

Per feature: unit + property tests, WORKFLOW.md flows (success / error /
empty / edge) before UI, full gate per commit, isolated-preview
perceptual pass where renderable, AUDIT.md CLAIMED rows with named
pending hardware checks.

## ADR-104 — Integration numbering: controllers keep 094–097 + Phase I; CNC renumbers to 098/101/102/103 + keeps Phase H (2026-07-03)

**Status:** accepted (recorded at the merge of `claude/determined-dewdney-7ec915` into `main`).

### Context

Two Phase H tracks were built in parallel off pre-Phase-H mains: the CNC
router track (ADR-094 = CNC scope on its branch) and the multi-controller
track (ADR-094–097 = driver seam/Marlin/Smoothie/Ruida). An earlier
resolution (ADR-099, drafted on the controller branch but never landed)
gave CNC the 094 number — however the controller track merged to `main`
FIRST, publishing 094–097 and (via the trace rebuild) ADR-100. Published
numbers win.

### Decision

- Controller ADRs keep **094–097** as published on `main`; the trace
  rebuild keeps **ADR-100**. The controller product phase is relabeled
  **Phase I — v0.9 "Multi-controller"** in PROJECT.md (its WORKFLOW flow
  IDs keep their original F-H prefix).
- The CNC track keeps the product label **Phase H — v0.8 "Router"** and
  its ADRs renumber at integration: CNC scope 094→**098**, gate-and-hide
  100→**101**, three.js 101→**102**, market-parity 102→**103**. Every
  in-tree reference was swept in the merge commit; pre-merge commit
  messages retain the old numbers (immutable history — read them against
  this table).
- ADR-099 is retired unused; the number stays reserved to avoid a third
  meaning. Next free ADR: **105**. *(Running update — published since:
  ADR-105 Easel-parity pack, ADR-106 box generator, ADR-107..110 Camera
  Mode v1..v4 — next free ADR: **111**.)*

## ADR-105 — Easel-parity UX pack: persistent 3D pane, pocket raster fill, bundled design library (2026-07-03)

**Status:** accepted (maintainer directive: "make sure that we have
everything Easel has and more"). Grounded by
`audit/reports/easel-1v1-comparison-2026-07-03.md`.

### Decisions

- **G9 — persistent 3D pane.** A docked, collapsible right-side pane in
  CNC mode renders the simulated cut result (stock + removal heightfield,
  the ADR-102 scene) LIVE while designing — Easel's split-view. The pane
  computes a coarse toolpath + removal grid outside Preview mode,
  debounced per edit; Preview mode reuses the scrubbed preview grid.
  UI-only; compile/emit untouched.
- **G10 — pocket raster fill.** `CncLayerSettings.pocketStrategy?:
  'offset' | 'raster-x' | 'raster-y'` (absent = offset, byte-identical
  output). Raster pockets inset the region by the bit radius (clipper2),
  hatch it with serpentine sweeps at the layer stepover, and finish with
  the innermost perimeter ring per depth pass — Easel's Fill Method
  offset/raster X/raster Y.
- **G11 — bundled design library.** A curated, LOCAL starter library
  (Easel's cloud "3M designs" is out of scope for a local-first app):
  `lucide-static` (ISC — MIT-compatible per ADR-017) provides the icon
  corpus; a manifest bundles a curated subset by category into a Library
  dialog that inserts through the existing SVG import pipeline. Larger
  art: users import SVGs from CC0 sources (openclipart et al) — the
  dialog links the guidance. PROVISIONAL curation; growable.
- **Explicitly NOT gaps (answering the drivers question):** Easel Driver
  exists because a cloud page cannot reach serial ports; KerfDesk talks
  WebSerial directly (browser) / native serial (Electron) — no agent to
  install. FTDI/CH340 USB-UART drivers are OS/board-level, identical for
  every sender. Post-processors: external CAM (Vectric/Fusion) targets
  us with their stock GRBL post; running such files live is roadmap
  (G12, external-program streaming — the simulator already re-imports
  them read-only).

### Verification

Unit tests per feature; raster-fill coverage/no-gouge checks; jsdom
fallback for the pane; license-check green with the new dependency;
full gate per commit. Hardware remains CLAIMED per ADR-098 §3.

## ADR-106 — Parametric finger-joint box generator: claim-model joinery (2026-07-03)

**Status:** accepted (maintainer-approved build plan, 2026-07-03).
**Numbering note:** drafted as ADR-105 on the box-generator branch, but
the Easel-parity pack published 105 on `main` first — published numbers
win (ADR-104 precedent). Pre-merge commit messages on
`claude/relaxed-liskov-0df88b` say ADR-105; read them as this ADR.

### Context

Operators want cut-ready finger-joint boxes for both laser and CNC
router modes. A previous attempt failed because the 2D panel math did
not encode the 3D assembly: panels rotate 90° into place, material
thickness eats into each mating panel, and the cutting process (laser
kerf / endmill radius) changes fit. Behavior research on MakerCase
(reverse-engineering study) and boxes.py (docs only — GPL, no code
copying per ADR-017) isolates the two classic failure classes this
design is built around:

1. **Corner conflicts.** Three panels meet at each cube corner; naive
   per-edge tab math either double-claims the T×T×T corner cube (parts
   collide — cannot assemble) or never claims it (visible hole).
   MakerCase's own study lists corner fillers as a known deferred gap.
2. **Fit compensation applied wrong.** Kerf widening done per-tab
   instead of as a uniform contour offset, or CNC interior corners left
   square so square tabs cannot seat (missing relief).

### Decision — own math, built against those two failures

- **One sequence per cube edge.** Each of the 12 cube edges is shared
  by exactly two panels. Per edge ONE alternating cell sequence is
  computed — odd cell count `n` = largest odd ≤ span/targetFingerWidth,
  clamped ≥ 3 (`1` for tiny spans), cell width `f = span/n` — and BOTH
  panels derive material ownership from that one sequence: A owns
  exactly what B does not. Complementarity holds by construction;
  both-tabs / neither-tab is unrepresentable. Odd count ⇒ symmetric ⇒
  opposite panels stay interchangeable.
- **Corner rule.** Each of the 8 T×T×T corner cubes has exactly one
  claimant: global axis priority **Z > Y > X** (top/bottom > front/back
  > left/right) among *present* panels. Open-top: corner cells that
  would belong to the missing top fall to the next-priority panel.
- **Outline walk.** Panel outline = closed rectilinear polygon walked
  from claims: boundary at the outer face line where a cell is owned,
  recessed by T where the mate owns it. No holes in v1 (dividers later).
- **Fit — division of labor (nothing duplicated).** Laser beam width
  stays in per-layer kerf compensation (`kerf-offset.ts` at compile;
  nominal = line-to-line press fit — LightBurn parity: kerf lives in
  cut settings, not the drawing). CNC cutter compensation stays in
  `profile-paths.ts` (`profile-outside`). The generator bakes exactly
  two things:
  1. **Clearance `c`** (signed, + = looser; default 0 laser = press
     fit, 0.15 mm CNC = glue fit): every panel polygon offset by −c/4
     via `offsetClosedPolylinesForKerf`. Derivation (corrected at S2
     from an earlier −c/2 draft): a uniform inward offset δ narrows
     every tab by 2δ AND widens the mating recess by 2δ, so joint play
     = 4δ; the contract is play == c, hence δ = c/4 — tabs narrow c/4
     per flank, recesses widen c/4 per flank, notch − tab = c exactly,
     uniformly. Never per-tab arithmetic.
  2. **CNC corner relief** in the shipped F-CNC26 corner-overcut
     convention (`dogbone.ts` precedent): a circle of one bit RADIUS
     centered ON the seat-critical reflex corner vertices, subtracted
     from the panel. The generator knows which corners mate, so it
     relieves exactly those (not `dogboneVectorObject`, which unions
     circles into cutout regions and blankets all sharp corners).
     **Ordering pinned: clearance offset FIRST, then reliefs at full
     bit radius** — offsetting after would shrink reliefs below tool
     diameter. Laser mode: no reliefs.
- **Modules.** Pure core `src/core/box/` (box-spec, edge-pattern,
  panel-claims, panel-outline, panel-fit, layout, generate-box) — NOT
  `core/shapes` (its index is at export capacity). UI `src/ui/box/`
  (dialog + canvas preview). Insertion wraps panels into ordinary
  `kind:'shape'` polyline objects via the existing `createPolyline`
  (ids injected UI-side via `crypto.randomUUID()`, ONE undo step,
  `ensureLayersForColors`, all inserted panels selected, ungrouped).
  Compile/preview/emit untouched; zero G-code snapshot churn.
- **Validation.** Pure `Result`-style union, no throws: dims/T > 0;
  inner dims stay positive when derived; finger width clamped to
  [max(2mm, T), span/3]; CNC: `f > toolDiameter` (error) and warn when
  `f < 2·toolDiameter`; `|c| < min(f, T)/2`. Violations →
  `{ kind:'invalid', issues }` rendered in the dialog; generation
  disabled.
- **v1 scope.** Closed 6-panel + open-top 5-panel; inner dimensions
  default (what the contents need), outer via toggle. Deferred as
  staged follow-ups: lids (slide/hinged), dividers, engraved panel
  labels (needs the io/text pipeline — unreachable from pure core),
  dogbone/T-bone relief styles (same future-refinement note as
  `dogbone.ts`).

### Verification (green structural tests ≠ fit — CLAUDE.md rule 2)

1. **Virtual 3D assembly referee** (fast-check, 100 runs, predicates in
   `src/__fixtures__/property/`): map each derived panel polygon into
   box coordinates via its placement (this encodes "panels turn
   sideways"), extract both panels' exact 1D occupancy intervals along
   each shared edge band — computed from the OUTPUT polygons, not the
   internal claim model. Assert: nominal ⇒ exactly complementary (zero
   overlap, zero gap); with clearance ⇒ uniform play ≈ c within 2·10⁻³
   (clipper rounds to 3 decimals), never interference; each cube corner
   has exactly one claimant (closed box). Fuzz: W,D,H ∈ [20,600],
   T ∈ [1,25], finger ∈ [1.5T,5T], open/closed, c ∈ [0,0.5].
2. **Invariants:** assembled outer bbox == outer dims exactly; every
   polygon simple and closed; reliefs only at reflex corners, only when
   CNC, diameter == tool diameter; determinism (same spec ⇒
   JSON-identical output — core has zero RNG).
3. **Perceptual fixture** (ADR-025 harness): render the generated sheet
   for a canonical spec; IoU vs analytic expectation + opt-in PNG
   artifact for human eyeballing.
4. **Hardware:** physical fit is NOT software-verifiable — the feature
   lands CLAIMED per AUDIT.md convention with a named pending check:
   cut a 60×40×30 mm, T=3 box on the Falcon (laser) / 4040 (router)
   and assemble it.

---

---

## ADR-107 — Camera Mode: overhead-camera alignment (manual 4-point homography v1; staged v1–v4)

**Status:** Accepted; staged in small PRs. | **Date:** 2026-06-27

> Numbering note: authored on `claude/camera-mode-v1` as ADR-094/095 (then the next
> free slots above the build plan's ADR-054..091 reservation). Merged after ADR-104's
> integration renumbering had assigned 094–104 to the controller/CNC tracks, so —
> following the ADR-104 precedent — the camera ADRs renumber on merge: v1 = ADR-107,
> v2 = ADR-108; v3 / v4 reserve ADR-109 / ADR-110. Pre-merge commit messages retain
> the old numbers (immutable history — read them against this note).
> Renumbered AGAIN at the main merge: origin/main had published ADR-105
> (Easel-parity pack) meanwhile — published numbers win (ADR-104) — so the
> camera ADRs were then v1=106..v4=109 — and renumbered a THIRD time when the
> Phase K box generator published ADR-106: final numbers v1=ADR-107,
> v2=ADR-108, v3=ADR-109, v4=ADR-110.

### Context

`PROJECT.md` listed "Camera alignment, overhead camera" under Out of scope; the maintainer
requested it. LightBurn's camera (capture → lens calibration → 4-marker alignment → live
overlay → print-and-cut → capture-to-trace) is the behavioral reference. Competitor source
was read directly: MeerK40t `camera.py` (`cv2.getPerspectiveTransform` from four manually
dragged corners, no RANSAC), Rayforge (capture-to-trace, `findHomography` with an image
y-down → bed y-up flip), OpenPnP (fiducial detection + intrinsic calibration). An adversarial
second audit verified the math against that code and found no errors.

The decisive constraint is the < 1 MB compressed web-bundle target (ADR-017): OpenCV.js
(~8–10 MB WASM) is ~10× the budget. The CV math actually required is small — a 4-point
homography is an 8×8 linear solve; Brown–Conrady undistort and inverse-homography rectify are
each a few dozen lines — and hand-rolls to ~150–250 LOC of pure TypeScript.

### Decision

1. **Hand-rolled pure-TS CV in a new `src/core/camera/` module — no OpenCV.js.** Rejected on
   bundle size, not licence (OpenCV.js is Apache-2.0, which is permitted). RANSAC (v3) injects
   its RNG per the pure-core no-random rule.
2. **Capture via a new `CameraAdapter` on `PlatformAdapter`** (`getUserMedia` / enumerate /
   stream), mirroring the existing `SerialAdapter` contract (`isSupported` / request,
   AbortError → null). Electron is Chromium, so one web code path serves web and desktop.
3. **v1 live overlay via CSS `matrix3d`** (the GPU performs the perspective divide; Canvas2D is
   affine-only and physically cannot warp). `matrix3d` covers the homography only — distortion
   correction (v2) cannot ride it and its live-undistort tech (WebGL shader / CPU remap /
   still-path-only) is resolved at v2.
4. **v1 alignment = manual 4-point homography** (matches LightBurn and MeerK40t: exact 8-DOF,
   no RANSAC). **Alignment targets are laser-engraved** at known machine coordinates, reusing
   the registration-jig engrave machinery (ADR-057). Fiducial auto-detection is deferred to v3;
   `js-aruco` / `js-aruco2` are rejected because their bundles include LGPL-v3 code.
5. **Calibration persists as a `readonly` optional field on `DeviceProfile`** (sibling of
   `scanningOffsets`; additive normalize in `deserialize-project.ts`; no `schemaVersion` bump).
   In-progress calibration drafts use the existing `localStorage` calibration-draft pattern.
6. **Staging:** v1 overlay + manual 4-point (this ADR) → v2 Brown–Conrady lens calibration
   (ADR-108) → v3 fiducial auto-align + 2-point print-and-cut (ADR-109) → v4 capture-to-trace
   reusing the existing trace pipeline (ADR-110). Each phase ships as its own small PR set.

### Consequences

- New pure-core module `src/core/camera/`; new `src/platform/web/web-camera.ts`; new
  `src/ui/camera/` (overlay + alignment panel) and a camera Zustand slice; one `readonly`
  field on `DeviceProfile`. No new runtime dependency; v1 bundle impact ~< 10 KB.
- The camera frame is a UI/IO concern only — core never generates it. The existing
  `drawBitmapAtTransform` / `view-transform` machinery and the registration-jig drag panel are
  reused rather than reinvented.

### Verification

Pure-core property and unit tests prove the math (four-correspondence round-trip, degeneracy
rejection, y-flip consistency) and run in CI. **They do not prove the overlay lands on the
real bed** — per CLAUDE.md rule 2 (green math ≠ fidelity), accuracy is verified on a physical
USB camera over a real machine (available to the maintainer): engrave the four targets, align,
and confirm a placed object burns where the overlay showed it. The y-flip *direction* can only
be confirmed against a real capture (a self-consistent pure test shares the flip and cannot
catch a mirror). A golden-image regression fixture (the ADR-025 perceptual harness) built from
a one-time real capture guards the math thereafter. The zero-install web target requires an
https / secure context or `getUserMedia` silently fails.

### Out of scope for v1

Lens distortion correction (v2), fiducial auto-detection (v3), capture-to-trace (v4), and
non-Chromium (Firefox) `OffscreenCanvas` fallbacks — tracked by ADR-108 / 109 / 110.

---

## ADR-108 — Camera Mode v2: fisheye lens calibration + de-fisheye render

**Status:** Accepted; staged in small PRs. | **Date:** 2026-06-28

### Context

The Falcon A1 Pro (like most laser bed cameras) uses a wide-angle lens, so the live feed
is visibly barrel-bowed. The ADR-107 4-point homography corrects perspective only — it
pins the four corners but cannot remove lens curvature, so straight bed edges stay curved.
A camera-implementation study (MeerK40t, OpenPnP, LightBurn, Rayforge, LaserWeb4, OpenCV)
confirmed the universal fix: a lens-distortion model applied to the frame **before** the
homography.

Licensing (ADR-017/018): GPL/AGPL apps (OpenPnP, LaserWeb4) may be **studied** but not
vendored; only MIT/BSD/Apache code may be copied. OpenCV.js (the build) is excluded on
bundle size (ADR-107), not licence — and the distortion math is not copyrightable, so the
equations are clean-roomed in TypeScript from the published Kannala-Brandt model.

### Decision (maintainer-chosen, 2026-06-28)

1. **Model: Kannala-Brandt fisheye** (θ-polynomial, k1..k4), not Brown-Conrady. It stays
   well-behaved at the wide field angles where Brown-Conrady's r⁶ term diverges; MeerK40t
   uses exactly this (`cv2.fisheye`) for the same hardware class. Pure-TS forward
   (`θ_d = θ(1 + k1θ² + k2θ⁴ + k3θ⁶ + k4θ⁸)`) plus a Newton inverse.
2. **Calibration: guided board.** Print a checkerboard, capture ~5 poses (4 corners +
   centre) with a per-capture reprojection-error score (LightBurn) and per-quadrant
   coverage feedback (Rayforge); fit K (fx,fy,cx,cy) + D (k1..k4) with an in-TS
   Levenberg-Marquardt minimiser over reprojection error. ChArUco is rejected — its ArUco
   decode needs an LGPL bundle barred by ADR-107; a plain checkerboard detects clean-room.
3. **Render: WebGL fragment shader.** The inverse-distortion sampling runs per-pixel on the
   GPU (LaserWeb4 proves `regl` does this < 1 MB, no OpenCV); output→input sampling so a
   rectified output pixel reads the distorted source. Supports live UVC video, not only the
   polled still.
4. **Order:** capture → de-fisheye → 4-point homography (ADR-107) → overlay. The homography
   now runs on rectified pixels. K + D persist on the readonly `DeviceProfile` field ADR-107
   reserved.

### Staging

v2.a fisheye math (pure core) · v2.b checkerboard detection (pure, `ImageData` in) ·
v2.c LM intrinsic solver (pure — the highest-risk port) · v2.d WebGL undistort shader ·
v2.e calibration wizard UI (capture poses, coverage + error score, and an OpenPnP-style
A/B "Apply Calibration?" toggle). Each is its own small PR.

### Consequences

- New pure-core `src/core/camera/{fisheye,checkerboard-detect,calibrate}.ts`; a new WebGL
  renderer and calibration wizard in `ui/camera/`. No new runtime dependency; the math is
  clean-roomed from the published Kannala-Brandt model and OpenCV/glfx equations (referenced,
  never copied).
- Once distortion is on, the overlay moves off pure CSS `matrix3d` (which cannot carry lens
  curvature) to a composited undistort→homography frame.

### Verification

Pure tests prove the math (distort/undistort round-trip; the LM solver recovers a known
K/D from synthetic board poses). Per CLAUDE.md rule 2, green math is **not** a straight real
image: an A/B "Apply Calibration?" toggle (OpenPnP) lets the operator **see** the bed edges
straighten on the real Falcon, and a golden frame guards regressions (ADR-025). Physical
straightness is hardware-verified, not asserted by a green suite.

### v2.c as-built (2026-06-28)

The LM intrinsic solver shipped as pure-core modules in `src/core/camera/` — all internal
except the single public entry point `calibrate(views, options?)`: `levmar` + `levmar-kernel`
(generic central-difference Levenberg-Marquardt with Marquardt damping), `rodrigues`
(axis-angle ↔ matrix, incl. the near-π log-map branch), `lm-params` (flat parameter packing),
`calibrate-residuals` (reprojection residuals; behind-camera corners masked inactive, not
penalised), `init-guess`, `calibrate` + `calibrate-metrics`, and the `calibrate-fixtures`
synthetic oracle (its own independent Rodrigues so a transposition bug cannot self-cancel).

Decisions made during the build (deviating from / refining the draft design):

- **Init = robust fisheye seed, NOT Zhang's pinhole closed-form.** `B = K⁻ᵀK⁻¹` factorises a
  negative/imaginary focal under Falcon-class barrel distortion, so K is seeded from the
  device-nominal focal (`0.7·imageWidth` default, or a measured `options.initialGuess`), D=0,
  and only the per-view R/t are taken from a homography decomposition (forced `t.z>0`,
  Gram-Schmidt orthonormalised). The wrong-K basin test confirms LM crosses to truth.
- **`behind-camera` failure reason dropped.** The `t.z>0`-forcing seed makes a whole-board
  behind-camera result unreachable; shipping the reason would be dead code. Reachable failures:
  `too-few-views | too-few-points | rank-deficient | no-convergence`.
- **Karpathy finding — noise overfits the high-order terms.** Zero-noise synthetic recovery is
  machine-precision for K and D from both a good and a wrong-K init. But under 0.2px detection
  noise the reprojection RMS stays low (~0.15px) while the weakly-observed `k3,k4` overfit to
  absurd values (e.g. k3 ≈ 200). **v2.e must add a coefficient-sanity bound + an RMS gate and
  prefer more poses/points; a low RMS alone does not mean a usable calibration.**

### v2.d as-built (2026-06-28) — render path refines decision #3

Shipped pure-core, all verified: `rectify-map.ts` (per-pixel output->input sample point, the
math the renderer mirrors), `cpu-rectify.ts` (bilinear-sampled de-fisheye over an RGBA buffer),
`camera-calibration.ts` (the persisted `CameraCalibration` type + an untrusted-JSON normaliser),
and a new optional `cameraCalibration?: CameraCalibration` on `DeviceProfile` (the ADR-107 #5 /
ADR-108 #4 "reserved" field — it did NOT exist in code; this closes that doc-vs-code drift),
normalised in `deserialize-project.ts` (override, not merge, so a malformed value is dropped).

**Render refinement (flag for the maintainer).** Decision #3 chose a WebGL fragment shader,
justified by "supports live UVC video." But the Falcon A1 Pro is a **polled network still**
(`getCapturePhoto`, ~1.5 s cadence), not 60fps video — so the tested CPU rectify (one pass per
polled frame) is adequate AND is the no-WebGL fallback the ADR already required. Building an
unverifiable GPU shader now would violate CLAUDE.md rule 2 (no "works" without perceptual proof).
**As-built: ship the CPU rectify as the v2 render path; defer the WebGL shader to a live-video
optimisation if/when a UVC camera is supported.** The maintainer can override this back to
WebGL-first; recorded here rather than silently swapped.

**Karpathy proof (no hardware needed).** `cpu-rectify.test.ts` distorts a known smooth scene
through the forward KB model, rectifies it back, and confirms reconstruction to <6 grey levels
over the interior — proving the de-fisheye *pipeline* straightens curvature. What remains
hardware-gated is only whether the **real Falcon lens matches the calibrated model**, surfaced by
the v2.e A/B "Apply Calibration?" toggle on a real captured frame.

**FOV tradeoff.** The rectify uses `outputK === sourceK` (the `outputK` parameter is separate so a
future widened "new camera matrix" can be slotted in). This trades ~7–8% of peripheral field for a
border-free overlay — the same default MeerK40t/LightBurn use. The v2.e wizard copy should mention it.

### v2.e as-built (2026-06-28) — trust gates + capture session (pure core); UI handed off

Shipped pure-core, all verified: `calibration-trust.ts` (`assessCalibrationTrust` flags implausible
KB coefficients `|k|>1`, RMS `>1.5px`, or a near-empty image quadrant — the gate that catches the
v2.c k3/k4-overfit a low RMS would otherwise hide), `pose-diversity.ts` (`checkPoseDiversity` —
geodesic rotation spread; rejects the 5-near-identical-shots focal/depth-ambiguity trap),
`resolution-match.ts` (`frameMatchesCalibration` + `scaleIntrinsicsToFrame` for apply-time frame
rescaling), and `calibration-session.ts` (the wizard's pure reducer: collect → solve → assess).

**Reduced distortion model.** `CalibrationOptions.distortionModel: 'k1k2' | 'k1k2k3k4'` (default
full; a string union, not a boolean per CLAUDE.md). `'k1k2'` freezes `k3=k4=0` via a new generic
`LevMarOptions.fixedIndices` (the param's Jacobian column is zeroed, so the damped step never moves
it). The wizard should default to `'k1k2'` for low-angular-coverage Falcon captures.

**Two solver behaviour changes (decisions, recorded):**
- **LM terminates on a damping explosion.** A sustained reject streak drives λ past `LAMBDA_MAX`
  → the step is negligible → we are at a minimum → `converged: true`. The absolute gradient stop is
  too tight to catch a nonzero-cost (reduced-model) minimum at pixel scale.
- **`calibrate()` returns a best-effort fit on non-convergence, not a hard failure** — OpenCV/
  MeerK40t behaviour, resolving the v2.c audit's concern that `converged:false → 'no-convergence'`
  wrongly rejects usable fits. `'no-convergence'` now means only a genuinely blown-up (non-finite)
  LM run. The wizard's trust check, not the solver, judges usability.

**Conditioning finding (honest).** For a narrow-FOV planar board (θ ≈ 0.12 rad here) even `k1,k2`
are weakly observable and trade off under noise (e.g. k2 → 1.0 while RMS stays ~0.15px) — the same
Karpathy lesson one order down. This is inherent to narrow-FOV planar calibration, not a solver bug;
`assessCalibrationTrust` is the backstop. Wider angular coverage (more board tilt/closer board) is
the real remedy, which the pose-diversity + coverage gates nudge the operator toward.

**Handed off (hardware-gated, NOT built).** The wizard's React UI + live camera/canvas wiring —
polling Falcon frames, detecting the checkerboard and feeding `BoardObservation`s, rendering
coverage/RMS/trust, and the A/B "Apply Calibration?" overlay (`rectifyImage`) — needs the
maintainer's real Falcon to build and verify (CLAUDE.md rule 2 perceptual proof, rule 4 side-effect-
free). The session/solve/assess/persist (`toCameraCalibration`) and de-fisheye (`rectifyImage`)
dependencies are all shipped and exported. **One pure piece is deliberately NOT shipped: a
checkerboard GRID DETECTOR.** `refineCornerSubpixel` only *refines* an already-located corner; finding
the grid in a real frame (the hardest pure-CV step) is part of the handed-off work, best built and
tuned against real Falcon captures.

**v2.e audit fixes (post-audit, all gated).** The trust gate now also inspects the intrinsics it
gates (`intrinsics-implausible`: non-positive/non-finite focal, or a principal point thrown far
outside the frame) — a degenerate-but-finite K with a low RMS no longer reads "trusted".
`CalibrationResult.ok` now carries `converged: boolean` + a typed `exit` (`tolerance` |
`iteration-cap` | `damping-stall`) so the wizard can warn before applying a best-effort fit; the
LM damping-stall stop is now `converged:false` (a stall is not a tolerance stop). Non-finite
distortion coefficients are flagged explicitly, `scaleIntrinsicsToFrame` guards non-positive frame
sizes, and the pose-diversity floor is documented as provisional + overridable.

### v2.b as-built (2026-07-03) — checkerboard auto-detection ships; focal sweep added

The handed-off GRID DETECTOR is now shipped as pure core, closing v2.b: `gray.ts`
(RGBA→luma), `xcorner.ts` (a clean-room centrosymmetry ring response — 16 taps at
radius 3; alternation across 90° minus an opposite-sample edge penalty — plus
non-max suppression), `grid-lattice.ts` (seed at the candidate nearest the cloud
centroid, basis from its two non-collinear nearest neighbours, then BFS integer-
lattice growth with second-order local extrapolation, full-window extraction and a
deterministic orientation), and `detect-checkerboard.ts` (orchestration + sub-pixel
refinement + `checkerboardObjectPoints`/`toBoardObservation` for the session).

**Verification (per CLAUDE.md rule 2, no hardware needed for this layer).** The
harness RENDERS frames through the forward KB model (`board-render-fixtures.ts`:
undistort each pixel to a ray, intersect the board plane, supersampled checker
shading) and detection runs on pixels alone: 54/54 corners on all seven test poses
(mean error < 0.4 px, matched bijectively against projected truth), robust to
sensor-scale noise, typed failures on blank/cut-off frames, and an end-to-end run
whose detections calibrate back to the true camera. A rendered A/B (distorted grid
with detections marked vs. de-fisheyed with the AUTO-recovered fit) was visually
confirmed straight. What remains hardware-gated is only real-Falcon frames
(lighting, blur, real sensor noise) via the wizard's live view.

**Solver finding (measured) + focal sweep decision.** From the default focal seed
(0.7·width) on detected corners, LM crawls the flat focal↔k1k2 valley: fx error
was still ~22% after 300 iterations, ~12% after 800, ~4% after 3000 — while the
same data seeded near the true focal settles in a few hundred (fx to ~1%). The
audited solver is left untouched; instead `calibrate-sweep.ts` adds
`calibrateWithFocalSweep()`: five short probes at fx/width ∈ {0.45, 0.55, 0.7,
0.9, 1.2}, keep the lowest-RMS basin, polish that seed with the caller's budget.
`solveSession` now routes through it, and it degrades to exactly one `calibrate()`
call when the caller supplies a measured focal. Corollary (also measured): the
step/cost tolerances are tight enough that realistic solves end `iteration-cap`
while micro-improving — the wizard must treat `iteration-cap` + trusted-gate-pass
as normal, not as a warning state, and should pass a generous `maxIterations`
(hundreds; a solve is seconds, cost scales with corners not pixels). Individual
K/D parameters remain only weakly identifiable on planar targets — acceptance is
judged on the fitted MAPPING (and the A/B view), not parameter closeness.

### Overlay wiring as-built (2026-07-03) — alignment persists; workspace overlay mounts

The beta exported `CameraOverlay` but never mounted it, and the solved
homography lived only in the ephemeral camera store — F-CAM1's "saved to the
device profile" promise was doc-vs-code drift. Closed by: a persisted
`cameraAlignment?: CameraAlignment` on `DeviceProfile` (`camera-alignment.ts`
normalizer, same untrusted-JSON discipline as `cameraCalibration`; the type
records the pixel `basis: 'raw' | 'rectified'` because composing a rectified
frame with a raw-basis homography would silently mis-register), an explicit
"Save & show on canvas" action in the aligned Falcon view, and
`WorkspaceCameraOverlay` mounted as a canvas-area sibling that re-computes the
canvas's own fit-to-bed view from its measured box (Workspace is untouched).
Overlay sources: a captured still (LightBurn's Update Overlay model, the
accurate default-to-be once rectified alignment lands) or the continuous live
video; panel controls cover show/hide + fade + still/live. Material-thickness
shift compensation and the rectified-basis alignment flow are follow-ups
(ADR-109 scope).

---

## ADR-109 — Camera Mode v3: automatic marker alignment (no-click homography)

**Status:** Accepted; shipped with tests. | **Date:** 2026-07-03

### Context

ADR-107 reserved v3 for "fiducial auto-align," rejecting ArUco decoders on
licence (LGPV-bundle) grounds. The v2.b work shipped a proven clean-room
X-corner detector — which is itself a fiducial detector if the fiducials are
checker patches. Manual 4-point alignment (clicking bed corners in the frame)
remains as the fallback and the Falcon path (its cross-origin frames block
pixel readback, so no client-side detection is possible there).

### Decision

1. **Markers = five 2×2 checker patches**, engraved at known bed coordinates
   (`generateCameraAlignPattern`, flowing through the normal generator →
   preview → burn pipeline). Each patch centre is a literal X-corner for the
   existing detector. 10 mm cells keep the sub-pixel refinement window inside
   one cell even at ~1.3 px/mm camera resolution (smaller cells measurably
   biased the corner by ~1.5 px in the harness).
2. **The origin target is a patch PAIR** (two patches, 30 mm apart, midpoint =
   target): the unique tight pair disambiguates camera rotation — including a
   180°-mounted camera — with zero user input. Detection = top X-corner
   candidates → the dominant closest pair → remaining three singles → points
   ordered clockwise from the origin (a physical camera never mirrors, so
   image-clockwise equals bed-clockwise).
3. **Rectify before aligning when a lens calibration exists.** The alignment
   then lives in the rectified basis (`CameraAlignment.basis`), giving
   distortion-free registration bed-wide; without calibration the raw-basis
   homography is exact at the four targets and slightly bowed between them.

### Verification

Rendered-frame harness (plane renderer shared with the board fixtures):
detection finds all four targets in layout order for fronto / tilted / 180°-
rotated cameras (≤1.5 px vs projected truth); typed failures for a blank bed
and a missing origin pair; solved homography registers a mid-bed probe to
< 2 mm raw-basis under a mild lens, and < 0.7 mm bed-wide in the rectified
flow. NOT verified on real hardware: engraved-marker contrast/lighting and
the physical burn-vs-overlay registration — the maintainer's F-CAM4 pass.

### Out of scope

Print-and-cut (2-point re-registration of a printed sheet) — the natural v3.5
follow-on now that marker detection exists; capture-to-trace stays ADR-110.

---

## ADR-110 — Camera Mode v4: capture-to-trace at true bed coordinates

**Status:** Accepted; shipped with tests. | **Date:** 2026-07-03

### Context

ADR-107 reserved v4 for capture-to-trace. The prerequisite geometry all
exists now: rectification (v2), a persisted basis-tagged alignment (overlay
wiring), and the marker auto-align (v3). LightBurn's equivalent traces a
camera capture the user then positions manually; because our warp lands in
bed coordinates, the trace needs no positioning at all.

### Decision

1. **Warp the aligned frame top-down into bed-mm space** (`warp-to-bed.ts`,
   pure core): output→input sampling through the INVERSED homography
   (`invertMat3`, adjugate), reusing the rectifier's bilinear sampler so the
   two resamplers cannot drift. Off-frame pixels stay transparent.
2. **Basis discipline is enforced, not assumed** (`trace-from-camera.ts`): a
   rectified-basis alignment de-fisheyes the capture first and REFUSES to run
   without a calibration; a raw-basis alignment uses raw pixels. Mixing bases
   would silently mis-register — the same rule the overlay follows.
3. **The RasterImage's bounds ARE the bed** (4 px/mm), so the existing trace
   dialog and pipeline (ADR-100) need zero changes and traced vectors land at
   the photographed object's true machine coordinates.

### Verification

Core closed loop: render a camera view of the marker bed → auto-align from
pixels → warp top-down → re-detect the markers in the warped image → they sit
at their true bed coordinates (< 0.75 mm at 2 px/mm). UI decision tests cover
the typed failures (no alignment / basis mismatch). NOT verified on hardware:
a real photographed object traced and burned back in place — the F-CAM5 pass.

## ADR-111 — CNC beginner-mode UX pack: material picker, machine auto-fill, limit advisories, Basic/Advanced disclosure (Phase H.13, 2026-07-04)

**Status:** accepted (maintainer directive after a real 4040 cut wandered:
"Is this the easiest for a user to understand? … Can some of it
automatically be filled in with machine detection?"). Chosen scope: the
full beginner-mode set (#1–#4). Diagnosis pointed at mechanical/setup
causes, but the panel made cut-wrecking numbers *easy* — it accepted feed
1000 / depth-per-pass 1.5 for 6 mm ply on a 1/8" bit with zero guidance.
The KerfDesk panel is a powerful LightBurn/VCarve-style surface (every
number exposed, all manual); Easel/Carbide are friendlier because they
auto-fill feeds from a material, hide advanced fields, and pull limits from
the controller. This pack adds those affordances without removing any pro
control.

### Decisions

- **#1 Material picker (layer card).** A "Material" select
  (`Custom` + `CHIPLOAD_MATERIALS`) at the top of each CNC layer card. On
  pick, `calculateFeeds()` (ADR-103 chipload engine, unchanged) fills
  feed / plunge / depth-per-pass from the layer's bit and current RPM,
  under a **2-flute** one-click assumption; the advanced Feeds calculator
  keeps full flute/RPM control. `CncLayerSettings.materialKey?: string`
  records the choice (display/round-trip only — absent = manual "Custom",
  byte-identical output); normalize validates it against the material set.
- **#4 Basic/Advanced disclosure.** A persisted `showCncAdvanced` flag
  (localStorage; default **Basic = false**) gates the advanced field group
  (feeds, stepover, pocket fill, cut-type tails). Basic keeps Material, Cut
  type, Bit, Cut depth, Tabs. A one-click **Through cut (= N mm)** button
  sets cut depth to the stock thickness — disambiguating the
  cut-depth-vs-stock-thickness pair. The two "Spindle" fields are
  relabelled: the machine's "Spindle max" is the RPM ceiling (GRBL $30);
  the layer's "Spindle" is that layer's running speed.
- **#3a Machine auto-fill.** An opt-in "Machine reports …" banner on the
  Material & Bit card, shown only when the connected controller's detected
  `$$` values differ. Apply writes spindle max ($30 → `params.spindleMaxRpm`)
  and bed size ($130/$131). **Correction to the plan:** bed lands on the
  shared `project.device` (bedWidth/bedHeight), NOT on `stock` — the stock
  is the workpiece on the bed, not the machine envelope, and
  `CncMachineConfig` has no bed field. Never silent; the banner disappears
  once values match.
- **#3b Limit advisories.** At Save/Start, `detectCncMachineLimitWarnings`
  compares the job against the detected limits: stock larger than reported
  travel, and a layer feed above the reported max rate ($110/$111). Both
  advisory (not a gate), like the H.2 stock-footprint advisory. Kept a
  **separate module** from `detectCncStockWarnings` (toolpaths vs stock)
  for single-responsibility, rather than the plan's "extend" wording. The
  live snapshot threads through `detectMachineJobWarnings(project,
  controllerSettings?)` (defaults null → callers unchanged).

### Out of scope

Saving custom materials (a future CNC Material Library reusing a
`CncLibrary.materialPresets` slice); an inch/mm field toggle (the canvas
already has one; fields stay mm).

### Verification

Unit tests (material-apply + normalize round-trip; through-cut helper;
detected-apply thresholds; limit-advisory thresholds) and jsdom component
tests (material pick fills feeds; Basic hides advanced; detected Apply
patches params + device, leaves stock untouched). Full gate per commit.
Perceptual pass in an isolated preview: Basic/Advanced toggle, material
pick fills safe numbers (not 1000/1.5), injected `controllerSettings` shows
the Apply banner + stock/feed advisories. Defaults improve, but the
physical cut stays CLAIMED per ADR-098 §3 — the operator owns clamping,
work-zero, and the actual feed the machine can survive.

## ADR-112 — Project-level CNC material picker: set material once for the job (Phase H.14, 2026-07-04)

**Status:** accepted (maintainer follow-up to ADR-111: on the live app, opening
CNC mode showed only the dense machine "Material & Bit" panel and no material
picker — the ADR-111 picker is per-layer and invisible until a design is
imported, and the panel titled "Material & Bit" had no material control at all).
Chosen fix (maintainer): a project-level picker in that panel, Easel-style.

### Decisions

- **Project material lives on the stock.** `CncStock.materialKey?` — the
  workpiece's material, chosen once. NOT compiled directly (feeds still live
  per-layer); display + seed only, round-trips in `.lf2`. Bed/stock separation
  from ADR-111 §3a holds: this is the material ON the bed, distinct from the
  per-layer feeds it fills.
- **Picker in the Material & Bit panel**, above Bit — the two "what am I
  cutting" selectors together, present the moment you enter CNC mode. Picking a
  material runs `applyCncStockMaterial`: auto-fills feed/plunge/depth-per-pass
  for **every** current layer (its own bit + spindle, 2-flute) in one undoable
  step. "Custom" clears the association and leaves feeds for hand-tuning.
- **New layers seed** from the project material: manual Add and SVG import both
  seed via the shared `seedLayerFromStockMaterial`, so the Easel flow (set
  material → import) brings layers in with safe feeds. Text/drawn-shape inserts
  do NOT seed — consistent with them not taking laser layer-defaults either; a
  documented minor follow-up, not a silent gap.
- **Per-layer override preserved.** The ADR-111 per-layer Material picker still
  overrides a single layer; the project picker sets the default/bulk.
- **DRY:** `isChiploadMaterialKey` extracted to `core/cnc` (the layer + stock
  normalizers and the picker all validate against it).

### Out of scope / follow-ups

Seeding text and drawn-shape inserts; a "mixed" indicator when layers diverge
from the project material; saving custom material presets (still ADR-111's
deferred CNC Material Library).

### Verification

Unit: validator table; stock round-trip + drop-unknown; pure apply (layer
fill/no-op, project set/clear/laser-noop, seed on/off) with feeds computed via
calculateFeeds (not pinned magic numbers). Store: action fills + dirty + undo;
seeding on manual Add + SVG import; no-material = no cnc block (byte-identical).
jsdom: the panel renders the dropdown and picking sets the stock material. Full
gate per commit. Live browser NOT driven into CNC mode (shares the maintainer's
scene, CLAUDE.md §4). Physical cut CLAIMED per ADR-098 §3.

## ADR-113 — Region-enhance re-trace (dialog boundary mode) (Trace fidelity, 2026-07-05)

**Status:** accepted (maintainer-directed follow-up to the trace-fidelity work).

### Context

Small features inside a large raster sit at the tracer's detection floor: a
~67px² letter counter in a 1024px logo drops out at native size. The whole-image
auto-upscale can't rescue it — `shouldUpscaleSmallSource` gates on
`max(w,h) < SMALL_SOURCE_EDGE_PX = 100` (`auto-upscale.ts`), so a 1024px source
is never supersampled, and quadrupling a 1024px buffer for one small feature is
the exact cost that gate exists to avoid. The dialog already had a
LightBurn-style **Boundary crop** (box a region → the trace contains ONLY that
region's paths, `traceImageRegion`), reachable from `retraceOriginalAction`
("Re-trace Original") with the retained source raster.

### Decision

Add a **second boundary mode** rather than a new canvas tool. The boundary box's
mode is a stringly union `BoundaryMode = 'crop' | 'enhance'` (no boolean flag):

- **`crop`** (default, LightBurn parity): unchanged — delegates to
  `traceImageRegion`, result is just the region.
- **`enhance`**: trace the FULL image, re-trace the boxed **source** region
  supersampled 2×, and patch the re-traced geometry back into the full trace so
  the small feature is recovered while the rest of the trace survives. The pure
  merge lives in `core/trace/region-enhance.ts` (`enhanceRegionPaths`); the
  worker-backed orchestration is `src/ui/trace/region-enhance-trace.ts`
  (`traceImageWithBoundaryMode`), which injects the app's worker tracer into the
  pure core.

The **venue is the existing dialog**: it reuses `retraceOriginalAction` and the
boundary-box UX (drag to box, Clear Boundary), so no new tool, command, or canvas
surface is introduced. The mode toggle is visible only when a boundary exists;
clearing the boundary resets the mode to `crop`. Default stays `crop`.

**Why 2×** — mkbitmap's documented sweet spot ("a greyscale image contains more
detail than a bilevel image at the same resolution"); 3×+ invents detail. Capped
per `computeRegionUpscaleFactor` at 1× if the 2× crop would exceed
`MAX_UPSCALE_SOURCE_PIXELS`. **Margin-ring merge rule**: the region is shrunk by
`REGION_EDGE_MARGIN_PX` before the swap so crop-edge fragments (which hug the
border) and larger outlines crossing the box both keep their original geometry;
only polylines fully inside the shrunk interior are dropped/replaced, merged by
colour key.

### Consequences

- **LightBurn divergence, maintainer-sanctioned.** LightBurn's answer to a
  dropped small feature is manual node-editing; it has no region-enhance re-trace.
  The maintainer sanctioned this divergence as a fidelity win, so it is a
  deliberate choice, not a bug against the LightBurn reference.
- The full-image trace runs twice in enhance mode (once whole, once on the crop);
  acceptable because enhance is an opt-in on a user-boxed region, not the default.
- The core merge is unchanged by this ADR (it landed earlier); this ADR is the
  UI seam + venue decision only.

### Verification

Unit: `region-enhance-trace.test.ts` (crop delegates unchanged with one trace;
enhance runs the full trace + supersampled crop trace and patches — a
region-contained polyline replaced, an outside one survives). Preview:
`use-trace-preview.test.ts` (enhance mode reaches the preview path; the ready
state reflects the patched trace). jsdom: `ImportImageDialog.workflow.test.ts`
(the mode toggle renders only after a region is boxed, defaults to Crop). Full
gate per commit. **NOT verified perceptually this session** — the rendered
recovery of the real logo counter against the source is the maintainer's
perceptual pass (CLAUDE.md §2); green tests are not fidelity proof.

## ADR-114 — Commercial legal pack: EULA, installer acceptance, shipped third-party notices (2026-07-05)

(ADR-113 is reserved by the trace-fidelity track on its own branch; this entry
deliberately skips it to avoid a repeat of the ADR-094/ADR-106 collisions.)

**Context.** The 2026-07-05 release audit found the product legally unsellable:
the repo LICENSE (ADR-018) affirmatively denies everyone the right to *use* the
software and no EULA, terms surface, or machine-safety disclaimer existed
anywhere a customer could see. Separately, the bundled Roboto (Apache-2.0) and
three OFL-1.1 fonts plus all nine production npm packages shipped without the
license texts their licenses require — THIRD_PARTY_NOTICES.md covered only the
Rayforge camera adaptation and was not bundled.

**Decision.**
1. `public/eula.txt` is the customer-facing End User License Agreement: use
   grant, restrictions, machine-safety warning, warranty disclaimer, liability
   cap, third-party pointer, termination. It ships in every bundle (vite
   `public/` → `dist/web`, which electron-builder packs) and the NSIS
   installer requires acceptance (`nsis.license`). The repo LICENSE (ADR-018)
   still governs the *source*; the EULA governs the *distributed binary* —
   they are complementary, not conflicting.
2. `scripts/generate-third-party-notices.mjs` builds
   `public/third-party-notices.txt` from real sources — each production
   dependency's `node_modules` LICENSE verbatim plus each font's name-table
   copyright record — with the canonical Apache-2.0/OFL-1.1 full texts
   committed under `scripts/license-texts/` (downloaded from apache.org and
   openfontlicense.org). `build:web` regenerates it and the generator fails
   loudly on a missing LICENSE, so a new dependency cannot ship un-attributed.
3. The About dialog names both files and carries a short safety notice.

**Consequences.** The EULA text is an engineering draft: it must be reviewed
by a lawyer before the first sale (jurisdiction/governing-law clause is
deliberately absent). First-run in-app acceptance (web) remains open — the
web bundle surfaces the EULA via About, not a blocking dialog; revisit when
the storefront exists.

## ADR-115 — Edge Detection engine: local-contrast mask + potrace geometry (Trace fidelity, 2026-07-05)

**Status:** accepted (maintainer-directed after rejecting ADR-059's letter quality).

### Context

The maintainer's perceptual pass on the live app rejected the Canny-chain
Edge Detection engine (ADR-059): serif letters traced with hooked/curled
spur artifacts at serif tips, wandering contours cutting across serifs,
blobby small letters, and a dropped letter counter. Side-by-side renders on
the same logo pixels showed the failure was NOT detection (Canny finds the
ink) but GEOMETRY SYNTHESIS: the thin → stroke-graph → junction-weld →
spur-prune → chain pipeline manufactures the artifact classes, and every
prior fix (apex snap, spur pruning, weld tuning, spline caps) was
whack-a-mole against that architecture. The clean-room potrace backend
(Line Art) traced the same letters cleanly — but its global 128 threshold
drops faint ink (the LANGEBAAN letters run luma 125-195; a Canny-fill probe
measured ~88k ink pixels the global threshold misses on this logo).

A Canny-loop-fill mask was prototyped and REJECTED: closing edge loops
morphologically consumes small interior holes (letter counters) — the exact
detail at stake. The winning mask is mkbitmap's design (potrace's own
companion preprocessor): local-contrast thresholding.

### Decision

`traceImageToEdgePaths` becomes: **local-contrast ink mask → shared potrace
geometry.**

- `local-contrast-mask.ts`: ink = darker than the local box-blur mean by
  `delta`, unioned with the global 128 threshold (solid interiors read ~0 in
  a highpass, the union keeps them filled). No morphology — a 3px counter
  survives any radius.
- `potrace-trace.ts` exports the extracted `potraceBitmapToPolylines`
  geometry stage (scan → polygon → curve → optimize → apex snap), now shared
  by Line Art/Smooth/Sharp AND Edge Detection.
- The Canny-era option fields remain the public knobs; the engine derives
  its parameters from them so dialog/presets/merge are untouched:
  low threshold ratio → delta (0.074 → 6, clamp 2..12), blur sigma → radius
  (1.2 → 12, clamp 4..32), edgeMinLengthPx → potrace turdSize.
- **Output is closed contours only** — LightBurn's trace semantic (its
  tracer is potrace-based). The chain engine's open-stroke output is gone;
  thin strokes trace as thin outline rings, as LightBurn does.
- **Seam-invariant fix in `potrace-apex.ts`** (latent Line Art bug exposed
  by the rebuild): `snapCornersToInk` deduped a ring's closing point and
  never re-appended it, so every apex-rebuilt ring shipped `closed: true`
  with first ≠ last — while job compilation documents closed segments as
  "last equals first by construction" and the emitters draw points as given
  (cornered shapes engraved with their final edge missing). Snapped rings
  now re-append the (possibly moved) start vertex.

### Consequences

- The maintainer's reported artifact classes are gone at the engine level:
  serif feet hug (no smile arcs), no hooks/spurs, and the LANGEBAAN counter
  census reads 2/2/2 at NATIVE resolution — the defect ADR-113's
  region-enhance was built to patch no longer occurs on this logo, so
  region-enhance becomes a general-purpose recovery tool rather than the
  counter fix.
- Benchmark recalibrations (documented in arch-house-edge-benchmark.ts):
  `langebaanExcessTurnPer100Px` target 12 → 135 — the old target measured
  the spline engine's evened curvature, which turned smoothly precisely
  because it melted letters; potrace's polygon style measures ~117 while
  rendering every letter legible. `openPolylineCount` expectation flips
  > 10 → 0 (all-closed by construction). Disc radial RMS 0.12 → 0.15
  (measured 0.135; the ridge-snap sub-pixel pass no longer exists; 0.015px
  is far below laser resolution).
- Orphaned modules pending a separate cleanup commit: `canny-edges.ts`,
  `edge-subpixel.ts`, `edge-ink-support.ts` (no remaining app importers;
  their tests still pass; `edge-reconnect.ts` was deleted in ARC-07). The
  centerline pipeline
  keeps its chain machinery (its own mode) including the spline deviation
  cap from the earlier fidelity fix.
- Known residuals accepted from the render review: small junction notches
  on ~10px G/E glyphs and occasional ~1px foot ticks — polygon-style output
  at glyph sizes near the information floor.

### Verification

Test-first on the seam bug (edge ring measured 14px first→last before the
fix; potrace-apex pins the invariant). Engine contract tests rewritten
against real semantics (sensitivity gates a contrast-8 bar; Detail radius
fills vs hollows a broad faint square; disc smoothness rebaselined with
measured values). Full trace + perceptual suites 328/328; renders of
np-house-H / np-house-all / np-lang-all read and compared against the
baseline (serifs hug, letters legible, counters present) — the maintainer
saw the prototype renders and approved the architecture before
implementation; the final engine renders await the maintainer's own pass.

## ADR-116 — Box generator v2: panel cutouts, divider grid, slide lid (2026-07-07)

**Status:** accepted (maintainer directive: "I need my box designer to be
a full broad tool"). Builds on ADR-106; scope lands here before code.

### Context

The v1 generator ships two styles (closed, open-top) on an engine whose
hard parts — per-edge complementary sequences, corner-cube arbitration,
uniform-offset fit, corner-overcut relief, and the virtual assembly
referee — are style-independent. The single blocker between v1 and the
broad-tool tier (dividers, lids, hardware mounts) is that a `BoxPanel`
carries exactly ONE outline ring: ADR-106 said "no holes in v1". This
ADR adds interior cutouts once, then spends that capability on the two
most-requested styles. Behavior references: boxes.py docs and MakerCase
(reverse-engineering study only — boxes.py is GPL, no code copying,
ADR-017).

### Decision 1 — panel cutouts (the enabling upgrade)

- `BoxPanel` gains `cutouts: ReadonlyArray<Polyline>` (closed interior
  rings in the same sheet frame as the outline).
- **Insertion changes carrier:** panels insert as `kind:'imported-svg'`
  vector objects (the established carrier for baked generated geometry —
  dogbone/weld precedent), one `ColoredPath` holding outline + cutout
  rings. This is chosen over per-ring shape objects because (a) even-odd
  fill semantics make cutouts real holes under Fill mode, (b) compile-time
  kerf offset is already containment-aware for hole rings
  (`kerf-offset.ts`), and (c) the `source` field ("Box panel: Front")
  finally carries panel names into the scene — closing the v1 gap where
  `SceneObject` has no name field. Undo/selection semantics unchanged
  (one undo step, all panels selected). The generator's own insert path
  never routes through `importSvgObject`, so Phase C re-import
  replace-by-source semantics cannot trigger on generated panels.
- **Fit generalizes for free:** the −c/4 clearance offset on correctly
  oriented multi-ring polygons shrinks material and therefore WIDENS
  every cutout by c/4 per flank — exactly the slot play the joint
  contract requires. Corner relief extends to cutout rings: every
  slot corner a mating tab must seat against gets the F-CNC26 overcut
  at full bit radius, same post-offset ordering.
- **Referee extension:** slot bands. A junction between a tabbed part
  and a slotted panel is checked like a cube edge: one shared sequence,
  exact complementarity at c = 0, uniform play/2 flank gaps otherwise,
  zero interference always.

### Decision 2 — divider grid

- `BoxSpec` gains `dividersXCount` / `dividersYCount` (0–N, evenly
  spaced partitions across width / depth; 0 = v1 output, byte-identical).
- Divider panels stand on the bottom panel (no bottom slots in v2),
  height = inner height, and carry tabs into **through-slots** in the
  two walls they meet — through-slots are the standard laser-box
  aesthetic; half-depth dados are CNC 2.5D work and stay deferred.
  Tab/slot layout reuses `edge-pattern` over the divider junction height
  (odd cells, divider owns the odd cells), so complementarity is by
  construction, exactly like cube edges.
- Divider×divider intersections use egg-crate cross-laps: X-dividers
  notched half-height from the top, Y-dividers from the bottom, notch
  width T (widened by the clearance pass like any recess).
- Validation: resulting compartment pitch must exceed 2·T and, for CNC,
  the slot/notch cells must clear the relief tool (same rule family as
  ADR-106).

### Decision 3 — slide lid

- New style `'slide-lid'`: bottom, back, slotted left/right walls,
  front wall shortened to the slot floor, plus a loose lid panel.
- Geometry (refined at V3 build): outer height = inner + 3T — bottom,
  cavity, lid band, and a captive top strip. The side walls carry a
  C-channel spliced into their solid front edge at the lid band,
  stopping one thickness INSIDE the wall body (stopping at the body end
  would leave a zero-width neck — the fit offset severs it, which is how
  the referee caught the draft geometry). The lid slides over the
  shortened front and stops against the in-wall post; lid = full outer
  width × (outer depth − 2T), leading edge carries a half-round thumb
  notch built with on-edge-exact endpoints (no clipper).
- A slide lid must SLIDE: validation requires clearance > 0 for this
  style (defaults stay 0.15 mm CNC; laser default rises to 0.2 mm for
  slide-lid only). The referee gains a mandatory-play check for the
  lid/slot bands and a lid-clears-front check.

### Staged diffs (each independently reviewable + CI-green)

- **V0 — docs:** this ADR, PROJECT.md Phase K.2 block, WORKFLOW.md
  F-K6/F-K7 flows.
- **V1 — cutout infrastructure:** `BoxPanel.cutouts`, multi-ring
  panel-fit (offset + relief across rings), named `imported-svg`
  insertion (amend F-K1's carrier wording in the same diff — flows
  describe shipped behavior), referee slot bands, benchmark category
  `cutouts`.
- **V2 — dividers:** divider spec + validation, wall-slot claims,
  divider outline builder (tabs + cross-laps), dialog fields + preview,
  referee divider bands, benchmark category `dividers`.
- **V3 — slide lid:** style + geometry, mandatory-play validation,
  dialog style option, referee lid checks, benchmark category
  `slide-lid`.
- **V4 — closeout:** AUDIT rows (CLAIMED + named hardware checks: cut an
  organizer with 2×1 dividers and a slide-lid box, assemble and slide),
  session report, PROJECT status flip.

### Out of scope (each needs its own ADR)

Lift-off lip lids, hinged lids and living-hinge curved boxes, polygon
prisms (hex/octagon), dovetail/angled fingers, CNC dado/rabbet 2.5D
joinery, T-slot bolt+nut joints, bottom slots for dividers, engraved
panel labels (io/text). Named so they are deferred, not forgotten.

### Verification

Same regime as ADR-106: every new junction type gets exact-referee and
play-referee coverage; the seeded benchmark extends (new categories must
score 100% and the v1 categories must stay 100% — no style may regress
another); perceptual fixtures per new style; determinism over the
enlarged spec space; physical fit stays CLAIMED until the named cuts.

## ADR-117 — Keep-awake during active jobs: renderer screen wake lock, Electron permission allowlist (2026-07-07)

**Status:** accepted. (Renumbered from a draft ADR-116 after the box-generator v2 pack claimed that number on main the same day.)

### Context

A long job streams G-code over Web Serial for hours from a renderer
process. OS display sleep can throttle or suspend that renderer mid-burn;
the 5-second stream-stall watchdog detects the freeze but cannot prevent
it. The 2026-07-07 multi-layer-job trust audit listed missing endurance
protection as a gap — and the follow-up investigation found the feature
was already half-shipped, undocumented: `useActiveJobWakeLock` (App-mounted,
laser-store-subscribed, visibility re-acquire) had landed without an ADR,
WORKFLOW flow, or AUDIT row, and was **provably dead on the desktop app**:
Electron routes `navigator.wakeLock.request('screen')` through the session
permission handlers as the string `'screen-wake-lock'`
(`shell/common/gin_converters/content_converter.cc`, verified on the
shipped 42-x-y source), the deny-by-default trusted-renderer policy
(serial + `fileSystem*` only) rejected it, and the hook's best-effort
`catch` swallowed the denial silently. The operator had no signal either
way.

### Decision

- Keep-awake stays a **renderer** concern via the standard Screen Wake
  Lock API — one implementation serves web and desktop. **No main-process
  `powerSaveBlocker`**: it would need IPC to track job state, and the
  security posture's zero-`ipcMain` surface is worth more than the
  marginal extra blocking strength.
- `trusted-renderer-policy.ts` allows `'screen-wake-lock'` alongside
  `serial` and `fileSystem*` — still gated to trusted origins and the
  main frame; Chromium grants it without a prompt.
- Lock lifecycle is bound to `isActiveJob` (streaming | paused | done |
  errored, until the post-job Idle clears the streamer): acquire on
  activation, re-acquire on `visibilitychange` and UA-initiated release,
  release on job end and dispose.
- Failure is non-blocking and **visible once**: a single LaserLog line
  ("Keep-awake unavailable — the OS may sleep the screen mid-job") on the
  first denial or missing API, so a marathon burn is never silently
  trusted to a machine that will sleep. Retries stay quiet.

### Consequences

- Desktop keep-awake goes from silently denied to granted; web behavior
  is unchanged. The permission surface grows by exactly one prompt-free
  Chromium permission.
- A screen wake lock keeps the display (and with it, the system) awake on
  typical setups, but cannot survive a lid close or manual sleep — the
  log line tells the operator to disable system sleep before long burns.
  Supervised operation remains the rule for laser jobs regardless.
- No new dependency, no IPC handlers, no platform-adapter surface: the
  Wake Lock API is identical in both delivery targets.

### Verification

jsdom hook tests pin acquire/release/re-acquire and the one-shot warning
(denied + missing API); policy tests pin `screen-wake-lock` granted for
trusted check+request and denied for untrusted origins and subframes.
NOT verified: the packaged Electron runtime grant, and a real hours-long
burn with display sleep armed — CLAIMED in AUDIT.md until the maintainer
runs one.

## ADR-118 — Interrupted-job checkpoint: fingerprint-verified resume after a crash (2026-07-07)

**Status:** accepted.

### Context

If the app dies mid-stream (tab crash, OS kill, power blip), the job is
simply gone from the app's point of view: the operator must guess which
G-code line the machine stopped at and enter it into Start-from-line by
hand. The 2026-07-07 trust audit called this out (gap 3b): for a
multi-hour job, "guess the line" is the difference between salvaging a
workpiece and scrapping it.

Two existing pillars make a cheap, correct fix possible:

1. **Deterministic G-code (non-negotiable #5).** Start-from-line already
   RE-COMPILES the program from the current project
   (`runStartFromLineFlow` → `prepareStartJob` → `prepared.gcode`); byte
   determinism is what keeps its line numbers valid. A checkpoint
   therefore never needs to persist the G-code text (raster jobs exceed
   localStorage quotas) — only a fingerprint of it.
2. **Autosave recovery (Phase C).** The project itself is already
   restored after a crash, so re-compilation has its input.

### Decision

- **Pure core module `src/core/recovery/job-checkpoint.ts`:** a
  `JobCheckpoint` = FNV-1a fingerprint of the streamed text (hash, char
  count, raw line count) + the acked count + machine kind + ISO
  timestamps (passed in — core cannot read the clock). Two numbering
  systems meet here and must not be confused: the streamer's
  `completed`/`total` count SENDABLE lines (blanks and full-line
  comments are never streamed — `isSendableGcodeLine`, now exported from
  the streamer as the single definition), while `buildResumeProgram` and
  Start-from-line speak RAW file lines. The checkpoint stores the acked
  SENDABLE count plus the program's sendable total; `rawResumeLine`
  converts acked-sendable back to the raw line number against the
  re-compiled text at resume time. Strict `parse` validation and
  monotonic `advance`.
- **Write path:** `runStartJobFlow` writes the initial checkpoint right
  after the stream starts. A `use-job-checkpoint` hook (App-mounted,
  laser-store-subscribed like ADR-117's wake lock) advances
  `ackedLines` from `streamer.completed` — every 25 acked lines while
  streaming, immediately on any status transition (pause, error,
  disconnect, cancel). The checkpoint is a ~200-byte localStorage
  record; the hook re-reads it per store fire (microseconds) so there is
  no cache to go stale.
- **Clear-on-done only.** A checkpoint survives Stop, error, disconnect,
  and crash; only a run reaching `done` (all lines acked) clears it —
  a deliberately stopped job is still resumable, and the banner's
  Dismiss is the explicit discard.
- **Resume path is the EXISTING one, gated by the fingerprint.** The
  recovery banner (Laser window, shown when a checkpoint with progress
  exists and no job is active) calls `runCheckpointResumeFlow`: it
  re-compiles, REFUSES when the fingerprint of `prepared.gcode` differs
  — an edited project silently producing different line numbers is
  exactly the failure this gate exists to stop — then maps the acked
  count to the raw resume line and hands off to the shared
  Start-from-line body. Manual Start-from-line stays ungated (the
  free-form escape hatch).
- **Resume runs are not themselves checkpointed (v1).** A resume program
  (preamble + tail) has its own line numbering; mapping a crash inside
  it back to original coordinates is deferred. Both resume flows stamp
  `resumeInFlight` on the stored checkpoint before streaming, and the
  hook additionally requires the streamer total to equal the
  checkpoint's sendable count — belt and braces so foreign ack counts
  can never corrupt the record. If a resume run finishes, the job is
  done and the checkpoint clears; if it dies, the ORIGINAL checkpoint
  still stands — stale toward earlier lines, which re-burns a short
  stretch rather than leaving a gap.

### Consequences

- After a crash: relaunch → autosave restores the project → banner
  offers "resume from line N" → recompile + fingerprint check → the
  proven resume preamble (ADR-103 G7) re-enters the cut. No G-code file
  round-trip, no guessing.
- `ackedLines` measures GRBL acks (parsed into the RX buffer), not
  execution. If the CONTROLLER also lost power, up to a buffer's worth
  of acked lines never ran — the mapped resume line can be a few lines
  late. The banner says so; the manual Start-from-line control remains
  the operator-editable escape hatch. Backing up re-burns, skipping
  forward leaves gaps, so the conservative direction is down. If only
  the app died, GRBL finished its buffer and the mapped line is exact.
- Work zero must be unchanged — same contract as manual Start-from-line
  (the existing confirm says it).
- localStorage writes on the ack path are throttled (25 lines) and
  ~200 bytes; failures (quota, private mode) are swallowed — a
  checkpoint is best-effort protection, never a reason to block a job.

### Verification

Core: fingerprint determinism/sensitivity, parse rejection corpus,
advance monotonicity, resume-line clamping. Storage: round-trip +
corrupt-payload clearing. Hook: interval + transition write policy,
freeze on foreign totals, clear-on-done. Flow: checkpoint written on
start, fingerprint mismatch refuses with no stream. Banner: render /
dismiss / hidden-while-active. NOT verified: a real crash + resume on
hardware — CLAIMED in AUDIT.md until the maintainer kills the app
mid-burn and resumes.

### Amendment â€” schema v2: also store the output scope + job placement (2026-07-11, PST-02)

The original checkpoint stored only the fingerprint + acked counts. But resume re-compiles the project through `prepareStartJob`, whose bytes depend on the output scope (cut-selected-graphics + selection ids) and the job placement â€” and a crash resets BOTH to their defaults. A run that used a non-default scope/placement therefore recompiled to different bytes on resume, failed `fingerprintsEqual`, and dead-ended with a false "it was edited since" refusal exactly when a long selective burn most needed to resume. `JobCheckpoint` now also carries `outputScope` + `jobPlacement`, and `JOB_CHECKPOINT_SCHEMA_VERSION` is bumped 1 â†’ 2 so pre-existing v1 slots (which lack the fields) read as `null` and are discarded (transient â€” the only cost is one stale recovery prompt). `runCheckpointResumeFlow` passes the stored scope/placement into `prepareResume`, reproducing identical bytes; the manual Start-from-line path still uses current app state.

### Amendment â€” schema v3: store the RESOLVED job origin, not the placement settings (2026-07-11, R1)

PST-02 (v2) stored the placement SETTINGS (`{startFrom, anchor}`). That is byte-deterministic for Absolute / User Origin / Verified Origin, but NOT for `current-position`: `resolveCurrentPosition` freezes the live head XY into `JobOriginPlacement.currentPosition` at compile time, and on resume it re-resolved against the (moved) post-crash head, translating the job to a different origin and renumbering every line â€” reopening the exact false "it was edited" refusal for a normal placement mode (Codex re-audit R1). The checkpoint now stores the RESOLVED `jobOrigin` (a `JobOriginPlacement`, so a current-position run carries its frozen XY); `JOB_CHECKPOINT_SCHEMA_VERSION` is bumped 2 â†’ 3 (older slots read null and are discarded). `prepareStartJob` gained an optional `resolvedJobOrigin` override: a resume re-validates the live machine through the frozen origin's MODE (a vanished custom origin / unknown position still refuses) but COMPILES with the frozen origin so the bytes match the fingerprint. `prepareStartJob` surfaces the resolved `jobOrigin` on its ok result so the write site can capture it. An absent `jobOrigin` = Absolute (no translation).

## ADR-119 — Box designer usability pack: fit test coupon, assembled 3D preview (2026-07-07)

**Status:** accepted.
**Numbering note:** drafted as ADR-118, but the interrupted-job
checkpoint published 118 on `main` first — published numbers win
(ADR-104 precedent). Pre-merge commit messages say ADR-118; read them
as this ADR.

**Status detail:** accepted (maintainer: "yes build it" on the ranked
improvement assessment). Builds on ADR-106/116.

### Context

The generator's joints are referee-proven, but the clearance NUMBER is a
guess until material is cut — and the flat-sheet preview makes users
assemble the box in their heads. Both gaps close with existing
machinery: the calibration-tool family (Material/Interval Test) and the
generator's own placement model.

### Decision 1 — fit test coupon (Tools → Box Fit Test…)

- Pure core `fit-coupon.ts`: TWO strips. A comb strip carries N tabs on
  a graduated clearance ladder (default 0.05–0.30 mm, 6 rungs,
  start/step/count configurable); a slot strip carries the N mating
  notches. Rung i bakes the production fit law analytically — tab width
  f − cᵢ/2, notch width f + cᵢ/2, both T deep — so the rung that feels
  right on the bench IS the number to type into the Box Generator.
- Rung identification without text: i+1 index nicks (1 mm square)
  along the strip edge under each rung.
- CNC mode runs the slot strip through the shared relief pass
  (corner-overcuts at notch corners, full bit radius); validation reuses
  the box rules (f > tool, ladder < min(f, T)/2).
- Inserts as two named vector objects (imported-svg carrier), one undo
  step, same insertion path as box panels.

### Decision 2 — assembled 3D preview

- Pure core `assembled-layout.ts`: every generated part's 3D frame
  (origin, u/v basis, normal, slab offset) — walls from the documented
  drawing convention, dividers from their slabs, the slide lid from its
  channel band. This is the referee's placement knowledge exposed as a
  reusable layout (kept in sync by tests, not imports).
- UI: the Box Generator preview gains a Flat/Assembled toggle. The
  assembled view is a Canvas2D isometric projection (extruded plates,
  painter-sorted, even-odd fill so cutouts read as holes) — deliberately
  NOT three.js: a dialog preview needs no camera, no lazy chunk, and
  must render under jsdom guards like BoxPreview does.

### Verification

fit-coupon: exact per-rung width law (notch − tab == cᵢ), determinism,
benchmark category `fit-coupon` (must hold 100% alongside the existing
nine). assembled-layout: unit-pinned frames for every part kind across
styles. Preview: component tests (toggle, jsdom-safe render). Hardware
remains CLAIMED; the coupon exists precisely to make those cuts
informative.

---

## ADR-120 - MIT license, open-source release (supersedes ADR-018)

**Status:** Accepted | **Date:** 2026-07-07

### Context

ADR-018 made the source proprietary and the repo private while the
monetization model was undecided, and defined explicit reversal triggers.
The maintainer has now decided to open-source the project: community
adoption and contribution matter more than source control at this stage
(reversal trigger 3), and the zero-install web + desktop combination is
the product wedge, not source secrecy.

ADR-018's asymmetry argument still holds: public-then-private is not
reversible. This decision is made deliberately, with the tree cleaned
for public consumption first: internal audit reports, study notes, and
session plans removed from the published tree; competitor names removed
from public-facing copy per the standing neutrality policy.

### Decision

- **License: MIT.** `LICENSE` is the standard MIT text, copyright
  Johann Stolk. `package.json` declares `"license": "MIT"`.
- **Repo visibility: public** (the flip itself is a maintainer action on
  GitHub, executed after the release-blocking item below is resolved).
- **Dependency policy unchanged** (ADR-017): MIT-compatible licenses only;
  GPL-family dependencies remain rejected now because the combined MIT
  work must stay redistributable under MIT, not merely by policy.
- **EULA (ADR-114) reduced to a distribution notice.** With an MIT source
  license the restrictive use-grant/no-redistribution clauses are void;
  `public/eula.txt` becomes a License & Safety Notice (MIT grant reference,
  machine-safety warning, warranty disclaimer, third-party pointer). The
  NSIS installer continues to show it for safety-terms visibility.
- **THIRD_PARTY_NOTICES.md / public/third-party-notices.txt** reworded:
  first-party code is MIT, third-party components remain under their own
  licenses.

### Release blocker (RESOLVED by ADR-123)

The in-house potrace-style trace backend (`src/core/trace/potrace-*.ts`)
had unresolved provenance: a 2026-06-10 audit found its internals mirror
the GPL-2 potrace C implementation's details (helper names, constants,
pipeline order) with no provenance record. If that code was derived from
the GPL source, it could not be published under MIT. The three exits were
(a) replace the backend with a documented clean-room implementation,
(b) revert to the Unlicense imagetracerjs backend, or (c) establish and
record that the existing code was independently written. **Exit (a) was
taken: ADR-123 removed every `potrace-*.ts` module and routes all filled
presets through the in-house contour backend. This blocker is closed.**

### Alternatives considered

- **Apache-2.0:** adds a patent grant; heavier text. MIT matches the
  existing dependency ecosystem and the ADR-008 posture being restored.
- **AGPL-3.0:** protects against closed hosted forks but deters the
  hobbyist audience and contradicts the MIT-compatible dependency story.
- **Source-available (BSL):** not open source; fails the adoption goal.

### Verification

- `LICENSE` reads "MIT License" (this commit).
- `pnpm license-check` still enforces the ADR-017 dependency allow-list.
- `public/third-party-notices.txt` regenerated without proprietary wording.
- The potrace provenance blocker is closed by ADR-123 (the `potrace-*`
  modules no longer exist in the tree).

---

## ADR-121 - Machine-camera frames ride the loopback bridge: frame proxy and server-side discovery (Camera, 2026-07-07)

**Status:** accepted.
**Numbering note:** drafted on the camera branch as ADR-116, but `main`
published ADR-116 through ADR-119 first; published numbers win.

### Context

Camera Mode v1-v4 supported USB cameras and a direct HTTP image poll for
some machine cameras. The maintainer's machine camera exposed two missing
pieces: pixel-consuming features were gated on a USB `MediaStream`, and the
browser/direct-image route was blocked or tainted by CSP and CORS. The local
RTSP bridge already had the right security shape: loopback origin, CORS for
trusted app origins, and private-network policy checks.

### Decision

- Machine camera still frames go through the local bridge, not directly
  through the browser. `GET /frame.jpg?url=...` proxies one http/https/rtsp
  frame with trusted CORS headers and private-network restrictions.
- Discovery moves server-side through the bridge, so production CSP does not
  block camera probing.
- The UI consumes frames through one source abstraction: USB stream,
  machine-JPEG, or machine-RTSP. Calibration, auto-align, overlay stills,
  trace-from-camera, and snapshots all capture through that source path.
- The frame proxy rejects untrusted origins, recursive bridge URLs, redirects,
  and non-private targets before fetching upstream camera bytes.

### Verification

Bridge policy tests cover allowed and rejected URLs/origins, frame proxy
responses, PNA preflight, discovery, and health reporting. UI/source tests
cover machine-camera activation and pixel-readable capture. Hardware
verification remains a separate live-machine checkpoint.

## ADR-122 - Camera-driven positioning and burn-target alignment wizard (Camera, 2026-07-07)

**Status:** accepted.
**Numbering note:** drafted on the camera branch as ADR-118; renumbered here
because `main` already published ADR-118 and ADR-119.

### Context

Once machine-camera frames are pixel-readable (ADR-121), the camera workflow
still needs two operator-facing pieces: a guided target-burn alignment flow
and a way to act on what the overlay shows. LightBurn-style camera setup burns
its own target and then solves alignment; the app previously required more
manual orchestration.

### Decision

- Add a bed-alignment wizard that burns the five-marker target through the
  normal `runStartJobFlow`, watches the job finish, prompts the operator to
  clear the bed, captures a frame, optionally de-fisheyes it, detects markers,
  solves the homography, and persists the alignment.
- Add click-to-position: a crosshair workspace tool maps a canvas click
  through the same origin transform used by G-code emission, clamps inside the
  machine bed, and sends one absolute beam-off jog through the existing gated
  jog path.
- Keep absolute zero-valued jog words (`X0`, `Y0`, `Z0`) in absolute jog mode
  for GRBL, Marlin, and Smoothieware; in relative mode zero deltas still mean
  "do not move this axis."
- Add snapshot saving and a wider monitoring view using the shared
  pixel-readable capture path.

### Verification

Tests cover wizard store transitions, burn-step job-flow integration,
auto-align failure paths, click-to-position origin mapping and gating,
absolute zero-axis jog command emission, snapshot encoding, and camera panel
state. Live hardware alignment accuracy remains a separate checkpoint.

---

## ADR-123 — Own-engine trace: remove the potrace-derived backend (closes the ADR-120 blocker)

**Status:** Accepted | **Date:** 2026-07-08

**Numbering note:** drafted as ADR-122, renumbered to 123 because the camera
branch published ADR-121/122 to `main` first (published numbers win, ADR-104
precedent).

### Context

ADR-120's one release blocker was `src/core/trace/potrace-*.ts` (~2,369
lines): a 2026-06-10 audit found the internals mirror the GPL-2 potrace C
implementation (helper names, constants, pipeline order) with no provenance
record, so the code could not ship under MIT. ADR-120 listed three exits;
the maintainer chose (a) — replace it with an in-house backend — and it was
built and perceptually accepted over three review loops (2026-07-07/08):

1. **Line Art de-wobble** — the flattener defaults on (Smoothness ramp),
   rewritten to a total-least-squares line fit with a three-gate
   noise/feature classifier; sharpener tangents use leg chords so boundary
   noise no longer mints false corners.
2. **Small-glyph overshoot + Edge reroute** — corner rebuild skips glyph-
   scale rings; a coverage gate stops the sharpener amputating serifs; Edge
   Detection was rerouted off the potrace geometry stage onto the shared
   `contourPolylinesFromMask` finisher.
3. **Big-letter corners + arc wobble** — a dense-stage moving circle-fit
   smoother evens mid-wavelength mask noise on large curves.

Each defect class is guarded by an analytic instrument
(`contour-straightness` / `contour-glyph-fidelity` / `contour-roundness`).

### Decision

- **Delete every `potrace-*.ts` module** (trace, apex, bitmap, curve +
  optimize, params, path-scanner, polygon family) and their tests, plus the
  dead `edge-ink-support.ts` and the two potrace comparison harnesses
  (`_contour-vs-potrace-audit`, `_sharp-candidates`).
- **All binary filled presets (Line Art, Smooth, Sharp) route to
  `contour-trace.ts`; Edge Detection shares its finisher.** The dispatch
  predicate `shouldUsePotraceTraceBackend` is renamed `isBinaryContourPreset`
  (backend-neutral) and lives in `contour-trace.ts`. This was already the
  runtime path (the ADR-120-era A/B swap), so production output is unchanged
  by the deletion.
- **Two kept symbols move out of the potrace modules:** the LightBurn dialog
  model (`LightBurnTraceSettings` + `DEFAULT_LIGHTBURN_TRACE_SETTINGS`) to a
  new `lightburn-trace-settings.ts`, and the `TraceBitmap` bitmap shape to
  `local-contrast-mask.ts` (its only surviving producer). The potrace
  parameter converter is deleted with the backend.
- **imagetracerjs stays** as the multi-colour / no-fixed-palette fallback
  (Unlicense, ADR-013) — untouched.

### Consequences

- The whole surfaced trace surface is now original / permissively-licensed
  code; the ADR-120 MIT-release blocker is closed. The Selinger 2003 potrace
  algorithm is neither used nor referenced by shipped code (the external
  potrace 1.16 binary remains only in TRACE_AUDIT-gated measurement fixtures,
  never bundled).
- Measured on the arch-house logo: contour IoU 0.92, band-IoU 0.94, hole
  census exact, ~40% faster than the old potrace path. Fidelity is
  eyeballed against the source (CLAUDE.md #2), not asserted from IoU alone.
- Known residual: sub-pixel mask-noise ripple on large curves; the named
  next lever is sub-pixel boundary extraction from the anti-aliased luma.
- Not verified: a LightBurn side-by-side; the Sharp/Smooth/Centerline live
  passes were rendered and reviewed but not burned.

### Verification

- Adversarial audit (5 dimensions, then per-finding refutation): 0 blockers,
  0 majors, 5 minors — all cleared. Provenance dimension confirmed clean-room
  (standard published math, zero potrace fingerprints in code, no GPL
  dependency).
- Routing pin (`trace-to-paths.test.ts`): the three binary presets classify
  to the contour backend and Line Art dispatches through it end-to-end;
  centerline/edge/multi-colour do not. Replaces the deleted potrace pin.
- Full suite green after the deletion; `tsc --noEmit` + lint clean.
- Perceptual: the five presets rendered through the app dispatcher and
  reviewed; the three fidelity instruments gate regressions.

## ADR-124 — Capture Board Corners: build the registration box from jogged machine coordinates (2026-07-08)

**Status:** accepted (maintainer directive: "jog the head to each corner,
press a button, remember the coordinates … draw the shape on canvas with
exact size so I can center artwork on a placed board"). Scope lands here
before code.

> **Numbering note.** Drafted as ADR-122, but the camera and trace-engine
> merges to main landed ADR-116–123 first (ADR-122 = potrace-backend removal,
> ADR-123). Renumbered to **ADR-124** — the next free number above main's
> body — when this feature was rebased onto main for merge, following the
> ADR-092/093/123 numbering-note convention.

### Context

The operator places a board (wood/acrylic offcut) somewhere on the bed and
wants to burn on it — usually centered. Today nothing tells the app where
that board physically sits or how big it is, so lining artwork up with a
placed board is guesswork. LightBurn solves this with a camera; the
camera-free path (ADR-057 Registration Box) is close but inverted — it
burns an outline first, then you place material inside it.

This ADR is the other direction: material is already placed, so **capture**
its corners by jogging the head to each one and recording the machine
coordinate. Manual hand-jogging cannot work: GRBL is open-loop (no
encoders), so pushing the head by hand does not update the reported
position — capture is always button-jog.

### Decision 1 — reuse the registration box; add a capture front-end

The captured board **is** an ADR-057 registration box (reserved
`REGISTRATION_LAYER_COLOR`), built from jogged corners instead of typed
width/height. That inherits, for free: distinct dashed rendering
(draw-scene), box-anchored placement (`computeRegistrationBoxBounds` →
`prepareOutput`), the artwork-centering machinery, and save/load. The
feature is a new *creation path*, not a new scene concept.

The operator captures four corners. Width and height come from the
axis-aligned **bounding box** of the four points
(`bestFitRectangleFromCorners`), so the result is **independent of capture
order/direction** — up-the-left-side and across-the-bottom both give the
same size and, crucially, the same orientation. (The original
edge-length-averaging was order-dependent: capturing the reverse direction
silently swapped width and height, drawing a horizontal board vertical —
found in live hardware use, ADR-124 amendment 2026-07-08.) Only the *first*
corner is special: it must be the bottom-left, because it sets the origin
(Decision 2); the other three are any order. An off-square diagnostic (the
largest distance from each **bounding-box corner** to its nearest captured
point) warns when the board is rotated on the bed, a corner was mis-captured,
or a corner was skipped and another repeated — measuring box-corner →
nearest-point, not the reverse, so a skipped/duplicated corner (which leaves
a box corner unclaimed) is caught rather than scoring zero. The outline is
drawn axis-aligned, so a large value means the drawn size/orientation won't
match the real board. Inputs are finite-guarded (non-finite → null).

**Known limitation.** The work origin is set at the *first* captured corner
(G92), which is order-dependent, while the geometry is now order-independent —
so capturing a corner other than the bottom-left first silently sets the
origin at the wrong corner with no geometric feedback (the burn would then be
misplaced, but the frame/Start bounds preflight catches an off-bed job). The
"bottom-left first" guidance is the primary mitigation; an origin-aware
first-corner check would need the device origin (deferred).

### Decision 2 — bottom-left sets the origin; box is drawn centered

Capturing the bottom-left corner calls the existing `setOriginHere` (G92
X0 Y0), so that physical corner becomes work (0,0). The box is drawn
**centered on the canvas** (reusing `registrationBoxDefaultPosition`) — a
convenient work area, not the board's true bed position — and job placement
is switched to **user-origin / front-left**. The box's front-left then
anchors to the work origin, so artwork centered on the on-canvas box burns
centered on the real board wherever it sits. This is the exact "no-homing
machine: Set Origin + Frame first" path ADR-057's help already describes,
and it works on machines without homing (the common case for this user
base). The `wcoCache` is inferred immediately by `setOriginHere`, so
user-origin placement is valid with no wait for a later WCO frame.

Registration output is forced to **artwork-only** on capture: the material
is already placed, so the outline is a guide, never burned.

The outline is labeled on the canvas with its measured `W × H mm`
(`draw-registration-dimensions.ts`, screen-space text from the box's drawn
bounds) and the size is repeated in the panel, so the operator can compare
what the laser measured against a physical ruler.

### Decision 3 — placement helpers reuse the align + jog machinery

"Center / corner the artwork" reuses selection alignment against the box:
`buildBoxAnchorAlign` composes a horizontal and vertical single-axis
`alignDelta` (exported from selection-align) into a corner snap, wired as
`alignSelectionToRegistrationBox(anchor)` beside the existing
`centerSelectionInRegistrationBox`. "Jog head to" a board point reuses the
guarded `jog` action via a new `jogToMachinePosition`, computed as a
relative delta from the current machine position (so it works for the
(0,0) corner and needs no absolute-jog builder). Motion actions
(home/jog/frame) moved to `laser-jog-actions.ts` when this pushed the
store past the ADR-015 size cap — a mechanical split matching
laser-job-actions / laser-origin-actions.

### Robustness (capture input; hardened during the ADR-124 self-audit)

Width/height derive from the bounding box, so capture order/direction can't
swap them (amendment above); the off-square diagnostic flags a rotated or
mis-captured board. A double-click is deduped — a capture within 1 mm of the
previous corner is ignored (a stationary-head double-click would otherwise
record a corner twice and corrupt the rectangle), backed by an in-flight
guard so the first-corner G92 fires once. "Create board outline" is blocked
below 3 mm in either dimension (a degenerate capture would otherwise be
silently clamped to 1 mm by `sanitizeSize`). A failed origin write surfaces
an in-panel error instead of leaving the operator on "Corner 1" with no
feedback.

### UI entry point (amendment 2026-07-08)

The panel moved from an inline section in the Laser controls column to a
**Place Board** toolbar command (Tools group, beside Registration Jig) that
toggles a NON-modal floating panel top-left of the canvas — the ADR-057
registration-jig pattern (toolbar toggle + `App.tsx`-rendered floating panel
+ ui-store open flag). The panel reads its own connected/Idle gate
(`useCaptureGating`) rather than a prop from `LaserWindow`. Kept ungated
across machine kinds (works for CNC stock placement too), unlike the
laser-only registration jig.

### Manual-size path (amendment 2026-07-08)

For operators who already know their material's exact dimensions, capturing
all four corners is busywork. After the bottom-left corner is captured (which
sets the origin), the panel offers a `ManualSizeForm`: type width × height and
draw. The origin is already correct, so it reuses `addCapturedBoardBox(w, h)`
verbatim and synthesizes the other three corners from the origin + size
(`boardCornersFromOrigin`) so the committed phase (measured readout,
jog-to-corner) behaves identically to a four-corner capture. The synthesis
assumes machine +X = width, +Y = height (the same front-left baseline as the
rest of the feature); the ≥ 3 mm guard is shared (`constants.ts`).

### Limitations (stated, not hidden)

Axis-aligned rectangle only: a physically-rotated board yields an
axis-aligned W×H box (size correct, orientation not), flagged by the
rotation warning. X/Y only, Z ignored. Requires connected + Idle + a live
machine position. Corner eyeballing is ±~0.5–1 mm. True rotated-rect /
N-point polygon capture is a documented follow-up.

### Verification

Pure core (`bestFitRectangleFromCorners` incl. the shear/rotation
diagnostics, `boardMachinePoints`, `buildBoxAnchorAlign`) and store actions
(`addCapturedBoardBox`, `alignSelectionToRegistrationBox`,
`jogToMachinePosition`) are unit-tested. A React panel test — driving the
capture flow with status frames injected into the laser store (NOT the GRBL
simulator) — asserts G92 on the bottom-left corner, the measured box size,
user-origin placement, the double-click guard (one origin write, one
corner), and the too-small-board block. The canvas size label is a
draw-scene text-capture test. **The perceptual render was NOT performed:**
the live preview was unavailable (its port held by the maintainer's own dev
server) and injecting a box into the live scene would break the
side-effect-free rule, so correctness of an axis-aligned rectangle at a
measured size rests on the exact geometry unit tests, not a rendered-pixel
comparison. Also NOT verified: on-machine jog-to-corner, real G92 behavior,
and the physical burn landing on the board — hardware remains CLAIMED; the
operator confirms via the WORKFLOW checklist.

### Amendment (2026-07-08) — lock the captured board

The captured board is created **locked** (`addCapturedBoardBox` sets `locked: true`), unlike the ADR-057 jig, which is operator-positioned and stays movable. Its on-canvas position encodes the physical board's measured location relative to the G92 work origin, so a stray drag would silently break centering, the ADR-125 Fill/Array, and the burn placement. Locking makes it unselectable and undraggable (the hit-test, marquee, snapping, and selection-transform paths all skip locked objects) while it still renders and compiles; "Capture a new board" still replaces it (the box is found by color, not selection).

## ADR-125 — Fill the board: auto-fit + array artwork onto the placed board (2026-07-08)

**Status:** accepted (maintainer directive: expand Place Board — chosen from the
expansion brainstorm: A1 auto-fit + A2 array/step-and-repeat; the material and
camera themes were deferred).

> **Numbering note.** ADR-124 (Capture Board Corners) was the last used number;
> **ADR-125** is the next free, verified against DECISIONS.md at authoring.

### Context

Place Board (ADR-124) turns a physical board into a canvas region — the ADR-057
registration box — tied to the work origin, but the operator could only position
*one* design on it (center / corner-snap). For production (a sheet of coasters, a
row of keychains) they want to *fill* the board: scale one design to fill it, or
tile many copies. Both act on the placed board's region and the current selection.

### Decision 1 — auto-fit is fit-to-region, generalizing fit-to-bed

`fitObjectToRegion` (`core/scene/fit-to-region.ts`) generalizes the existing
`fitObjectToBed`: fit-to-bed already scales-to-fit-and-centers against the bed
`(0,0,bedW,bedH)` with a fixed 10% margin, capped at scale 1 (never grows).
fit-to-region takes any rectangle (the board's scene-space bounds, via
`transformedBBox` of the registration box), a caller-supplied margin, and a
`grow` flag; auto-fit passes `grow: true` so a small design scales *up* to fill.
Centering is rotation-safe (it maps the local center through the scaled
transform), fixing a latent fit-to-bed limitation. The store action
`fitSelectionToBoard` fits the *one* selected design; multi-select is a no-op
(fitting several would pile them on top of each other).

### Decision 2 — array is pure geometry (offsets) + a store tiler

`tileIntoRegion` (`core/scene/tile-into-region.ts`) is pure: given the design's
scene footprint (`cell`), the board `region`, and a layout — explicit `rows × cols`
or `fill` (auto-count how many fit) — it returns one translation offset per grid
slot, the block centered in the region. The store action `tileSelectionIntoBoard`
moves the original into slot 0 and adds a fresh copy (`crypto.randomUUID`, matching
the duplicate action's id minting) per remaining slot, as one undoable edit; copies
inherit the source layer. `MAX_TILE_PER_AXIS` caps a typo (9999 rows) or a 0.1 mm
design from spawning millions of objects. Single-design only, like auto-fit.

### Decision 3 — both live in the post-capture placement panel

Both are gated on a placed board **and** exactly one selected design, in
`BoardPlacementControls` (the panel that already hosts align/jog), grouped under
"Fill board" (Fit to board button) and the array form (`BoardArrayForm`:
fit-as-many-as-fit, or rows × cols, with a spacing gap).

### Consequences

Turns Place Board from "position one design" into "run a production sheet."
**Not covered** (outlined in the expansion brainstorm, deferred): nesting
*different* parts (bin-pack), board→material presets, caliper mode, camera board
detection. **Verified:** pure-geometry unit tests + store-action tests (fill
scale, centering, rotation-safety, grid/fill counts, guards). **NOT** perceptually
rendered in the live app at authoring time — the maintainer's canvas eyeball is
the fidelity gate (green tests assert geometry, not that it *looks* right).

### Amendment (2026-07-08) - review-driven fixes

An adversarial review of this diff surfaced four issues, all fixed here:

- **Rotation-safe fit, not just centering.** `fitObjectToRegion` now scales by the design's rotated footprint (its unit-scale AABB) instead of its intrinsic W x H, so a rotated design fills the board without overflowing it - and without burning off the physical material. (Centering was already rotation-safe.)
- **Re-array cannot silently stack.** After arraying, the whole grid becomes the selection (like Duplicate), which disables Array/Fit (they need exactly one selected design); the operator undoes to re-array. A re-click can no longer drop a second exactly-overlapping grid (a doubled burn).
- **Count + perf caps.** `MAX_TILE_TOTAL` (500) caps the total copies - a tiny design under "fit as many as fit" could otherwise spawn ~10,000 - and the copies are appended in a single pass rather than an O(n^2) per-object loop.
- **Finite-gap guard.** A non-finite spacing (e.g. a huge literal parsing to Infinity) is clamped to 0 in both the array form and `tileIntoRegion`, so it cannot write NaN into a copy's transform or the emitted G-code.

## ADR-126 - Generalize Place Board to a board-shape union; circle boards (2026-07-08)

**Status:** accepted (maintainer directive: capture round boards - "origin the middle of the circle and draw a circle with a hand-measured diameter around the laser origin"; chosen scope: a general board-shape system, circle first).

> **Numbering note.** ADR-125 (Fill the board) was the last used; **ADR-126** is the next free (verify at merge).

### Context

Place Board (ADR-124) captured rectangles only - four jogged corners, origin at the bottom-left. Round stock (coasters, medallions) has no corners, and its natural origin is the CENTRE. Rather than special-case a circle, generalize the captured board to a shape union so future shapes (rounded-rect, polygon) slot in cleanly.

### Decision 1 - a BoardShape discriminated union in core

`BoardShape = { kind:'rect'; widthMm; heightMm } | { kind:'circle'; diameterMm }` (`core/scene/board-capture.ts`), matched with `assertNever`. The capture-in-progress reducer gains `shapeKind` + a resolved `shape`; `corners` is shape-relative (rect: up to four corners; circle: `[centre]` or `[centre, rim]`).

### Decision 2 - circle origin is the centre; size by typing or jog-to-edge

The operator jogs to the CENTRE and Captures, which sets the G92 work origin there (anchor `'center'`, already a valid placement). Then they type the hand-measured diameter, or jog to any rim point and capture it - `diameterFromCenterEdge(centre, rim) = 2*|rim - centre|` (pure) measures it without a ruler. So a circle is one jog + one number, simpler than the rectangle's four corners.

### Decision 3 - reuse: circles need no downstream change

`createRegistrationCircle` (an ellipse on the registration layer) already exists. Crucially, `findRegistrationBoxes` keys on `kind:'shape' && color`, NOT `spec.kind`, so it already finds the circle - meaning Fit/Array (ADR-125), align, lock, remove, and the burn placement all work on a circle board with ZERO change. The store action `addCapturedBoard(shape)` dispatches rect vs circle (locked outline, kept out of the burn, shape-appropriate anchor); `addCapturedBoardBox` is the rectangle back-compat wrapper.

### Decision 4 - shape-aware UI

A Rectangle / Circle toggle at the top of the Place Board panel (switching clears the in-progress capture). The capture phase and the placement controls branch by shape: a circle shows a single Centre anchor (align + jog) and a diameter readout instead of the rectangle's four corners.

### Consequences

Round boards work end-to-end (verified by panel integration tests: toggle -> capture centre -> type/measure diameter -> a locked, centre-anchored ellipse). The shape union makes further shapes additive. Fit/Array measure the circle by its bounding SQUARE, so a design's corners can overhang the arc - an optional inscribed-square fit is a deferred fast-follow. NOT verified: on-machine capture / G92 / burn (hardware CLAIMED); no live perceptual render (rule #4 - the dev server shares the maintainer's scene).

### Amendment (2026-07-08) - inscribed-square fit for circles (PR 5)

Supersedes the "bounding square" note above. Fit/Array now fill a circle board's centered INSCRIBED SQUARE (side = diameter / sqrt(2)) instead of its bounding square, so a design stays inside the arc rather than overhanging the corners. A new pure helper `boardFitRegion(box)` (core/scene) returns the inscribed square for an ellipse box and the full bounds for a rectangle; `fitSelectionToBoard` and `tileSelectionIntoBoard` feed it to `fitObjectToRegion` / `tileIntoRegion`. Rectangle behavior is unchanged.


## ADR-127 - Rotary axis engine: one machine-space job for chuck/roller Y-scaling (Phase N, 2026-07-09)

Context. Cylindrical engraving (mugs, tumblers, pens) needs the design Y to drive
a rotary axis instead of the flat-bed Y motor, mapping surface distance to
rotation. The mapping must be applied consistently everywhere the job is measured
- emit, framing, time estimate, placement preflight, and Ruida .rd - or they
disagree with the streamed motion.

Decision. A rotary attachment is an optional `RotarySetup` on the device profile
(persisted in .lf2 and machine profiles). `core/job/rotary-job.ts` (machineSpaceJob)
is the SINGLE source of truth: it scales + rebases Y for a rotary job and is the
identity for non-rotary jobs; every downstream consumer routes through it.
- Chuck: surface mm scaled by mmPerRotation / (pi * objectDiameterMm). Roller: 1:1.
- Both rebase Y to 0 - rotation is relative; a flat-bed Y position is meaningless
  on a cylinder. reverseAxis mirrors within the wrap window for inverted gearing.
- Scale is applied AFTER prepareOutput so the on-canvas preview stays surface-true;
  only emitted motion is scaled.
- Bounds preflight swaps bed height for the one-revolution wrap limit
  (boundsHeightOverrideMm); a job taller than one revolution is refused.
- Image/raster engraving is refused while rotary is enabled
  (rotary-raster-unsupported) - v1 is vectors-only.

Scope of THIS change. Engine only: the rotary math and its wiring through
emit/.rd/preflight/estimate/framing plus the .lf2 + machine-profile round-trip.
The Rotary Setup dialog and command wiring are a deliberate follow-up so this
lands as a small, reviewable, UI-free slice.

Consequences.
- Determinism (#5): disabled/absent rotary is byte-identical to current output
  (asserted in the emit-gcode-rotary tests).
- HARDWARE-GATED / CLAIMED: the Y-scale factor, reverse-mirror sign, and wrap
  limit are structurally unit-tested but have never run on a physical rotary. A
  wrong calibration silently distorts the burn and no automated test can catch
  it. Ships CLAIMED until a maintainer rotary bench pass.

## ADR-128 — Measured-boundary trace pipeline: sub-pixel extraction, supersampling, and fair-then-fit finishing

Context. ADR-123 replaced the potrace-derived backend with the in-house contour
finisher (mid-crack boundary walk -> Taubin pre-smooth -> corner rebuild ->
curvature evening -> straight-run flattening -> spline resample). Measured
against a maintainer reference pair (an idealized outline drawing + a filled
redraw of the Arch House logo), that finisher still produced wobbly stems, serif
spikes/melt, ~1px scallops on organic curves, and sawtooth on the long
hand-drawn strokes. Root analysis (three research briefs + a perceptual loop
harness): those smoothing stages existed to repair QUANTIZATION noise from
binarize-then-walk, and each stage fought the staircase the previous one left.
The frontier is fidelity vs a professional-artist look: fair curves + regular
typography.

Decision. Move the contour lane (and the edge lane, which shares the finisher)
to a MEASURED-boundary pipeline with a fair-then-fit finish:

1. Sub-pixel boundary extraction. The mid-crack walker interpolates the
   pre-threshold grayscale iso-line at each crack (marching-squares style)
   instead of quantizing to lattice midpoints. Loop TOPOLOGY stays on the
   cleaned binary mask; vertex POSITIONS come from the anti-aliasing ramp
   (~0.1px vs ~0.7px). A CrackSubPixelField {lumaAt, thresholdAt} exposes the
   iso per branch (global/Otsu = constant; local-contrast/sketch =
   position-dependent). Saturated binary steps carry no sub-pixel information
   and stay at the midpoint.

2. 2x quality supersample. The binary-contour and edge presets trace at 2x
   (mkbitmap's recipe) so 1-2px features (hooked apex tips, thin subtitle
   strokes) binarize with double resolution. An INTERNAL pixelScale option
   scales EVERY pixel-denominated constant (despeckle/pinhole/min-area areas by
   s^2; simplify epsilon, window and run lengths, local-mean radius by s) so the
   1x tuning holds. Sharp opts out: bilinear supersampling would anti-alias the
   pixel notches it exists to preserve.

3. Wobble stages stand down on measured loops. When most cracks interpolated
   (the boundary is a MEASUREMENT), the quantization-noise stages (chord
   flattener, arc-noise evening) are net harmful -- they fabricate joint steps
   on measured stems. They disable per loop; binary/pixel sources keep the full
   legacy behaviour, protected by the straightness/roundness instruments.

4. Fair-then-fit finish. Measured loops end in least-squares cubic Bezier
   fitting (Schneider's published Graphics Gems method: chord parameterization,
   tangent-constrained LS, Newton reparameterization, corner split) -- on
   low-noise measured data the fit IS the fairing. Large hand-drawn (organic)
   loops are first Whittaker-Henderson penalized-smoothed (fair-chain.ts:
   minimize ||y-x||^2 + lambda*||D2 x||^2, one banded LDL^T solve per
   corner-delimited segment, lambda derived from a frequency cutoff at 2x the
   ink-texture wavelength), THEN fit tight -- because max-error split-fitting
   alone can never stop chasing texture (established over three iterations).
   Corners are hard boundaries: persistence-gated for organic loops
   (turn survives at two window widths), evidence-backed for glyphs.

Scope. Line Art, Smooth, and Edge Detection get the full measured-boundary
stack; Sharp stays 1x pixel-pure; Centerline (the skeleton lane) is untouched.
Engine + perceptual harness only -- no changes to the trace dialog or public
option surface beyond the internal preset flags.

Consequences.
- Provenance stays clean-room: standard published math (marching squares,
  Schneider fitting, Whittaker-Henderson smoothing, scale-space corner
  persistence). No GPL code was read or ported (potrace, libspiro, autotrace,
  cornucopia-lib all avoided; only the imagetracerjs dependency remains, for the
  legacy multi-colour path).
- Fidelity vs fairness: input-mask IoU DROPS slightly on textured art BY DESIGN
  -- the reference style prefers fair lines over faithfully-traced ink
  roughness, and IoU/chamfer are blind to fairness. Verification is the
  perceptual loop harness (arch-house-reference-loop, env-gated) plus a
  resolution-aware apex-fidelity invariant and fair-chain / fit-cubics
  frequency-response unit tests.
- Cost: Line Art / Smooth / Edge trace rises from ~0.6s to ~2-3.5s on a 1024^2
  logo (2x supersample + fitting). Acceptable at import time; a "High quality"
  toggle to reclaim 1x speed is a possible follow-up.
- Karpathy discipline: every iteration was gated on rendered vector-resolution
  crops, not green tests. Perceptually verified against the reference on
  letters, serifs, arch bands, waves and roof lines; NOT verified on physical
  laser output (this changes trace geometry only, no G-code semantics).

## ADR-129 - Enforce no-go/keep-out zones on app-initiated jog and click-to-position motion (2026-07-10)

**Status:** accepted (audit DEV-04: no-go zones gated Start/Frame/export/resume, but jog was zone-blind end to end).

> **Numbering note.** ADR-128 (measured-boundary trace pipeline, merged from main) was the last used; **ADR-129** is the next free.

### Context

No-go/keep-out zones (clamps, cameras, fixtures) are honored by the Start, Frame, export, and resume preflights, but the jog path was blind to them end to end: `jogActions.jog` gated only on autofocus + jog/frame readiness, and `buildJog` checked only finiteness/axis. One jog-pad move or one click-to-position could drive the head straight through a clamp at up to 3000 mm/min. LightBurn has no equivalent (it does not model keep-out zones for jogging), so this is a deliberate KerfDesk safety divergence, recorded here.

### Decision

Add a pure core check `firstZoneCrossedBySegment(from, to, zones)` (`core/preflight/no-go-zones.ts`, reusing the existing segment/rect intersection helpers) and call it at the single jog choke point. All three UI motion paths - jog pad, jog-to-point, and click-to-position - funnel through `jog({dx,dy,feed})`, so the guard covers them all: it resolves the target from the live machine position plus the delta and refuses (same shape as the readiness refusal - set `lastWriteError`, log, throw) when the straight from->target segment crosses an enabled zone, naming the zone.

### Scope / non-goals

The check is skipped (motion allowed) when there is no known machine position for a relative jog - the operator has no live position to reason about either, and blocking would strand jogging. Homing and any future continuous (hold-to-jog) motion are out of scope here; the Safety Zones panel documents these uncovered paths.

### Consequences

A jog that would cross a keep-out is refused before any byte is sent, closing the gap between jogging and the job/frame/export paths. Pure core stays pure (returns the zone or null, no throw for control flow). No G-code or snapshot change. NOT hardware-verified - the geometry and the refusal are unit- and integration-tested (core segment cases + a connected-store jog that crosses a clamp sends nothing), but on-machine behavior is CLAIMED.

## ADR-130 - Registration-box provenance: protect a captured board from the jig panel (2026-07-10)

**Status:** accepted (audit CAM-04: the Registration Jig panel could silently unlock/replace a captured board, breaking its physical registration).

> **Numbering note.** ADR-129 (jog no-go zones) was the last used; **ADR-130** is the next free.

### Context

Place Board (ADR-124) and the Registration Jig panel share ONE reserved-color registration box (isRegistrationBox keys on the reserved color, not a provenance field). Place Board locks that box because its canvas position encodes the physical work origin (G92). But the always-available jig panel offered a one-click unlock checkbox and a Create/Replace button wired to the same box, so an operator could unlock+drag or replace a captured board and silently break centering, Fill/Array, and the burn placement, with no signal.

### Decision

Add an optional provenance?: 'captured-board' | 'jig' to ShapeObject. Place Board tags its outline 'captured-board' (in the locked() helper, the single construction choke point); jig creates leave it absent. Absent is treated as 'jig' (back-compatible: old .lf2 files load unchanged). The field round-trips as ordinary JSON (the deserializer passes non-text objects through as-is); the shape validator gains one optionalLiteral line so a malformed value is rejected at the .lf2 boundary.

The jig panel reads the current box provenance: for a captured board it disables the unlock checkbox and the Create/Replace button and shows a warning that unlocking or replacing it here breaks its physical registration, and to use Place Board to re-capture or Remove it first. Remove stays available as the explicit, safe path to clear a captured board.

### Consequences

A captured board can no longer be silently unlocked or replaced from the jig panel. The two features keep sharing one box (no second reserved layer), and the tag is additive/optional so nothing else changes. NOT hardware-verified; the guard is unit-tested (io round-trip + a panel render test asserting the disabled controls + warning for a captured board and enabled for a jig box).

## ADR-131 - Canonical Result<T, E> for core control-flow errors (2026-07-11)

**Status:** accepted (audit ARC-01/ARC-02: core geometry ops throw user-facing strings for expected user input, which CLAUDE.md's "Pure core" section bans; there was no shared type to convert them to, so ~46 files hand-rolled ad-hoc `{ ok }` / `{ kind }` shapes).

> **Numbering note.** ADR-130 (registration-box provenance) was the last used; **ADR-131** is the next free.

### Context

CLAUDE.md "Pure core" forbids throwing for control flow: "return a `Result<T, E>` discriminated union." But `grep 'Result<' src/core` returned zero files — the discipline was stated but had no vehicle. Ops such as `weldVectorObjects`, `combineVectorObjects`, and `offsetVectorObjects` threw `new Error(userMessage)` for expected conditions (too-few objects, open contours, empty intersection), and the four store actions swallowed them with the bare `try { … } catch { return state }` shape CLAUDE.md's anti-patterns list explicitly bans. Nothing in the type system marked these as throwing, so every future caller had to rediscover it. A first pass (CNV-10) converted three ops to an ad-hoc `{ ok, message }` shape — which is the very hand-rolling this ADR exists to eliminate.

### Decision

Add one pure-core module `src/core/result.ts` exporting the canonical type and its constructors:

```ts
export type Result<T, E> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'error'; readonly error: E };
export function ok<T>(value: T): Result<T, never>;
export function err<E>(error: E): Result<never, E>;
```

The `kind` tag matches the house discriminated-union style so `assertNever` closes a switch's default arm on the error variant, exactly like every other core union. There is no top-level `core/index.ts` barrel; consumers import `../result` (within core) or `../../core/result` (from ui), matching how the existing loose core files (`app-branding.ts`, `grbl-streaming.ts`) are imported. New ad-hoc `{ ok }` / `{ kind }` result shapes in core are disallowed going forward — converge on this type. Migration of the ~46 existing ad-hoc sites is incremental, not a single batch diff; ARC-02 converts the vector-geometry cluster first (weld/boolean/offset/dogbone) and supersedes CNV-10's interim `{ ok, message }` shape.

### Consequences

Core control-flow errors now have one typed channel a caller must narrow on (`result.kind === 'error'`) rather than a throw a caller may forget to catch. The addition is behavior-neutral (ARC-01 ships no consumers); the behavior change — deleting the throws and the `catch` swallows — lands in ARC-02. The 46 ad-hoc sites converge opportunistically as they are touched; this ADR is the reference they converge to.

## ADR-132 - The 250-line soft tier is a report-only script, not an ESLint warning (2026-07-11)

**Status:** accepted (audit ARC-03: the 250 soft tier promised by ADR-015, CLAUDE.md's size table, and PROJECT.md non-negotiable 15 had no enforcement mechanism — it was fiction).

> **Numbering note.** ADR-131 (canonical Result) was the last used; **ADR-132** is the next free.

### Context

ADR-015 lists a two-tier file-size discipline: 400 lines hard, 250 soft. The hard tier is a real ESLint gate (`max-lines: ['error', { max: 400, skipBlankLines, skipComments }]`, `eslint.config.mjs`). The soft tier was never implemented: `grep max-lines eslint.config.mjs` shows a single `error/400` entry, and the finding's recommendation to "add a second `max-lines` at warn/250" is **not achievable** — ESLint keys rules by name, so a second `max-lines` config for the same files *replaces* the first (last-wins), it does not stack. You cannot have warn/250 AND error/400 on the built-in rule simultaneously. 78 non-test src files currently sit over 250 counted lines (two — `io/svg/parse-svg.ts`, `ui/library/DesignLibraryDialog.tsx` — pinned at 400 with zero headroom), all invisible.

### Decision

The soft tier is a separate, report-only mechanism, not an ESLint severity. Add `scripts/check-soft-line-limit.mjs` (mirroring `check-file-size-policy.mjs`'s walk) that counts ESLint-style lines — skipping blank and comment-only lines, and skipping string literals so a `//`/`/*` inside a string is not misread as a comment — and lists non-test files over 250, then **always exits 0**. Tests and `__fixtures__` are excluded because `eslint.config.mjs` relaxes file-size for them; the soft report mirrors the hard rule's scope. It is wired as `check:soft-size` and appended (non-failing) to `release:check`; in CI it also appends a table to the job summary. The counter is a line-scan approximation of ESLint's AST count — validated against the audit's independent tally (78 ≈ the finding's 76–81) and against ESLint's own count (the two 400-pinned files register at exactly 400). ADR-015's wording is updated to say the soft tier is report-only.

### Consequences

The soft tier is finally visible without blocking anyone: `release:check` prints the over-250 list every run, so the drift is measured, but only the ESLint error/400 rule fails CI. Splitting the 78 files (especially the two 400-pinned ones, whose next edit forces an unplanned mid-feature split) stays out of scope — each is its own concept-driven tidy PR. Because the counter is an approximation, a file within a line or two of 250 may be mis-listed; it is a report, not a gate, so that is acceptable.

## ADR-133 - Camera bridge trusts only the exact production origins and refuses all loopback frame-proxy targets (2026-07-11)

**Status:** accepted (audit ELE-02: residual-risk hardening of ADR-121's loopback camera bridge; the finding "drivable cross-origin by every *.pages.dev preview; usable as a localhost scanner" was CONFIRMED).

> **Numbering note.** ADR-132 (soft-tier report-only script) was the last used; **ADR-133** is the next free.

### Context

ADR-121's loopback camera bridge opts into Private Network Access and trusted three origin classes in `isTrustedHostedAppOrigin` (`electron/rtsp-camera-bridge.ts`): `https://kerfdesk.com`, `https://laserforge-2fj.pages.dev`, AND any `*.laserforge-2fj.pages.dev` â€” every Cloudflare Pages preview of every branch/PR. Any such preview the operator opened in a normal browser could drive the bridge's `/discover`, `/frame.jpg?url=`, `/probe`, and `/stream.mjpg`. Separately, the frame-proxy URL policy (`electron/camera-frame-proxy-policy.ts`) refused only the bridge's OWN port as a proxy target (`targetsBridgeItself`), so `http://127.0.0.1:<other-port>` was permitted â€” the proxy could read other loopback services, acting as a localhost port/host oracle (timing/error) despite the private-network egress guard and the JPEG-magic content check.

### Decision

Two independent tightenings of ADR-121's origin/target policy:

1. `isTrustedHostedAppOrigin` trusts only the EXACT production hostnames (`kerfdesk.com`, `laserforge-2fj.pages.dev`) â€” the `.pages.dev` subdomain wildcard is dropped. A preview build that must reach a local bridge is expected to gate that behind an explicit dev flag, not a standing wildcard. The loopback-dev-origin allowance (`http://localhost` / `127.0.0.1`, any port) is unchanged: code already running on the operator's loopback can reach the cameras without the bridge's help, so it is outside the S03-001 drive-by-remote threat model.
2. `cameraFrameUrlPolicy` refuses ALL loopback targets (`localhost`, `::1`, `127.0.0.0/8`) on any port, not just the bridge port. The bridge-itself case keeps its clearer "cannot proxy itself" message; every other loopback host returns "private-network hosts only". Real machine cameras live on RFC1918, never loopback, so no legitimate reach is lost.

### Consequences

A preview-build deploy can no longer reach a locally-running bridge (intended â€” previews are for UI review, not hardware). A local test camera bound to loopback can no longer be proxied; real cameras (RFC1918) are unaffected. The residual timing/error oracle across the egress guard's allowed RFC1918 range remains â€” a per-session bridge token replacing Origin-header trust is the next step if the maintainer wants it, deferred to its own ticket. Behavior-only change; no G-code or core impact. The deliberate `camera-frame-proxy-policy.test.ts` expectation that loopback-on-another-port was `ok` is flipped to `invalid`.

### Amendment â€” origin-exact allowlist + residual hosted-origin threat (2026-07-11, R3)

Codex re-audit R3 split into a fixable bug and a documented residual:

- **Fixed (R3):** `isTrustedHostedAppOrigin` compared `url.hostname`, which discards the port, so `https://kerfdesk.com:444` was accepted despite the "exact production origins" intent. It now compares `url.origin` against a set of full origins (`https://kerfdesk.com`, `https://laserforge-2fj.pages.dev`), so a non-default port or a wrong scheme no longer matches. Test-first in `rtsp-camera-bridge.test.ts`.
- **Residual (accepted by design, NOT closed):** hosted-origin access to the loopback bridge is deliberate â€” ADR-121 makes the deployed site a supported bridge client so production CSP does not block camera probing. Therefore a compromise or XSS of an EXACT trusted hosted origin (`kerfdesk.com` / `laserforge-2fj.pages.dev`) can still drive `/discover`, `/probe`, and `/frame.jpg` against the operator's RFC1918/ULA cameras through the loopback bridge. Blocking loopback proxy targets (ADR-133) stops localhost scanning, not RFC1918/ULA discovery. The mitigation is per-session bridge-token auth replacing Origin-header trust; it is a larger change deferred to its own ticket (the maintainer decides whether the deployed-site camera workflow warrants it, or whether hosted access should be dropped). R3 is therefore "port-exactness fixed; hosted-origin access is an accepted, documented residual" â€” not "closed".

## ADR-134 - The workspace camera overlay honors the alignment basis, matching Trace (2026-07-11)

**Status:** accepted (Codex re-audit R2: the overlay applied a rectified-basis homography to raw pixels â€” a bug, not a design choice).

> **Numbering note.** ADR-133 (camera bridge exact origins) was the last used; **ADR-134** is the next free.

### Context

A camera alignment records the `basis` it was solved in (`raw` or `rectified`). `runAutoAlign` persists `basis: 'rectified'` whenever a lens calibration exists â€” the homography was solved on de-fisheyed pixels. Trace (`buildCameraTraceImage`, ADR-110) honors this: it `rectifyImage()`s the raw frame before applying the homography, and refuses (`basis-mismatch`) when a rectified alignment has no calibration. The workspace overlay (CAM-02 / c70f4b87) only rescaled the homography for resolution and never read `alignment.basis`, so a calibrated (rectified) alignment was applied as a linear CSS `matrix3d` directly to raw, distorted pixels â€” the overlay bowed at the bed edges and mis-registered, while Trace of the same scene was correct. A CSS `matrix3d` is a linear projective map and cannot represent the nonlinear de-fisheye, so the live `<video>` overlay cannot be corrected by a transform at all.

### Decision

The overlay honors `basis`, sharing one pure helper with Trace (`rectifyForAlignmentBasis` in `core/camera`, so the two can never diverge again):

- **Captured still, `basis: 'rectified'`, calibration present** â†’ de-fisheye the still in its canvas (same `rectifyImage` params as Trace) before applying the homography. This is the primary LightBurn "Update Overlay" path and is now correct.
- **`basis: 'rectified'`, no calibration** (still or live) â†’ refuse: show a small "needs a captured still" notice instead of a mis-registered overlay.
- **Live `<video>`, `basis: 'rectified'`** â†’ refuse (a CSS transform cannot de-fisheye); the operator captures a still to see the aligned overlay. This matches LightBurn, which lens-corrects a snapshot rather than streaming a de-fisheyed live overlay.
- **`basis: 'raw'`** â†’ unchanged (warp raw pixels directly).

The rectify runs once per source/alignment change (memoized), not per zoom/pan render.

### Consequences

Calibrated overlays now register correctly on the still. A visible UX change: for a rectified alignment on a live USB stream the overlay is replaced by a notice â€” the operator must capture a still (previously they saw a wrong overlay). Per-frame live de-fisheye (canvas-per-frame or a GPU shader, ADR-108) is deferred as a larger feature. NOT perceptually verified: the tests prove the basis routing and that a rectified still produces a new (de-fisheyed) buffer, not that the overlay visually lines up on real hardware â€” that needs a rendered comparison against the bed. The notice wording/placement is a maintainer UX call.

---

## ADR-135 - Gate desktop auto-update on a trusted, code-signed channel

**Status:** Superseded by ADR-141 | **Date:** 2026-07-12

### Context

ADR-024 allowed unsigned Windows builds to download an update from the pinned
R2 feed and install it on quit. The feed's SHA-512 value proves only that the
download matches `latest.yml`; both files come from the same origin. An attacker
who can replace the feed can therefore publish a higher-version installer and a
matching hash. With `autoDownload` and `autoInstallOnAppQuit` enabled, that code
would be accepted without an independent publisher identity check.

### Decision

Desktop auto-update is fail-closed behind an explicit trust gate. The updater
may run only when both conditions hold:

1. Electron reports a packaged build through `app.isPackaged`.
2. `IS_DESKTOP_UPDATE_CHANNEL_TRUSTED` is true because production installers
   and update artifacts are code-signed by the same approved Windows publisher.

Until signing is operational, the trust constant stays false. Packaged builds
remain fully usable but perform no update check, download, or install. Operators
update manually from the pinned KerfDesk download page. Enabling the constant
requires a separate release change that configures signing in CI, fails closed
when signing credentials are absent, and verifies a packaged update on Windows.

Once trusted, ADR-024's burn-safe behavior remains: background download,
install-on-natural-quit, and no `quitAndInstall()` call.

### Consequences

- An unsigned release-feed compromise cannot become a silent code-install path.
- Unsigned builds do not notify about new versions; manual download is the safe
  interim experience.
- The R2 publishing workflow may continue producing artifacts, but clients do
  not consume its update metadata until the signing gate is deliberately opened.
- Code signing is now a functional prerequisite for automatic updates, not only
  a SmartScreen/reputation improvement.

---

## ADR-136 - CNC interruption recovery rewinds to a retract-first safe boundary

**Status:** Accepted | **Date:** 2026-07-12

### Context

ADR-103/118 rebuilt modal state at the first unconfirmed line and emitted a CNC
preamble that started the spindle while the bit could still be embedded, then
rapid-retracted and plunged back to the recorded depth. A stopped spindle may
not accelerate under cutting load. GRBL acknowledgements also prove parsing or
planner admission, not physical execution, so an exact acknowledgement-line
resume can skip accepted-but-unexecuted motion. Finally, the checkpoint kept
progress but discarded the terminal safety reason after reload/reconnect.

### Decision

- CNC recovery treats the first unconfirmed line as an interruption vicinity,
  scans backward to the previous pure `G0 Z<safe>` retract, and replays from
  that semantic boundary. No safe boundary means no automatic resume.
- Its preamble emits a controlled `G1 Z<safe> F<recovered plunge>` extraction
  before any `M3`/`M4`, then starts the last active spindle mode and waits for
  the configured dwell at clearance. The replayed boundary owns XY travel and
  the plunge. Laser recovery keeps its beam-off position-first order.
- The checkpoint optionally persists the terminal safety category, operator
  message, and rejected line without a schema bump; existing schema-v3 records
  remain readable.
- A final `ok` advances progress but does not clear recovery. Clearing requires
  the completed stream to be released while connected at physical `Idle`.

### Consequences

Router recovery deliberately recuts from the start of a cutting segment rather
than trusting an arbitrary buffered line. This can mark already-cut material,
but avoids both gaps and a spindle restart while embedded. The operator still
must preserve work zero and pass all normal readiness checks. The behavior is
unit/integration verified; real interruption and embedded-tool hardware tests
remain unverified and must use the standing air-cut/scrap protocol first.

## ADR-137 - Trace reliability: latest request wins and completed work is reusable (2026-07-11)

**Status:** accepted.

> **Numbering note.** ADR-136 (CNC retract-first interruption recovery) was the last used; **ADR-137** is the next free.

### Context

The trace dialog debounces preview state, but the shared worker client still queues every request. A CPU-bound worker cannot receive a cancellation message until its current synchronous trace returns, so rapid preset changes can put obsolete jobs ahead of the only result the user wants. Every queued request also starts its own fixed timeout. Clicking Trace then decodes and traces the same source again even when the current preview already contains the matching geometry. On large or supersampled images, this duplicate and queued work is a more credible failure source than the tracing quality itself.

### Decision

Make the tracing pipeline explicitly single-flight and latest-wins. Starting a new worker trace retires the worker that owns an unfinished request, rejects that request with a typed superseded error, and runs the new request on a fresh worker. Supersession is control flow, not a preview error and not a reason to retry inline. The timeout applies only to the active request. A ready preview carries the identity of the file, options, boundary, and boundary mode; commit may reuse its paths and bounds only while all of those inputs still match. Bounded resize-at-decode, transferable worker buffers, and backend-specific working-pixel budgets preserve this one-live-job contract while limiting large-image memory and compute.

### Consequences

- Rapid option changes can pay worker startup again, but never wait behind stale CPU work; old worker memory becomes reclaimable as soon as it is terminated.
- The preview and commit paths share one completed result when their inputs match, removing the most common duplicate full trace.
- Large images are bounded before allocation-heavy tracing, and Region Enhance cannot stack an inner 4x supersampling pass on top of its own work scale.
- This is in-process cancellation, not cooperative cancellation inside the tracing algorithms. A backend that monopolizes the main thread remains out of scope, and worker termination latency remains browser-controlled.
- Regression coverage proves superseded jobs cannot fall back inline, stale timers cannot retire the replacement worker, mismatched preview inputs cannot be reused at commit, and working-pixel budgets hold across representative image sizes.

## ADR-138 - The primary toolbar is icon-first and never wraps

**Status:** Accepted | **Date:** 2026-07-13

### Context

The primary toolbar had fourteen text buttons and wrapped into a second row at
compact desktop widths. That reduced canvas height, shifted the numeric toolbar
and workspace during resize, and made the command surface visually dominant.
Removing commands would improve density at the cost of discoverability.

### Decision

- Every toolbar command uses a pinned `lucide-static` icon. Familiar file,
  import, export, Preview, and Shortcuts actions are icon-only at all widths.
- Specialist commands retain icon-plus-label presentation above 1280 px and
  switch to icon-only at 1280 px and below.
- Icon-only buttons keep the complete command label as their accessible name
  and retain the command registry's tooltip, shortcut, disabled reason, and
  pressed state.
- The toolbar is one non-wrapping row. Its command-group region may scroll
  horizontally on unusually narrow windows; the brand and Shortcuts control
  remain fixed outside that region, except the redundant brand wordmark hides
  below 700 px to preserve every command before scrolling is needed.
- Icons come from the already-approved `lucide-static` dependency. Imported SVG
  strings are build assets, never project or user content.

### Consequences

The workspace no longer jumps between one-row and two-row chrome. Common
desktop widths gain vertical space while specialist labels remain available
where room permits. Operators on narrow windows may need to horizontally scroll
the command group, but every command also remains available from the menus.

## ADR-139 - Right workspace rails are independently collapsible, with machine controls fail-visible

**Status:** Accepted | **Date:** 2026-07-13

### Context

The fixed 320 px Cuts/Layers rail and 300 px machine rail consume most of a
1024 px workspace before the drawing tool strip. The canvas remains technically
responsive but becomes too narrow for practical layout work. Neither rail had a
visibility command, so operators could not trade inspector space for canvas
space without resizing the whole application.

The machine rail also owns the visible Stop control. Treating it like an
ordinary hideable inspector during a stream would remove the primary pointer
target for an emergency stop, even though the global keyboard shortcut remains.

### Decision

- Ephemeral UI state tracks Cuts/Layers and machine-panel visibility
  independently. It is not project data and is not included in undo or `.lf2`.
- Each expanded rail has a header collapse button. A collapsed rail remains as
  a narrow named strip with an expand button, preserving location and
  discoverability.
- Checked commands in the Window menu mirror both visibility states.
- Entering a viewport 700 px wide or narrower collapses both rails once. Users
  may expand either rail while remaining compact; the default reapplies only on
  the next transition into compact mode.
- An active job makes the machine panel fail-visible regardless of its stored
  preference. Its collapse button and Window command are disabled until the job
  is no longer active, so the visible Stop control remains reachable.

### Consequences

Compact windows can recover 280 px per collapsed rail without hiding how to
restore the panels. Ending a job restores the operator's prior machine-panel
preference, so a panel that was collapsed before Start collapses again after the
stream fully settles. Panel visibility remains session-only; persistence across
launches can be added later if user testing shows that preference is valuable.
At 700 px and below, the initial canvas no longer collapses to zero width.

## ADR-140 - CNC profile finish allowance + finishing pass (Phase H follow-up, 2026-07-13)

> **Numbering note.** ADR-137 through ADR-139 are accepted. **ADR-140** is allocated to this decision.

Context. A profile cut removes the full wall across its depth passes, so the
finished edge carries the roughing tool's deflection and chatter. Production CNC
work leaves a small "stock to leave" allowance on roughing and removes it with a
light finishing pass along the true contour for a cleaner wall.

Decision. Optional per-layer `finishAllowanceMm` on CncLayerSettings, for
profile-outside / profile-inside cuts only (0/absent = off, byte-identical).
When > 0:
- Roughing offsets the contour by tool-radius + allowance, staying that far
  proud of the finished wall (profileToolpathPolylines gained an allowance arg).
- One finishing pass at the true contour (tool-radius offset, allowance 0) at
  full depth is appended after the roughing passes.
- Holding tabs: the finishing pass runs through the SAME tab split the deepest
  roughing pass uses, so tabs are preserved and the part stays attached.

Scope. Profile cuts only. Pocket-wall finishing, profile-on-path, and relief
(which already has its own H.8 finishing skim) are out of scope, documented in
code, and covered by a test showing those cut types are unaffected.

Consequences.
- Determinism (#5): allowance 0/absent is byte-identical (tested).
- HARDWARE-GATED / CLAIMED: the toolpath is unverified on a real machine.
- RESIDUAL RISK - tab alignment: roughing and finishing tabs are placed by the
  same perimeter-fraction logic on concentric contours, so they align for
  typical convex profiles; on complex/concave geometry clipper's offset can pick
  a different start vertex and misalign them, which could sever the part. Verify
  with a test cut before trusting tabs + finish allowance together on intricate
  parts.

## ADR-141 - Disable executable CNC checkpoint and start-from-line recovery

**Status:** Accepted | **Date:** 2026-07-13

### Context

ADR-136 improved one failure mode by rewinding CNC recovery to a retract-first
boundary, but the app still could not prove that retract was safe. A GRBL `ok`
means a line was accepted into controller/planner processing; it does not prove
that the physical cut completed, that position survived the interruption, or
that the cutter is clear. Automatically moving Z can therefore pull a stopped
or broken tool through stock, clamps, or a shifted workpiece. No generic G-code
preamble can infer tool engagement, retained work coordinates, workholding
integrity, or the correct extraction direction.

### Decision

- Automatic CNC restart from both checkpoints and arbitrary G-code lines is
  disabled. The core resume builder returns a stable policy error for every CNC
  request before it parses or emits any motion.
- The UI removes the executable CNC recovery controls and replaces them with a
  supervised recovery message: inspect engagement, establish clearance with a
  machine-specific procedure, re-home if position may be lost, verify WCS/Z
  zero/tool/workholding, and start a newly reviewed recovery job.
- CNC checkpoints remain visible as diagnostic evidence, including accepted-line
  counts and the recorded interruption cause, until the operator dismisses them.
  Their counts are labelled as controller acknowledgements, not completed motion.
- Laser start-from-line and checkpoint recovery remain available with their
  beam-off positioning rules. Ordinary live Feed Hold/Resume is unchanged; it
  resumes the same controller session and is not crash/start-from-line recovery.

### Consequences

KerfDesk no longer offers one-click continuation for an interrupted router job.
Operators may lose machining time and must create a deliberate recovery job,
but the application will not guess physical cutter state from transport-level
acknowledgements. A future CNC recovery feature requires machine-specific,
hardware-validated state acquisition and a supervised recovery state machine;
re-enabling the old retract-first preamble is not an acceptable shortcut.
