# RESEARCH_LOG.md — LaserForge 2.0

> Every external claim, library adoption, or source-of-record decision that influenced an ADR or a piece of code lives here. Stale entries are worse than no entries — re-verify entries older than ~6 months for fast-moving topics (frameworks, browser APIs, security advisories).
>
> Entry format below. New rows are added on PR; existing rows are updated with `Re-verified:` lines when re-checked.
>
> **Note on license-history references (2026-05-27).** Earlier entries describe the project as "MIT-licensed" and reject GPL deps with phrasing like "would taint MIT license." That was true under ADR-008. **ADR-018 superseded ADR-008**: the project source is now proprietary (private repo, monetization deferred), but the **dependency policy is unchanged** — MIT-compatible only, GPL rejected. The rejections in this log remain valid; only the framing-as-MIT is historical.

---

## How to add an entry

Whenever you adopt a runtime dependency, cite an external standard, or rely on a third-party claim to justify a decision, add a row here in the relevant section. Before the PR that uses the claim or dependency can merge, this file must contain the entry.

Required fields:

- **Subject** — library name, standard name, source name.
- **Version / date** — the exact version pinned, or the publication date of the source.
- **License** — for libraries; "n/a" for standards or source code references.
- **Source URL** — official repo, official spec, official advisory.
- **Decision affected** — ADR ID or file path.
- **Evaluated** — date and evaluator (`Claude Code session` is acceptable; sign your PR).
- **Confidence** — high / medium / low. Low requires re-verification before any change to the decision.
- **Re-verify by** — a date (~6 months out for fast-moving topics, ~12 months for stable).
- **Alternatives considered** — for adoptions only; what else was looked at and why rejected.
- **Notes** — CVEs, known issues, planned upgrades.

---

## Adopted runtime dependencies

Each entry here corresponds to a `package.json` dependency. New rows are added when a dependency is added; existing rows are updated when a version is bumped.

### DOMPurify

- **Version:** ≥ 3.3.2 (pinned floor; latest at adoption: 3.4.6 — verified via `cure53/DOMPurify` `package.json` on 2026-05-27)
- **License:** MPL-2.0 OR Apache-2.0 (verified MIT-compatible per ADR-017)
- **Source:** https://github.com/cure53/DOMPurify
- **Decision affected:** ADR-017 (library policy); used in `src/io/svg/` for sanitization
- **Evaluated:** 2026-05-26
- **Confidence:** high
- **Re-verify by:** 2026-11-26
- **Alternatives considered:**
  - `sanitize-html` (MIT) — rejected; HTML-focused, weaker SVG support.
  - Hand-rolled `<script>`/`xlink:href` stripping — rejected; small attack surface but the well-known maintained library is safer and CVE-tracked.
- **Notes:**
  - CVE-2026-0540 fixed in 3.3.2 — pinned floor is the fix version, not the latest.
  - Used with `USE_PROFILES: { svg: true, svgFilters: true }` plus a custom hook stripping external `xlink:href` references and non-image data URIs.
  - Bundle impact: ~80 KB minified, ~25 KB gzipped. Acceptable against the 1 MB budget.
  - Test corpus of crafted-malicious SVGs lives at `src/__fixtures__/svg/malicious/`.

### React + React DOM

- **Version:** ^18.3.0 (resolved: 18.3.1)
- **License:** MIT
- **Source:** https://github.com/facebook/react
- **Decision affected:** ADR-009 (TypeScript + React + Vite + Vitest stack)
- **Evaluated:** 2026-05-26
- **Confidence:** high (mature, ubiquitous)
- **Re-verify by:** 2027-05-26
- **Alternatives considered:**
  - Svelte / SolidJS — rejected per ADR-009 (smaller talent pool; less battle-tested with `eslint-plugin-boundaries`).
  - React 19 — deliberately pinned to 18.x for MVP stability; 19's new compiler is not load-bearing.
