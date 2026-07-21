# RESEARCH_LOG.md — LaserForge 2.0

> Every external claim, library adoption, or source-of-record decision that influenced an ADR or a piece of code lives here. Stale entries are worse than no entries — re-verify entries older than ~6 months for fast-moving topics (frameworks, browser APIs, security advisories).
>
> Entry format below. New rows are added on PR; existing rows are updated with `Re-verified:` lines when re-checked.
>
> **Note on license-history references (2026-05-27, updated 2026-07-07).** Earlier entries describe the project as "MIT-licensed" and reject GPL deps with phrasing like "would taint MIT license." That was true under ADR-008, superseded by ADR-018 (proprietary, private, 2026-05-27), which is in turn superseded by **ADR-120 (2026-07-07): the project is MIT-licensed and open source again**. The dependency policy was identical under all three postures — MIT-compatible only, GPL rejected — so every rejection in this log remains valid.

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
- **Bundled fonts:** Roboto Regular (Apache-2.0), Inconsolata Regular (OFL-1.1), Pacifico Regular (OFL-1.1), Dancing Script Regular (OFL-1.1). All MIT-compatible per ADR-017. Loaded on-demand via UI-layer `font-loader.ts` — fonts are not in the initial JS bundle.

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
- **2026-05-28 — preprocessing upgrade (Phase E.2).** Real-world trace quality on user-supplied images (banner logos, photos) was visibly poor on the bare imagetracerjs path. Rather than swap libraries, added three pure-core preprocessing stages composed before the tracer:
  - **Otsu's adaptive threshold** — picks the binary cutoff from the image's luma histogram by maximising between-class variance. Reference: N. Otsu, "A Threshold Selection Method from Gray-Level Histograms", IEEE Trans. Sys. Man. Cyber. 9 (1979). Public-domain math; implemented from the paper, no library used.
  - **3×3 median filter** — kills salt-and-pepper noise (JPEG artefacts, scan dust) before threshold. Classic image-processing primitive, public domain.
  - **Connected-component despeckle** — removes ink regions below N pixels via 4-connected BFS. Topology preserving (letter holes survive). Textbook flood-fill, public domain.
  - **TRACE_PRESETS reworked** to use these stages. "Line Art" now: Otsu + despeckle 12; "Smooth" adds median + despeckle 24; "Sharp" Otsu + despeckle 4; "Detailed" / "Photo" use median.
- **Alternatives that would replace imagetracerjs entirely (parked, not adopted):**
  - **vtracer** (MIT, Rust-based, has WASM build) — visioncortex group; known higher quality than imagetracerjs. Strong candidate for a future evaluation. Would need a bundle-impact + integration-shape review before adoption per ADR-017.
  - **potrace** (GPL-2) — gold standard but license-incompatible per ADR-017. Algorithm (Selinger 2003 paper) could be re-implemented from scratch if the preprocessing-upgrade path stops being enough.

---

## External standards and references (non-dependencies)

These are not in `package.json`; they are sources of record we rely on for protocol correctness, scope decisions, or comparison.

### GRBL v1.1 protocol

- **Version / date:** v1.1f (latest stable as of evaluation)
- **License:** GPL-3 (the firmware itself; **we do not depend on or distribute it** — we implement against its protocol, which is documentation, not licensed code)
- **Source:** https://github.com/gnea/grbl/wiki
- **Upstream status:** gnea/grbl is archived since Aug 30 2019 (last commit, last accepted PR). 1.1h is the de-facto wire protocol; actively maintained protocol-compatible forks are **grblHAL**, **FluidNC**, and **µCNC**.
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

### Fill hatch overscan and GRBL endpoint burn behavior

- **Version / date:** LightBurn docs crawled 2026-06-01; GRBL v1.1 documentation
- **License:** n/a
- **Source URLs:**
  - https://docs.lightburnsoftware.com/UI/CutSettings/CutSettings-Fill.html
  - https://docs.lightburnsoftware.com/Troubleshooting/JobQuality/BurnedEdges.html
  - https://docs.lightburnsoftware.com/2.1/Explainers/Overscanning/
  - https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/SharedSettings/
  - https://github.com/gnea/grbl
  - https://github.com/gnea/grbl/blob/master/doc/markdown/settings.md
- **Decision affected:** ADR-031 (proposed); `src/core/job/job.ts`,
  `src/core/job/compile-job.ts`, `src/core/output/grbl-strategy.ts`
- **Evaluated:** 2026-06-01 by Codex
- **Confidence:** high for overscan root cause; medium for exact default
  distance because acceleration and material vary per machine.
- **Re-verify by:** 2026-12-01
- **Notes:**
  - LightBurn documents Fill as scan-line engraving of closed shapes and
    says Overscanning adds extra moves before/after each line so the
    head reaches speed before firing and slows after the laser is off.
  - LightBurn's dark-edge troubleshooting specifically attributes
    darker Fill/Image edges to missing or incorrect overscanning.
  - LightBurn defaults GRBL devices to Variable Power (`M4`) and treats
    Constant Power (`M3`) as a compatibility option; GRBL documents
    `M4` dynamic laser power as speed-scaled. LaserForge keeps `M3` for
    the first Fill overscan increment to minimize blast radius; `M4`
    Fill is a separate hardware experiment if overscan alone is not
    enough.
  - Local evidence: Image mode already emits S0 overscan in
    `emit-raster.ts`; Fill mode currently flows through `CutGroup` and
    starts positive-S motion at the hatch boundary.

### Bidirectional raster engraving after overscan runtime regression

- **Version / date:** LightBurn latest docs crawled 2026-06-01; GRBL v1.1 laser-mode docs
- **License:** n/a for docs; behavior references only, no code copied.
- **Source URLs:**
  - https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/FillMode/
  - https://docs.lightburnsoftware.com/legacy/ScanningOffsetAdjustment
  - https://github-wiki-see.page/m/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode
