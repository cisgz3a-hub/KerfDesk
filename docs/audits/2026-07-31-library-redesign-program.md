# CurveDesk Library redesign program

Date started: 2026-07-31
Worktree: `C:\Users\Asus\LaserForge-2.0\.codex-worktrees\library-redesign`
Branch: `codex/library-redesign-program`
Baseline: `e3ace9928163fcd696d074c9f0a54024f8215948` (`origin/main`, fetched 2026-07-31)
Status: active implementation program; verified milestones may be committed,
pushed, and opened as review PRs after coordinator handoff; never merge main,
deploy, publish releases, or operate hardware

## Program outcome

Replace the current Design Library with a premium, useful, licensed, visually
coherent asset-browsing and import experience. The work advances only through
audited Library milestones. It does not change Design Studio, controller
behavior, ordinary Frame/Start authorization, laser safety policy, or emitted
machine semantics.

## Operating boundaries

- Keep all work in the dedicated clean worktree above.
- Preserve current project/import behavior unless a Library milestone explicitly
  changes and verifies it.
- Use only assets, code, or dependencies with source-level license evidence and
  terms compatible with this repository. Preserve required notices and record
  per-source provenance.
- Do not copy visually attractive but unverified assets.
- Implement one coherent Library UX/data/visual slice at a time. Run focused
  tests and a behavior audit before advancing.
- A completed, independently audited milestone may be committed, pushed, and
  opened as a review PR only after the coordinator accepts its exact scope and
  verification handoff. Never merge main. Do not deploy, publish a release,
  operate hardware, or change the repository's license.
- Automated verification can prove software behavior only. It cannot qualify
  physical placement, cut quality, engraving quality, or machine safety.

## Evidence labels

- **Confirmed**: reproduced in this worktree or supported by current source,
  tests, or a primary source.
- **Planned**: accepted program direction, not yet implemented.
- **Candidate**: requires a product, license, performance, or visual decision.
- **Blocked**: cannot advance without maintainer input or new evidence.
- **Hardware-only**: cannot be concluded from code, browser, or simulator tests.

## Milestone ledger

| Milestone | Scope | State | Verification / exit evidence |
|---|---|---|---|
| M0 | Clean worktree, authority map, single ledger | Confirmed | Worktree is based on refreshed `origin/main`; initial status was clean |
| M1 | Current UX, data/import, provenance/license, performance, web/Electron, workflow audit | Confirmed | Source/test audit plus isolated desktop/narrow browser baseline |
| M2 | Comparable-product research, permissive-source decision, IA and visual-system plan | Confirmed | Primary-source citations, license matrix, accepted asset/source boundaries |
| M3 | Correct Library insertion identity and persisted provenance | Confirmed | Independent re-audit GO; 56 focused tests, 210 project IO tests, type/lint/export/file-size/integrity/build gates |
| M4 | Accessible responsive browser, premium cards/details, search/filter and empty/error UX | Planned | Focused component tests plus desktop/narrow keyboard and visual audit |
| M5 | Curated Tabler/owned starter collections and lazy catalog delivery | Planned | Pinned MIT source, per-asset manifest, notices, catalog validation, bundle/performance budget |
| M6 | Library-native SVG import entry, favorites/recent state, final accessibility/platform audit | Planned | Verified current SVG handler, focused tests, browser smoke, web/Electron behavior audit |
| M7 | Final regression and behavior audit | Planned | Relevant CI gates plus separate browser smoke; limitations recorded |

## M0 — clean execution boundary

The canonical checkout at `C:\Users\Asus\LaserForge-2.0` was on
`claude/rotate-numeric-centre` with unrelated modified and untracked files. It
was left untouched. `origin/main` was fetched, resolved to
`e3ace9928163fcd696d074c9f0a54024f8215948`, and the dedicated worktree was
created from that exact commit.

## M1 — current-state audit

### Baseline