- **Notes:**
  - Used with the new JSX transform (`jsx: "react-jsx"` in tsconfig).
  - Bundle impact: ~45 KB gzipped for react + react-dom.

### Zustand

- **Version:** ^4.5.0 (resolved: 4.5.7)
- **License:** MIT
- **Source:** https://github.com/pmndrs/zustand
- **Decision affected:** ADR-009 (state library choice)
- **Evaluated:** 2026-05-26
- **Confidence:** high
- **Re-verify by:** 2027-05-26
- **Alternatives considered:**
  - Redux Toolkit — rejected per ADR-009 (boilerplate fights ADR-015 file-size limits).
  - React Context-only — rejected (re-render fan-out unmanageable as Project state grows).
  - Zustand 5 — deliberately pinned to 4.x; 5 is React 19-only.
- **Notes:**
  - Single store in `src/ui/state/store.ts`; selectors are inline at call sites.
  - Bundle impact: ~3 KB gzipped.

### Phase A build-time stack (umbrella entry under ADR-009)

The following dev dependencies are adopted as a package per ADR-009 and are
not separately evaluated against ADR-017's per-library criteria — the stack
choice itself was the ADR. Listed here for completeness so the bundle / CVE
audit can find them.

Versions below reflect the current `package.json` (last refreshed 2026-05-28
after the F-2 security bump). When you bump anything in this table, also
append a row to the "Re-verification log" further down so the diff stays
auditable.

| Package | Version (pinned ^) | License | Role |
|---|---|---|---|
| `typescript` | ^5.5.0 | Apache-2.0 | Type-checker |
| `vite` | ^6.4.2 | MIT | Web build + dev server |
| `@vitejs/plugin-react` | ^4.3.0 | MIT | JSX transform for Vite |
| `vitest` | ^3.2.4 | MIT | Test runner |
| `@vitest/coverage-v8` | ^3.2.4 | MIT | Coverage |
| `jsdom` | ^25.0.0 | MIT | DOM env for Vitest |
| `fast-check` | ^3.22.0 | BSD-2-Clause | Property tests |
| `eslint` | ^9.10.0 | MIT | Linter |
| `@eslint/js` | ^9.10.0 | MIT | Core rules |
| `typescript-eslint` | ^8.6.0 | MIT (BSD-2 components) | TS lint rules |
| `eslint-plugin-boundaries` | ^6.0.2 | MIT | Module isolation (ADR-010) |
| `eslint-plugin-import` | ^2.31.0 | MIT | Import-cycle detection |
| `eslint-plugin-react` | ^7.36.0 | MIT | React rules |
| `eslint-plugin-react-hooks` | ^5.0.0 | MIT | Hook-deps rule (wired post-R-H4) |
| `eslint-config-prettier` | ^9.1.0 | MIT | Disables style rules covered by Prettier |
| `eslint-import-resolver-typescript` | ^3.6.3 | ISC | TS path resolution for boundaries |
| `prettier` | ^3.3.0 | MIT | Formatter |
| `globals` | ^15.9.0 | MIT | Predefined env globals |
| `license-checker` | ^25.0.1 | BSD-3-Clause | CI license audit |
| `@types/node`, `@types/react`, `@types/react-dom`, `@types/opentype.js` | various | MIT (DefinitelyTyped) | Type declarations |
| `electron` | ^42.3.0 | MIT | Windows desktop shell (bumped F-2; CVE-2026-34769/34780 patched) |
| `electron-builder` | ^26.11.1 | MIT | Desktop installer pipeline |
| `wrangler` | ^4.95.0 | MIT / Apache-2.0 | Cloudflare Pages deploy CLI |

All licenses verified MIT-compatible by `pnpm license-check` (production-only)
+ manual review of dev-dep tree. The CI workflow re-runs the check on every
push.

---

## Pinned for future phases (not yet adopted)

These have been chosen in advance but are not yet in `package.json`. Re-verify at the start of the relevant phase before adoption.

### opentype.js — adopted Phase D (2026-05-27)