- **Decision affected:** ADR-032; `src/core/raster/emit-raster.ts`
- **Evaluated:** 2026-06-01 by Codex
- **Confidence:** high that unidirectional overscanned raster rows are the avoidable runtime cost; medium on hardware backlash risk until user burns a bidirectional test.
- **Re-verify by:** 2026-12-01
- **Notes:**
  - LightBurn documents Bi-directional Fill as engraving while sweeping in both directions; disabling it burns in one direction and returns without engraving, which can add significant runtime on long jobs.
  - LightBurn's overscanning guidance still applies in both directions: the laser-off runway is needed before the burn span and after it so the marked area sees steadier speed.
  - Other open-source raster engravers document the same tradeoff: bidirectional raster alternates row direction and is faster, while unidirectional is slower but can be more consistent on machines with backlash.
  - LightBurn's scanning-offset page documents the risk side: high-speed bidirectional scanning can show ghosted/shifted edges if the machine has response delay or belt stretch, and compensation is a separate calibration problem.
  - Local evidence: `emit-raster.ts` explicitly listed serpentine alternation as deferred and emitted every active row left-to-right. Fill hatches already alternate direction in `fill-hatching.ts`, so the runtime regression target is raster/Image mode, not Fill mode.

### Open-source competitor landscape (research)

- **Date:** 2026-05-26
- **Source:** Web research summarized below; full search results in conversation history.
- **Decision affected:** ADR-001, ADR-003, ADR-008
- **Confidence:** medium (competitor landscape moves)
- **Re-verify by:** 2026-11-26
- **Findings (paraphrased):**
  - Open-source GRBL CAM tools active in 2026: LaserGRBL (Windows only), MeerK40t (multi-platform), CNCjs (general G-code sender), gSender (general G-code sender), plus a Gtk4-based Linux/Windows CAM tool. None ships a web app + Windows desktop combination; this is our differentiator.
  - LightBurn remains dominant in paid space at ~$60.
  - No competitor combines: web delivery, multi-color layer assignment, GRBL streaming, single-codebase web+desktop. LaserForge 2.0 targets this combination. (The "MIT license" differentiator from the original framing is current again per ADR-120.)

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
  - **grbl** itself (github.com/gnea/grbl) — `planner.c`, `stepper.c`. License: **GPL-3.0**. Read-only reference per ADR-017 (same status this log gives CNCjs for protocol work). No code copied. Upstream archived Aug 2019; live forks are grblHAL / FluidNC / µCNC.
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

## Workspace image-scan responsiveness (2026-06-01)

**Trigger:** user reported that the app still froze after applying an
image trace/scan. The trace geometry was now visually acceptable, but
post-trace interaction became unusably slow.

**Sources consulted:**
- MDN Web Workers / transferable objects:
  `https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers`
  and `https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects`.
  Transferable `ArrayBuffer`s avoid copy cost when moving large image
  buffers across worker boundaries, but transferred buffers detach from
  the sender, so this is a measured follow-up rather than a casual swap.
- MDN OffscreenCanvas:
  `https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas`.
  OffscreenCanvas can move rendering into a worker, but it is a larger
  architecture change than the current bug needs.
- web.dev main-thread responsiveness:
  `https://web.dev/articles/optimize-long-tasks` and
  `https://web.dev/articles/off-main-thread`. Long work should be
  split, yielded, or moved off the main thread; UI redraw paths should
  not perform unbounded geometry walks.
- React memoization docs:
  `https://react.dev/reference/react/useMemo` and
  `https://react.dev/reference/react/memo`. Memoization is useful for
  expensive calculations in granular editors only when dependencies are
  stable; always-new objects defeat it.

**Local evidence and outcome:**
- `draw-vector-strokes.ts` already reduced Canvas2D `lineTo` calls, but
  the sampled path still read every source point. Added
  `display-polylines.ts` and a stronger point-read regression so the
  display sample is bounded and cached by immutable polyline array.
- `draw-preview.ts` compiled the job and rebuilt the toolpath from
  inside the draw function. `Workspace.tsx` now memoizes the preview
  toolpath by `project` while preview mode is active, so pan/zoom/scrub
  redraws do not recompile the job.
- Worker fallback is now bounded: tiny images can still trace inline in
  test/non-worker contexts, but large images fail with an actionable
  error instead of silently tracing on the main thread.

**Decision:** keep full geometry for saved projects, G-code, and Start.
Only display/preview rendering is simplified. OffscreenCanvas and
transferable return formats remain future work if profiling still shows
long tasks after this bounded-rendering fix.

---

## Raster image parity and async bitmap encode (2026-06-04)

**Trigger:** combined Claude/Codex audit rated raster fidelity below
LightBurn because Image mode lacked the full dither set, grayscale Min
Power, and engrave-path brightness / contrast / gamma; the same audit
flagged Convert-to-Bitmap's synchronous `canvas.toDataURL()` encode as a
remaining memory-pressure risk.

**Sources consulted:**
- LightBurn Image Mode:
  `https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/`.
  Image mode exposes multiple dithering algorithms; Grayscale varies
  power between Min and Max power.
- LightBurn Shared Settings:
  `https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/SharedSettings/`.
  Min Power / Max Power are part of the shared cut setting model, with
  Grayscale image mode using the range for tonal output.
- LightBurn Adjust Image:
  `https://docs.lightburnsoftware.com/latest/Reference/AdjustImage/`.
  Adjust Image uses brightness / contrast / gamma style image
  preprocessing with live preview before output.
- MDN HTMLCanvasElement `toBlob()`:
  `https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob`.
  `toBlob()` provides asynchronous canvas export to a `Blob`.