- The Library is a fixed modal mounted eagerly by the app and opened from the
  left tool strip.
- The current catalog contains 77 entries: 21 CurveDesk-owned templates, 48
  Lucide icons, and eight OpenClipart files.
- Every entry is parsed by the production SVG parser and passed to the normal
  scene import action. The asset metadata does not set power, feed, depth,
  material, tool, machine state, Frame, or Start policy.
- Current filtering covers category, machine, entry type, operation, source,
  and a simple case-insensitive text haystack.
- The current card is a small button with a 42 px preview, title,
  subcategory, and terse implementation badges. The modal uses component-local
  inline styles and fixed desktop grids.
- Focused baseline tests passed: 11/11 Library tests in the primary run. The
  production-parser catalog test took 682 ms. Repository license-check passed
  for 33 production packages across seven allowed license groups.

### Ranked findings

#### P1 — duplicate inserts silently replace existing artwork

The Library uses `Library: <title>` as the imported SVG source identity and
ignores the scene action's `ImportOutcome`. The normal scene importer treats an
identical source as a re-import target. Adding one Library item twice therefore
replaces the first object while the UI says it was added. The catalog also has
two different entries titled **Flower** (OpenClipart and Lucide), so the second
collides with the first.

An isolated browser run confirmed that **Import visible** reported 77 imports
but produced 76 objects. This must be repaired before visual polish: insertion
needs stable asset identity and append semantics, while actual file re-import
must keep its existing replacement contract.

#### P1 — the bulk action is non-atomic, slow, and places artwork off-bed

**Import visible** synchronously parses every filtered item, performs one store
mutation and fit for each, and creates separate history entries. A 77-card
browser run took approximately 540 ms; 63 of the 76 resulting objects were
outside the default 400 × 400 mm bed. This is not a useful asset-library action
and comparable products do not bulk-add an entire search result into the active
project. It will be removed rather than optimized.

#### P1 — manufacturing labels overpromise inserted behavior

The catalog labels entries `profile`, `pocket`, `drill`, `v-carve`, and
`calibration`, but those values are filter metadata only. Every current SVG
lands as an ordinary line operation. Several owned items are also unlabeled
rectangle or circle diagrams rather than complete, operator-ready calibration
artifacts. The redesign will call these values **suggested uses**, keep them
advisory, and reject or rename assets whose title promises behavior the geometry
does not contain. Artwork will not silently carry machine settings.

#### P1 — provenance is neither visible nor preserved

Catalog entries hold source URL, license, retrieval date, hash, and notice, but
cards show only raw values such as `lucide` or `cc0`. Insertion reduces the
record to `Library: <title>` and the scene object has no structured Library
provenance. The existing footer's claim that source and license provenance are
included is therefore misleading.

The redesign must expose exact source/license facts in the detail view and
carry a compact structured provenance snapshot on the inserted scene object so
project/export inspection does not lose the source record.

#### P1 — current Lucide license labels are incomplete

The installed `lucide-static@1.23.0` license is ISC for Lucide work and MIT for
a named Feather-derived subset. Six bundled entries—Arrow Right, Compass, Key,
Moon, Music, and Smile—belong to that subset, but every entry is currently
labeled ISC only. Release notices contain both license texts, so distribution
is covered; the per-entry metadata is inaccurate and will be corrected.

#### P1 — OpenClipart adoption and manifests drift from accepted records

ADR-105 and the adoption entry in `RESEARCH_LOG.md` say OpenClipart should
remain an external import route, yet current main bundles eight files.
Separately, URL/hash facts are triplicated across the catalog, a Markdown note,
and the notice-generation manifest; existing tests can pass when those copies
disagree. All eight checked-in files were independently re-hashed and match the
recorded downloads, and the official OpenClipart FAQ states the CC0/public
domain policy. This is governance/manifest drift, not evidence of incompatible
licensing.