- **Version:** 2.0.0
- **License:** MIT (re-verified 2026-05-27 against the upstream `package.json`)
- **Source:** https://github.com/opentypejs/opentype.js
- **Decision affected:** ADR-012 (text + fonts as Phase D)
- **Status:** ADOPTED as runtime dependency
- **Evaluated:** 2026-05-26 (preliminary) → re-verified + adopted 2026-05-27
- **Confidence:** high
- **Alternatives reconsidered at kickoff:**
  - `fontkit` (MIT) — heavier (~600 KB unminified); supports more font formats than we need (WOFF2, etc.). Skipped.
  - `harfbuzzjs` (MIT) — text shaping for complex scripts; overkill for Latin-script MVP-D and 10× the size.
- **Bundle impact:** adds ~265 KB to the JS bundle (524 KB total → 161 KB gzip). Within PROJECT.md's "< 1 MB compressed" target with margin. Lazy-loading deferred — could re-evaluate if a future feature pushes the bundle past 200 KB gzip.
- **Bundled fonts:** Roboto Regular (Apache-2.0), Inconsolata Regular (OFL-1.1), Pacifico Regular (OFL-1.1). All MIT-compatible per ADR-017. Loaded on-demand via UI-layer `font-loader.ts` — fonts are not in the initial JS bundle.

### imagetracerjs — adopted Phase E (2026-05-27)

- **Version:** 1.2.6 (npm package name is `imagetracerjs`, not `imagetracer.js`)
- **License:** **Unlicense** (public domain) — more permissive than the preliminary "MIT" note; on the ADR-017 allow-list either way
- **Source:** https://github.com/jankovicsandras/imagetracerjs
- **Decision affected:** ADR-013 (image vectorize as Phase E)
- **Status:** ADOPTED as runtime dependency
- **Evaluated:** 2026-05-26 (preliminary) → re-verified + adopted 2026-05-27
- **Confidence:** high
- **Alternatives reconsidered at kickoff:**
  - `potrace-wasm` — **rejected** again; potrace is GPL-2, fails the dependency-license allow-list per ADR-017.
  - `image-trace` — looked unmaintained at kickoff. Skipped.
- **Bundle impact:** ~50 KB minified. Negligible vs the existing bundle.
- **Integration shape:** UI layer decodes file → canvas → ImageData, then `core/trace/trace-image.ts` runs `imagedataToSVG`. The resulting SVG string flows through the existing `parseSvg()` pipeline (reuses DOMPurify sanitization + bezier flattening + color-keyed layer assignment). Output becomes a `TracedImage` SceneObject — same `paths: ColoredPath[]` shape as ImportedSvg and TextObject, so compileJob / draw-scene need only one new switch arm each.
- **Trace quality:** Acceptable on the fixture corpus (synthetic black-on-white square + standard test). Real-world quality depends heavily on input contrast and the `numberofcolors` parameter; the dialog exposes 2-16 colors with 2 as the default for clean engraving cuts.

---

## External standards and references (non-dependencies)

These are not in `package.json`; they are sources of record we rely on for protocol correctness, scope decisions, or comparison.

### GRBL v1.1 protocol

- **Version / date:** v1.1f (latest stable as of evaluation)
- **License:** GPL-3 (the firmware itself; **we do not depend on or distribute it** — we implement against its protocol, which is documentation, not licensed code)
- **Source:** https://github.com/gnea/grbl/wiki
- **Decision affected:** ADR-006 (GRBL-only in MVP)
- **Evaluated:** 2026-05-26
- **Confidence:** high (protocol is mature and stable)
- **Re-verify by:** 2027-05-26
- **Notes:**
  - We do not link, vendor, or distribute GRBL source. We implement a client against its serial protocol — protocol implementations are not subject to source license.
  - Key spec areas referenced: real-time commands (`?`, `~`, `!`, `\x18`), status report format, alarm codes, settings (`$$`, `$30`, `$32`), homing cycle.
  - When a Phase B implementation question is ambiguous (e.g., timing of position polling), this wiki + the CNCjs source code (see below) are the resolution sources, in that order.