- MDN HTMLCanvasElement `toDataURL()`:
  `https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL`.
  MDN warns `toDataURL()` encodes the whole image as an in-memory string
  and recommends `toBlob()` for larger images.
- MDN FileReader `readAsDataURL()`:
  `https://developer.mozilla.org/en-US/docs/Web/API/FileReader/readAsDataURL`.
  Used to convert the async PNG `Blob` back to the existing `.lf2`
  data-URL storage format without changing project persistence.

**Local evidence and outcome:**
- `src/core/raster/dither.ts` now exposes LightBurn-style binary modes
  beyond Threshold / Floyd plus Grayscale.
- `Layer.minPower` is additive and defaults to 0, so old projects keep
  identical burn output until the operator changes the setting.
- Grayscale keeps white pixels at `S0` while mapping non-white tones
  through `[Min Power, Power]`; preview and compile share the same
  calculation.
- RasterImage brightness / contrast / gamma are applied before
  resampling / dithering in both compile and preview paths, and a small
  selected-image adjustment panel exposes the settings.
- Convert-to-Bitmap now uses async `canvas.toBlob()` plus
  `FileReader.readAsDataURL()` instead of synchronous `toDataURL()`.

**Decision:** keep existing data URL project storage for compatibility,
but remove the synchronous canvas string encode from Convert-to-Bitmap.
Further parity work remains for LightBurn-only modes not yet modelled
exactly (Newsprint, Halftone, Sketch, full Adjust Image dialog, Material
Test / Interval Test).

---

## Start From / Job Origin workflow parity (2026-06-04)

**Trigger:** the combined Claude/Codex audit found that the core already
had job-origin anchor math, but the operator workflow did not expose
LightBurn-style Start From modes or the 9-point Job Origin selector.

**Sources consulted:**
- LightBurn Coordinates and Job Origin:
  `https://docs.lightburnsoftware.com/latest/Reference/CoordinatesOrigin/`.
  LightBurn separates `Start From` placement modes from the 9-dot `Job
  Origin`; the anchor is meaningful for relative placement modes such as
  Current Position and User Origin.
- GRBL v1.1 streaming / coordinate behavior:
  `https://github-wiki-see.page/m/gnea/grbl/wiki/Grbl-v1.1-Commands` and
  `https://github-wiki-see.page/m/grbl/grbl/wiki/Interfacing-with-Grbl`.
  LaserForge emits absolute G-code, so Current Position cannot be faked
  as `X0 Y0`; emitted coordinates must be in work coordinates and bounds
  checks must use the current work-to-machine offset.

**Local evidence and outcome:**
- `src/core/job/job-origin.ts` now supports `current-position` as a
  resolved placement that moves the selected anchor to the current work
  coordinate position.
- `src/ui/job-placement.ts` is the single resolver for Absolute
  Coordinates, Current Position, and User Origin. It returns both the
  resolved job-origin transform and the physical bounds offset needed by
  preflight.
- `Start`, `Frame`, workspace preview, and G-code export all consume the
  same resolver. If Current Position / User Origin cannot be resolved,
  the app refuses instead of previewing or exporting absolute output.
- `src/ui/laser/JobPlacementControls.tsx` exposes the Start From dropdown
  plus a 9-anchor Job Origin picker. Pressing `Set origin here` switches
  the visible mode to User Origin so the old ergonomic workflow remains
  explicit.

**Decision:** keep Absolute Coordinates conservative while a custom GRBL
work origin is active: the app asks the operator to reset origin or choose
User Origin instead of silently shifting absolute output through G92.

---

## `.lf2` field-level validation (2026-06-04)

**Trigger:** the combined audit found that `deserializeProject` normalized
some additive fields and then returned `normalized as unknown as Project`,
which meant malformed nested device/layer/object fields could enter app
state and fail later.

**Sources consulted:**
- Local schema source of truth:
  `src/core/scene/project.ts`, `src/core/scene/layer.ts`,
  `src/core/scene/scene-object.ts`, and
  `src/core/devices/device-profile.ts`.
- Existing migration / additive-field behavior:
  `src/io/project/migrations.ts` and `src/io/project/project.test.ts`.
  Missing additive fields must keep backfilling; present wrong-typed
  fields should be rejected.

**Local evidence and outcome:**
- Added red tests for malformed `device.bedWidth`, malformed
  `scene.layers[0].power`, and unknown `scene.objects[0].kind`; the old
  deserializer accepted all three.
- Added `src/io/project/project-shape-validator.ts`, a dependency-free
  schema guard for current `.lf2` device, workspace, layer, and scene
  object shapes.
- `deserializeProject` now validates the migrated raw project before
  normalization, then keeps the existing additive backfills for
  `letterSpacing`, layer image/fill fields, and device planner fields.

**Decision:** use hand-rolled guards for now rather than adding a schema
library. The schema is small, local, and already typed; avoiding a new
runtime dependency keeps project loading predictable.

---

## Convert to Bitmap render type and DPI parity (2026-06-04)

**Trigger:** the combined audit found that LaserForge converted selected
vectors immediately as Fill-All at a fixed density, while LightBurn exposes
a Convert to Bitmap dialog with Render Type and DPI controls.

**Sources consulted:**

- LightBurn Convert to Bitmap:
  `https://docs.lightburnsoftware.com/latest/Reference/ConvertToBitmap/`.
  LightBurn documents `Outlines`, `Fill All`, and `Use Cut Settings` render
  types, an explicit DPI setting, 50% gray converted pixels, and deletion of
  the original vector graphics after conversion.

**Local evidence and outcome:**

- Added red tests proving explicit DPI changes pixel density, Outlines
  preserves open vector strokes, and Use Cut Settings treats line-mode
  source layers as outlines.