The redesign will not bulk-ingest more OpenClipart. The visually inconsistent
set will be removed from the starter experience, with historical provenance
retained in Git and the program record. Any retained external asset requires
one canonical manifest containing creator, item URL, license, retrieval date,
original hash, transformation history, and normalized hash.

#### P1 — the bespoke modal fails the repository's dialog contract

The modal lacks `aria-modal`, initial focus, focus containment, Escape close,
and focus restoration even though the shared `Dialog` component provides all
five. Live browser inspection confirmed focus remained on the underlying
**Open design library** button. The document's tab order continues through the
canvas and machine controls before reaching the Library.

At a 500 px viewport the panel client width was 476 px while its content
required 732 px. At 390 px, the category rail consumed nearly half the
available width and the asset browser collapsed into a thin single-card column.

#### P2 — the visual hierarchy is a clip-art/debug grid

The first view is an alphabetical mix of manufacturing sketches, colorful
OpenClipart, and 24 px Lucide UI glyphs. Many owned and Lucide previews are
nearly invisible because every preview is forced to 42 × 42 px and receives a
fixed CSS invert filter. Raw source names and machine strings read as debug
metadata. There is no detail view, collection story, preview scale control,
favorites/recent state, or clear primary add action.

#### P2 — facets, search claims, and empty states are inaccurate

`Laser Templates`, operation `image`, and source `public-domain` are exposed as
filters despite having no entries. Search help claims it searches source data,
but the haystack omits provenance. A zero-result filter produces a blank grid
with no explanation or recovery action.

#### P2 — asset bytes and preview work are eager

The renderer eagerly imports all catalog modules. The initial graph includes
214,513 raw SVG bytes before owned template strings: 189,511 bytes of
OpenClipart and 25,002 bytes of Lucide. Current data-URI encoding expands the 56
external SVGs to about 302,815 characters and is recomputed during card render.
All 77 cards remain in the DOM; there is no lazy payload, bounded thumbnail,
virtualization, loading state, or per-preview error state.

The shared renderer serves both web/PWA and Electron, so the UX and startup
defects affect both platforms. A baseline Vite build succeeded; the primary
renderer chunk was 712.03 kB / 208.85 kB gzip before redesign.

### Coverage gaps

Current tests do not cover duplicate/title collisions, operation-label truth,
provenance display or persistence, empty/dead facets, modal accessibility,
narrow layouts, placement/history atomicity, performance budgets, or a
Design-Library Playwright/Electron path.

## M2 — research, source policy, IA, and visual system

### Comparable-product evidence

Only primary product documentation influenced the plan:

| Product | Confirmed pattern | CurveDesk decision |
|---|---|---|
| [LightBurn Art Library](https://docs.lightburnsoftware.com/latest/Reference/ArtLibrary/) | Multiple local libraries organized by theme or purpose; a library list plus thumbnails; import files or current-project selections; drag to place or add to viewport center; artwork does not store cut settings | Keep artwork geometry-only, organize it into purposeful collections, and use **Add to canvas**. Machine settings remain in Artwork Operations and Material Library |
| [LightBurn downloadable libraries](https://docs.lightburnsoftware.com/latest/Resources/ArtLibraries/) | Curated themed releases rather than one undifferentiated clip-art dump | Ship a small, reviewed starter collection with named packs and provenance rather than maximizing count |
| [xTool Studio / XCS overview](https://support.xtool.com/article/1303) and [current release notes](https://support.xtool.com/article/1773) | Separate Shape/Elements, Templates, Designs, and Materials surfaces; built-in categorized assets and templates | Keep individual artwork, manufacturing templates/jigs, and material settings visibly separate |
| [Cricut Design Space image guide](https://help.cricut.com/hc/en-us/articles/360009426074-Using-Images-in-Design-Space) | Canvas-adjacent search, bookmarks, popular and advanced filters, operation badges, quick add, and a richer detail/inspiration view | Pair fast add with a selectable card/detail view; include favorites/recent locally; use operation labels as suggestions, not machine qualification |
| [Vectric VCarve Clipart Tab](https://docs.vectric.com/docs/V12.5/VCarveDesktop/ENU/Help/form/Clipart%20Tab/index.html) | Local library folders, adjustable thumbnail sizes, double-click add-to-center, and drag-to-place | Preserve local/offline ownership and add-to-center now; reserve drag placement for a later separately audited enhancement |
| [Easel](https://easel.inventables.com/) | A very large design library within an integrated CAD/CAM product | Treat scale as the parity driver only. Do not copy proprietary assets, cloud assumptions, or undocumented interaction details |

### Source and license decision

| Source | Verified terms | Decision |
|---|---|---|
| CurveDesk-owned geometry | Repository MIT license | Primary source for calibration geometry, blanks, jigs, and joinery. Every entry must accurately describe geometry-only behavior |
| [`@tabler/icons` 3.43.0](https://github.com/tabler/tabler-icons/tree/v3.43.0) | MIT; npm package reports version `3.43.0`, MIT, and integrity `sha512-qXwS17Op9jqr3Asvu31fejyw8+OnRDKH7oR8nQXyUgW1pI44ET8OKG9kssy+XIvvAIyej6gZdGmviNUn1VMfPw==` | Accepted as the one coherent starter-art family. Pin the exact version, select non-brand outline/filled assets intentionally, preserve the MIT notice, and record per-file source and hash |
| Existing `lucide-static` 1.23.0 | ISC plus MIT for the named Feather-derived subset | Keep for application UI icons. Remove it from the customer artwork catalog once the Tabler collection lands, avoiding mixed visual families |
| Existing OpenClipart snapshots | Per-item CC0/public-domain evidence and matching hashes | Do not expand. Remove the visually inconsistent eight files from the starter catalog; do not silently reuse the aggregation pattern |
| Google Material Icons 4.0.0 | Apache-2.0 | Compatible but held. A second symbol family would reduce coherence and add notice complexity without filling a proven gap |
| Iconoir 7.11.0 | MIT at the pinned upstream tag | Compatible but rejected as redundant with Tabler |
| Open Peeps / museum open-access records | CC0 only when verified per item | Held for later individual review. Illustration conversion and cultural/trademark review are not part of this program |
| Remix Icon current release | Custom Remix Icon License v1.0 with standalone/competing-library restrictions | Rejected; it is not the requested MIT/Apache/CC0-style source and the Library is a primary product surface |
| Noun Project, Freepik, Envato, competitor galleries, generic SVG aggregators, bulk Wikimedia ingestion | Proprietary, attribution/subscription bound, or unreliable per-file redistribution evidence | Rejected |

The asset goal is not a count target. A collection advances only when its
assets share a visual family, parse through the production SVG pipeline, remain
legible at card scale, contain no brand/trademark material, have complete
manifest facts, and add a useful category that the current collection lacks.

### Information architecture

Top-level destinations:

1. **Starter** — a curated cross-section for first use.
2. **Artwork** — Animals, Nature, Borders & Flourishes, Signs & Labels, Home &
   Food, Celebrations, Hobbies & Sport, Travel & Outdoors, and Symbols.
3. **Templates & Jigs** — blanks, boxes/joinery, workholding, registration, and
   layout geometry. These remain geometry-only.
4. **Test & Calibration** — explicit software-generated geometry with honest
   instructions; no implied power/speed/material recipe.
5. **Favorites** — local item IDs only.
6. **Recent** — a bounded local list of successfully added item IDs.

`My Library` is not being inferred as a persistent custom-asset database in
this program. The Library will provide a first-class **Import SVG…** entry using
the current verified SVG file handler. A persistent user-collection format
would require its own storage/import/export contract and is a later product
decision.

Primary controls:

- Search is always visible and covers title, collection, tags, creator, source,
  and human-readable license name.
- Collection is the primary navigation.
- Machine, suggested use, geometry style, and source/license live in an
  expandable filter area. **All** is always available.
- Result count is announced through a polite status region.
- Empty search retains the query and offers **Clear filters** and **Import
  SVG…**.

Card and detail behavior:

- Clicking a card selects it and opens detail; a clearly labeled `+` action
  adds it immediately. **Add to canvas** is the detail primary action.
- Double-click-to-center may be added only if it remains discoverable and
  keyboard-equivalent. Drag-to-place is deferred.
- Remove **Import visible** entirely.
- Detail shows a large preview, content type, geometry facts, suggested uses,
  source, creator, exact license, version/item URL, hash, and notice.
- Suggested uses never apply power, speed, depth, material, cutter, or a machine
  mode. They do not assert closed-path suitability or physical safety unless
  the geometry validator actually proves the displayed fact.

### Visual system

- Use one neutral, workshop-grade visual language: warm/neutral preview stages,
  crisp dark geometry, restrained blue accent, and existing CurveDesk theme
  tokens. Do not invert arbitrary SVGs.
- Comfortable cards use a 4:3 preview stage at 128–160 px, 16–20 px internal
  breathing room, a two-line title limit, a human collection label, and at most
  two useful badges. Source/license details belong in the inspector.
- Use selected, hover, focus-visible, loading, and broken-preview states that
  do not depend on color alone.
- Desktop layout: collection rail, responsive card grid, and detail inspector.
  Narrow layout: stacked search/navigation, full-width grid, and an inline
  detail section. No horizontal page or dialog scrollbar.
- The component must use the shared dialog/accessibility infrastructure while
  it remains an overlay. A future docked Library is a separate workspace-layout
  decision.

### Data and performance contract

- Lightweight manifest metadata loads with the Library shell.
- Insert bytes load only when an asset is selected or added. Preview assets use
  bounded files and native lazy image loading; stable aspect-ratio boxes prevent
  layout shift.
- External-source facts live in one canonical manifest used by UI, validation,
  tests, and notice generation.
- An inserted Library object stores a compact immutable provenance snapshot:
  schema version, asset ID, title, source/creator, SPDX-style license ID,
  license/source URLs, source version, and asset hash.
- Library-origin objects never participate in filename re-import replacement;
  repeated adds append independent objects. Ordinary file re-import replacement
  remains unchanged.
- Asset parse/load errors are isolated to the selected item, produce no scene
  mutation, and keep the browser usable.
- Initial renderer cost, Library-open cost, visible-card render time, import
  latency, and lazy payload sizes are measured at M5. Virtualization is adopted
  only if profiling the final curated count shows it is needed.

### Sequential build order

1. M3 fixes insertion identity and structured project provenance with no visual
   redesign.
2. M4 replaces the bespoke modal/card grid and validates responsive,
   accessible browsing against the existing catalog.
3. M5 replaces the catalog with the pinned curated family and implements lazy
   asset delivery plus canonical manifest validation.
4. M6 adds the verified SVG import entry and local favorites/recent behavior.
5. M7 runs the whole Library regression, browser, accessibility, bundle, and
   shared-renderer audit.

## M3 — insertion identity and persisted provenance

### Implemented contract

- Added a versioned, immutable `libraryProvenance` snapshot to imported SVG
  scene objects. It captures catalog ID, title, source, exact license ID, and
  optional creator, URLs, source version, and asset hash.
- Project loading validates the snapshot. Unsupported schema versions,
  malformed types, and blank/whitespace required identity fields fail closed.
- Library insertion attaches that snapshot after the production SVG parser and
  before the normal scene import action.
- Library-origin objects are reusable artwork rather than file revisions:
  adding the same asset repeatedly appends independent objects. Existing
  same-source file imports still use the established replace-in-place contract.
- Insertion remains geometry-only. It sets no object power scale or operation
  override and creates only ordinary line layers without CNC, material, or
  calibration metadata.
- Corrected per-entry source/license facts:
  CurveDesk-owned assets now identify CurveDesk/MIT; OpenClipart records expose
  CC0-1.0 and its canonical license URL; the six selected Feather-derived
  Lucide icons identify `ISC AND MIT`, while other Lucide entries remain `ISC`.
- Catalog validation now requires a nonblank source name, display license, and
  machine-readable license ID.

### Verification and independent audit

- Focused Library, insertion, state, and provenance tests: **56/56 passed**.
- Project serialization and validation tests: **210/210 passed**.
- Release-integrity/third-party closure tests: **14/14 passed**; license check
  passed for 33 production packages across seven allowed license groups.
- TypeScript, touched-file ESLint, Prettier, diff check, raw file-size policy,
  and public-export no-growth ratchet passed. The scene barrel remains at its
  accepted legacy count of 208 exports.
- Web production build passed. The primary renderer chunk is 713.12 kB /
  209.20 kB gzip, a 1.09 kB / 0.35 kB gzip increase from the M1 baseline.
- Broad regression run: 8,187 tests passed; one unrelated desktop Preview shell
  test hit its 15-second timeout under full parallel load. Its isolated rerun
  passed 1/1 in 12.7 seconds, and the independent auditor reproduced a pass in
  11.3 seconds. This is recorded as a P3 general load observation, not a
  Library regression.
- Independent M3 audit initially returned NO-GO for one P1 export-ratchet
  violation and two P2 validation/evidence gaps. All three were repaired. The
  delta re-audit returned **GO with no open P0–P2 findings**.
- No controller, Frame, Start, output, or laser-safety files changed. No
  physical-output behavior was qualified.

### Coordinator master-ledger record

- **Workstream:** CurveDesk Library — M3
- **Finding/fix title:** Correct insertion identity and persisted, validated,
  operation-neutral provenance
- **Severity:** former P1/P2 items closed; no open M3 severity
- **Status:** fixed/verified
- **Exact evidence/reproduction:** repeated `Library: Flower` imports previously
  replaced one another through source-name matching; Library-tagged scene
  objects now bypass filename re-import targeting, persist exact provenance,
  reject malformed/blank snapshots, and retain ordinary line-only insertion
- **Tests/checks:** 56 focused tests; 210 project IO tests; 14 release-integrity
  tests; typecheck; touched ESLint; Prettier; diff; file-size; export ratchet at
  208; license check; web build; independent delta audit GO
- **PR URL/commit:** none
- **Remaining boundary:** software behavior only; M4 UX is not included;
  physical output is unverified; no deployment, release, hardware operation, or
  main merge
- **Source ledger path:**
  `docs/audits/2026-07-31-library-redesign-program.md`

## Decisions

No material product or licensing decision is currently awaiting maintainer
input. M2 selected a single MIT artwork source, defined the geometry-only
boundary, and explicitly deferred persistent custom-library storage and
drag-to-place rather than expanding scope speculatively.

## Change log

- 2026-07-31: Created the clean worktree and this single program ledger.
- 2026-07-31: Completed M1 source, license, performance, desktop, and narrow
  browser audit. Recorded duplicate-replace, bulk placement, provenance,
  accessibility, visual, and eager-loading findings.
- 2026-07-31: Completed M2 primary-product research, source/license matrix, IA,
  visual system, data contract, and staged roadmap. Accepted pinned Tabler
  3.43.0 (MIT) as the sole new artwork family; rejected incompatible,
  redundant, proprietary, and unverified sources.
- 2026-07-31: Completed M3 duplicate-safe Library insertion, validated persisted
  provenance, exact per-entry license metadata, operation-neutral coverage, and
  an independent audit/delta re-audit. No open P0–P2 M3 findings remain.