### CNCjs source code

- **Version / date:** 1.10.x (latest stable at evaluation)
- **License:** MIT
- **Source:** https://github.com/cncjs/cncjs
- **Decision affected:** ADR-006, ADR-017 (Phase B protocol reference, not a dependency)
- **Evaluated:** 2026-05-26
- **Confidence:** high (long-maintained, widely used)
- **Re-verify by:** Phase B kickoff
- **Notes:**
  - **Reference only — not a dependency.** Read for GRBL protocol details, alarm code → message mappings, and streaming state machine patterns.
  - License compatibility is not the gating factor; the gating factor is that CNCjs's architecture is a full sender (full app), and adopting it as a library would impose its data model on our pipeline.
  - Phase B will copy *patterns* (e.g., streaming buffer sizing, alarm handling) into our `src/controllers/grbl/`, not source code.

### W3C SVG 1.1 / 2 specifications

- **Version / date:** SVG 1.1 (2011), SVG 2 candidate recommendation
- **License:** W3C Software and Document License (compatible with use as a reference)
- **Source:** https://www.w3.org/TR/SVG11/ and https://www.w3.org/TR/SVG2/
- **Decision affected:** ADR-010, `io/svg/` implementation
- **Evaluated:** 2026-05-26
- **Confidence:** high (stable standard)
- **Re-verify by:** 2027-05-26
- **Notes:**
  - Path data grammar reference is in §9.3 of SVG 1.1.
  - The "unitless coordinates = mm" convention is our project's choice (matches laser community), not the SVG spec's default (which is `px`). This is documented in `WORKFLOW.md` F-A3 edge cases.

### LightBurn (UX reference)

- **Version / date:** 1.7.x (latest at evaluation)
- **License:** Proprietary, paid (~$60 one-time)
- **Source:** https://lightburnsoftware.com/
- **Decision affected:** ADR-001 (workflow model)
- **Evaluated:** 2026-05-26
- **Confidence:** high
- **Re-verify by:** 2027-05-26
- **Notes:**
  - **UX reference only — no source access, no code copying, no asset copying.**
  - We replicate the user-visible workflow (color-as-layer, Cuts/Layers window, Laser window, naming conventions) because it is the recognized convention in the field, not because of LightBurn IP.
  - Where our product deviates from LightBurn (GRBL-only per ADR-006, web-app delivery per ADR-003, etc.), the deviation is documented in its own ADR.

### Open-source competitor landscape (research)

- **Date:** 2026-05-26
- **Source:** Web research summarized below; full search results in conversation history.
- **Decision affected:** ADR-001, ADR-003, ADR-008
- **Confidence:** medium (competitor landscape moves)
- **Re-verify by:** 2026-11-26
- **Findings (paraphrased):**
  - Open-source GRBL CAM tools active in 2026: Rayforge (MIT, Gtk4/Linux+Windows), LaserGRBL (Windows only), MeerK40t (multi-platform), CNCjs (general G-code sender), gSender (general G-code sender). None ships a web app + Windows desktop combination; this is our differentiator.
  - LightBurn remains dominant in paid space at ~$60.
  - No competitor combines: web delivery, multi-color layer assignment, GRBL streaming, single-codebase web+desktop. LaserForge 2.0 targets this combination. (Original framing included "MIT license" as a differentiator; superseded by ADR-018 — license is now proprietary while monetization is decided.)

---

## Re-verification log

Append re-verification entries here when an existing row is re-checked. Format:

```
- YYYY-MM-DD — {Subject} — {what changed or "unchanged"} — {evaluator}
```