- `src/core/raster/rasterize-vector.ts` now supports Fill-All and Outlines;
  Use Cut Settings is resolved in the UI builder because it depends on scene
  layer mode, not geometry alone.
- `src/ui/raster/ConvertToBitmapDialog.tsx` exposes Render Type and DPI,
  and `src/ui/common/Toolbar.tsx` passes the selected options plus current
  layer modes into `buildBitmapFromVector`.

**Decision:** keep converted pixels at the existing LightBurn-compatible
50% gray (`luma=128`) and preserve the existing source-deletion behavior.
If a requested DPI would exceed the raster budget, the existing density
reduction path still lowers `linesPerMm` instead of freezing the app.

---

## Trace Image control parity (2026-06-04)

**Trigger:** the combined audit found that LaserForge's trace dialog was
preset/image-adjustment first, while LightBurn exposes trace-specific controls
such as Cutoff, Threshold, Ignore Less Than, Smoothness, and Optimize.

**Sources consulted:**

- LightBurn Image Tracing:
  `https://docs.lightburnsoftware.com/latest/Reference/ImageTracing/`.
  LightBurn documents direct trace controls for Cutoff/Threshold brightness
  range, Ignore Less Than noise filtering, Smoothness, Optimize, transparency,
  fade image, and show-points style inspection.
- Existing local trace engine:
  `src/core/trace/trace-image.ts`, `src/core/trace/potrace-params.ts`, and
  `src/core/trace/potrace-trace.ts`. The core already carried the main
  LightBurn trace fields; the gap was that the operator could not tune them
  directly from the dialog.

**Local evidence and outcome:**

- Added red tests proving changed LightBurn trace settings merge into
  `TraceOptions`, while untouched Photo/Detailed presets are not forced
  through binary Cutoff/Threshold fields.
- Added `src/ui/trace/TraceSettingsControls.tsx` with Cutoff, Threshold,
  Ignore Less Than, Smoothness, and Optimize controls.
- `ImportImageDialog` now merges trace-setting overrides before image
  adjustments, so preview and commit use the same LightBurn-style options.
- `Ignore Less Than` maps to both `ignoreLessThanPixels` and
  `despeckleMinPixels`, because the Potrace lane reads the former and the
  ImageTracer preprocessing lane reads the latter.

**Decision:** do not rewrite the tracing backend in this slice. The core
already had LightBurn-field support and tests; this change makes the workflow
reachable without destabilizing the proven worker/fallback trace path.

---

## SVG import fill, units, rounded rect, and local reuse parity (2026-06-04)

**Trigger:** the combined audit found that SVG fill-only artwork was dropped
and that SVG physical units, rounded rectangles, and local `<use>` references
were incomplete compared with common LightBurn import workflows.

**Sources consulted:**

- LightBurn documentation identifies SVG as a first-class import format and
  includes SVG-specific import/view behavior in its settings workflow:
  `https://docs.lightburnsoftware.com/latest/Reference/Importing/` and
  `https://docs.lightburnsoftware.com/latest/Reference/Settings/`.
- MDN / SVG reference behavior for the language-level pieces:
  SVG length units (`mm`, `cm`, `in`, `pt`, `pc`, `px`), `<rect rx ry>`
  rounded corners, and local `<use href="#id">` reuse.
- Existing LaserForge sanitizer constraints in `src/io/svg/sanitize.ts`:
  external `href` / `xlink:href` is stripped, so local reuse expansion must
  remain limited to `#id` references.

**Local evidence and outcome:**

- Added red tests for fill-only rect import, physical root dimensions without
  a viewBox, rounded rect `rx/ry`, and local `<use>` placement.
- `parseSvg` now falls back from visible stroke color to visible fill color,
  while still skipping hidden, transparent, or colorless geometry.
- Root `width` / `height` without a `viewBox` are converted to millimetres
  for common SVG/CSS units.
- `shape-to-polylines` now approximates rounded rect corners instead of
  sharpening them.
- Sanitization explicitly keeps safe SVG `<defs>`, `<symbol>`, `<use>`, and
  local reference attrs while preserving the external-link/data-URI stripping
  hooks; the parser then expands only local `#id` uses and skips `<defs>` /
  `<symbol>` templates unless referenced.

**Decision:** this slice covers safe local reuse and no-viewBox physical
dimensions. SVGs with both `viewBox` and physical dimensions still need a
future scale-transform pass if we want exact physical sizing independent of
viewBox user units.

---

## Cuts/Layers layer-order control parity (2026-06-04)

**Trigger:** the combined audit found that LaserForge processed layers in
import/internal order because the operator could edit layer settings but could
not reorder the Cuts/Layers list.

**Sources consulted:**

- LightBurn Optimization Settings:
  `https://docs.lightburnsoftware.com/latest/Reference/OptimizationSettings/`.
  LightBurn documents layer ordering as part of output optimization, including
  order-by-layer behavior and priority/order controls.
- Existing LaserForge compile path:
  `src/core/job/compile-job.ts` already iterates `scene.layers` in order, so
  the missing piece was operator control over that array, not a planner rewrite.

**Local evidence and outcome:**

- Added red tests proving `moveLayer` reorders layer arrays without mutating
  the input scene and no-ops at boundaries.
- Added store tests proving UI state can reorder layers, marks the project
  dirty, and supports undo.
- Added a Cuts/Layers panel smoke test proving visible controls call the live
  store action and boundary controls disable.
- Added up/down controls to each layer row. The visible Cuts/Layers list order
  is now the generated output order because `compileJob` already uses
  `scene.layers`.

**Decision:** implement only direct layer-order controls in this slice. Full
LightBurn Priority mode remains a separate optimization-settings feature; this
fix removes the import-order lock without destabilizing the existing job
compiler.

