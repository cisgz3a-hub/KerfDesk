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
- `imagetracer.js` (MIT). `potrace-wasm` rejected (GPL-2).
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
ESLint fails CI on violation. Periodic audit: `find src -name '*.ts*' -exec wc -l {} +` produces no file > 400.

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
- `imagetracer.js` (MIT) — Phase E raster trace.

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

1. **Phase A fixture corpus.** Five SVG fixtures for snapshot tests.
2. **Bundled MIT fonts list** for Phase D (resolved at Phase D kickoff).

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

## Future ADRs (anticipated, not yet written)

- ADR-019 — GRBL streaming state machine design (Phase B)
- ADR-020 — Alarm code → user-message mapping (Phase B)
- ADR-021 — Web-app deployment target (before first deploy)
- ADR-022 — Update mechanism for Windows desktop (before first signed release)
- ADR-023 — Image trace parameter defaults for Phase E