- 2026-05-27 — DOMPurify — bumped from ^3.3.2 to current `^3.3.2` (still patched against CVE-2026-0540; no version drift required at this time) — Claude
- 2026-05-27 — F-2 dev-dep security bump — electron 32 → ^42.3.0, electron-builder 25 → ^26.11.1, vite 5 → ^6.4.2, vitest 2 → ^3.2.4, @vitest/coverage-v8 2 → ^3.2.4, eslint-plugin-boundaries 5 → ^6.0.2, tmp transitive override `<0.2.6 → ^0.2.6`. `pnpm audit` 34 → 0/0/0/0. CVE-2026-34769 (Electron command-line switch injection) and CVE-2026-34780 (WebCodecs preload bypass) patched. — Claude
- 2026-05-27 — wrangler — added as a new dev dep `^4.95.0` (MIT) for Cloudflare Pages deploy. Approved post-hoc per ADR-017 (build-tool category, see ADR-009 umbrella). — Claude
- 2026-05-28 — gnea/grbl — re-verified upstream status. Repo archived since Aug 2019; 1.1h remains de-facto wire protocol; active forks are grblHAL, FluidNC, µCNC. Our streaming code is protocol-compatible with all three (only depends on 1.1h surface). — Claude

---

## Rejected dependencies (history)

Libraries that were evaluated and explicitly rejected. Keeping this list prevents re-evaluating the same library cold.

### potrace-wasm