---

## Notes on style

- Be concrete. "Used by many projects" is not a useful claim; "4,281 npm dependents as of 2026-05-26" is.
- Be honest about confidence. "high" means you'd defend this in a code review; "low" means you'd want a second opinion.
- Verify licenses against the actual `LICENSE` file in the upstream repo, not against npm metadata or reputation.
- A library is not added to `package.json` until its row exists here. CI enforces this with a custom lint rule cross-checking `package.json` against this file.

### Playwright - adopted for isolated browser smoke (2026-07-13, ADR-158)

- **Version:** ^1.61.1 (dev dependency; Apache-2.0).
- **Role:** deterministic Chrome workflow smoke in `.github/workflows/e2e.yml`; it is not a runtime
  dependency and does not participate in production builds.
- **Operational boundary:** browser installation and execution are isolated from `release:check`
  and Cloudflare deployment. Failures retain Playwright traces and screenshots for review.
- **Alternatives considered:** keeping browser smoke in every release/deploy run was rejected because
  browser provisioning adds unrelated timeout and infrastructure failures to the production gate;
  removing browser coverage was rejected because real interaction checks catch failures outside
  jsdom and pure-core tests.

## Phase H kickoff — CNC router mode (2026-07-02)

ADR-017 dependency evaluation for Phase H ("Router", ADR-094):

- **No new runtime dependencies.** Maintainer mandate: all Phase H parsers
  (DXF, STL, G-code `.nc`) are clean-room, hand-written in `src/io/`.
  Candidate libraries (`dxf-parser` MIT, `three` MIT STL loaders, various
  gcode parsers) were rejected without evaluation — mandate, not license.
- **clipper2-ts** (already adopted; used by `src/core/geometry/kerf-offset.ts`
  and `pocket-paths.ts`) is reaffirmed as the only geometry dependency. It
  additionally powers the H.3 V-carve inward offset ladder. No version change.
- Everything else in the phase (marching squares, triangle rasterization,
  max-plus kernels, de Boor spline evaluation, modal G-code interpretation)
  is implemented clean-room in pure core, per the house determinism rules.
- Re-evaluate only if a reversal trigger in ADR-094 fires (e.g. the
  clean-room DXF parser cannot reach usable real-world compatibility).

### three — adopted for the 3D relief viewer (2026-07-03, ADR-102)

- **Version:** ^0.180.0 (pinned caret; see package.json)
- **License:** MIT (verified against the upstream three.js LICENSE file)
- **Role:** WebGL scene graph for the relief 3D viewer ONLY — imported
  beneath `src/ui/relief-viewer/`, lazy-loaded, never in core/ or io/
  (clipper2-ts stays the only core geometry dependency).
- **Why an exception to the Phase H no-new-deps rule:** ADR-102 records
  the maintainer-approved override — the clean-room mandate covers
  parsers/geometry we must own, not commodity WebGL presentation.
- **Types:** `@types/three` (dev dependency, MIT/DefinitelyTyped).

### lucide-static — adopted for the bundled design library (2026-07-03, ADR-105)

- **Version:** ^1.23.0 (see package.json)
- **License:** ISC (verified via `node -e "require('lucide-static/package.json').license"`)
  — MIT-compatible per ADR-017.
- **Role:** static SVG icon corpus for the local starter Design Library
  ONLY — a curated subset is bundled at build time via `?raw` imports in
  `src/ui/library/design-library.ts`; nothing from the package runs at
  runtime and nothing enters core/ or io/. Inserted art flows through the
  normal SVG import pipeline (parse → sanitize → scene object).
- **Alternatives considered:** hand-drawn set (too little art to matter),
  openclipart bundling (CC0 but per-file provenance is unauditable at
  scale — kept as the documented IMPORT path instead), The Noun Project
  (not license-compatible).

### electron-updater — adopted for Windows desktop auto-update (2026-07-04, ADR-024)

- **Version:** ^6.8.9 (resolved 6.8.9 at adoption, 2026-07-04). VERIFY no
  unfixed high/critical CVEs before the release PR merges (`pnpm audit`).
- **License:** MIT (electron-userland/electron-builder monorepo) — MIT-compatible
  per ADR-017.
- **Source:** https://github.com/electron-userland/electron-builder (packages/electron-updater)
- **Decision affected:** ADR-024; used in `electron/` main process ONLY (never
  core/ io/ ui/).