- **Evaluated:** 2026-05-26
- **Rejection reason:** GPL-2 license is incompatible with the project's dependency-license allow-list per ADR-017 (MIT-compatible only). Rejection survives the ADR-008 → ADR-018 license-posture change.
- **Decision affected:** ADR-013
- **Re-evaluate if:** the project's license changes (it won't), or a wrapper exists with an explicit non-GPL re-licensing of potrace (doesn't currently exist; potrace authors hold the copyright).

### paper.js / fabric.js (as primary rendering layer)

- **Evaluated:** 2026-05-26
- **Rejection reason:** Both are excellent vector libraries (MIT), but each imposes its own scene-graph data model. Adopting either would require our pipeline to consume their structures, contradicting ADR-010 (pure-function core with our own data model) and ADR-014 (`SceneObject` discriminated union). Canvas2D with our own model is sufficient.
- **Re-evaluate if:** the canvas rendering layer becomes a perf bottleneck and a custom Canvas2D solution is no longer adequate. At that point, a wrapper around one of these libraries inside `ui/workspace/` (not in `core/`) might be reconsidered.

### cncjs (as a runtime dependency)

- **Evaluated:** 2026-05-26
- **Rejection reason:** Architecturally a full G-code sender application, not a library. Adopting it would force our app to be a CNCjs plugin or fork. We instead use its source as a *reference* (see above) and write our own client.
- **Re-evaluate if:** CNCjs extracts its protocol implementations into a standalone, reusable library (announced or attempted multiple times; not currently available).

### sanitize-html

- **Evaluated:** 2026-05-26
- **Rejection reason:** HTML-focused; weaker SVG support than DOMPurify. DOMPurify's `USE_PROFILES: { svg: true }` is purpose-built for our use case.
- **Re-evaluate if:** DOMPurify becomes unmaintained or has a security incident we can't accept the response time on.

### grbl-sim / grbl (as references for the planner-aware estimator)

- **Subject:** GRBL motion planner — junction-deviation cornering + two-pass lookahead
- **Sources consulted:**
  - **grbl** itself (github.com/gnea/grbl) — `planner.c`, `stepper.c`. License: **GPL-3.0**. Read-only reference per ADR-017 (same status this log gives CNCjs for protocol work). No code copied.
  - **grbl-sim** (github.com/grbl/grbl-sim) — earlier-thought-to-be-MIT; actually GPL-3. Same read-only reference.
  - **Sonny Jeon's "Improving Grbl: cornering algorithm"** (2014 design paper, publicly published). Algorithm and math are public — algorithms are not copyrightable.
  - **MeerK40t** (github.com/meerk40t/meerk40t) — MIT-licensed laser app. Skimmed for sanity-check; their planner is heavier than what we needed for an estimator and we did not adopt code.
- **Evaluated:** 2026-05-27
- **Outcome:** wrote `src/core/job/planner.ts` from first principles using the published junction-deviation formula (`v_j = √(a·δ·sin(θ/2) / (1−sin(θ/2)))`) and standard motion-control trapezoidal-profile math. No code copied from any source; the algorithm is the same one every GRBL-class machine implements internally.
- **Re-evaluate if:** estimate accuracy regressions appear that the formula alone can't explain — at that point, comparing against grbl-sim's instrumented output is the right reference.

---

## Phase F kickoff — scanline fill, dithering, image→G-code (2026-05-28)

Per ADR-017, libraries are surveyed at phase kickoff. Phase F (raster
engrave) splits into F.1 (Fill mode, in progress) and F.2 (Image mode,
future). This entry covers F.1's library survey; F.2 will get its own
entry at kickoff.

### Scanline polygon fill (F.1)

**Use case:** closed polyline + hatch angle + spacing → array of hatch
line polylines. Pure algorithm, ~150 LOC.

**Candidates evaluated:**
- **`flatten-svg`** (npm, ISC) — already in our permitted-license set
  per ADR-017. But it converts SVG curves to flat polylines; it does
  NOT do hatching. Doesn't fit our use case. **Not adopted.**
- **`polygon-clipping`** (npm, MIT) — boolean polygon ops (union,
  intersection, difference). Could in principle hatch by intersecting
  a polygon with parallel-line stripes, but that's 10× the work of a
  scanline fill and pulls a ~50 KB dependency. **Not adopted.**
- **No maintained MIT-licensed JS library** does "polygon + angle +
  spacing → hatch lines" specifically. Every CAM tool we surveyed
  (LightBurn, LaserGRBL, Inkscape's Hershey extension) self-implements
  the scanline-fill core because it's small and the parameter
  conventions vary per app.
- **Self-implementation** (`src/core/job/fill-hatching.ts`) — ~150 LOC
  of pure code, even-odd fill rule, half-open interval for vertex-on-
  scanline cases, snake fill for travel optimization, snap-to-clean
  values at multiples of 90°. 10 unit + property tests cover symmetry,
  donut holes, open polylines, degenerate input, float-precision drift.
- **Evaluated:** 2026-05-28
- **Outcome:** self-implement. No dependency added. Algorithm is from
  first principles + classical computer-graphics scanline-fill literature
  (Foley, van Dam) — well-trodden, no IP encumbrance.
- **Re-evaluate if:** a future need (concave-with-non-trivial-holes,
  variable-density hatching, dotted-line hatching) outgrows the simple
  scanline core.

### Dithering + image → G-code (deferred to F.2)

Two libraries are pre-noted here so the F.2 kickoff has a head start.
Neither is adopted in F.1 (F.1 doesn't do raster anything).

- **`floyd-steinberg`** (npm, MIT) — single-purpose Floyd-Steinberg
  error-diffusion dither. Last published 8 years ago; tiny (~30 LOC of
  algorithm under the hood). Maintenance: stale but the algorithm is
  textbook so an unmaintained pin is fine.
- **`img2gcode`** (npm, MIT) — image-to-G-code wrapper. Unmaintained
  (last release > 4 years ago). Scope larger than ours (it owns
  serial output too). **Likely not adopted at F.2 kickoff** —
  self-implement the ~80 LOC raster emit and reuse our existing
  streamer.
- **Decision deferred:** to F.2 kickoff ADR-020.

---

## Notes on style

- Be concrete. "Used by many projects" is not a useful claim; "4,281 npm dependents as of 2026-05-26" is.
- Be honest about confidence. "high" means you'd defend this in a code review; "low" means you'd want a second opinion.
- Verify licenses against the actual `LICENSE` file in the upstream repo, not against npm metadata or reputation.
- A library is not added to `package.json` until its row exists here. CI enforces this with a custom lint rule cross-checking `package.json` against this file.