- **Role:** background update check + differential download against our
  self-hosted generic feed (`https://dl.kerfdesk.com/desktop/latest.yml`),
  install-on-quit. Runs only when `app.isPackaged`. No `quitAndInstall`
  (burn-safety, non-negotiable #9). No user data / no telemetry.
- **Evaluated:** 2026-07-04, Claude Code session
- **Confidence:** medium — unsigned-Windows + per-user install-on-quit behavior
  must be hardware-verified (WORKFLOW.md desktop flow) before launch is done.
- **Re-verify by:** 2027-01-04
- **Alternatives considered:**
  - Notify-only self-hosted manifest (renderer fetch) — rejected by the
    maintainer in favor of full auto-update.
  - Rolling our own updater — rejected; `electron-updater` is the standard,
    maintained integration for electron-builder generic feeds.
- **Notes:**
  - Prod `dependencies` (required by the packaged main process), not devDeps.
  - The build emits `latest.yml` + `.blockmap` when `publish` is configured;
    those plus the `.exe` are the R2 feed.
  - Once code signing lands, it verifies the publisher signature, hardening the
    update channel.
  - Transitive `sax@1.6.0` (via `builder-util-runtime`) is **BlueOak-1.0.0** —
    a permissive, MIT-compatible license (Blue Oak Council permissive list;
    no copyleft). Added to the `scripts/check-licenses.mjs` allow-list on
    adoption (maintainer-approved 2026-07-04), consistent with the existing
    permissive non-MIT entries (BSL-1.0, CC-BY-4.0, CC0-1.0).

## GRBL axis-specific origin semantics (2026-07-13)

- **Source snapshot:** [gnea/grbl at bfb67f0c](https://github.com/gnea/grbl/tree/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e)
- GRBL's parser computes `WPos = MPos - WCS - G92 - TLO`. Its G92 path recalculates only named
  axes and retains the prior offset for unnamed axes; G92.1 clears the transient offset.
- `$#` reports stored WCS, G92, TLO, and probe parameters, while intermittent status WCO reports the
  effective combined offset. A mutation `ok` proves acceptance, not the value of every untouched axis.
- **KerfDesk consequence:** XY-only commands may derive X/Y but must preserve known Z or wait for
  readback. Any G92.1 path invalidates unqualified Z evidence until a new touch-off or richer readback
proof exists.

---

## CNC live accessory and Start ownership semantics (2026-07-13, ADR-179)

- **GRBL v1.1 interface source:**
  https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface at repository HEAD
  `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e` (archived upstream).
  `A:SCFM` describes controller-commanded primary spindle/coolant state;
  `Ov:` without `A:` is the ordinary all-off observation. Realtime commands
  can be ignored when repeated before the prior request is serviced.
- **grblHAL implementation source:**
  https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/report.c
  lines 1452-1485. Current code emits `A:E` for spindle encoder error and
  `A:T` for a pending firmware tool change, and reports secondary spindles in
  separate `SPn:` fields. The source also supports automatic status reporting.
- **Decision impact:** CNC Start uses an app-wide arming reservation, an
  acknowledged queued dwell as the command/inbound fence, then a live
  `Idle`/`Ov:`/`A:` observation and a synchronous final state/ack/setup-epoch
  gate. Exceptional grblHAL flags and secondary-spindle evidence fail closed.
- **Boundary:** this proves ordering only for KerfDesk-owned writes. GRBL has no
  transaction that atomically binds a status frame to later program bytes, so
  pendants, WebUIs, PLCs, macros, and second senders require exclusive-command
  ownership or an external/machine-specific interlock.
- **Use:** read-only protocol research; no upstream code copied.
- **Confidence:** high for the cited wire/source behavior; physical controller
  campaigns remain required before production safety claims.

---

## Same-session CNC hold/resume continuity (2026-07-13, ADR-180)

- **GRBL behavior:**
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/commands.md
  documents realtime feed hold/cycle start, spindle-stop override, and safety-door
  restoration. These operate on the current planner session; they are not a
  durable execution ledger or proof of physical spindle RPM.
- **Physical feedback comparison:**
  https://linuxcnc.org/docs/stable/html/config/core-components.html models
  spindle at-speed as a hardware/encoder-backed input before feed proceeds.
  Legacy GRBL `A:`/`FS:` instead report controller command/output state.
- **Machine-specific recovery comparison:**
  https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---operation.html
  keeps the spindle running in Run-Stop-Jog-Continue and uses an ordered return;
  the controller warns that tools, offsets, and return path must remain valid.
- **Decision impact:** generic CNC Resume now fails closed before `~` or stream
  refill. Pause remains available, but continuation routes to Stop and supervised
  recovery until a profile can prove exclusive control plus spindle continuity.
- **Future architecture:** do not inject a queued dwell into a paused stream.
  A safe opt-in needs an ack-neutral realtime-status arbiter, stable `Hold:0`
  observations, unchanged session/setup epochs, and controller-visible spindle
  fault/at-speed evidence.
- **Use:** read-only protocol/manual research; no upstream code copied.
- **Confidence:** high for the generic refusal. Any future opt-in still requires
  machine-specific hardware and fault-injection validation.

---

## CNC controller ownership and Start attestation (2026-07-13, ADR-181)

- **Stock GRBL attribution limit:**
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c
  and
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c
  implement a shared input order with bare terminal responses; no client ID,
  nonce, command ID, or lease is returned.
- **Realtime mutation:**
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md
  documents realtime reset/hold/resume/override handling outside the normal
  line buffer. These mutations generally have no attributable terminal ack.
- **grblHAL competing-owner evidence:**
  https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/report.c#L1494-L1503
  reports `MPG:1`/`MPG:0`, which can expose MPG ownership but is not a general
  lease across network, serial, PLC, macro, or physical inputs.
- **Browser boundary:** https://wicg.github.io/serial/#dom-serialport-open
  defines opening the browser's serial port; it cannot prove that other
  controller-side transports or command sources are inactive.
- **Decision impact:** require a fresh, exact-program exclusive-access operator
  attestation for each CNC Start, bind it to the existing controller/setup
  epochs, and reject stale evidence before any fence or job byte.
- **Use:** read-only protocol/specification research; no upstream code copied.
- **Confidence:** high that legacy GRBL cannot prove ownership. The attestation
  reduces operational ambiguity but does not replace a gateway or interlock.

---

## grblHAL MPG ownership telemetry (2026-07-13, ADR-182)

- **Ownership transition:**
  https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/stream.c#L707-L762
  switches input streams for MPG mode and disables the previous stream's
  receive path while the manual source owns commands.
- **Wire evidence:**
  https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/report.c#L1494-L1503
  emits `MPG:1` and `MPG:0` status fields for acquisition/release.
- **Broadcast caveat:**
  https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/stream.c#L265-L273
  and
  https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/stream.c#L328-L431
  show that receiving controller output is not equivalent to owning its input.
- **Decision impact:** parse and latch explicit MPG state, refuse known-active
  MPG before the Start fence and after live refresh, and require explicit
  release or session reset before CNC Start can proceed. First acquisition also
  invalidates position/Z/frame evidence so a later release requires fresh setup.
- **Use:** read-only upstream protocol research; no upstream code copied.
- **Confidence:** high for grblHAL MPG field semantics. It covers MPG ownership
  only and does not establish a general multi-sender lease.

---

## GRBL-family terminal response ownership (2026-07-13, ADR-183)

- **Stock GRBL terminal protocol:**
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c
  and
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c
  emit ordered, bare `ok`/`error` responses with no sender identity, command
  nonce, or ownership lease.
- **grblHAL multi-stream boundary:**
  https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/stream.c#L265-L273
  and
  https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/stream.c#L328-L431
  show that controller output can remain visible across input-stream changes;
  receiving a terminal line is not proof KerfDesk owned the command.
- **Internal ownership audit:** every KerfDesk newline write owes one ordered
  terminal response except job-stream chunks, whose replies belong to stream
  RX accounting. The previous autofocus private subscription and post-write
  ack reservation created double-consumption and fast-response gaps.
- **Decision impact:** pre-reserve non-stream acks, route autofocus through the
  shared semantic owner, latch truly ownerless GRBL-family terminal replies,
  invalidate CNC setup evidence once, and block Start until reconnect/setup.
- **Boundary:** an external reply can coincide with a valid KerfDesk-owned
  response window and be indistinguishable. The feature detects ownership
  anomalies; it does not convert legacy GRBL into a multi-client protocol.
- **Use:** read-only upstream source research plus local architecture audit; no
  upstream code copied.
- **Confidence:** high for the response-attribution limitation and local ledger
  behavior; physical multi-transport fault injection remains required.

## GRBL probe ownership and settlement — 2026-07-13 (ADR-184)

- **Sources:** GRBL's official `interface.md`, `commands.md`, `gcode.c`, and
  local source audit at upstream commit `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`.
- GRBL terminal `ok` means the line was accepted by the parser, not that queued
  physical motion has finished. A successful probe transaction therefore needs
  a FIFO planner fence followed by fresh stable Idle reports.
- `G38.2` failure is alarmed; `G10 L20` mutates the selected coordinate system.
  A later failure can therefore leave partial motion or coordinate changes even
  though the overall multi-line cycle failed.
- Status `FS:` exposes commanded feed and spindle speed. KerfDesk can refuse a
  probe when spindle-off evidence is absent, while `M5`/`M9` provide an explicit
  commanded-off boundary before motion. This does not prove mechanical coast-down.
- Serial adapters are allowed to deliver a reply before their write Promise
  resolves. Response ownership and the untracked-ack ledger must be reserved
  synchronously before the first await.
- Serial write resolution proves only OS/adapter queueing, not that GRBL has
  processed Ctrl-X. Recovery therefore requires the observed GRBL reboot banner
  before any later Idle report can qualify settlement. Every banner, alarm,
  sleep, disconnect, or explicit ledger reset advances the write-session epoch
  so late Promises cannot mutate a newer acknowledgement owner.
- No new dependency was adopted. Hardware confirmation remains outstanding for
  probe wiring, plate geometry, spindle coast-down, controller variants, and
  real-machine reset/recovery behavior.

## Atomic GRBL corner-probe offsets — 2026-07-13 (ADR-185)

- **Source:** GRBL `gcode.c` at upstream commit
  `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`, especially G10 L20 block
  preprocessing and `settings_write_coord_data()` execution.
- Separate Z, X, and Y `G10 L20` lines are individually persistent. If the
  later side probe alarms, GRBL retains the axes committed before that alarm,
  creating a mixed old/new work frame even though KerfDesk rejects the cycle.
- GRBL precomputes every axis named in one G10 block, then calls its coordinate
  settings writer once with the complete vector. A single
  `G10 L20 P0 X... Y... Z...` is therefore the correct command-level commit
  boundary. It does not guarantee EEPROM integrity across sudden power loss.
- The pre-commit path remains relative. After each slow contact it retreats by
  a deterministic amount, so the final current XYZ values can be expressed in
  the intended corner frame without using a partially updated WCS for motion.
- Software tests cover all corner signs and a final-side alarm before G10.
  Real plate dimensions, squareness, contact repeatability, and safe clearance
  remain hardware-unverified.

## Static XYZ corner-probe geometry preflight â€” 2026-07-14 (ADR-188)

- The prior builder assumed a 15 mm plate-center inset, 35 mm outward clearance,
  6 mm side drop, and 5 mm final park while the UI accepted cutter diameters up
  to 100 mm. Those individually valid inputs did not prove a collision-free set.
- For plate thickness `T`, side drop `D`, per-axis center offsets `dx/dy`, cutter
  radius `r`, outward clearance `C`, and external margin `m`, the static proof
  requires `T-D >= 1`, `dx >= r+m`, `dy >= r+m`, and
  `C >= max(dx,dy)+r+m`; final park is the next emitted 0.001 mm at or above
  `max(5,r+m)`.
- Side contact currently supports cylindrical end mills only. Ball-nose, V-bit,
  and engraving-tool radius varies with contact height, so their catalog
  diameter cannot safely drive collision proof or XY compensation.
- The validator runs before line generation and store reservation. Integration
  coverage proves an invalid request sends neither `M5`/`M9` nor probe motion.
- A profile bed rectangle is not yet machine-envelope evidence. Stock GRBL can
  report machine positions in inches (`$13`), its homing frame can vary by build
  option, and a reset can invalidate position trust. A later owned qualification
  must establish units, homing-frame identity, fresh MPos, and axis bounds before
  XYZ probing is production-qualified.

## GRBL controller-session truth foundation — 2026-07-14 (ADR-189)

- Stock GRBL `$13=1` converts reported coordinate values to inches while
  `$130-$132` remain millimetre settings. Treating both as one unit can produce
  a 25.4x envelope error.
- `$22=1` enables homing but does not prove the current controller session was
  homed; `$X` can unlock to Idle without Home. Home evidence must therefore be
  created by an owned full Home transaction and bound to the current session.
- The welcome banner occurs on reset boundaries that discard volatile proof.
  Late line/close callbacks from a replaced serial connection must not mutate
  the current connection.
- Stock GRBL normally uses negative machine space on every axis. With
  `HOMING_FORCE_SET_ORIGIN` (`OPT:Z`), each `$23` bit determines whether that
  axis extends positive or negative from zero. Profile bed coordinates are not
  a substitute for this firmware frame.
- This slice adds parsers, math, observation stamps, and invalidation only. It
  deliberately does not send `$I`, `$$`, `$H`, or a new status query and does
  not make corner probing machine-envelope-qualified.

---

## License-safe CNC single-line fonts — 2026-07-17 (ADR-226)

- **Need:** attractive native centerline writing fonts for CNC engraving,
  without retracing an outline font or restoring the exact bundle removed by
  ADR-213.
- **Rejected provenance route:** four visually acceptable Borland BGI `.CHR`
  files were initially prototyped from a package declaring MIT. Direct asset
  inspection found retained Borland copyright strings and no authoritative
  license grant for those binaries. The prototype was never committed or
  shipped and is not represented as MIT.
- **Approved sources:** Relief SingleLine at commit
  `01dfc5779ec1e9e4b288d96c6c96c23bfccbaf9d`; EMS Nixish, EMS Decorous
  Script, and EMS Casual Hand at commit
  `8c71f2d9e1a5292047bb88e5595a766241b82cc6`. Relief's repository carries a
  project-specific OFL notice; every selected EMS SVG identifies itself as SIL
  Open Font License and names its source designer, creator, and converter.
- **Visual decision:** the four real path renderings were shown together and
  explicitly approved. This selection supersedes ADR-213's quality rejection
  only for these reviewed faces, not for the old bundle as a whole.
- **Reproducibility:** the generator pins canonical remote-byte SHA-256 values
  for all four SVGs and both license sources, verifies identity/license markers,
  and rejects unsupported path commands or missing space/fallback glyphs.
- **Geometry boundary:** source centerlines are kept as open paths. Relief's
  native cubic curves are preserved; EMS authored segments remain unchanged.
  Unsupported Unicode uses the visible `?` fallback rather than disappearing.
- **No runtime dependency added.** The generated data is lazy-loaded and the
  complete OFL text, source metadata, revisions, and hashes ship in the
  generated third-party notices.


---

## Image Studio kickoff — raster-editor library survey (2026-07-21)

Per ADR-017, libraries surveyed at phase kickoff (Phase L, ADR-242). Full cited
evidence: `docs/audits/2026-07-21-image-editor-web-research.md`; roadmap:
`docs/audits/2026-07-21-image-editor-research-and-roadmap.md`.

**Use case:** Photoshop-grade in-app raster editing of `RasterImage` sources
(paint/erase/line tools, selections, adjustments, filters, retouch).

**Candidates evaluated (license / verdict):**

- **OpenCV.js** (Apache-2.0) — ~7.6-8 MB wasm (~4.2 MB trimmed); kills the
  <1 MB bundle budget. Rejected; lazy-load re-evaluation only if
  GrabCut/inpaint-class features are ever committed.
- **wasm-vips** (LGPL-2.1) — license-hostile per ADR-017 + ~4.6 MB. Rejected.
- **photon-rs** (Apache-2.0, wasm) — fine license; overlaps ops we write in
  30-150 LOC each; adds a wasm toolchain. Not adopted; IE-4 re-evaluation.
- **glfx.js / CamanJS / WebGLImageFilter** (MIT) — dead (glfx last real commit
  2013). MIT shader references only.
- **Jimp / image-js** (MIT) — maintained but far too slow for an interactive
  editor loop. Rejected.
- **miniPaint** (MIT, v4.14.3 2026-04, alive) — full-featured but a vanilla-JS
  monolith application; incompatible with strict-TS/pure-core/size rules.
  Feature checklist + algorithm reference only.
- **toast-ui image-editor** (MIT, dead ~2022), **Filerobot** (MIT,
  crop-widget scope), **Pintura** (commercial/closed), **tldraw** (custom
  watermark license, vector domain), **fabric.js** (MIT, object-canvas — wrong
  substrate) — all rejected.
- **Graphite** (Apache-2.0, Rust/wasm) — most important newcomer; raster still
  experimental, not embeddable. Watch only.
- **ML background removal** — BRIA RMBG-1.4/2.0 weights are NON-COMMERCIAL
  (rejected outright); MODNet / U-2-Net are Apache-2.0 and would be the only
  acceptable weights, but multi-MB models conflict with offline-first + bundle
  budget. Classical border-flood + color-distance removal needs no dependency.

- **Evaluated:** 2026-07-21 (Claude Code session)
- **Outcome:** self-implement, pure TypeScript, ZERO new runtime dependencies
  through IE-3 (matches the Phase F scanline-fill precedent above). Algorithms
  from classical literature: Tanner Helland dither survey, losingfight.com
  wand/marching-ants pair, Substance/Photoshop brush-stamping semantics
  (spacing/hardness/flow-vs-opacity), separable Gaussian + unsharp mask,
  scanline flood fill.
- **Patent note:** PatchMatch-class healing (Adobe content-aware-fill family)
  is deliberately avoided; spot-heal ships as masked median/edge-aware blend.
- **Re-evaluate if:** IE-4 profiling demands GPU/wasm acceleration, or ML
  matting becomes a committed feature (then MODNet/U-2-Net only, explicit
  opt-in download, never RMBG).
