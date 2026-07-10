# KerfDesk full-sweep multi-sector audit — 2026-07-10

> **Report-only.** Per CLAUDE.md collaboration rule 1, this audit reports findings and the maintainer chooses what to fix. No source file was modified. Branch: `claude/multi-sector-audit-3447b9`.

## Audit charter

> Run a full-sweep, report-only audit of KerfDesk across every major product sector. For each sector: (1) walk the end-to-end user workflow; (2) assess the architecture behind it; (3) evaluate UI layout and button placement — where features live, whether they are discoverable, and whether placement matches LightBurn muscle memory; (4) explain how each feature actually works in the code; (5) identify what is genuinely great and must be preserved; and (6) propose concrete, prioritized, effort-sized improvements. Use LightBurn as the behavioral reference; treat divergences as bugs unless an ADR records them. Cite file:line evidence for every claim; adversarially verify every critical and major claim. Report only — change no code.

## Method

- 14 sector audit agents ran in parallel, each restricted to reading the tree (code, docs, tests, configs) — no code changes, no dev-server interaction, no synthetic DOM events (collaboration rule 4).
- Every **critical** and **major** finding was then handed to an independent adversarial verifier instructed to refute it against the cited files. **51 verdicts: 47 CONFIRMED, 4 PARTIAL** (core claim holds, a detail was corrected — the corrections are quoted inline), **0 refuted**.
- A completeness critic then reviewed coverage and named four unaudited subsystems (see "Unaudited gaps" below); the four gap agents failed on a session token limit and those sectors remain unaudited.
- Totals: 70 agents, ~7.8M tokens, 2,511 tool calls, ~39 minutes wall clock. **157 findings: 1 critical, 50 major, 84 minor, 22 polish**, plus 84 named strengths.

## What this audit did NOT verify

Consistent with Karpathy's law and CLAUDE.md rule 2, everything below is **static code reading**. Specifically not verified:

- **No perceptual verification.** No trace/fill/image output was rendered and compared to source. Green tests and clean reads are not fidelity proof.
- **No hardware verification.** Every hardware-accuracy claim in the tree (camera overlay registration, board capture G92, CNC air cuts, raster burns) remains **CLAIMED**, not VERIFIED, per the ADRs' own ledgers.
- **No live-app run.** The dev server was not driven; UI layout statements are code-derived (component structure, CSS, command registry), not screenshots.
- `pnpm test` was not run by the audit agents (read-only session); the architecture sector did run `pnpm lint` and `pnpm typecheck` (both clean).

## Unaudited gaps (flagged by the completeness critic — recommend a follow-up pass)

1. **Project persistence, save-format migration, autosave & crash/job recovery** (`src/io/project`, `src/core/recovery`) — data-loss and laser-resume safety live here.
2. **Electron desktop platform** (`electron/`): security posture (CSP, trusted renderer, private-network policy), auto-update, native serial, RTSP camera bridge, web-vs-desktop parity — the shipped Windows platform had zero dedicated coverage.
3. **Non-GRBL controller stack**: the Ruida binary/.rd/UDP implementation plus grblHAL, FluidNC, Marlin, Smoothieware drivers and controller auto-detection.
4. **Device/machine-profile lifecycle & catalog data correctness** (`core/devices`, `io/machine-profile`, .lbdev import, safety zones) — wrong catalog numbers translate directly into gantry crashes or fires.

## Scoreboard

| # | Sector | Grade | Critical | Major | Minor | Polish |
|---|--------|-------|----------|-------|-------|--------|
| 1 | Import & file I/O workflow | B+ | – | 5 | 6 | 2 |
| 2 | Canvas editing, drawing tools & content creation | B+ | – | 3 | 9 | 2 |
| 3 | Layers & cut settings (the LightBurn Cuts panel) | B | – | 4 | 6 | 1 |
| 4 | Toolpath preview, simulation & job planning | B+ | – | 2 | 9 | 2 |
| 5 | G-code generation & motion safety | A- | – | 2 | 6 | 2 |
| 6 | Machine control: connection, jog, console, streaming | A- | – | 3 | 6 | 2 |
| 7 | Camera & board/registration workflow | B+ | – | 4 | 4 | 3 |
| 8 | CNC / Easel mode | B+ | 1 | 3 | 3 | 1 |
| 9 | Trace engine & raster/image fidelity | B+ | – | 5 | 6 | 1 |
| 10 | Architecture & code health (cross-cutting) | A- | – | 3 | 5 | 1 |
| 11 | UI information architecture & button layout | B+ | – | 5 | 7 | 2 |
| 12 | Onboarding, help, error UX & docs | B | – | 2 | 6 | 1 |
| 13 | Performance & robustness (static analysis) | B- | – | 5 | 5 | 1 |
| 14 | Test & CI quality | B+ | – | 4 | 6 | 1 |

## Executive summary — the ten themes that matter

**The spine is excellent; the edges have drifted.** The compile/emit pipeline (one pure `prepareOutput` shared by Preview, Save, Start, Estimate), the streaming state machine, the command registry, and the enforcement machinery (boundaries, purity, exhaustiveness — lint and typecheck clean across 872 source files) are the strongest parts of the app and repeatedly earned A- grades. Almost everything below is edge-of-pipeline, parity, feedback, or governance debt — not core rot.

Ranked priorities across all sectors:

1. **The one critical: in-app CNC multi-bit jobs are un-completable (S8-F1).** An M0 tool-change hold surfaces no Resume, and jog/probe/Zero-Z are all blocked while a job is active — the documented re-zero-at-tool-change flow (F-CNC14/15) cannot be performed when streaming from the app, turning a bit swap into a wrong-depth cut.
2. **The last NaN hole (S1-F1 = S5-F1, found independently by two sectors).** Import boundaries now guard non-finite coordinates, but if any non-import path ever produces NaN, `G1 XNaN` is stringified into output and **every preflight scanner silently skips it** (`parseGcodeWord` returns null, predicates skip null). Effort S; closes a long-standing lead for good.
3. **Silent camera/board mis-registration (S7-F1/F2/F4).** Manual 4-point alignment mis-maps clicks on non-4:3 frames (letterbox ignored); persisted alignments apply to frames of any resolution with no guard; and the Registration Jig can silently unlock or clobber a captured board. These sit in exactly the accuracy-critical path that has never been hardware-verified.
4. **CNC beginner-safety defaults diverge from the Easel/Carbide references (S8-F2/F3/F4).** No work-zero advisory at Start, through-cut-by-default with tabs off and no warning, and the exact "cut-wrecking" 1000 mm/min / 1.5 mm default feeds ADR-111 was written about, whenever no material is picked.
5. **Operator-feedback black holes.** Wrong-baud hints, banner-mismatch advisories and wake-lock warnings go to a log surface that no longer exists in the UI (S6-F1); boolean/weld/offset failures are swallowed with zero feedback even though core prepares user-facing messages (S2-F1); connect failure never links the troubleshooting guide that exists one menu away (S12-F2); a placement failure shows an actively wrong "enable Output" hint (S4-F1).
6. **LightBurn muscle-memory cluster (mostly S/M effort, huge switcher payoff).** Ctrl+I imports only SVG where LightBurn has one universal Import (S1-F4 = S11-F4); selecting an object collapses the layer list into a closed disclosure (S3-F2 = S11-F1); no one-click color-palette layer assignment (S11-F2); fixed, non-collapsible right rails with no Window-menu control (S11-F3); no Fire/test-pulse button on exactly the diode machines the catalog targets (S6-F2); no continuous/keyboard jog, jog speed, or go-to-origin (S6-F3); Ctrl+Shift+G ungroup and offset-duplicate Ctrl+D, both unrecorded (S2-F3).
7. **Performance hot loops in flagship scenarios (S13, all surgical fixes).** Preview recompiles on the main thread every 250 ms status poll while connected; the CNC 3D pane recomputes a full compile + removal grid per store update (per mousemove); an object-returning selector re-renders the App root per mousemove; the streamer queue is O(N²) over a job; image-mode compile is uncached with a character-at-a-time base64 decoder. The flagship demo — photo engrave, Preview open, machine connected — hits three of these at once.
8. **The raster/Image-mode fidelity blind spot (S9-F2/F3/F4 = S14-F2).** Rotated raster images cannot engrave at all (LightBurn can); burn-grid resampling is nearest-neighbor; and the one LightBurn headline mode with zero perceptual coverage is Image mode — its fidelity claims rest on structural tests plus a pending hardware burn.
9. **Doc/spec drift is now systemic, not incidental.** WORKFLOW.md has materially drifted in at least six sectors (import states, cuts panel, camera flows, save fallback, shortcuts, pause gate); PROJECT.md still describes the trace engine as imagetracerjs with centerline open — both false; ADR-045's warn-don't-block decision is contradicted by shipped code (S3-F1); per-object cut overrides, replace-on-reimport, and shortcut divergences are unrecorded; CLAUDE.md claims two CI gates that are convention-only (S14-F1).
10. **Architecture governance gaps behind the clean lint run (S10).** The `Result<T,E>` discipline does not exist in core — geometry booleans throw user-facing strings and the UI branches via silent catch, the exact banned anti-pattern; the 250-line soft tier and index.ts export caps are unenforced fiction (76 files past soft; `camera/index.ts` at ~80 exports vs a hard cap of 20); 8 verifiably dead modules.

**What must be preserved** (the recurring strengths): the single prepared-output pipeline; the three-layer laser-off-on-travel enforcement; the pure terminal-absorbing streamer with the untracked-ack ledger; the command registry feeding every UI surface with test-enforced tooltips; the ADR-101 single choke-point mode gating; the perceptual harness discipline (instruments tested first); the hostile-input-grade .lf2 load path; and the box generator / Device Setup wizard dialog patterns.

---

# Sector reports

## 1. Import & file I/O workflow — grade B+

Import and file I/O is one of the most mature sectors in the tree: four formats (SVG, DXF, PNG/JPG, STL) plus a CNC-only G-code simulator import all funnel into a single SceneObject carrier and a single prepareOutput/emitGcode pipeline, the .lf2 load path is defended in depth (schema gate, migration registry, path-precise validator, integer-bomb and coordinate caps), and autosave/recovery is carefully engineered with per-window slots, beforeunload flush, and quota reporting. Both known leads were re-verified: the DXF closed-seam bug is fixed at the compile layer with a pinned test, and NaN can no longer enter via any import format — though the preflight backstop is still blind to a non-numeric coordinate word if one is ever produced elsewhere. The real weaknesses are parity and doc drift rather than mechanism: Ctrl+I opens an SVG-only picker where LightBurn has one universal Import, embedded SVG bitmaps are dropped with a stale 'Phase E will support these' toast, repeat imports silently replace placed artwork, WORKFLOW.md still documents a web download fallback and other F-A3/F-A12 states the code never implemented, and there is no Open Recent and no recorded decision about .lbrn. Nothing rose to critical; grade B+.

### What's great

- **Every import format converges on one SceneObject carrier and one output pipeline** — SVG, DXF, and generated geometry all land as the same 'imported-svg' variant (DXF explicitly reuses it so 'both compilers / preview / save apply unchanged'), and emitGcode routes preview, live estimate, Save G-code, and Start through the same prepareOutput pipeline — what is previewed is what is emitted, and a new format needs zero downstream changes. _(src/io/dxf/parse-dxf.ts:80-91; src/io/gcode/emit-gcode.ts:38-48)_
- **Layered, hostile-input-grade .lf2 load path** — deserializeProject stacks schema-version gating + a migration registry, a path-precise shape validator (errors like 'missing or invalid `scene.objects[3]...`'), finite-coordinate and transform-scale caps, an integer-bomb guard on stored raster dimensions (256M px cap, security audit 2026-06-14), and field-level normalizers that drop malformed values to safe defaults instead of trusting them. A corrupt file produces a specific reason, never a partial load. _(src/io/project/deserialize-project.ts:39-81; src/io/project/project-shape-validator.ts:41-48; src/io/project/project-shape-primitives.ts:1-2,47-59)_
- **SVG import treats input as untrusted and shows its work** — DOMPurify SVG profiles plus an allowlist href hook (fragments + data:image only — explicitly fixed from a blocklist after audit LU6), resource budgets (256 colors / 50k polylines / 250k points / 1e6 mm coordinate cap), a 256-deep walk cap against circular <use> chains, and sanitization counts surfaced to the user in the import toast. _(src/io/svg/sanitize.ts:57-73; src/io/svg/svg-import-budget.ts:1-52; src/io/svg/parse-svg.ts:152-156; src/ui/app/import-toasts.ts:83-97)_
- **Autosave + crash recovery is genuinely engineered, not a timer bolt-on** — Per-window sessionStorage-keyed slots with an index (two dirty windows cannot clobber each other), a beforeunload flush that deliberately overrides the streaming pause, quota failures surfaced once with actionable copy, recovery that only prompts into an empty scene, keeps the slot armed until the first manual save (M15: the restored project's only durable copy IS the slot), and clears on manual save/open so the prompt never nags. _(src/ui/state/autosave.ts:24-102,147-160; src/ui/app/use-autosave.ts:60-120; src/ui/app/file-actions.ts:253-255,292-293)_
- **Re-import-with-diff preserves user investment** — Re-importing an edited SVG/DXF with the same filename keeps the object's id, position/scale/rotation, and all per-color layer settings, then toasts a kept/new/removed color diff — the iterate-in-your-design-tool loop LightBurn users actually live in (semantics caveat filed as a finding). _(src/ui/state/scene-mutations.ts:454-488; src/ui/app/import-toasts.ts:69-81)_
- **Both known import leads addressed at the right layer** — The DXF closed-entity seam bug is fixed consumer-agnostically (withClosingPoint applied in compileJob so every producer that sets `closed` but drops the seam vertex is covered, pinned by compile-job-closure.test.ts), and NaN can no longer enter through any import format (SVG asserts, DXF coerces, .lf2 validates). _(src/core/scene/polyline-closure.ts:24-44; src/core/job/compile-job.ts:418; src/core/job/compile-job-closure.test.ts:4)_

### Findings

#### S1-F1 [MAJOR] Preflight bounds check silently skips non-numeric coordinates — the NaN backstop is still missing at the G-code gate

_Area: mechanism · Effort: S · verified: CONFIRMED_

The import boundary now guards non-finite coordinates (SVG: assertSvgImportPoints; DXF: parseNumber coerces to fallback; .lf2: requireCoordinate), but the last line of defense is blind: parseGcodeWord returns null for any word whose value fails Number.isFinite (gcode-words.ts:10-11), and appendAxisBoundsIssue returns immediately on null (predicates.ts:121). So if any non-import path (numeric property edits, geometry ops) ever produces NaN, the emitted line 'G1 XNaN ...' (toFixed(3) of NaN is 'NaN') passes every preflight check and faults on GRBL mid-job. This is the surviving half of the known lead 'NaN unguarded until emit'.

- **Evidence:** src/core/invariants/gcode-words.ts:4-12; src/core/invariants/predicates.ts:111-126; src/io/svg/svg-import-budget.ts:42-52; src/io/dxf/dxf-entities.ts:180-183; src/io/project/project-shape-primitives.ts:47-52
- **LightBurn reference:** LightBurn never emits malformed coordinate words; a comparable failure would be caught before streaming.
- **Recommendation:** Add a preflight predicate that flags any motion line containing an X/Y/Z/F/S word whose value fails numeric parse (distinct from 'word absent'), and/or assert Number.isFinite at the emit formatting boundary so a NaN can never be stringified into output.

#### S1-F2 [MAJOR] WORKFLOW.md documents a web save 'browser download' fallback that deliberately does not exist

_Area: workflow · Effort: S · verified: CONFIRMED_

F-A9 ('web ... uses File System Access API where available, else browser download') and F-A11 ('falls back to browser download', plus a 'Save needs file-system access. Re-prompt?' modal) contradict the shipped adapter, which states 'No download-fallback path' and throws when showSaveFilePicker is missing; the throw surfaces as a generic error toast. PROJECT.md targets Chromium-only, so the code position is defensible — but WORKFLOW.md is declared the source of truth for UI behavior and has drifted. The documented re-prompt modal also does not exist.

- **Evidence:** WORKFLOW.md:341-342,396-397; src/platform/web/web-adapter.ts:1-6,50-53; src/ui/app/file-actions.ts:245-247; PROJECT.md:37
- **LightBurn reference:** Not applicable (desktop app); the finding is internal doc/code contradiction, which CLAUDE.md treats as stop-and-ask.
- **Recommendation:** Fix WORKFLOW.md F-A9/F-A11 to state the Chromium-only File System Access contract and the actual error copy, or implement the documented download fallback — pick one and record it.

#### S1-F3 [MAJOR] SVG embedded <image> elements are dropped with a stale 'Phase E will support these' promise

_Area: workflow · Effort: M · verified: CONFIRMED_

parseSvg counts <image> elements and discards them; the toast says 'embedded image(s) ignored — Phase E will support these'. Phase E (raster import + trace) shipped long ago, standalone PNG/JPG import exists, and the sanitizer already whitelists data:image URIs — but embedded bitmaps inside an SVG still never import. An Inkscape/Illustrator file mixing vectors and a placed photo silently loses the photo, with a message pointing at a phase that already shipped.

- **Evidence:** src/io/svg/parse-svg.ts:171-172,450-452; src/ui/app/import-toasts.ts:46-52; src/io/svg/sanitize.ts:36,66; PROJECT.md:91 (Phase E shipped)
- **LightBurn reference:** LightBurn imports SVGs with embedded raster images as image objects alongside the vectors.
- **Recommendation:** Decode data:image hrefs into RasterImage scene objects during the walk (reusing importImageFile's geometry/luma path), or at minimum update the toast to an honest 'embedded images are not supported' and record the divergence.

#### S1-F4 [MAJOR] Import is split into three format-specific commands; Ctrl+I opens an SVG-only picker

_Area: ui-layout · Effort: S · verified: CONFIRMED_

File menu has Import SVG... (Ctrl+I), Import DXF... (no shortcut), Import Image... (no shortcut), each opening a picker filtered to a single extension family. A LightBurn user pressing Ctrl+I to import a DXF or PNG gets a picker that will not accept it and must discover the sibling menu items. The drag-drop path already dispatches all four formats from one entry point, so the split is picker-only friction.

- **Evidence:** src/ui/commands/command-families.ts:34-42; src/ui/app/file-actions.ts:43,58; src/ui/commands/platform-image-files.ts:3; src/ui/app/use-import-drag-drop.ts:63-92
- **LightBurn reference:** LightBurn has a single File → Import (Ctrl+I) whose picker accepts every supported format (svg, dxf, png, jpg, ai, pdf, ...).
- **Recommendation:** Add a unified 'Import...' command on Ctrl+I with accept ['.svg','.dxf','.png','.jpg','.jpeg','.stl'] that dispatches by extension exactly like the drop handler; keep the per-format items as secondary entries.

#### S1-F5 [MAJOR] Re-importing a file with the same name silently replaces the existing object instead of adding a copy

_Area: workflow · Effort: M · verified: CONFIRMED_

importSvgObject matches on source filename and swaps the existing imported-svg in place (keeping id/transform/layer settings), toasting a kept/new/removed diff. The diff feature is excellent for the iterate-in-Inkscape loop, but it is the unconditional default: there is no way to import a second instance of the same file, and a user expecting LightBurn's add-another-copy behavior gets their placed copy overwritten (undo-able, toasted, but surprising). PROJECT.md scopes 're-import with diff' but the always-replace semantics are not recorded as a deliberate LightBurn divergence, and WORKFLOW.md F-C4 is still a stub.

- **Evidence:** src/ui/state/object-insert-actions.ts:55-69; src/ui/state/scene-mutations.ts:79-87,454-488; PROJECT.md:75; WORKFLOW.md:810
- **LightBurn reference:** LightBurn's Import always adds a new instance; repeat imports never replace placed artwork.
- **Recommendation:** Write F-C4 with explicit semantics and either prompt ('Replace existing design.svg or import as copy?') or add an 'import as copy' modifier; record the divergence in DECISIONS.md.

#### S1-F6 [MINOR] F-A3 documented import states missing: no MIME/content sniff, no >5s parse spinner (parse blocks the main thread), no units-assumed toast, no batch summary toast

_Area: workflow · Effort: M_

Drop/picker filters are extension-only (doc specifies MIME + first-200-bytes sniff); parseSvg runs synchronously on the main thread so the documented non-blocking 'Parsing large SVG…' spinner is impossible and a confirmed oversize import freezes the UI; the 'no units — assuming millimeters' info toast does not exist (though unit handling itself is more sophisticated than the doc, per ADR-046); multi-file drops toast per-file rather than the documented 'Imported 3 designs · 7 colors total'. Each divergence is small; together F-A3 is materially out of date.

- **Evidence:** src/ui/app/use-import-drag-drop.ts:111-124,143-173; src/io/svg/parse-svg.ts:414-438 (synchronous); src/io/svg/svg-units.ts (no note emitted); WORKFLOW.md:95-105,88,123-124
- **LightBurn reference:** LightBurn parses large files with a progress indication and does not hard-freeze the canvas.
- **Recommendation:** Update F-A3 to match shipped behavior, and consider moving parseSvg into the existing Web Worker pattern used by trace so oversize imports do not block the UI.

#### S1-F7 [MINOR] Picker import path reads the whole file into memory before the 25 MB oversize confirm

_Area: mechanism · Effort: S_

The drag-drop path checks file.size before reading, but the File-menu path must call file.text() first because PlatformAdapter's FileHandle exposes no size — the guard then only prevents the parse, not the read. A multi-hundred-MB file stalls or OOMs the tab before the user is ever asked. Both the SVG picker and DXF picker have the pattern; the SVG one even documents it.

- **Evidence:** src/ui/app/file-actions.ts:66-69; src/ui/app/dxf-import-action.ts:35-36; src/ui/app/use-import-drag-drop.ts:150 (correct order); src/platform/types.ts:6-14 (no size field)
- **Recommendation:** Add readonly size to FileHandle (trivially available from the web File object) and hoist confirmOversizeImport above the read in both picker paths.

#### S1-F8 [MINOR] DXF value-level corruption coerces silently to 0 instead of rejecting with a line number

_Area: mechanism · Effort: S_

tokenizeDxf rejects structural corruption (bad group codes, truncation) with line numbers as F-CNC9 documents, but coordinate/value parsing (parseNumber) silently substitutes 0 or a fallback for a non-numeric value — a corrupt '10' (X) tag distorts geometry with no warning. DXF import also lacks SVG's coordinate-magnitude budget (1e6 mm cap), so extreme-but-finite values import and only fail later at bed-bounds preflight.

- **Evidence:** src/io/dxf/dxf-entities.ts:180-183; src/io/dxf/dxf-tags.ts:19-51; src/io/svg/svg-import-budget.ts:1-6 (SVG has the cap); WORKFLOW.md:1753-1754
- **LightBurn reference:** LightBurn rejects unreadable DXF entities rather than silently zeroing coordinates.
- **Recommendation:** Make parseNumber return a tagged failure for geometry-bearing codes (10/20/40/41/42/50...) and count/report them like skipped entities; add a magnitude cap mirroring SVG_IMPORT_LIMITS.

#### S1-F9 [MINOR] No Open Recent, anywhere

_Area: ui-layout · Effort: M_

WORKFLOW.md F-A1 says returning users open via 'File → Open Recent (Phase C)'; no recent-files store, command, or menu entry exists in the tree. Combined with autosave recovery only prompting when the scene is empty and lastSaveTarget being cleared on New/Open, every session starts with a full picker navigation to the last project.

- **Evidence:** WORKFLOW.md:29; grep 'Open Recent|recentProjects|recent-files' over src → no matches; src/ui/commands/command-families.ts:10-60 (File family has no recent list)
- **LightBurn reference:** LightBurn shows a recent-projects list in the File menu and on its start behavior.
- **Recommendation:** Persist a small MRU of saved/opened project names (and FileSystemFileHandles where permission persists) in localStorage and render a File → Open Recent submenu.

#### S1-F10 [MINOR] .lbrn project import is absent with no recorded scope decision

_Area: workflow · Effort: L_

PROJECT.md's out-of-scope list names .clb, AI, and PDF explicitly, and io/lightburn already imports LightBurn .lbdev device profiles — but .lbrn (the project format of the product KerfDesk explicitly mirrors) appears nowhere in src and in no scope/ADR entry. For a LightBurn migrator, their entire existing project library is unreadable, and the repo has no written decision saying that is intentional.

- **Evidence:** grep -i 'lbrn' over src → no matches; src/io/lightburn/lbdev-import.ts:40-60 (.lbdev only); PROJECT.md:462,470-471; DECISIONS.md:39 ('.lf2 ... analogous to .lbrn')
- **LightBurn reference:** LightBurn opens .lbrn/.lbrn2 natively; MillMage (same vendor) reads .lbrn too.
- **Recommendation:** Record an ADR: either scope a geometry-plus-cut-settings .lbrn importer (the format is zlib-wrapped XML) or explicitly declare it out of scope so the gap is a decision, not an omission.

#### S1-F11 [MINOR] F-A12 edge state 'project references a device profile not configured locally' has no implementation

_Area: workflow · Effort: S_

WORKFLOW.md F-A12 documents a status-bar warning ('Project's device profile (xTool S1) is not configured locally. Add it in Settings.') when opening a .lf2 whose embedded profile is unknown to this machine. The load path normalizes and adopts the embedded device wholesale; no local-profile comparison or warning exists.

- **Evidence:** WORKFLOW.md:423-425; src/ui/app/file-actions.ts:288-299; src/io/project/deserialize-project.ts:210-240 (adopts embedded device); grep 'not configured locally' → no matches
- **Recommendation:** Either implement the check against the machine-profile store or delete the edge state from WORKFLOW.md.

#### S1-F12 [POLISH] Core import-pipeline files are riding the 400-counted-line hard cap

_Area: architecture · Effort: M_

By a blank/comment-excluding approximation, parse-svg.ts is at ~400 counted lines (471 raw), project-shape-validator.ts ~396, scene-mutations.ts ~392, store.ts ~381 — all far past the 250 soft limit with near-zero headroom before the CI hard error. parse-svg.ts in particular bundles color normalization, presentation-state inheritance, transform matrix math, and the walk; the matrix helpers are a natural extraction.

- **Evidence:** wc/grep counts this session: src/io/svg/parse-svg.ts (471 raw/~400 counted), src/io/project/project-shape-validator.ts (~396), src/ui/state/scene-mutations.ts (~392); CLAUDE.md size-limits table
- **Recommendation:** Split parse-svg.ts (matrix/transform helpers → svg-transform.ts, color → svg-color.ts) before the next feature touches it; same for the validator and scene-mutations.

#### S1-F13 [POLISH] Inconsistent io error contract: parseSvg throws, parseDxf returns a Result

_Area: architecture · Effort: M_

parseDxf and parseGcodeProgram return tagged {kind:'error'} results per the repo's Result convention; parseSvg throws Error for parse failures and budget violations, forcing every caller into try/catch (importMany, handleImportSvg both do). io/ is outside the pure-core throw ban, but CLAUDE.md lists throwing-for-control-flow as a repo-wide anti-pattern and the two importers now disagree on shape.

- **Evidence:** src/io/svg/parse-svg.ts:417-427; src/io/svg/svg-import-budget.ts:29-46 (throws); src/io/dxf/parse-dxf.ts:29-38 (Result); src/ui/app/use-import-drag-drop.ts:151-171 (try/catch)
- **Recommendation:** Migrate parseSvg to the same ParseResult union in a pure refactor PR; the toast helpers already centralize messaging so the diff is mechanical.

### Not verified in this sector

- Did not run pnpm test/lint/typecheck (read-only audit): the counted-line figures are my own blank/comment-excluding approximation, not ESLint's counter.
- No perceptual/fidelity verification of any import: SVG curve-flattening quality, DXF spline/bulge/ellipse accuracy, unit scaling vs LightBurn on real files, and trace overlay registration were read in code only — none were rendered or compared to LightBurn output this session.
- Electron runtime behavior (showOpenFilePicker/showSaveFilePicker presenting native dialogs in the Electron renderer, fileSystem* permission grant) inferred from main.tsx and PROJECT.md:427 comments, not executed.
- What the GRBL streamer does when a malformed (e.g. XNaN) line errors mid-job — whether the laser is left energized — was not traced; the NaN-backstop finding's failure scenario past the preflight gate is unconfirmed.
- Autosave behavior across multiple real browser windows, real quota exhaustion, and the beforeunload write under a force-kill were not exercised.
- LightBurn reference behaviors (single Ctrl+I import for all formats, embedded-SVG-image import, repeat-import-adds-copy, Open Recent) are from prior knowledge of LightBurn, not verified against a live LightBurn install this session.
- WORKFLOW.md was read in relevant sections (lines 1-1163 plus targeted greps and F-CNC9/F-CNC10); Phase-CNC sections beyond the import flows were not fully read.

## 2. Canvas editing, drawing tools & content creation — grade B+

Canvas editing is the most mature LightBurn-parity surface I've audited in this codebase: the full selection stack (click, shift-toggle, directional enclosing/crossing marquee, group expansion, locked/hidden filtering), single- and multi-selection scale/rotate with anchor-grid numeric X/Y/W/H/R entry, object+grid snapping with guides and Ctrl bypass, five drag-drawn primitives plus a click-driven pen with LightBurn's Ctrl+R/E/L bindings, basic node editing, group/align/distribute, clipper2-backed weld/subtract/intersect/exclude/offset, a genuinely excellent box generator, and a curated design library — all riding a disciplined snapshot undo and a single command registry that feeds menu, toolbar, context bar, and shortcuts identically. The architecture is clean: shape math is pure core, drags are a discriminated-union state machine, and every mutation pushes exactly one undo entry. The gaps are concentrated at the edges: boolean/weld/offset failures are silently swallowed (the core prepares user-facing messages the UI never shows), text creation is a 4-font modal far from LightBurn's on-canvas tool, drawn primitives have no editable shape properties (recorded as deferred), and WORKFLOW.md has drifted from or never documented much of this sector — including code comments citing a LIGHTBURN-STUDY.md that does not exist in the tree. Nothing here reaches critical (no G-code or safety implications), and none of the drawing/editing output has been perceptually verified in this read-only session.

### What's great

- **One command registry feeds every surface, with disabled-reason tooltips everywhere** — Menus, top toolbar, right-click context bar, and shortcuts all consume the same gated AppCommand objects; a disabled command always carries a human reason ('Select at least two objects to align.', 'Copy or cut artwork first.') that renders as the tooltip on every surface. Adding a command once places it everywhere, and MENU_GROUPS/TOOLBAR_GROUPS are presentation-only layers that provably cannot hide an unregistered command (leftovers always render). _(src/ui/commands/use-app-commands.ts:59-73; src/ui/commands/AppMenuBar.tsx:133-180; src/ui/commands/WorkspaceContextBar.tsx:39-78; src/ui/common/Toolbar.tsx:64-117)_
- **LightBurn-faithful selection semantics implemented in one pure module** — Directional marquee (L→R enclosing, R→L crossing) matches LightBurn exactly; click on any group member expands to the whole group; locked objects and hidden-layer objects are filtered by a single orderedLiveIds gate used by click, shift-click, marquee, and Select All alike — so lock/visibility rules cannot drift between selection paths. _(src/ui/workspace/selection-marquee.ts:9-27; src/ui/state/scene-group-actions.ts:114-135)_
- **Airtight undo discipline: every mutation is one snapshot, drags coalesce, Esc cancels cleanly** — All 30+ store slices that touch the Project route through pushUndo (94 call sites); interactive drags use beginInteraction/setObjectTransform/endInteraction so a whole drag is exactly one undo step, endInteraction skips no-op drags, and cancelInteraction (Esc mid-drag) restores the pre-drag snapshot without polluting history. A Window > Undo History dialog exposes the stacks — something LightBurn doesn't have. _(src/ui/state/store-actions.ts:207-245; grep pushUndo → 94 occurrences across 32 state files; src/ui/commands/UndoHistoryDialog.tsx)_
- **Drawing tools are pure-core parametric SceneObjects riding the existing pipeline** — shapeFromDrag lives in src/core (caller supplies id and color, so core stays RNG/UI-free), supports Shift=regular and Ctrl=from-center modifiers, rejects sub-0.5 mm twitches, and commits kind:'shape' objects that flow through compile/preview/emit/serialize unchanged (ADR-051's TextObject precedent) — preview and G-code cannot disagree about a drawn shape. Ctrl+R/E/L match LightBurn's bindings, with export G-code deliberately moved to Ctrl+Shift+E and the reasoning recorded (ADR-051 B7). _(src/core/shapes/shape-from-drag.ts:27-100; src/ui/workspace/draw-tool.ts:88-99; DECISIONS.md:2734-2779)_
- **Box generator is a model dialog-tool: pure validation, live dual preview, persistent draft** — The Phase K box generator parses a string draft through pure core (parseBoxDraft/generateBox/validateBoxSpec), keeps the last valid sheet visible while the draft is invalid, distinguishes blocking issues from warnings, shows outer/inner dims live, offers flat and assembled 3D previews plus a fit-test coupon (ADR-119), persists the draft, and is discoverable in both the top toolbar and Tools menu. Insertion is one undo step with all panels selected (F-K1/F-K5). _(src/ui/box/BoxGeneratorDialog.tsx:38-115; src/ui/common/Toolbar.tsx:122-137; WORKFLOW.md:2446-2698 (F-K1..F-K9))_
- **Snap engine is pure, guide-emitting, and LightBurn-consistent where it applies** — snapMoveTransform is a pure function over the Project returning transform + guide segments (rendered as canvas guides), considers object edges/centers and grid per-axis independently, excludes locked objects and the dragged multi-selection itself, and Ctrl/Cmd temporarily bypasses snapping during a move exactly like LightBurn — with the conflict against Ctrl-scale-from-center consciously reasoned about in a comment. _(src/ui/workspace/snapping.ts:42-111; src/ui/workspace/drag-snap.ts:35-49; src/ui/workspace/apply-transform-drag.ts:43-54)_

### Findings

#### S2-F1 [MAJOR] Boolean / weld / offset failures are silently swallowed — dead-end with zero feedback

_Area: workflow · Effort: S · verified: PARTIAL_

core's combineVectorObjects/offsetVectorObjects throw user-facing messages ('The result is empty — the selected shapes do not overlap that way', 'The offset collapsed the shape — use a smaller inward distance') and the header comment says 'callers surface the message'. The UI slice catches every one of these and returns state unchanged with no toast: weld (catch { return state; }), boolean, and offset all swallow. Menu gating (selectionCanCombine) pre-filters open contours, but the reachable cases — Intersect on disjoint shapes, Exclude producing an empty region, an inward Offset larger than the shape — click and nothing happens. LightBurn always gives visible feedback (a result or a status message).

- **Evidence:** src/ui/state/vector-path-actions.ts:131-135, 163-167, 195-199; src/core/geometry/vector-path-booleans.ts:35-39, 58-60, 90-92; src/ui/commands/tool-command-context.ts:77-79 (no pushToast wired)
- **LightBurn reference:** LightBurn's Boolean tools and Offset Shapes always produce a visible result or feedback; a no-op click with no explanation does not occur.
- **Recommendation:** Route the caught error message into pushToast (the toast store is already imported in sibling slices, e.g. scene-clipboard-actions.ts:12). One warning toast per failed op; keep the state-unchanged semantics.
- **Verifier's correction (PARTIAL):** The mechanics are all confirmed: vector-path-actions.ts swallows every core throw with `catch { return state; }` (weld 131-135, boolean 163-167, offset 195-199), vector-path-booleans.ts throws user-worded messages and its header (lines 35-39) says "callers surface the message", tool-command-context.ts:76-79 wires the ops without pushToast despite pushToast being a parameter wired to sibling actions in the same function, and the empty-Intersect / collapsing-inward-Offset cases are reachable past the menu gating (selectionCanCombine at selection-command-state.ts:91-97 cannot pre-detect empty results; OffsetPathsRow.tsx:52 has no feedback path). However the finding is weakened on two counts the auditor missed. (1) WORKFLOW.md:2087-2095 (F-CNC22, ADR-103 G1) explicitly records both headline cases as the designed flow — "An inward offset large enough to collapse the shape changes nothing" and "An Intersect of non-overlapping shapes produces nothing and leaves the scene untouched" — and vector-path-actions.test.ts:185-194 asserts that silent no-op as expected behavior, so this is documented behavior, not an accidental dead-end (though the flow doc never explicitly says no feedback is shown, and it contradicts the core module's own "callers surface the message" contract — that internal drift is the real surviving defect). (2) The weld swallow is defensive-only: selectionCanWeld (selection-command-state.ts:77-88) pre-checks every condition weldVectorObjects throws on (empty selection, open contours, metadata compatibility — vector-path-tools.ts:46/55/72/98), so it is not reachable via the gated command; and "Exclude producing an empty region" requires identical shapes (XOR of disjoint shapes is non-empty), an edge case. No data loss, no undo pollution, no wrong G-code — severity 'major' is inflated for a documented UX-feedback gap; it is a minor doc/contract-drift issue needing a maintainer decision (surface the messages via pushToast, or fix the core comment and WORKFLOW.md to say silence is intended).

#### S2-F2 [MAJOR] Text tool is a modal dialog with 4 bundled fonts — far from LightBurn's on-canvas text

_Area: workflow · Effort: L · verified: CONFIRMED_

Text is created via a top-toolbar 'Add Text' button that opens AddTextDialog (content textarea, font picker limited to FONT_REGISTRY's 4 fonts, size/alignment/line-height/letter-spacing, diacritic insert buttons). There is no on-canvas typing, no live preview on the bed, no system-font access, no bold/italic, no curved/arc text, and no text entry in the left tool strip (TOOLS array has no text tool) nor a Ctrl+T-style binding (TOOL_BINDINGS is only r/e/l). Bundled-fonts-only is a recorded decision (ADR-012: 'No system font access'), and arc/curved text + system-font import are on the ADR-103 explicit roadmap — but the modal-instead-of-canvas editing model and the missing tool-palette placement are unrecorded divergences. Edit path (double-click selected text reopens the dialog, transform preserved) works.

- **Evidence:** src/ui/text/AddTextDialog.tsx:44-82; src/core/text/font-registry.ts:25-53; src/ui/workspace/ToolStrip.tsx:17-27; src/ui/app/shortcuts.ts:306-310; DECISIONS.md:222-236 (ADR-012), DECISIONS.md:4397-4405 (ADR-103 roadmap); src/ui/workspace/Workspace.tsx:302-339 (dblclick edit)
- **LightBurn reference:** LightBurn: Text is a left-tool-palette tool; you click the canvas and type in place, with a Text options toolbar (system font dropdown, height, bold/italic, spacing, curved text, weld).
- **Recommendation:** Short term: add a Text entry to the ToolStrip that opens the dialog (muscle-memory placement) and record the dialog-vs-canvas divergence in an ADR. Medium term: on-canvas click-to-place with the dialog fields moved to a contextual bar; system-font import needs its own ADR per the ADR-103 roadmap.

#### S2-F3 [MAJOR] Ungroup binding Ctrl+Shift+G diverges from LightBurn's Ctrl+U; Ctrl+D duplicates with a 10 mm offset instead of in place — both unrecorded

_Area: workflow · Effort: S · verified: CONFIRMED_

Group is Ctrl+G (matches LightBurn) but Ungroup is Ctrl+Shift+G. Duplicate (Ctrl+D) clones with a 10 mm x/y stagger (MULTI_IMPORT_OFFSET_MM reuse), where LightBurn duplicates exactly in place. Neither divergence is recorded in DECISIONS.md (no ADR mentions ungroup shortcuts or duplicate offset; ADR-051:2760 explicitly deferred the 'clipboard / group / align / grid array' increment to 'a separate ADR/phase' and no such ADR exists in the file). Per ADR-027 divergences are defects unless recorded. Group/ungroup themselves are also missing from the Arrange menu — they live under Edit; LightBurn keeps them in Arrange and on the toolbar.

- **Evidence:** src/ui/app/shortcuts.ts:210-217, 224-226; src/ui/commands/edit-command-family.ts:124-155; src/ui/state/scene-mutations.ts:29 (MULTI_IMPORT_OFFSET_MM), DECISIONS.md:2760; grep of DECISIONS.md for 'ungroup'/'Ctrl+U' → only ADR-106 panel note (DECISIONS.md:4569)
- **LightBurn reference:** LightBurn: Group = Ctrl+G, Ungroup = Ctrl+U, both under the Arrange menu; Ctrl+D duplicates in place (stated from product knowledge — the in-repo LIGHTBURN-STUDY.md the code cites is absent, see the doc-drift finding).
- **Recommendation:** Either rebind Ungroup to Ctrl+U (keeping Ctrl+Shift+G as an alias) and add an in-place duplicate, or write the ADR recording why KerfDesk deviates. Also consider mirroring Group/Ungroup into the Arrange menu.

#### S2-F4 [MINOR] No shape-property editing after (or during) drawing: corner radius, polygon sides, star points are frozen

_Area: workflow · Effort: M_

shapeFromDrag hardcodes cornerRadiusMm: 0, DEFAULT_POLYGON_SIDES = 6, DEFAULT_STAR_POINTS = 5 / ratio 0.5, and no UI anywhere edits a shape's parametric spec afterwards (repo-wide grep for cornerRadius/sides in src/ui hits nothing but an unrelated comment; object-properties actions only cover powerScale and operation overrides). The spec union carries the parameters (ADR-051), so this is purely a missing editor. It IS recorded as deferred ('Interactive parametric handles ... deferred (P2)', ADR-051), so it is a known parity gap rather than an unrecorded divergence — but a LightBurn user reaching for Shape Properties finds nothing.

- **Evidence:** src/core/shapes/shape-from-drag.ts:20-27, 43; DECISIONS.md:2766-2768 (ADR-051 P2 deferral); grep src/ui for cornerRadius|sides → only src/ui/state/registration-box-actions.ts:39 (unrelated); src/ui/state/object-properties-actions.ts:28-36
- **LightBurn reference:** LightBurn's Shape Properties window edits rectangle corner radius and polygon side count on the selected primitive.
- **Recommendation:** Add a small Shape Properties section (visible when a kind:'shape' object is selected) editing spec fields and re-materializing paths — the parametric block was designed for exactly this.

#### S2-F5 [MINOR] Node editor is move/delete only, and silently no-ops on primitives without a Convert-to-Path hint

_Area: workflow · Effort: M_

The node tool supports select (with shift-additive within one object), drag (whole selected set follows the primary), nudge, and delete — but no insert-node, no smooth/corner conversion, no line↔curve, no break/join. Hit-testing only recognizes imported-svg, traced-image, and polyline shapes; clicking a rect/ellipse/polygon/star/text with the node tool does nothing, with no prompt that Convert to Path (which exists: convertSelectionToPath) would unlock it. ADR-103 states 'Node-level editing beyond this stays future work', yet a node tool-mode shipped; I found no ADR recording its scope.

- **Evidence:** src/ui/state/path-node-edit-actions.ts:27-35 (action surface), src/ui/workspace/path-node-hit-test.ts:76-80 (eligible kinds); grep for insertNode/addNode → no matches; DECISIONS.md:4366-4367 (ADR-103); src/ui/help/help-topics.ts:81-84 (tooltip gives no eligibility hint)
- **LightBurn reference:** LightBurn's node editor supports insert (hover+I), delete, smooth/corner conversion, line↔curve, and break; editing a primitive requires conversion and LightBurn surfaces that requirement.
- **Recommendation:** Two cheap wins first: (a) toast/status hint 'Convert to Path to edit nodes' when the node tool clicks an ineligible object; (b) tooltip note. Then insert-node on segment click as the first editor extension, with an ADR defining node-editor scope.

#### S2-F6 [MINOR] WORKFLOW.md drift: stale marquee and flip-menu specs, no flows for drawing/text/node/group/align, and code cites a LIGHTBURN-STUDY.md that does not exist

_Area: workflow · Effort: M_

(1) F-A5 says marquee selects 'fully or partially inside' — the implementation is LightBurn's directional marquee (L→R enclosing, R→L crossing), which is better but contradicts the spec. (2) F-A6 says Flip lives in 'Edit → Flip Horizontal (H)' — flips are registered in the Arrange family. (3) There are no WORKFLOW flows at all for drawing tools (Phase G), text (Phase D is a stub listing F-D1..F-D5), node editing, group/ungroup, align/distribute, snapping, or the undo-history dialog; booleans/offset and the design library are documented only under CNC flows (F-CNC22, F-CNC30) despite being machine-agnostic. (4) Four source comments cite 'LIGHTBURN-STUDY' sections (e.g. §6.1, §7.4) but no such file exists anywhere in the tree, so the parity reference cannot be audited.

- **Evidence:** WORKFLOW.md:153-157 vs src/ui/workspace/selection-marquee.ts:9-27; WORKFLOW.md:199-201 vs src/ui/commands/arrange-command-family.ts:51-89; WORKFLOW.md:840-850 (Phase D stub); WORKFLOW.md:5 (admits density gap); src/ui/app/shortcuts.ts:297, src/ui/workspace/selection-marquee.ts:9, src/core/raster/preview-data.ts:5, src/core/output/grbl-strategy.ts:13 (citations); Glob **/LIGHTBURN* → no files
- **LightBurn reference:** n/a — this is documentation-as-spec (ADR-016) drift, the repo's own contract.
- **Recommendation:** Update F-A5/F-A6 to match shipped behavior, add a Phase G flow section (draw/text/node/group/align/snap, four states each), and either commit the LightBurn study document or rewrite the four comments to cite something that exists.

#### S2-F7 [MINOR] Design library is reachable only via an unlabeled 'Lib' text button; absent from the command registry and menus

_Area: ui-layout · Effort: S_

The bundled design library (ADR-105 G11, flow F-CNC30) opens solely from a small text button reading 'Lib' appended below the icon tool strip, styled unlike the IconButtons around it. There is no tools.design-library command id, so it appears in no menu, no context bar, no shortcut, and no command-driven help. A user scanning File/Tools menus for 'library' finds only the CNC material/bit libraries. The dialog itself is good (category rail, filters, provenance, insert-through-SVG-pipeline).

- **Evidence:** src/ui/workspace/ToolStrip.tsx:50-58; grep src/ui/commands/command-types.ts for 'library' → no matches; src/ui/library/DesignLibraryDialog.tsx:35-116; DECISIONS.md:4474-4480 (ADR-105 G11)
- **LightBurn reference:** No direct LightBurn equivalent (Easel-parity feature) — so placement has no muscle-memory anchor, making menu presence more important, not less.
- **Recommendation:** Register a tools.design-library command (Tools menu, first group next to Box Generator) that sets libraryDialogOpen, and give the strip button a proper icon + label ('Design Library').

#### S2-F8 [MINOR] Offset tool hidden in the right-hand panel row; missing from the Tools menu where the booleans live

_Area: ui-layout · Effort: S_

Offset (ADR-103 G1, same feature family as weld/subtract/intersect/exclude) is implemented as OffsetPathsRow — a distance field + Outward/Inward buttons that appears in the right panel only when a closed-vector selection exists. It has no command id, so it is absent from the Tools menu group that contains convert-to-path/weld/subtract/intersect/exclude, absent from the right-click context bar, and invisible when nothing qualifying is selected (the row returns null rather than rendering disabled with a reason, unlike every registry command).

- **Evidence:** src/ui/layers/OffsetPathsRow.tsx:16-59; src/ui/commands/AppMenuBar.tsx:156 (tools group without offset); src/ui/commands/vector-boolean-commands.ts (siblings registered, offset not); DECISIONS.md:4360-4367 (ADR-103 G1 groups offset with booleans)
- **LightBurn reference:** LightBurn's 'Offset Shapes' is a Tools-menu item and toolbar button opening a dialog (stated from product knowledge).
- **Recommendation:** Add a tools.offset command (dialog or reuse of the row's fields) beside the booleans; keep the panel row as the quick path but render it disabled-with-reason instead of vanishing.

#### S2-F9 [MINOR] src/core geometry throws for control flow, violating the pure-core Result contract — and directly enabling the silent-swallow bug

_Area: architecture · Effort: M_

CLAUDE.md's pure-core rules ban 'throw exceptions for control flow — return a Result<T, E>'. combineVectorObjects and offsetVectorObjects throw for fully expected conditions (too few objects, open contour, empty result, collapsed offset), and weldVectorObjects is consumed the same way; every UI caller wraps them in try/catch, which is exactly the 'throwing for control flow' anti-pattern the same file names, and is why failures got silently discarded (see the boolean finding). dogboneSelection repeats the pattern (catch → continue).

- **Evidence:** src/core/geometry/vector-path-booleans.ts:35-39 (documented throws), 46-47, 58-60, 75-80, 90-92; src/ui/state/vector-path-actions.ts:76-79, 131-135, 163-167, 195-199; CLAUDE.md 'Pure core' + 'Anti-patterns: Throwing for control flow'
- **LightBurn reference:** n/a — internal architecture contract.
- **Recommendation:** Change the three core functions to return a discriminated Result<ImportedSvg, {reason}> ; the UI match arm then naturally has a place to toast the failure message. Small blast radius: five call sites.

#### S2-F10 [MINOR] Snapping is barely configurable and only applies to move drags

_Area: workflow · Effort: M_

Snap has good bones (object edges/centers + grid, visual guides, Ctrl temporarily bypasses — matching LightBurn), but the entire UI surface is a cryptic '#' toggle inside the bottom-right zoom chip; snap distance (2 mm) and grid pitch (10 mm) are store-settable (setSnapSettings) yet no UI edits them, and the settings do not persist. Snapping also never applies while drawing shapes, dragging the pen, scaling, or node-dragging (transformDragWithSnap returns guides:[] for every kind except 'move'), so drawn geometry lands on arbitrary sub-mm coordinates unless typed in afterwards.

- **Evidence:** src/ui/workspace/overlays.tsx:39-54 ('#' toggle); src/ui/state/ui-store.ts:293-296 (no persistence); src/ui/workspace/drag-snap.ts:35-39 (move-only); src/ui/workspace/snapping.ts:20-28 (constants); grep setSnapSettings → only overlays.tsx
- **LightBurn reference:** LightBurn exposes snap-to-grid/objects options in Settings, and snapping applies during shape creation as well as movement.
- **Recommendation:** Give the toggle a magnet icon + tooltip listing Ctrl-bypass; add distance/grid fields (a small popover on the toggle would do); extend snapMoveTransform to draw-drag start/end points.

#### S2-F11 [MINOR] Undo: 50-step cap duplicated in two constants, selection wiped on every undo/redo, history dialog rows are unlabeled

_Area: mechanism · Effort: S_

Undo/redo is snapshot-based (whole immutable Project) and comprehensively wired — every mutating slice pushes through pushUndo, drags coalesce via beginInteraction/endInteraction, Esc cancels without polluting history. Three rough edges: (1) HISTORY_DEPTH = 50 is defined independently in store-actions.ts and scene-mutations.ts (the copy-paste anti-pattern CLAUDE.md names; a future change to one silently desyncs undo vs redo caps — the redo slice caps with the other constant). (2) undo()/redo() unconditionally clear selectedObjectId/additionalSelectedIds, so undoing a nudge deselects everything — repeated undo-tweak cycles force reselection each time. (3) The Window > Undo History dialog lists rows only as 'N objects, M layers' with no action names, limiting its usefulness.

- **Evidence:** src/ui/state/store-actions.ts:15, 102-136; src/ui/state/scene-mutations.ts:28, 72-74; src/ui/commands/UndoHistoryDialog.tsx:91-96
- **LightBurn reference:** LightBurn's undo does not have a documented 50-step ceiling and keeps working context; no equivalent history dialog (the dialog is a KerfDesk extra).
- **Recommendation:** Export HISTORY_DEPTH once from scene-mutations; preserve selection across undo when the ids still exist in the restored project; tag undo entries with an action label for the dialog.

#### S2-F12 [MINOR] Groups are flat id-sets: grouping steals members from existing groups, so nested groups are impossible

_Area: mechanism · Effort: L_

SceneGroup is {id, name, objectIds}; groupSelectionInState first strips every selected id out of all existing groups, then creates one new flat group, and pruneGroups deletes any group left under 2 members. Selecting any member expands to the whole group (LightBurn-like), but grouping two existing groups destroys them into one — LightBurn preserves group hierarchy (groups of groups). The flat model also means ungroup always dissolves to loose objects in one step. Undocumented as a deliberate simplification (no ADR covers grouping at all — see the shortcut finding).

- **Evidence:** src/ui/state/scene-group-actions.ts:62-104, 114-135, 137-145
- **LightBurn reference:** LightBurn supports nested groups; grouping two groups yields a group containing groups, and ungroup peels one level.
- **Recommendation:** Record the flat model in an ADR (acceptable v1) or move objectIds to memberIds: (objectId | groupId)[] later; nothing downstream depends on flatness except these helpers.

#### S2-F13 [POLISH] Tool strip tooltips omit the LightBurn-parity shortcuts, hurting discoverability of the ADR-051 B7 bindings

_Area: ui-layout · Effort: S_

ADR-051 B7 deliberately bound Ctrl+R/Ctrl+E/Ctrl+L to rect/ellipse/pen for LightBurn parity (even overriding browser defaults), but TOOL_HELP tooltips for those tools say only 'Draw a rectangle by dragging...' with no shortcut hint; the strip's other affordances (Esc-to-select is mentioned only on the Select tooltip). Users find the bindings only via the Shortcuts dialog. Menu/toolbar commands do show their shortcuts, so the strip is the odd one out.

- **Evidence:** src/ui/help/help-topics.ts:89-108; DECISIONS.md:2770-2779 (B7 as-built); src/ui/common/Toolbar.tsx:115-117 (commands do append shortcuts)
- **LightBurn reference:** LightBurn tool tooltips include the binding (e.g. 'Ellipse (Ctrl+E)').
- **Recommendation:** Append '(Ctrl+R)' etc. to TOOL_HELP tooltips, sourced from the same table shortcuts.ts uses so they cannot drift.

#### S2-F14 [POLISH] Sector hotspot files sit at 89-100% of the 400 counted-line hard cap

_Area: architecture · Effort: M_

Approximate counted code lines (blank/comment-stripped grep; ESLint's exact count may differ slightly): DesignLibraryDialog.tsx ~400, command-families.ts ~389, use-workspace-drag.ts ~386, CommandShell.tsx ~370, drag-state.ts ~360, AddTextDialog.tsx ~357 — all far past the 250 soft cap where CLAUDE.md says 'stop and split before continuing'. The workspace drag files in particular keep absorbing every new tool mode (node, measure, position-laser, pen), which is exactly the growth pattern that produced them.

- **Evidence:** Line counts run this session over src/ui/workspace/use-workspace-drag.ts, src/ui/workspace/drag-state.ts, src/ui/library/DesignLibraryDialog.tsx, src/ui/commands/command-families.ts, src/ui/commands/CommandShell.tsx, src/ui/text/AddTextDialog.tsx; CLAUDE.md size-limits table
- **LightBurn reference:** n/a — repo size-limit contract (ADR-015).
- **Recommendation:** Pre-emptive splits: DesignLibraryDialog → grid/filters components; use-workspace-drag's beginToolDrag dispatch → per-tool modules (the pen/measure/position-laser branches are already self-contained).

### Not verified in this sector

- Any perceptual/runtime behavior: nothing was rendered or interacted with (read-only audit). Selection handles, snap guides, draft-shape rendering, pen rubber-band, text glyph fidelity, star/polygon geometry on screen, box flat/assembled previews, and design-library artwork were verified only as code, not as pixels.
- LightBurn behaviors cited from product knowledge (Ctrl+U ungroup, in-place Ctrl+D duplicate, Shape Properties corner-radius/sides editing, node-editor hotkey set, on-canvas text editing, Offset Shapes menu placement) could not be checked against an in-repo reference: the LIGHTBURN-STUDY.md the code cites does not exist in the tree.
- Exact ESLint counted-line numbers for the near-cap files (my grep-based approximation excludes blanks and //-comments but may differ from the lint rule's counting).
- Whether an ADR exists under different wording for the node tool-mode or for the group/align/distribute/clipboard increment (greps of DECISIONS.md for node edit/group/align/ungroup found none, but a differently-phrased record could have been missed).
- Memory behavior of the 50-deep whole-Project undo snapshots on scenes with large raster images (structural sharing should make it cheap; not measured).
- Marquee/hit-test behavior on rotated objects uses AABBs (transformedBBox) — whether this diverges from LightBurn's precise-geometry marquee on rotated shapes was not testable statically.
- The test suite was not run (per audit rules); all 'exists and is wired' claims are from reading source, not from executing it.

## 3. Layers & cut settings (the LightBurn Cuts panel) — grade B

The Cuts/Layers sector nails every core LightBurn semantic I checked one-by-one: layers are keyed by color and auto-created on import/draw/trace (scene-mutations.ts:89-159), the visible list order is literally the compile order (compile-job.ts:50), Show hides from canvas only while Output gates the job (visibility.ts vs compile-job.ts:51), double-click opens a full cut editor with Make Default parity, and the per-layer model (kerf, tabs, air, fill angle/interval/LPI/style/cross-hatch, 11 dithers, DPI/interval, dot-width, min-power) is deeper than most LightBurn clones. Architecture is genuinely clean — pure core layer model, one shared compile path so preview and G-code cannot disagree, undo on every mutation. The deductions are governance and discoverability, not correctness: material presets hard-block on device mismatch in direct contradiction of ADR-045's recorded warn-don't-block decision; selecting any object collapses the layer list behind a closed disclosure and hides the layer's fields; per-object cut-setting overrides and sub-layers are meaningful LightBurn divergences with no ADR; and WORKFLOW F-A7 has drifted badly from the shipped card UI, including a delete button whose destructive semantics the doc explicitly forbids. All findings are from static reading only — nothing here was verified perceptually or on hardware.

### What's great

- **The cut list IS the execution order, through one shared compile path** — compileJob walks scene.layers in array order and skips output:false layers (compile-job.ts:48-60); moveLayer is a pure adjacent swap with undo (scene.ts:73-82, store-actions.ts:39-49). Because preview, save, start, and estimate all consume the same prepared output (ADR-040), reordering a row provably reorders the burn — cut-settings-output-parity.test.ts routes a single dialog patch through prepared output, preview toolpath, G-code, and the live estimate and asserts they agree. _(src/core/job/compile-job.ts:48-60; src/ui/layers/cut-settings-output-parity.test.ts:18-50)_
- **Show vs Output semantics exactly match LightBurn, enforced at the right layers** — visible only affects canvas rendering (visibility.ts:7-41 consumed by draw-scene.ts:274,289 and selection paths) and is never consulted by the compiler; output only gates compileJob (compile-job.ts:51) and the design canvas still draws output-off artwork (card dims instead, LayerRow.tsx:175-181). The tooltips even teach the distinction ('without changing output' / 'exclude from preview, frame, export, and job output', LayerRow.tsx:308-314). _(src/core/scene/visibility.ts:7-41; src/core/job/compile-job.ts:51; src/ui/layers/LayerRow.tsx:308-314)_
- **Double-click opens a full Cut Settings editor with per-device persisted defaults** — Double-clicking a card opens the dialog (with a guard so double-clicking inputs doesn't, LayerRow.tsx:107-111,317-320), and the dialog carries LightBurn-parity Make Default / Make Default for All / Reset to Default, persisted per device profile in localStorage with defensive parsing (LayerRowCutSettings.tsx:24-26; layer-default-settings.ts:17-58). A dedicated jsdom test pins both the open behavior and the interactive-target exclusion. _(src/ui/layers/LayerRow.tsx:107-111; src/ui/layers/layer-default-settings.ts:17-58; src/ui/layers/LayerRow.double-click.test.tsx:71-93)_
- **The debounced-commit hook is unusually honest about clamped values** — One 300 ms debouncer drives every numeric field; on commit it snaps the displayed text to the value actually committed (fixing the audited 'field displays 9999 while G-code uses 6000' lie), holds blank fields as transient edit state instead of force-committing a fallback, and restores the last committed value on blank blur — explicitly citing LightBurn behavior (use-debounced-commit.ts:54-61,86-119). One undo frame per edit instead of four. _(src/ui/layers/use-debounced-commit.ts:54-61,86-119)_
- **The per-layer settings model is deep and mode-scoped without stringly typing** — Layer carries kerf offset, tabs/bridges (size/count/skip-inner), air assist, hatch angle/interval with LPI dual entry, overscan, three fill styles, cross-hatch, bidirectional, 11 dither algorithms, DPI/interval dual entry, dot-width correction, grayscale min-power, and pass-through — all as typed unions/readonly fields (layer.ts:11-44), and readCutSettingsPatch deliberately preserves the inactive mode's fields so switching Line→Fill→Line loses nothing (cut-settings-draft.ts:80-106). _(src/core/scene/layer.ts:11-44; src/ui/layers/cut-settings-draft.ts:26-106)_
- **Cut settings are locked while a job is active, with auto-close** — useCutSettingsLauncher blocks opening the editor while streaming, jogging, or autofocusing, and force-closes an already-open dialog the moment a job starts (use-cut-settings-launcher.ts:12-27), with the disabled state explained in the Edit button tooltip (LayerRow.tsx:139-143). Prevents mid-burn parameter mutation races. _(src/ui/layers/use-cut-settings-launcher.ts:12-27; src/ui/layers/LayerRow.tsx:139-143)_

### Findings

#### S3-F1 [MAJOR] Material preset apply is device-BLOCKED, contradicting ADR-045's warn-don't-block decision

_Area: workflow · Effort: S · verified: CONFIRMED_

ADR-045 records: 'Device hints are advisory safety metadata. Later UI can warn when the active machine differs, but this ADR does not block cross-machine reuse' (DECISIONS.md:2366-2367). The implementation blocks instead: presets that fail device matching get isAssignable:false and label 'not compatible' (material-library-preset-options.ts:42-49), the Apply button is disabled for them (MaterialLibraryRecipeControls.tsx:19-22), and even if the UI were bypassed the store action silently refuses via canAssignPreset() returning false for any unmatched preset (material-library-actions.ts:66,104-107) — the user just sees 'Preset was not applied.' A user who switches device profiles loses one-click access to every preset saved under the old profile.

- **Evidence:** src/ui/layers/material-library-preset-options.ts:38-49; src/ui/layers/MaterialLibraryRecipeControls.tsx:19-22; src/ui/state/material-library-actions.ts:104-107; DECISIONS.md:2366-2367
- **LightBurn reference:** LightBurn's Material Library lets you Assign any library entry to a layer regardless of which machine it was authored for; the library is just saved cut settings.
- **Recommendation:** Keep the 'unsupported'/'not compatible' warning text but enable Apply, per ADR-045: warn (perhaps with a confirm) instead of disabling, and remove the silent canAssignPreset gate or make it warn-through. If blocking is now intended, supersede ADR-045 explicitly.

#### S3-F2 [MAJOR] Selecting any object collapses the Layers list into a closed <details> and hides the layer's cut fields

_Area: ui-layout · Effort: M · verified: CONFIRMED_

CutsLayersPanel renders two branches: with no selection, MaterialLibraryPanel and LayerList are open; with any selection, both are wrapped in CollapsedPanel — a <details> element with no `open` attribute, i.e. closed by default (CutsLayersPanel.tsx:48-64, 89-102). Because the branch switch remounts the element, every new selection re-collapses a list the user just opened. Additionally, when the selected object is on a layer, that layer's card replaces its Power/Speed/Passes fields with the hint 'Use Selected Artwork Settings above for this selection.' (LayerRow.tsx:154-157). So the most common LightBurn gesture — click a shape, then adjust its layer in the Cuts panel — requires expanding a disclosure and either deselecting or double-clicking for the dialog.

- **Evidence:** src/ui/layers/CutsLayersPanel.tsx:48-64,89-102; src/ui/layers/LayerRow.tsx:154-157
- **LightBurn reference:** LightBurn's Cuts/Layers list is always visible; selecting a shape highlights its layer row and the panel always edits per-layer settings.
- **Recommendation:** Keep the Layers section expanded by default (persist open state across selection changes, or default `open`), and let the layer card keep editing layer defaults when objects are selected, with the per-object override reachable via an explicit toggle rather than an automatic redirect.

#### S3-F3 [MAJOR] Per-object cut-setting overrides (operationOverride) are an unrecorded LightBurn divergence

_Area: workflow · Effort: S · verified: CONFIRMED_

SceneObjects carry an optional operationOverride that forks any layer setting (mode, power, speed, fill params) per object (scene-object.ts:76-78); the compiler buckets overridden objects into synthetic layers (compile-job.ts:96-120), and the UI exposes it as 'Selected Artwork Settings' (SelectedObjectOperationSettings.tsx:64) with the layer card retargeting when a selection exists (LayerRow.tsx:218-244). Grep of DECISIONS.md for operationOverride / 'Selected Artwork' / 'per-object override' found no ADR, and WORKFLOW.md has no flow for it. ADR-027 says LightBurn divergences are defects unless recorded. Only powerScale (LightBurn Shape Properties parity) is annotated. Behaviorally this can silently fork one object's settings from its layer — invisible in the Cuts list except a badge while selected.

- **Evidence:** src/core/scene/scene-object.ts:73-82; src/core/job/compile-job.ts:96-120; src/ui/layers/LayerRow.tsx:218-244; grep of DECISIONS.md for 'operationOverride|Selected Artwork|per-object' returned no matches
- **LightBurn reference:** LightBurn has no per-object cut settings; settings are strictly per layer, with only per-shape power scale in Shape Properties.
- **Recommendation:** Write an ADR recording the per-object override model, its interaction with the layer list (execution order, preview, material presets), and add a persistent per-row indicator when any object on a layer carries an override.

#### S3-F4 [MAJOR] WORKFLOW.md F-A7 is stale spec — layout, delete semantics, and feedback messages all drifted

_Area: workflow · Effort: M · verified: CONFIRMED_

ADR-016 makes WORKFLOW.md the spec, but F-A7 no longer matches code: (a) it specifies a 7-item left-to-right row (WORKFLOW.md:217-226) while the implementation is a card stack with field rows (CutsLayersPanel.tsx comment lines 7-11); (b) it says the hover delete button is 'for the *Layer*, not the objects' (WORKFLOW.md:226) and line 455 says Phase A exposes no manual layer delete, but DeleteLayerButton calls deleteLayerAndObjects, deleting the artwork too (DeleteLayerButton.tsx:5-11 → layer-actions.ts:127-137) — a destructive semantic the doc explicitly contradicts (undo does restore it); (c) documented status-bar confirmations ('Layer · power set to 50%', WORKFLOW.md:240) and range errors ('Power must be 0–100', WORKFLOW.md:264-269) do not exist — grep for 'power set to' finds nothing in src; (d) F-A7 still says Fill/Image are disabled Phase-A options (WORKFLOW.md:220) with no superseded marker, unlike F-ML1 which is properly marked superseded.

- **Evidence:** WORKFLOW.md:217-269,455; src/ui/layers/DeleteLayerButton.tsx:5-11; src/ui/state/layer-actions.ts:127-137; grep 'power set to' in src returned only an unrelated raster comment
- **LightBurn reference:** LightBurn's cut list has no per-layer delete button at all; empty layers simply leave the list.
- **Recommendation:** Rewrite F-A7 to the shipped card layout (or mark sections superseded with the change history, as F-ML1 does), and decide delete semantics deliberately: either match the doc (remove layer only, orphan objects to a default layer) or update doc + add a confirm for delete-with-artwork.

#### S3-F5 [MINOR] Out-of-range numeric input is clamped silently — the promised red flash / status feedback is absent

_Area: workflow · Effort: S_

WORKFLOW F-A7 specifies snap + brief red flash + status message for out-of-range power/speed/passes (WORKFLOW.md:264-272). The implementation clamps inside parse() (LayerRowFields.tsx:204,230,255) and the debouncer snaps the displayed text to the committed value (use-debounced-commit.ts:54-61) — correct data-wise, but a user typing 8000 into Speed on a 6000-maxFeed device gets silently corrected with no explanation anywhere.

- **Evidence:** src/ui/layers/LayerRowFields.tsx:204,230,255; src/ui/layers/use-debounced-commit.ts:54-61; WORKFLOW.md:264-272
- **LightBurn reference:** LightBurn constrains input ranges in the editor; it does not silently rewrite a typed value to a different machine cap without the cap being visible.
- **Recommendation:** Emit the documented one-line status/toast on clamp (especially the maxFeed cap, which changes burn results), or update WORKFLOW.md if silent clamp-and-snap is now the accepted design.

#### S3-F6 [MINOR] Sub-layers: LightBurn-divergent feature with no ADR, and the sub-layer dialog shows a dead 'Visible' checkbox

_Area: mechanism · Effort: S_

Sub-layers (extra operations per color, emitted after the primary; layer.ts:46-51,204-208) are documented in WORKFLOW.md:882-897 but grep of DECISIONS.md for 'sub-layer|sublayer' finds no ADR recording this divergence from LightBurn's model. The sub-layer editor reuses CutSettingsDialog wholesale, so it renders 'Visible' and 'Output' checkboxes; on apply the visible value is silently discarded and output is remapped to 'enabled' (LayerSubLayers.tsx:182-190) — the user can toggle a checkbox that does nothing.

- **Evidence:** src/core/scene/layer.ts:46-51,193-208; src/ui/layers/LayerSubLayers.tsx:118-127,182-190; WORKFLOW.md:882-897; grep DECISIONS.md 'sub-layer' no matches
- **LightBurn reference:** LightBurn has no sub-layers; multi-operation-per-color is done by duplicating objects onto another layer or using its two-pass settings per layer.
- **Recommendation:** Record the sub-layer model in DECISIONS.md, and pass a variant flag to CutSettingsDialog that hides Visible (and relabels Output as Enabled) for sub-layer editing.

#### S3-F7 [MINOR] Image-mode overscan is a hard-coded 5 mm, not a per-layer setting

_Area: mechanism · Effort: M_

Fill overscan is per-layer (fillOverscanMm, exposed in row and dialog), but raster/image overscan is the fixed DEFAULT_OVERSCAN_MM = 5 (compile-job-defaults.ts:6, applied at compile-job-raster.ts:93) with no field in CutSettingsImageFields or LayerImageFields. The code comment says it's kept off Layer so it can 'ride device profiles in the future' — an intent note, not an ADR, and no UI path exists today to change it for a slow or fast machine.

- **Evidence:** src/core/job/compile-job-defaults.ts:1-6; src/core/job/compile-job-raster.ts:13,93; src/ui/layers/CutSettingsImageFields.tsx (no overscan field)
- **LightBurn reference:** LightBurn exposes Overscanning (percent or distance) per scanned layer in the cut settings editor for both Fill and Image.
- **Recommendation:** Either surface image overscan per layer in CutSettingsImageFields (mirroring fillOverscanMm) or land the device-profile plan and record the fixed-value interim in DECISIONS.md.

#### S3-F8 [MINOR] Missing LightBurn cut-editor features are not recorded as out of scope

_Area: workflow · Effort: S_

The Cut Settings editor covers kerf, tabs, air, fill, and a deep image section, but several LightBurn per-layer staples are absent with no DECISIONS.md scope entry: perforation mode, dot mode, Z offset / Z step per pass, cut-through (start/end pause) delays, fill grouping (fill all shapes at once vs. shapes individually vs. groups), and ramp. Grep of DECISIONS.md for 'perforation|Z offset|dot mode|Cut Through' returns no scope statements (only unrelated 'ramp' hits). Per the project's own rule, absences that a LightBurn user will hunt for should be deliberate and written down.

- **Evidence:** src/ui/layers/CutSettingsCommonFields.tsx:63-130 (line-mode field inventory); src/core/scene/layer.ts:20-44 (full settings model); grep DECISIONS.md 'perforation|Z offset|dot mode|Cut Through' — no scope entries
- **LightBurn reference:** LightBurn's cut settings editor includes perforation, dot mode, Z offset/Z step per pass, cut-through delays, and fill-grouping options per layer.
- **Recommendation:** Add a short scope ADR listing which cut-editor features are deferred and why (e.g. Z moves gated on the focus-test track), so parity gaps are decisions rather than surprises.

#### S3-F9 [MINOR] Layer reordering is single-step arrow buttons only

_Area: ui-layout · Effort: M_

LayerOrderControls offers one-position up/down buttons per card (LayerOrderControls.tsx:26-46; moveLayer swaps adjacent, scene.ts:73-82). Order semantics and undo are correct, but reordering an 8-layer job's bottom layer to first is 7 clicks, and the tiny '^'/'v' glyph buttons are low-affordance.

- **Evidence:** src/ui/layers/LayerOrderControls.tsx:26-46; src/core/scene/scene.ts:73-82; src/ui/state/store-actions.ts:39-49
- **LightBurn reference:** LightBurn's cut list supports drag-and-drop reordering plus move up/down/top/bottom arrow buttons.
- **Recommendation:** Add drag-to-reorder on the card (or at least move-to-top/bottom), keeping moveLayer as the single mutation primitive.

#### S3-F10 [MINOR] Five sector files exceed the 250 counted-code-line soft limit

_Area: architecture · Effort: M_

Approximate counted-code lines (blank/comment-stripped grep, not the ESLint counter): SelectedObjectOperationSettings.tsx ~385 (approaching the 400 hard limit), layer-actions.ts ~370, LayerImageFields.tsx ~310, LayerRow.tsx ~296, LayerRowFields.tsx ~265. CLAUDE.md says stop-and-split at soft limit. layer-actions.ts also mixes five concerns (manual create, assignment, delete, clipboard, sub-layer re-export) that its own helper split (layer-sub-layer-actions.ts) shows the pattern for.

- **Evidence:** line counts via grep on src/ui/layers/SelectedObjectOperationSettings.tsx (385/402), src/ui/state/layer-actions.ts (370/399), src/ui/layers/LayerImageFields.tsx (310/329), src/ui/layers/LayerRow.tsx (296/320), src/ui/layers/LayerRowFields.tsx (265/279)
- **Recommendation:** Split SelectedObjectOperationSettings first (closest to the hard limit), then carve clipboard + delete flows out of layer-actions.ts into sibling action modules.

#### S3-F11 [POLISH] Offset Fill lives inside the Fill dialog as 'Follow Shape', not in the Mode dropdown where LightBurn users look

_Area: ui-layout · Effort: S_

The Mode dropdown offers Line/Fill/Image (LayerRow.tsx:211-213); LightBurn's mode list is Line / Fill / Offset Fill / Image. Our equivalent is Fill style = 'Follow Shape' (offset) or 'Island Fill', a select inside the Fill fieldset of the dialog (CutSettingsFillFields.tsx:17-29). Functionally covered, but a LightBurn user scanning the Mode dropdown for Offset Fill won't find it, and no ADR records the relocation (fillStyle union at layer.ts:18).

- **Evidence:** src/ui/layers/LayerRow.tsx:211-213; src/ui/layers/CutSettingsFillFields.tsx:17-29; src/core/scene/layer.ts:18; WORKFLOW.md:880-882
- **LightBurn reference:** Offset Fill is a top-level layer mode alongside Line, Fill, and Image.
- **Recommendation:** Either add 'Offset Fill' as a Mode alias that sets mode=fill + fillStyle=offset, or record the consolidation as a deliberate divergence in DECISIONS.md.

### Not verified in this sector

- Anything perceptual or runtime: no app was launched. All claims are from static reading; fill hatch, image dither, and preview rendering fidelity for these settings were NOT verified (green structural tests like cut-settings-output-parity.test.ts prove routing, not looks).
- The <details> re-collapse-on-selection behavior is inferred from the conditional render branches in CutsLayersPanel.tsx; I did not exercise it in a browser.
- File line counts are grep approximations (non-blank, non-comment-prefix lines), not the ESLint counted-code metric; exact lint status of those files was not run.
- LightBurn behavior statements come from training knowledge plus the LightBurn references cited in DECISIONS.md (ADR-044/045 link official docs); I did not consult a live LightBurn install, so details like current dialog layouts could have drifted in recent LightBurn versions.
- Speed-unit parity (LightBurn's configurable mm/sec vs our fixed mm/min) was not assessed as a finding because I could not verify LightBurn's current default from repo evidence.
- The CNC side of the layer cards (CncLayerFields, feeds calculator, dogbone/pocket rows) was only skimmed — it is another sector's territory but shares this panel.
- The material preset wizard (F-ML2, src/ui/material-library/wizard) internals and Saved Libraries dialog flows were not read in depth; only the panel-level apply flow was traced.
- Whether every WORKFLOW F-A7 error state (e.g. passes < 1 snap) has test coverage — CutsLayersPanel.numeric-safety.test.tsx exists but I did not read it line-by-line.

## 4. Toolpath preview, simulation & job planning — grade B+

This sector is architecturally the strongest part of the app I examined: preview, save, start, live estimate, and even .rd export all derive from one pure prepareOutput pipeline (ADR-040) with a regression test locking preview order to emitted order, the time estimate is a genuine grbl-style physics planner (per-edge blocks, junction deviation from $11, two-pass lookahead), and the raster preview reuses the exact compile-path dither (ADR-028). Job placement matches LightBurn's Start From + 9-dot Job Origin model and extends it safely with Verified Origin. The weaknesses are presentation-layer parity and estimate honesty at the edges: preview cuts render in one fixed blue with no shade-by-power (diverging from both LightBurn and WORKFLOW F-A8), a placement failure produces an empty preview with an actively wrong "enable Output" hint, playback is distance-compressed rather than time-based, and the raster ETA path duplicates the sweep model and ignores the unidirectional setting. None of these are safety issues; the compile/emit spine is sound.

### What's great

- **Single prepared-output pipeline: preview provably equals export** — prepareOutput (pre-emit budget guard -> compileJob -> applyJobOrigin -> optimizePaths) is the one function behind Save (emit-gcode.ts:44), Start (start-job-readiness.ts:97), the canvas preview (draw-preview.ts:131), the live estimate (live-job-estimate.ts:46), tiled save, and Ruida export. draw-preview.parity.test.ts locks buildPreviewToolpath to deep-equal the prepared job's toolpath, so the 'approve one order, burn another' failure class is structurally closed, not just tested away. _(src/io/gcode/prepare-output.ts:49-92; src/io/gcode/emit-gcode.ts:38-48; DECISIONS.md:1986-2043 (ADR-040); src/ui/workspace/draw-preview.parity.test.ts:59-85)_
- **Physics-based time estimate, not naive length/speed** — estimateJobDuration delegates to a clean-room grbl planner: one block per polyline edge, junction-deviation cornering caps from DeviceProfile.junctionDeviationMm ($11), backward+forward lookahead passes, and generalized trapezoid/triangle block times — plus a raster sweep model and analytic CNC plunge/retract terms. The junction half-angle inversion was recently found and fixed with the sign math documented in-line (planner.ts:279-287). _(src/core/job/planner.ts:1-81,212-291; src/core/job/estimate-duration.ts:50-110)_
- **WYSIWYG raster burn simulation via the compile path's own dither** — The image-mode preview calls the same dither() with the same sMax the emitter uses, renders in scene space to preserve rotation/mirror, and gates on output layers exactly like compileJob (ADR-028). The scrubber now also walks raster output row-by-row through real toolpath steps carrying per-span pixel provenance, so playback shows passes and bidirectional travel in emitted order. _(DECISIONS.md:1109-1145 (ADR-028); src/ui/workspace/draw-raster-preview.ts:1-68; src/core/job/toolpath-raster-steps.ts:17-154)_
- **CNC material-removal simulation coupled to the scrubber** — computeRemovalGrid stamps tool kernels along cut/plunge steps with Z interpolation and an uptoLengthMm budget, so the depth-shaded 2D preview and the 3D dialog show the partially-completed cut at the scrubber position; the UI quantizes scrub into 120 buckets to memoize grids and caps the grid near 1M cells for responsiveness. _(src/core/sim/stamp-toolpath.ts:29-73; src/ui/workspace/use-cnc-removal-grid.ts:21-65; src/ui/workspace/Workspace.tsx:59,151-183)_
- **Exhaustively-modeled job placement with per-mode machine gates** — Start From is a discriminated union (absolute | current-position | user-origin | verified-origin) resolved against live machine state with mode-specific, actionable failure messages; Verified Origin deliberately downgrades to a size-only preflight plus a mandatory Verified Frame gate before Start (ADR-053), and Absolute refuses to run while a custom origin is active — a genuinely safe extension beyond LightBurn's model. _(src/ui/job-placement.ts:39-148; src/core/job/job-origin.ts:15-48; src/ui/laser/start-job-readiness.ts:87-124,175-196)_
- **Preview complexity guards prevent UI freezes without corrupting output** — Cheap raw-segment counts gate the synchronous compile before it runs (scenePreparationTooComplex), preview builds are scheduled off the render path with cancellation, oversized routes degrade to a stride-sampled display with an explicit 'too large to draw safely' banner, and the over-budget raster case flows out as a preflight verdict instead of a freeze. _(src/ui/workspace/draw-preview.ts:116-135,168-193; src/ui/workspace/use-preview-toolpath.ts:45-93; src/ui/workspace/preview-overlays.tsx:24-29)_

### Findings

#### S4-F1 [MAJOR] Placement failure yields an empty preview with a wrong 'enable Output' diagnosis

_Area: workflow · Effort: S · verified: CONFIRMED_

usePreviewToolpath resolves job placement before building the preview; when resolution fails (Start From = Current Position while disconnected/no status report, User Origin with no origin set, or Absolute while a custom origin is active) it silently substitutes buildToolpath(EMPTY_JOB) and discards placement.messages. PreviewStatusOverlays only knows project+toolpath, so a vector scene then shows the hint 'Nothing to preview — enable Output on at least one layer with objects' — an actively wrong diagnosis — while the stats panel still shows a Time estimate (the estimate ignores placement) next to 0.0 mm distances. The correct messages exist and surface only later at Start.

- **Evidence:** src/ui/workspace/use-preview-toolpath.ts:58-68; src/ui/job-placement.ts:69-101; src/ui/workspace/preview-overlays.tsx:30-34; src/ui/workspace/preview-status.ts:20-23
- **LightBurn reference:** LightBurn's preview always renders the job geometry; placement problems surface as their own errors at frame/start, never as a false 'nothing to output' state.
- **Recommendation:** Plumb the ok:false placement messages into the preview overlay (a distinct banner: 'Preview unavailable: <placement message>'), and suppress the enable-Output hint when the emptiness cause is placement, not scope.

#### S4-F2 [MAJOR] Preview cuts ignore layer color and have no shade-by-power

_Area: ui-layout · Effort: M · verified: CONFIRMED_

drawCut receives each step's layer color but ignores it (parameter named _color) and strokes every cut in the fixed theme blue #2563eb; there is no power-based shading for line or fill moves and no toggle. A 10% power line and a 90% power fill look identical in preview. This diverges from WORKFLOW.md F-A8 ('Cut paths rendered in their Layer color at full opacity') and from the LightBurn baseline the repo itself records — ADR-028 quotes LightBurn's preview as 'shades according to power' — which is honored for raster images only. No ADR records the vector-preview divergence.

- **Evidence:** src/ui/workspace/draw-preview.ts:258-264; src/ui/theme/canvas-theme.ts:47-50; WORKFLOW.md:292-295; DECISIONS.md:1121
- **LightBurn reference:** LightBurn's preview window draws burned lines dark with an optional 'Shade according to power' mode; darker = more power, applying to fills and lines, with traversals in red.
- **Recommendation:** Use step.color (already carried on every cut step) for stroke color as the F-A8 spec says, and add power to cut steps so a shade-by-power toggle can scale darkness/alpha; record any residual divergence in an ADR.

#### S4-F3 [MINOR] Playback is distance-compressed, not time-based simulation

_Area: mechanism · Effort: M_

Play advances the scrubber at a constant arc-length rate over a fixed wall duration (slow/normal/fast = 60/30/10 s regardless of job), so a 100 mm/min engrave segment and a 6000 mm/min travel animate at identical speed and the % label is % of distance. The UI even self-describes as 'compressed route preview'. The physics planner already computes per-block times, so time-proportional playback (LightBurn's model, including a time-based slider) is achievable without new math.

- **Evidence:** src/ui/workspace/use-preview-playback.ts:6-10,42-59; src/ui/workspace/preview-overlays.tsx:207-221; src/ui/workspace/overlays.tsx:110-129; src/core/job/planner.ts:62-81
- **LightBurn reference:** LightBurn preview playback simulates in job time (with a play-speed multiplier); the slider position corresponds to elapsed job time, so the head visibly slows on slow layers.
- **Recommendation:** Expose per-step durations from the planner (the file already notes a per-block export as a future option) and drive the scrubber in time-space, keeping distance mode as a fallback for too-large jobs.

#### S4-F4 [MINOR] PROJECT.md promises 2-opt; shipped optimizer is nearest-neighbor with a silent 2,000-segment cutoff

_Area: workflow · Effort: M_

PROJECT.md Phase C lists 'path optimization (2-opt)'. optimize-paths.ts is an honest, well-documented nearest-neighbor with inside-first containment buckets — explicitly 'NOT full 2-opt' — and above MAX_NEAREST_NEIGHBOR_SEGMENTS=2000 segments per group it silently keeps source order even with 'Reduce travel moves' checked, with no UI indication. The Optimization Settings dialog is a single checkbox; inner-shapes-first is hard-coded on (a good default) but not surfaced.

- **Evidence:** PROJECT.md:75; src/core/job/optimize-paths.ts:1-24,48,88-99,129-141; src/ui/laser/OptimizationSettingsDialog.tsx:22-35; src/core/scene/project.ts:21 (default true)
- **LightBurn reference:** LightBurn's Optimization Settings panel offers ordered strategies (order by layer/group/priority), 'Cut inner shapes first', 'Reduce travel moves', direction choice, and starting-point selection; it does not silently stop optimizing on large jobs.
- **Recommendation:** Fix the PROJECT.md wording (or land 2-opt over the NN seed as the header plans); surface the >2000-segment skip as a preview/stats note; consider exposing inner-first as a visible (default-on) option for LightBurn familiarity.

#### S4-F5 [MINOR] Raster ETA duplicates the sweep model and ignores unidirectional scanning

_Area: mechanism · Effort: M_

estimate-duration.ts re-implements raster span extraction and sweep construction that toolpath-raster-steps.ts also implements (RASTER_GAP_RAPID_THRESHOLD_MM=5 is defined in both files; rasterActiveSpans exists twice with different loop shapes). The estimator's copy alternates sweep direction unconditionally (sweepIndex % 2), while the toolpath/emitter honor group.bidirectional ?? true — so a layer set to unidirectional image scanning gets an ETA modeled as bidirectional, unpriced per-row return rapids included. Copy-paste duplication is a named CLAUDE.md anti-pattern and this is exactly the drift it warned about.

- **Evidence:** src/core/job/estimate-duration.ts:48,136-200; src/core/job/toolpath-raster-steps.ts:13,36,72-97; src/core/job/compile-job-raster.ts:95
- **LightBurn reference:** LightBurn's time estimate follows the actual scan mode configured on the layer.
- **Recommendation:** Extract one shared raster-sweep builder consumed by both the toolpath and the estimator, and thread group.bidirectional through it (pricing the return rapid at travel speed for unidirectional).

#### S4-F6 [MINOR] Estimate ignores job placement; preview always draws origin start + park travel regardless of dialect

_Area: mechanism · Effort: S_

estimateLiveJob calls prepareOutput without the resolved jobOrigin, and the planner prices travel from machine (0,0) to the first cut and back (buildBlocks cursor=ORIGIN, final appendTravel to ORIGIN). Meanwhile buildPreviewToolpath always passes startPoint/parkPoint (0,0) on the PLACED job. Consequences: for current-position/user-origin jobs the first/last travel legs differ between the Time row (unplaced) and the Cut/Travel rows (placed) of the same stats panel; and the preview draws a park-back travel even for dialects where grbl-strategy skips the park move (parkAtOriginAfterJob false, e.g. the Neotronics-safe dialect).

- **Evidence:** src/ui/laser/live-job-estimate.ts:46; src/core/job/planner.ts:87-106; src/ui/workspace/draw-preview.ts:139-147; src/core/output/grbl-strategy.ts:86-91; src/ui/workspace/preview-overlays.tsx:73-88
- **LightBurn reference:** LightBurn's preview time and distance stats describe the same simulated run.
- **Recommendation:** Pass the resolved jobOrigin into the estimate's prepareOutput call (it is already resolved for the preview in the same component tree), and make startPoint/parkPoint dialect- and placement-aware.

#### S4-F7 [MINOR] Out-of-bounds preview state lacks the per-layer distances F-A8 specifies

_Area: workflow · Effort: S_

WORKFLOW.md F-A8 edge state specifies 'Out-of-bounds path segments rendered in red' plus a summary like 'Preview: 1 layer extends 12 mm beyond bed'. The implementation shows a generic danger banner ('Some objects extend past the bed (red dashed outlines)...') and red dashed OBJECT outlines — no layer names, no millimeter amounts, and outlines of whole objects rather than the offending segments. The banner exists and is honest, but the spec's actionable detail (which layer, how far) is missing.

- **Evidence:** WORKFLOW.md:313-315; src/ui/workspace/preview-overlays.tsx:35-40; src/ui/workspace/draw-scene.ts:41,138
- **LightBurn reference:** LightBurn shows 'Cut might be out of bounds' warnings with the affected extent at frame/start time.
- **Recommendation:** Compute per-layer overflow amounts from the existing bounds machinery (job-bounds/frame-preflight already produce distances) and interpolate them into the banner text per the F-A8 wording.

#### S4-F8 [MINOR] No estimated-time-remaining or elapsed time during a running job

_Area: workflow · Effort: M_

The streaming progress bar shows only 'completed / total lines'. WORKFLOW.md F-B11 explicitly says 'Phase C will add an estimated-time-remaining label', and PROJECT.md marks MVP complete at end of Phase C — but the label never landed. The planner-based estimate exists pre-run; scaling remaining time by acknowledged-line progress (or better, by remaining planned block time) is data already computed.

- **Evidence:** src/ui/laser/JobControls.tsx:173-207; WORKFLOW.md:663; src/core/job/estimate-duration.ts:50-62
- **LightBurn reference:** LightBurn shows previewed total time and job progress; LaserGRBL (the other app this user base comes from) shows a live remaining-time countdown during the run.
- **Recommendation:** Add elapsed + remaining labels to the progress row, deriving remaining from the prepared job's planned duration weighted by completed lines.

#### S4-F9 [MINOR] Start From / Job Origin settings are session-only, reset to Absolute on every launch

_Area: workflow · Effort: S_

jobPlacement lives only in the Zustand store with DEFAULT_JOB_PLACEMENT (absolute/front-left) as the initial value; it is not serialized into .lf2 (no matches in src/io/project) nor persisted like the CNC library or camera preferences are. An operator who always runs User Origin must re-select it every session. Failure direction is safe (Absolute mode refuses to start while a custom origin is active, job-placement.ts:69-77), but it is recurring friction LightBurn users won't expect.

- **Evidence:** src/ui/state/store.ts:365; src/ui/job-placement.ts:9-12,69-77; Grep of src/io/project for jobPlacement/startFrom: no matches
- **LightBurn reference:** LightBurn persists Start From and Job Origin across sessions as part of device/user settings.
- **Recommendation:** Persist jobPlacement (and outputScopeSettings) in the same app-level persistence used for the CNC library / device-setup flags; keep the existing absolute-mode safety gate.

#### S4-F10 [MINOR] core/job public API is ~40 value exports — double the CLAUDE.md hard cap of 20

_Area: architecture · Effort: L_

src/core/job/index.ts exports roughly 41 value bindings (plus ~25 types) spanning at least six responsibilities: compile, job placement, duration estimation, toolpath/scrubber model, calibration-pattern generators (material test, interval test, scan-offset, camera-align), and fill heat-risk analysis. CLAUDE.md sets a 10 soft / 20 hard public-export limit and says 'If exceeded, the module is doing too much; split it.' The internals are individually clean, but every sector of the app funnels through this one index, concentrating churn.

- **Evidence:** src/core/job/index.ts:1-88; CLAUDE.md size-limits table (Public exports row)
- **Recommendation:** Split along existing seams: core/job (compile+job model), core/placement (job-origin/frame), core/estimate (planner+duration), core/toolpath (steps/slice), core/calibration (test-grid generators). Mechanical re-export moves, no behavior change; do it tidy-first before the next feature that touches compile.

#### S4-F11 [MINOR] Module-level mutable caches in ui/workspace lack the ADR that CLAUDE.md's rule requires

_Area: architecture · Effort: S_

draw-raster-preview.ts holds module-level mutable Maps (previewCanvasCache, pendingPreviewBuilds), and draw-scene.ts calls a sibling pruneRasterImageCaches implying the same pattern in draw-raster.ts. CLAUDE.md bans module-level mutables outside Zustand slices, and ADR-050 grants a narrow exception explicitly scoped to src/core/job WeakMap memoization, stating 'Any other module-level mutable still violates the rule and needs its own ADR.' These UI caches are pruned against live data URLs (bounded in practice) but are string-keyed Maps, not identity-keyed WeakMaps, and have no ADR.

- **Evidence:** src/ui/workspace/draw-raster-preview.ts:40-41,49; src/ui/workspace/draw-scene.ts:35,93; DECISIONS.md:2679-2683 (ADR-050 scope)
- **Recommendation:** Either write the ADR recording the UI bitmap-cache exception (with its pruning contract) or move the caches behind a DI'd cache object owned by the Workspace component, like displayPolylineCacheRef already is (Workspace.tsx:240-244).

#### S4-F12 [POLISH] In-canvas preview mode vs LightBurn's separate Preview window is undocumented as a divergence

_Area: ui-layout · Effort: S_

Preview is a workspace mode toggle (toolbar 'Preview' command + 'P'), replacing the canvas in place, with controls docked bottom-left and the scrubber along the bottom; LightBurn opens a separate modal Preview window on Alt+P. The in-place approach is arguably better (route registers against the bed, board jigs and camera overlays stay visible) and is fully specified by WORKFLOW F-A8 — but ADR-027 declares LightBurn divergences defects unless recorded, and no ADR records this one. Discoverability is good (button gated on previewable content but always available to exit).

- **Evidence:** src/ui/workspace/Workspace.tsx:107-118; src/ui/app/shortcuts.ts:394-398; src/ui/commands/command-families.ts:332-352; WORKFLOW.md:287-303; DECISIONS.md:1068 (ADR-027)
- **LightBurn reference:** LightBurn: Alt+P opens a dedicated Preview window with black cut lines, red traversals, play controls and time estimate; closing it returns to the canvas.
- **Recommendation:** One-paragraph ADR recording the in-canvas preview as a deliberate divergence and why; optionally alias Alt+P to the toggle for muscle memory.

#### S4-F13 [POLISH] Stale comments and dangling doc references around the preview pipeline

_Area: architecture · Effort: S_

Three small truth-drift items: (1) preview-status.ts's header still claims 'raster groups are a continuous sweep with no toolpath steps', but appendRasterGroupSteps has shipped and raster rows do produce scrubber steps; (2) ADR-028 §6 still describes the raster scrubber as 'deferred to a separate PR' though it landed; (3) DECISIONS.md:1121 and src/core/raster/preview-data.ts:5 cite 'LIGHTBURN-STUDY.md §1.4', a file deleted from the tree in commit 42e7556d (MIT-release neutrality sweep), so the sector's LightBurn baseline citations now dangle for any future auditor.

- **Evidence:** src/ui/workspace/preview-status.ts:1-5; src/core/job/toolpath-raster-steps.ts:17-60; DECISIONS.md:1137,1121; src/core/raster/preview-data.ts:5; git show 42e7556d --stat (LIGHTBURN-STUDY.md, 1255 deletions)
- **Recommendation:** Refresh the two comments; add a one-line note where LIGHTBURN-STUDY.md is cited that the study was removed at open-sourcing (or inline the relevant claim), so the ADR evidence chain stays verifiable.

### Not verified in this sector

- Any visual/perceptual verification: I did not run the app, render a preview, or compare a preview against emitted G-code or a LightBurn screenshot — all rendering claims are from static code reading (per the read-only mandate). Whether the preview LOOKS correct (registration, Y-flip, raster sim alignment) is asserted only by the code's own tests/ADRs, which per CLAUDE.md rule 2 do not prove fidelity.
- Time-estimate accuracy against real hardware runtimes — the planner math is verifiable on paper but no measurement against a physical burn exists in the tree (hardware ledger is CLAIMED throughout MEMORY/PROJECT.md).
- LightBurn baseline details beyond what the repo records (separate Alt+P preview window, time-based playback slider, exact Optimization Settings panel contents, black/red preview palette) come from general knowledge; the repo's own LIGHTBURN-STUDY.md was deleted in commit 42e7556d so I could not cross-check its §1.4 claims in-tree. The shade-by-power baseline IS in-repo (DECISIONS.md:1121).
- Whether ESLint/CI actually enforces the CLAUDE.md index.ts public-export cap (I did not parse eslint.config.mjs); the ~41-export count in core/job/index.ts was verified by reading the file.
- Byte-level agreement between preview raster steps (toolpath-raster-steps.ts) and the emitted raster G-code (emit-raster path in core/output) — I verified structural symmetry (same 5 mm gap threshold, same overscan/lead model, bidirectional flag) but did not read emit-raster.ts line-by-line.
- Cut3DPreviewDialog / relief 3D viewer internals (src/ui/relief-viewer) — confirmed wiring from the preview panel only.
- Did not run the test suite, lint, or typecheck (read-only audit; ~4000-test suite explicitly excluded).

## 5. G-code generation & motion safety — grade A-

This is the strongest sector I have audited in KerfDesk: the Scene→Job→G-code pipeline is a single pure function shared by Preview, Save, Start, and Estimate (prepareOutput), the laser-off-on-travel invariant is enforced three times (constructively at emit, by text scanners in preflight, and by property tests), and the Start flow proves $30/$32 against the live controller before a byte is sent. Recent audit fixes (C1 laser resume ordering, C2 flatness in scene-mm, C4 raster NaN bounds, F1/F2 ack accounting, the planner half-angle inversion) are all verifiably present in the current tree. The remaining gaps are edge-of-pipeline: vector-path non-finite coordinates can still reach the emitter and sail through preflight unflagged, curve flattening happens once at import so post-import scaling multiplies chord error (LightBurn re-flattens at output), and WORKFLOW.md has drifted behind the safer code (the pause $32 gate is undocumented). Grade reflects excellent architecture and layered safety with a handful of real but bounded holes.

### What's great

- **One pipeline for Preview, Save, Start, and Estimate — preview can never disagree with the burn** — prepareOutput runs the identical sequence (pre-emit budget guard -> compileJob -> job-origin placement -> optimizePaths) for every consumer, explicitly fixing the earlier preview-vs-emit divergence (roadmap P1-C). emitGcode then preflights the exact motion body it returns, with the provenance header excluded so comments can never mask a verdict. _(src/io/gcode/prepare-output.ts:1-92, src/io/gcode/emit-gcode.ts:38-76)_
- **Laser-off-on-travel enforced in three independent layers** — Constructively: every rapid carries S0 (travelLine), fill sweeps re-assert S per span, and a head-position tracker suppresses zero-length moves so a positive S never rides a stationary G1. Post-emit: runPreflight rescans the final text with findLaserOnTravelIssues (sticky-S model) and findLongBlankFeedMoves. Fill/raster additionally run M4 dynamic power, which is dark at zero feed, making pause/stop strictly safer (ADR-036 records the LightBurn comparison). _(src/core/output/grbl-strategy.ts:47-54,253-292; src/core/invariants/predicates.ts:43-79; src/core/preflight/preflight.ts:381-408; DECISIONS.md:1715-1777)_
- **Controller-readiness gate proves the power scale and laser mode before Start** — runControllerReadiness blocks Start unless controller $30 equals device.maxPowerS and $32=1 is confirmed, with honest capability-aware degradation (grbl-dollar strict error, readonly-dump warn, settings-none explicit 'NOT verified' warning) and the correct CNC inversion ($32 must be 0, $30 = spindle RPM). Pause is separately gated: feed hold is refused on a laser unless $32=1 is proven, because hold with $32=0 leaves the beam on. _(src/core/preflight/controller-readiness.ts:39-208; src/ui/laser/start-job-readiness.ts:111-114; src/ui/state/laser-job-actions.ts:85-110,238-252)_
- **Streamer is a pure, terminal-absorbing state machine with automatic beam-off on stream errors** — Alarm wipes in-flight accounting (firmware provably dropped its RX buffer), error:N is terminal so trailing oks cannot report a clean finish, oversized lines are refused before start instead of freezing at 0/N, and a mid-job error:N automatically issues a realtime soft reset plus boot-banner-deferred beam-off cleanup — the operator does not have to react to keep the diode dark. _(src/core/controllers/grbl/streamer.ts:142-294; src/ui/state/laser-error-line.ts:86-120; src/ui/state/laser-job-actions.ts:112-156)_
- **Machine-aware resume re-entry with Result-typed refusals (audit C1 fix present)** — buildResumeProgram replays modal state and emits a laser body that positions FIRST and only then re-arms M3/M4 (no G4 dwell, no Z), while the CNC body spins up before motion and feeds back to depth — the exact stationary-dot bug class is documented and fixed. G91/G53/G28/G30 programs are refused via a Result union, and the ADR-118 checkpoint resume refuses when the recompiled G-code fingerprint no longer matches. _(src/core/controllers/grbl/resume-program.ts:106-174; src/ui/laser/start-job-flow.ts:95-108,147-180)_
- **CNC motion contract holds by construction AND is re-proven on the final text; frame-vs-overscan is a documented non-bug (C3 confirmed)** — The CNC emitter retracts before every XY rapid, plunges only via G1, retracts before the M0 tool-change and forgets tracked Z afterwards (operator re-zeroed); findPlungedTravelIssues and findOverdeepCutIssues then re-verify the emitted text so an upstream regression still blocks the file write. computeJobBounds vs computeJobMotionBounds documents that Frame traces the burn area while safety gates use the overscan motion envelope, and the preflight bounds error names the overscan remedy. _(src/core/output/cnc-grbl-strategy.ts:145-160,360-365; src/core/invariants/cnc-motion.ts:20-73; src/core/job/job-bounds.ts:34-39; src/core/preflight/preflight.ts:351-363)_

### Findings

#### S5-F1 [MAJOR] Vector path can emit non-finite coordinates (XNaN) and every preflight scanner silently skips them

_Area: mechanism · Effort: S · verified: CONFIRMED_

The vector emit path has no finite-coordinate guard: compileJob transforms stored polyline points (toMachineCoords(applyTransform(...))) and grbl-strategy's fmt() is a bare toFixed(3), so a NaN coordinate becomes the literal text 'G1 XNaN'. The raster path was hardened after audit C4 (emitRasterGroup validates bounds finite before fmt), but the vector path was not. Worse, the preflight scanners are blind to it: parseGcodeWord's number regex only matches digit forms, so 'XNaN'/'XInfinity' parses as null and findOutOfBoundsCoords returns without an issue — the file is approved as safe-to-write. SVG import validates points (assertSvgImportPoints, parse-svg.ts:229), but downstream producers (kerf offset output points, tabs, trace, text) are not re-checked at the emit boundary. A prior session's memory records an unguarded clipper NaN exposure on the kerf path feeding exactly this emitter.

- **Evidence:** src/core/output/grbl-strategy.ts:35-37,95-112; src/core/job/compile-job.ts:397-425; src/core/invariants/gcode-words.ts:1-12; src/core/invariants/predicates.ts:111-126; contrast src/core/raster/emit-raster.ts:437-448; src/core/preflight/preflight.ts:213-215 (only layer.speed is finite-checked)
- **LightBurn reference:** Not a LightBurn-parity issue per se, but it violates PROJECT.md non-negotiable #4 (pipeline failure must write no file): a file containing XNaN is broken output that preflight approves.
- **Recommendation:** Add a last-line-of-defense check: either validate every CutSegment/FillSegment point is finite at Job construction (mirroring emit-raster's validate) or add a preflight text scan for NaN/Infinity tokens on motion lines (a one-line regex per line in the existing scanners). Report as a new PreflightCode, e.g. 'non-finite-coordinate'.

#### S5-F2 [MAJOR] Curves are flattened once at import (0.25 mm); post-import transform scale multiplies chord error with no re-flatten at output

_Area: mechanism · Effort: L · verified: CONFIRMED_

Audit C2 fixed flatness to be 0.25 mm in scene space at import time (dividing by the SVG transform's stretch). But SceneObjects store only polylines (ColoredPath), and compileJob applies obj.transform to the already-flattened points — so an object scaled up 4x after import burns with ~1 mm chord error and visible faceting on circles. Drawn shapes flatten adaptively at creation (DECISIONS.md:2731) but are subject to the same transform math at compile. This is the 'wavy edge / faceting' fidelity class the maintainer explicitly tracks, and there is no ADR recording flatten-at-import as a deliberate divergence.

- **Evidence:** src/io/svg/parse-svg.ts:216-229; src/io/svg/flatten-curves.ts:12 (DEFAULT_FLATNESS_MM = 0.25); src/core/job/compile-job.ts:404-419 (transform applied to stored points); src/core/job/job.ts:17-22 (CutSegment is a polyline)
- **LightBurn reference:** LightBurn keeps parametric curve primitives in the scene and flattens at G-code generation time with a device-space tolerance, so scaling artwork never coarsens output.
- **Recommendation:** Either (a) re-flatten from source curves at compile with tolerance divided by the object's current scale (requires keeping curve data on SceneObject — a design change), or (b) as a cheap interim, warn in preflight when an output object's |scale| materially exceeds 1 so the operator knows fidelity degraded, and record the current behavior as an ADR-listed divergence.

#### S5-F3 [MINOR] WORKFLOW.md has drifted behind the safety code: F-B7 pause documents no $32 gate and F-A10 documents 6 of ~12 implemented checks

_Area: workflow · Effort: S_

F-B7 says Pause unconditionally writes '!' and lists only success states; the code refuses Pause outright on a laser when $32 is not proven ('Pause requires confirmed GRBL laser mode ($32=1). Use Stop instead...') and has a distinct stream-side path for Marlin — neither the error state nor the CNC exemption is documented. F-A10 lists the original six pre-write checks, while runPreflight now implements roughly twice that (layer-mode mismatch, offset-fill open contours, machine-profile checks, no-go zones, laser-on-travel, long blank feed, raster budget, unsupported raster transform, relative-motion envelope). The doc is the stated source of truth for 'what should happen when...'.

- **Evidence:** WORKFLOW.md:356-369,630-639 vs src/ui/state/laser-job-actions.ts:32-35,85-110 and src/core/preflight/preflight.ts:35-57,83-122
- **LightBurn reference:** n/a (doc-vs-code drift)
- **Recommendation:** Update F-B7 with the pause-blocked error state (message text and the Stop fallback) and the capability matrix; refresh F-A10's check list to match PreflightCode. Pure docs change.

#### S5-F4 [MINOR] No per-layer Constant/Dynamic power mode — power mode is fixed per device dialect

_Area: workflow · Effort: M_

GrblGcodeDialect fixes cutPowerMode='constant' (M3), fillPowerMode='dynamic', rasterPowerMode='dynamic' for every built-in dialect, and there is no per-layer override. ADR-036 records the defaults (cut keeps M3 because 'a slow corner must still cut fully through') and notes LightBurn's M4 fill default, so the default divergence is recorded — but the absence of the per-layer control is not. A LightBurn user who vector-engraves at low power (where M3 corner dwell over-burns) or who wants constant power for a specific fill cannot express it.

- **Evidence:** src/core/devices/gcode-dialects.ts:57-125; src/core/output/grbl-strategy.ts:368-405 (mode chosen only from group.kind + dialect); src/core/job/job.ts:28-45 (no power-mode field on groups); DECISIONS.md:1744-1758
- **LightBurn reference:** LightBurn on GRBL defaults to M4 (variable power) and exposes a per-layer 'Constant Power Mode' checkbox that switches that layer to M3.
- **Recommendation:** Add an optional per-layer powerMode ('constant' | 'dynamic') that overrides the dialect in powerModeForGroup, defaulting to today's behavior so existing snapshots stay byte-identical; record the UI copy to mirror LightBurn's 'Constant Power Mode'.

#### S5-F5 [MINOR] Planner sibling defect: junction/exit velocity is never clamped to the current block's own target speed

_Area: mechanism · Effort: S_

Next to the just-fixed half-angle inversion (commit b8072ef8, corrected formula confirmed at planner.ts:279-291): capJunctionEntries sets entryV = min(next.targetVelocity, vJunction) — GRBL clamps the junction speed to the MINIMUM of BOTH adjacent blocks' nominal speeds. backwardPass then copies that entry into the previous block's exitV without capping it to that block's own targetVelocity, and forwardPass never re-caps exitV either. When two same-kind blocks with different speeds abut with no intervening travel (appendTravel drops zero-length travels, so consecutive groups whose geometry touches produce adjacent cut blocks), the slower block gets exitV > vTarget and blockTime's tDecel = (vTarget − exitV)/accel goes negative, shaving time off the estimate. Estimation-only — the planner never drives motion — but it is the same class of error the monotonicity property test exists to catch.

- **Evidence:** src/core/job/planner.ts:223-237 (min against next.targetVelocity only), 241-251 (exitV = next entry, uncapped), 254-264 (no exit clamp), 295-308 (negative tDecel when exitV > vTarget); commit b8072ef8
- **LightBurn reference:** n/a (internal estimator; GRBL's own planner is the reference and it clamps to both nominal speeds)
- **Recommendation:** In capJunctionEntries use Math.min(prev.targetVelocity, next.targetVelocity, vJunction); add a property test asserting entryV/exitV ≤ block.targetVelocity for every planned block.

#### S5-F6 [MINOR] Bounds preflight checks only G2/G3 endpoint words — an arc bulging past the bed edge passes the text scan

_Area: mechanism · Effort: M_

findOutOfBoundsCoords treats G2/G3 as motion lines but reads only the X/Y endpoint words; the I/J center words are ignored, so a CNC arc whose sweep bows outside [0,bed] while both endpoints are inside is approved. The placement pre-check (findPlacementBoundsIssue → computeJobBounds → cncPassXyPoints, which samples arc points) can catch it, but that path returns early when jobOrigin/motionOffset are absent, and runCncPreflight's own bounds pass is the text scanner. Laser output is unaffected (no arcs emitted).

- **Evidence:** src/core/invariants/predicates.ts:81-109; src/core/invariants/gcode-words.ts:18-20; src/core/output/cnc-grbl-strategy.ts:262-274 (native G2/G3 emission); src/core/preflight/cnc-preflight.ts:72 with src/ui/laser/start-job-readiness.ts:142-151 (early return when motionOffset undefined)
- **LightBurn reference:** n/a (CNC-side; LightBurn is laser-only). GRBL itself will happily execute the arc into the frame.
- **Recommendation:** Extend the bounds scanner to compute the axis-aligned extent of G2/G3 arcs from endpoint + I/J (quarter-point extrema test), or run the sampled cncPassXyPoints bounds check unconditionally in runCncPreflight.

#### S5-F7 [MINOR] LIGHTBURN-STUDY.md — the canonical divergence ledger — does not exist in the repo

_Area: architecture · Effort: S_

DECISIONS.md declares 'The authoritative behavior reference is LIGHTBURN-STUDY.md §§1–7' and 'The running ledger is LIGHTBURN-STUDY.md §8', and this sector's code cites it directly (grbl-strategy.ts:13 records the preamble pre-arm M3 S0 divergence as 'LIGHTBURN-STUDY §8'). A repo-wide search finds no such file — only references to it in DECISIONS.md, grbl-strategy.ts, preview-data.ts, and shortcuts.ts. The audit rule 'divergence is a bug unless the ledger records it' cannot be executed because the ledger is unauditable; this audit had to fall back on general LightBurn knowledge.

- **Evidence:** DECISIONS.md:1089-1101; src/core/output/grbl-strategy.ts:13-14; find/grep across repo root returned no LIGHTBURN-STUDY.md (only src/core/trace/lightburn-trace-settings.ts and src/io/lightburn exist)
- **LightBurn reference:** The ledger is the mechanism that makes LightBurn the reference; its absence undermines rule 3 itself.
- **Recommendation:** Restore or recreate LIGHTBURN-STUDY.md in the repo (or update DECISIONS.md to point at wherever it actually lives), and verify the §8 entries cited by code comments are present in it.

#### S5-F8 [MINOR] Image-mode overscan is a hard-coded 5 mm constant with no per-layer setting

_Area: workflow · Effort: M_

Raster groups always get overscanMm = DEFAULT_OVERSCAN_MM (5), with a comment deferring configurability to a future device-profile field. Fill mode DOES expose per-layer overscan (layer.fillOverscanMm flows through compileVectorGroupsForLayer), so the two scan modes are inconsistent. High-speed engraves may need more runway; tight bed placements need less (the M1 preflight note even coaches users to move artwork 5 mm inboard rather than letting them reduce it).

- **Evidence:** src/core/job/compile-job-defaults.ts:1-6; src/core/job/compile-job-raster.ts:93; contrast src/core/job/compile-job.ts:140 (fillOverscanMm per layer); src/core/preflight/preflight.ts:351-363
- **LightBurn reference:** LightBurn exposes Overscan as a per-layer setting on scanned (fill/image) layers, default 2.5%, adjustable per layer.
- **Recommendation:** Promote image overscan to a layer field (like fillOverscanMm) defaulting to 5 mm, or at minimum to a device-profile field as the comment already plans; keep the preflight note's wording in sync.

#### S5-F9 [POLISH] Resume confirmation dialog uses CNC wording for laser jobs

_Area: ui-layout · Effort: S_

streamResumeFromRawLine shows one confirm message for both machine kinds: 'The machine will restart the spindle, move to the recorded position at safe height, feed back to depth...'. For a laser job none of that is true (buildResumeProgram's laser body deliberately travels first, arms second, never touches Z), so the dialog describes the exact behavior the C1 fix removed and may alarm a laser operator into cancelling a safe resume.

- **Evidence:** src/ui/laser/start-job-flow.ts:162-165 vs src/core/controllers/grbl/resume-program.ts:161-174
- **LightBurn reference:** LightBurn's 'Start Here' preview dialog describes cut-from-here behavior in laser terms.
- **Recommendation:** Branch the confirm copy on machineKindOf(project.machine): laser wording ('move to the resume point with the beam off, then re-arm and continue') vs the existing CNC wording.

#### S5-F10 [POLISH] Four core sector files exceed the 250-counted-line soft cap

_Area: architecture · Effort: M_

Counted (non-blank, non-comment) lines: compile-job.ts 367, emit-raster.ts 365, preflight.ts 346, grbl-strategy.ts 309 — all under the 400 hard cap but well past the soft limit at which CLAUDE.md says to stop and split. Each already has natural seams (e.g. grbl-strategy's fill-sweep emitter, preflight's per-check appenders, emit-raster's corrected-run emitters).

- **Evidence:** grep -cvE count run this session: src/core/job/compile-job.ts=367, src/core/raster/emit-raster.ts=365, src/core/preflight/preflight.ts=346, src/core/output/grbl-strategy.ts=309
- **LightBurn reference:** n/a
- **Recommendation:** Schedule tidy-first splits (per CLAUDE.md refactor rules, separate PRs, no behavior change): grbl-strategy fill emission → grbl-strategy-fill.ts; preflight per-check appenders → sibling modules; emit-raster corrected-row emitters → emit-raster-corrected.ts.

### Not verified in this sector

- Firmware-side behavior claims (feed hold kills the beam only when $32=1; M4 power gates to zero at rest; ALARM de-energizes the laser; a cable yank mid-M3-cut leaves a stationary beam after buffered motion drains) — asserted from GRBL v1.1 documentation and in-repo comments; no hardware was driven this session and the repo's own hardware ledger marks these CLAIMED, not verified.
- Perceptual fidelity of fill/raster/overscan output — nothing was rendered or burned; per the audit rules, green structure/determinism tests do not prove the output looks right.
- Test suite, lint, and typecheck were not run (read-only audit on a slow machine); pass/fail status of the ~4000-test suite in this worktree is unknown.
- LightBurn reference behaviors cited in findings (M4 default with per-layer Constant Power Mode, per-layer Overscan setting, output-time curve flattening, G0/G1-only laser output) come from general knowledge — the repo's LIGHTBURN-STUDY.md ledger is absent (itself a finding) so none could be cross-checked in-repo.
- UI resize semantics — whether canvas scaling writes transform.scale (multiplying flattening error, as finding 2 assumes for imported SVGs) or regenerates shape polylines was not traced through the scene-mutation code.
- marlin-fan-transform.ts and smoothieware-strategy.ts power-conversion internals, blank-feed.ts and no-go-zones.ts scanner implementations were only read at their call sites, not audited line-by-line.
- Whether GRBL firmware actually rejects an 'XNaN' token with error:N (finding 1's assumed in-app failure mode) was not tested against firmware; the saved-file exposure holds regardless.
- estimate-duration accuracy against real burns (the planner is estimation-only; no timing comparison was possible).

## 6. Machine control: connection, jog, console, streaming — grade A-

Machine control is the strongest-engineered sector I have audited in this codebase: a pure, audit-hardened character-counted streamer with terminal-absorbing states and an untracked-ack ledger; a genuinely delivered multi-controller driver seam (grblHAL is a 4-line delta, UI gates on capabilities not kind); and safety semantics (pause gated on $32 proof, deferred post-reset beam-off cleanup, reboot-during-job detection, stall watchdog, fingerprint-verified checkpoint resume) that go beyond typical GRBL senders. The connect flow matches WORKFLOW F-B1 for the supported/cancel/failed states, and alarms/errors are fully humanized with recovery actions. The main defects are on the operator-experience side: the app's diagnostic log channel became invisible when ConsolePanel replaced the never-deleted LaserLog (wrong-baud hints, banner-mismatch advisories, and the wake-lock warning now go nowhere), the Fire button is an unrecorded LightBurn divergence on exactly the diode machines the catalog targets, and jog lacks continuous/keyboard/go-to-origin conveniences a LightBurn Move-window user expects. Docs have drifted from code in several small, fixable places (Brave hint, poll cadence, jog steps, the promised mid-job ETA).

### What's great

- **Audit-hardened, pure streaming state machine** — The GRBL streamer is a side-effect-free reducer with character-counted (default 120-byte, CNCjs-margin) and ping-pong modes, terminal-absorbing statuses (trailing oks after error:N can never report a clean finish), an oversized-line preflight so a >RX-buffer line refuses the job loudly instead of freezing at 0/N, alarm-wipes of in-flight accounting, and correct paused-drain semantics (GRBL acks held-but-parsed lines during feed hold; resume completes a drained stream). Nearly every branch cites the audit finding that motivated it. _(src/core/controllers/grbl/streamer.ts:22-46,105-151,199-243,292-294; src/ui/state/laser-job-actions.ts:64-73)_
- **Untracked-ack ledger prevents cross-attributed acks from overflowing the real RX buffer** — Every queued non-job write owes exactly one terminal ack per newline (multi-line Marlin jogs counted correctly); Start blocks until the ledger drains (1.5 s budget, guards re-asserted after the await), and a terminal ack is attributed to stream vs untracked in strict receive order — closing a genuinely dangerous class of sender bug where a stale ok phantom-frees RX budget mid-burn. _(src/ui/state/laser-safe-write.ts:88-101; src/ui/state/laser-stream-ack.ts:12-28; src/ui/state/laser-job-actions.ts:36-63)_
- **The multi-controller driver seam is real, not aspirational** — ControllerDriver is a pure data+function interface (nullable realtime bytes, capability flags, per-firmware line classifier and console rules); the store selects it at connect, UI gates on capabilities never on kind, and grblHAL is literally a 4-line delta over the GRBL driver. Banner detection is advisory (mismatch logs, never silently switches). Adding a GRBL-family firmware requires no surgery — ADR-094's promise is delivered in code. _(src/core/controllers/controller-driver.ts:67-82; src/core/controllers/grblhal/driver.ts:9-13; src/core/controllers/detect-controller.ts:14-25; src/ui/state/laser-store.ts:149-161; DECISIONS.md:3604-3638)_
- **Safety-reasoned pause/stop semantics beyond typical sender practice** — Pause requires proven $32=1 laser mode before feed hold on lasers (a hold at $32=0 can leave the beam on) while exempting CNC and settings-incapable firmwares with documented rationale; Stop soft-resets, wipes in-flight accounting, and defers the beam-off cleanup until the boot banner arrives so its ack can't be swallowed mid-reboot or orphaned; an uncommanded reboot mid-job (banner while streaming) errors the stream immediately instead of showing live progress for 10-90 s. _(src/ui/state/laser-job-actions.ts:85-156; src/ui/state/laser-line-handler.ts:148-199; src/ui/state/laser-reset-cleanup (armResetCleanup/flushResetCleanup call sites))_
- **Layered failure detection: stall watchdog, safety notices, wake lock, checkpoint resume** — An ack-stall watchdog fed by the status poll (10 s grace, 90 s while Run, paused during Hold/Door) catches silent USB death; failed Stop/Pause/Resume/Disconnect writes raise explicit operator safety notices; jobs hold a screen wake lock (ADR-117); and interrupted jobs persist a ~200-byte fingerprint-verified checkpoint whose sendable-vs-raw line mapping is single-sourced against the streamer's own predicate, refusing resume when the recompiled G-code differs. _(src/ui/state/laser-store-helpers.ts:110-181; src/ui/state/laser-connection-actions.ts:221-243; src/core/recovery/job-checkpoint.ts:1-15,56-124; src/ui/laser/start-job-flow.ts:95-109)_
- **Alarm and error vocabulary fully humanized with recovery actions** — All GRBL v1.1 alarms 1-9 plus grblHAL 10-13 map to title/detail/position-lost/recovery-action and drive a red banner offering $H and capability-gated $X; error:N lines are decoded into the console transcript; a frame that trips a hard limit names the triggered axis from the Pn: pins so the operator knows which way the job overran (ADR-053 P3). _(src/core/controllers/grbl/alarm-codes.ts:20-121; src/ui/laser/LaserWindow.tsx:166-237; src/ui/state/laser-line-handler.ts:201-242; src/core/controllers/grbl/status-parser.ts:37-46)_

### Findings

#### S6-F1 [MAJOR] Operator warnings are written to a log surface that no longer exists in the UI (orphaned LaserLog, unread lastWriteError)

_Area: ui-layout · Effort: S · verified: CONFIRMED_

Commit a52d0960 ('feat: add guarded GRBL console') replaced <LaserLog /> in LaserWindow with ConsolePanel, but ConsolePanel renders `transcript`, not `log`. LaserLog.tsx (the only reader of `state.log`) is now mounted nowhere — its only remaining references are two comments. Every pushLog-only message is therefore invisible to the operator: the wrong-baud handshake hint 'No controller response within 2 s. Check baud rate…' (laser-connection-actions.ts:174-180), the banner/profile mismatch advisory that WORKFLOW F-H1 documents as a user-visible log line (laser-line-handler.ts:160-166 vs WORKFLOW.md:2402-2404), the wake-lock-denied warning that WORKFLOW F-B6 §6 says appears as 'one LaserLog line' before long burns (use-active-job-wake-lock.ts:13-15 vs WORKFLOW.md:618-622), and the Marlin 'pause is stream-side only' caveat (laser-job-actions.ts:107-109). `lastWriteError` is likewise set in ~10 places and read by zero components (repo-wide grep). The wrong-baud case means one of F-B1's documented error states effectively has no UI.

- **Evidence:** src/ui/laser/LaserLog.tsx:12-13 (sole s.log reader); git show a52d0960 (removed <LaserLog/> from LaserWindow.tsx); src/ui/state/laser-connection-actions.ts:172-180; src/ui/state/laser-line-handler.ts:158-166; src/ui/app/use-active-job-wake-lock.ts:13-15; src/ui/state/laser-job-actions.ts:107-109; grep: no non-test reader of lastWriteError outside laser-store-helpers.ts:192
- **LightBurn reference:** LightBurn's Console window shows all controller traffic plus application messages in one place; a mis-baud connection is visibly diagnosable there.
- **Recommendation:** Route pushLog '[lf2]' lines into the transcript as system entries (ConsolePanel already renders system/'blocked' rows via systemTranscriptEntry), or re-mount LaserLog; surface lastWriteError (or drop it); delete the dead LaserLog.tsx once its duty moves. Update WORKFLOW F-B6/F-H1 wording to name the real surface.

#### S6-F2 [MAJOR] No Fire / test-pulse button — unrecorded LightBurn divergence on diode-laser positioning

_Area: workflow · Effort: M · verified: CONFIRMED_

There is no way to briefly fire the laser at low power to see the spot for material alignment. Grep for fire/pulse across src/ui and DECISIONS.md finds nothing; PROJECT.md's out-of-scope list (macros, scripting, variable text…) does not include it, and no ADR records the omission. The shipped catalog profiles are Creality Falcon diode machines (src/core/devices/falcon-profiles.ts) — exactly the class of machine whose users rely on LightBurn's Fire button because there is no red-dot pointer. Frame partially substitutes, but framing traces a whole box with the beam off; it cannot show 'where exactly is the spot right now'.

- **Evidence:** grep -i 'fire|pulse' over src/ui and DECISIONS.md: no UI hits (only unrelated matches, e.g. safety-notice.ts fire-hazard copy); src/ui/laser/JogPad.tsx and JobControls.tsx contain no such control; DECISIONS.md ADR index (lines 31-6094) has no fire-button ADR
- **LightBurn reference:** LightBurn's Move window has an opt-in Fire button (enabled in Device Settings, GRBL diode devices) that pulses the laser at a user-set low power for positioning.
- **Recommendation:** Add an opt-in, capability-gated Fire control (device-profile flag, default off; power clamp, connected+Idle+no-job interlocks reusing the existing motion/operation guards; M3 Sn / M5 through safeWrite). Record it as an ADR either way — if deliberately excluded, write that down so it stops being an unrecorded divergence.

#### S6-F3 [MAJOR] Move-window parity gaps: no continuous (hold-down) jog, no keyboard jog, no jog-speed control, no Go-to-origin

_Area: workflow · Effort: L · verified: CONFIRMED_

JogPad is click-per-step only; the file header itself says 'Phase B initial is step-only; continuous / hold-down jogging is Phase B polish' (JogPad.tsx:4-6) but that deferral was never promoted into WORKFLOW.md or an ADR. Jog feed is hardcoded to min(maxFeed, 3000) (JogPad.tsx:32 — also an unnamed magic number) with no user speed setting. Keyboard shortcuts exist only for Start (Ctrl+Return) and Stop (Ctrl+.) (use-job-shortcuts.ts:1-10); there is no arrow-key jog. There is no 'Go to Origin'/'Go to Zero'/saved-positions control — jogToMachinePosition exists in the store (laser-store.ts:178-182) but is only used by board capture. A LightBurn user positioning a head across a 400 mm bed will stumble on all four.

- **Evidence:** src/ui/laser/JogPad.tsx:4-6,19,32; src/ui/laser/use-job-shortcuts.ts:1-33; src/ui/laser/OriginRow.tsx:28-64 (set/reset/release only, no go-to); src/ui/state/laser-store.ts:178-182
- **LightBurn reference:** LightBurn's Move window offers continuous and step jog with a speed field, arrow-key jogging, Go to Origin / saved positions, and Set Origin — all staples of GRBL muscle memory.
- **Recommendation:** Prioritize continuous jog (send $J= with a long distance on pointerdown, jog-cancel 0x85 on pointerup — the driver's jogCancel is already plumbed via cancelJog) and a Go-to-origin button reusing jogToMachinePosition; add a jog feed selector and name the 3000 constant. Record whatever is deferred.

#### S6-F4 [MINOR] Brave WebSerial hint required by PROJECT.md is missing from the connect error path (and WORKFLOW contradicts itself)

_Area: workflow · Effort: S_

PROJECT.md:38 mandates: 'Surface a one-line "Enable WebSerial in Brave settings" hint in the F-B1 connect error path' (Brave ships WebSerial behind Shields/flags in some versions, issue #24404, re-verified 2026-05-28). The actual hint in LaserWindow lists Brave as a working browser with no caveat: 'Use Chrome, Edge, Brave, or Arc, or install the Windows desktop app' (LaserWindow.tsx:119-122); connection-help.ts:13 says the same. WORKFLOW.md:36 includes the parenthetical '(may require enabling under Brave Shields/flags)' while WORKFLOW.md:551 (F-B1 itself) omits it — the two doc sections disagree, and code matches the weaker one. A Brave user with WebSerial gated sees a disabled Connect and advice to use the browser they are already in.

- **Evidence:** PROJECT.md:38; WORKFLOW.md:36 vs WORKFLOW.md:551; src/ui/laser/LaserWindow.tsx:117-123; src/ui/help/connection-help.ts:13
- **Recommendation:** Add the Brave Shields/flags caveat to the ConnectionHints copy and reconcile WORKFLOW.md:551 with WORKFLOW.md:36.

#### S6-F5 [MINOR] WORKFLOW.md drift: jog step list, status-poll cadence, and the still-missing mid-job ETA

_Area: workflow · Effort: S_

Three doc/code mismatches in the sector's flows. (1) F-B5 documents step sizes '0.1 / 1 / 10 / 100 mm' (WORKFLOW.md:603); code ships nine steps 0.1–100 (JogPad.tsx:19). (2) F-B10 says 'App writes real-time ? every 250 ms while connected' (WORKFLOW.md:659); code polls every 250 ms only during activity and every 4th tick (1 Hz) when idle (laser-connection-actions.ts:39-41,227-228,240). (3) F-B11 promises 'Phase C will add an estimated-time-remaining label' (WORKFLOW.md:663); the project is deep into Phase H/I and the in-job progress bar still shows only acked-line counts (JobControls.tsx:190-207) — a pre-job estimate exists (EstimateBadge) but nothing updates during the run, where LightBurn shows elapsed/remaining time.

- **Evidence:** WORKFLOW.md:603,659,663; src/ui/laser/JogPad.tsx:19; src/ui/state/laser-connection-actions.ts:39-41,221-242; src/ui/laser/JobControls.tsx:161-207
- **LightBurn reference:** LightBurn displays elapsed time and a time-based completion estimate while a job runs.
- **Recommendation:** Fix the two doc lines to match code (both code behaviors are better than the doc), and either ship the mid-job ETA (the live-job-estimate module plus streamer progress gives the inputs) or re-date the promise in WORKFLOW.

#### S6-F6 [MINOR] Override panel says 'Spindle' on laser machines

_Area: ui-layout · Effort: S_

OverrideControls renders a fixed 'Spindle' row label (OverrideControls.tsx:35-41) regardless of machine kind, though on a laser the 0x99-0x9B bytes change beam power. The codebase already has a machine-aware label helper (src/ui/machine/machine-labels.ts, used by LaserWindow/JobControls) but this component doesn't use it. A laser user hunting for the power override won't recognize 'Spindle'.

- **Evidence:** src/ui/laser/OverrideControls.tsx:35-41; src/ui/machine/machine-labels.ts (machine-aware labels exist); src/ui/laser/LaserWindow.tsx:10,38-39 (pattern in use elsewhere)
- **LightBurn reference:** LightBurn consistently labels the laser output control 'Power'.
- **Recommendation:** Label the row 'Power' when project.machine kind is laser (reuse machine-labels), keep 'Spindle' for CNC.

#### S6-F7 [MINOR] Right-rail density: Console and jog sections are always expanded in a fixed 300px rail

_Area: ui-layout · Effort: S_

LaserWindow stacks Device-setup buttons, ConnectionBar, banners, StatusDisplay, JogPad (+air assist +Z group), ProbePanel, JobControls (which itself hosts placement, origin, Home/Auto-focus/Frame/Start, start-from-line, checkpoint banner, progress) and a permanently-open Console (min-height 90px, its own quick-command row and filter row) in a 300px-wide, internally-scrolling column (LaserWindow.tsx:63-101,239-256). The maintainer has previously rejected controller-panel walls of buttons and required collapsible grouped sections; the pattern is respected for DeviceSettings, GrblLaserSetupPanel, MachineSettingsPanel, ProbePanel and Origin-advanced (all <details>), but the Console — the least-used section for a beginner — cannot be collapsed, and on a laptop screen the operator scrolls to reach Start.

- **Evidence:** src/ui/laser/LaserWindow.tsx:63-101,239-256; src/ui/laser/ConsolePanel.tsx:64-95,372-378 (no <details>); collapsibles: DeviceSettings.tsx:42, MachineSettingsPanel.tsx:61, ProbePanel.tsx:13, OriginRow.tsx:183, GrblLaserSetupPanel.tsx:26
- **LightBurn reference:** LightBurn splits this surface into separately dockable Laser, Move, and Console windows the user can hide independently.
- **Recommendation:** Wrap ConsolePanel in the same <details> chrome (open state persisted), and consider collapsing the Jog group when disconnected. Keeps the Start/Stop cluster above the fold.

#### S6-F8 [MINOR] Driver-seam leak: ui/state builds a raw GRBL '$J=' line for the CNC frame retract

_Area: architecture · Effort: S_

laser-store.ts's header contract says 'this file must not hardcode any protocol bytes' (laser-store.ts:2-3) — firmware vocabulary belongs to the ControllerDriver (ADR-094). But the frame action in ui/state emits a hand-built GRBL jog literal for the CNC safe-Z retract: cncFrameRetractLine returns `$J=G90 G21 Z… F…` (laser-jog-actions.ts:107-110), justified inline by 'CNC is GRBL-only (ADR-098)'. The assumption is currently true, but grblHAL also reports cncJobs:true in capabilities (grbl/driver.ts:54 inherited at grblhal/driver.ts:9-13), and any future CNC-capable non-$J firmware turns this into shotgun surgery — exactly what the seam exists to prevent.

- **Evidence:** src/ui/state/laser-jog-actions.ts:84-91,107-110; src/ui/state/laser-store.ts:1-3; src/core/controllers/grbl/driver.ts:54; src/core/controllers/grblhal/driver.ts:9-13
- **Recommendation:** Add a nullable buildFrameRetract(zMm, feed) (or extend buildFrameLines with an options object) to ControllerCommands and move the literal into the GRBL driver.

#### S6-F9 [MINOR] Several sector files sit well past the 250-line soft limit

_Area: architecture · Effort: M_

Counted non-blank/non-comment lines (grep approximation of the ESLint rule): ConsolePanel.tsx ≈373, grbl-settings.ts ≈375, laser-store.ts ≈351 — all under the 400 hard cap but 40-50% past the soft limit where CLAUDE.md says 'stop and split before continuing'. ConsolePanel in particular mixes transcript filtering/formatting logic with five subcomponents; the filter/format helpers (visibleEntries, formatTranscriptLine, rowStyleFor, consoleCommandDisabledReason) are a natural pure-module extraction.

- **Evidence:** grep -cve blank/comment: src/ui/laser/ConsolePanel.tsx=373, src/core/controllers/grbl/grbl-settings.ts=375, src/ui/state/laser-store.ts=351 (soft 250 / hard 400 per CLAUDE.md size table)
- **Recommendation:** Split ConsolePanel's pure helpers into console-transcript-view.ts; grbl-settings and laser-store are next when they are touched again. No behavior change; refactor-only PRs.

#### S6-F10 [POLISH] core jog builder throws for user-reachable invalid input instead of returning a Result

_Area: architecture · Effort: S_

buildJogCommand / assertJogHasAxis in src/core throw Errors on non-finite or all-zero jog params (commands.ts:100-122,166-179), against the pure-core rule 'no throwing for control flow — return Result<T,E>'. Callers currently guard the reachable cases (jogToMachinePosition epsilon check at laser-jog-actions.ts:53; JogPad steps are never 0), so this is defensive-invariant territory rather than a live bug, but an unguarded future caller would surface as an unhandled rejection with only the (invisible — see finding 1) log for evidence.

- **Evidence:** src/core/controllers/grbl/commands.ts:100-122,166-179; src/ui/state/laser-jog-actions.ts:51-54; CLAUDE.md 'Pure core' section
- **Recommendation:** Return Result from buildJogCommand (or document these as assertion-class invariants in an ADR footnote) when the file is next touched.

#### S6-F11 [POLISH] Console has no user macros (recorded deferral — parity note only)

_Area: workflow · Effort: L_

LightBurn's Console ships user-definable macro buttons; KerfDesk's console offers only driver-defined quick commands ($X, $$, $#, $I, $G, ?) and single-line input (ConsolePanel.tsx:72-77,133-158; grbl/driver.ts:81-88). Unlike the Fire button, this divergence IS recorded: WORKFLOW.md:707 'persistent macros are deferred to a later lane' and PROJECT.md:486 lists macros/scripting out of scope — so per the audit rules it is a roadmap note, not a bug. Flagging because console macros are the single most common LightBurn-console habit (homing sequences, air toggle, focus moves).

- **Evidence:** src/ui/laser/ConsolePanel.tsx:72-77,133-158; src/core/controllers/grbl/driver.ts:80-88; WORKFLOW.md:707; PROJECT.md:486
- **LightBurn reference:** LightBurn Console has editable macro buttons persisted per device.
- **Recommendation:** Keep deferred, but when revisited, macros fit cleanly through prepareConsoleCommand's existing per-firmware validation lane.

### Not verified in this sector

- No hardware or live-app verification: connect/jog/frame/stream behavior was assessed by static reading only — nothing was exercised against a controller, simulator, or dev server, and per project rules green tests would not prove fidelity anyway.
- LightBurn behavior claims (Fire button, continuous jog + Move-window layout, console macros, 'Power' label, in-job time display) are from product knowledge; no LightBurn install was consulted this session.
- Marlin, Smoothieware, FluidNC, and Ruida driver internals were only skimmed (grblhal/driver.ts read in full; marlin/smoothie/ruida command/response modules not line-read); ADR-095/096/097 themselves state these are simulator-verified only, never on hardware.
- Counted-line figures are a grep approximation (non-blank, non-// lines) of the ESLint rule, which I did not run; block comments could shift the numbers slightly.
- The Device Setup wizard steps (DeviceSetupWizard.tsx and step files) and MachineSetupDialog internals were not read; the connect-wizard error-state assessment covers only the LaserWindow/ConnectionBar path.
- I searched for alternate readers of state.log and lastWriteError repo-wide and found none, but did not read every file; a rendering path I missed would downgrade finding 1.
- Status-parser and settings-collector correctness against real GRBL wire output was not validated beyond reading the parser and its documented format.

## 7. Camera & board/registration workflow — grade B+

This sector is two coherent, well-factored workflows: a LightBurn-style Camera panel (source → lens calibration → bed alignment → overlay/trace/click-to-position, all capturing through one ActiveCameraSource abstraction per ADR-121) and a genuinely one-place Place Board panel (rect corners or circle centre+diameter → locked registration outline → place/fit/array/jog/remove, ADR-124/125/126). The architecture is exemplary — pure-TS CV in src/core/camera with typed failures and assertNever unions, safety-gated burns and jogs reused rather than reinvented — and the board geometry is order-independent and self-diagnosing. The headline caveat is that every physical-accuracy claim (overlay lands on the bed, trace burns in place, G92 board capture) is hardware-CLAIMED, not VERIFIED, per the ADRs' own admissions, and I found two plausible silent mis-registration defects (letterboxed click mapping in manual 4-point alignment; no resolution guard when applying a persisted alignment) in exactly the accuracy-critical path that has never been hardware-proven. Camera WORKFLOW.md sections (F-CAM1/F-CAM4) have drifted from the shipped wizard-based flow, and the Registration Jig panel can silently unlock or clobber a captured board because both features share one registration box with conflicting semantics.

### What's great

- **One FrameSource abstraction unifies every camera consumer** — ActiveCameraSource ({usb | machine-jpeg | machine-rtsp}) is the single capture path for calibration, auto-align, overlay stills, trace-from-camera, and snapshots, with per-source poll cadence and null-not-throw capture failure. This closed the 'calibration didn't even work on machine cameras' gap and means a new camera type slots in at one seam. _(src/ui/camera/frame-source.ts:14-68, src/ui/camera/CameraSourceView.tsx:17-31)_
- **Pixel-basis discipline is enforced, not assumed** — CameraAlignment persists the basis ('raw' | 'rectified') it was solved in; trace-from-camera refuses to warp raw pixels with a rectified alignment (typed 'basis-mismatch') and the overlay follows the same rule, so a later lens calibration cannot silently mis-register existing alignments. _(src/ui/camera/trace-from-camera.ts:46-60, src/core/camera/camera-alignment.ts:14-15, DECISIONS.md:4898-4904)_
- **The burn-target wizard and click-to-position never bypass safety gates** — burnAlignMarkers runs the marker burn through the NORMAL runStartJobFlow (readiness, preflight, operator confirm, streaming) instead of a parallel pipeline; 'Move laser here' clamps to the bed, maps through the same origin transform G-code emission uses, and dispatches through the fully-gated jog path with the JogPad's block reasons. _(src/ui/camera/align-wizard/burn-markers-step.ts:19-36, src/ui/workspace/position-laser-click.ts:24-63)_
- **Board-capture geometry is pure, order-independent, and self-diagnosing** — Width/height derive from the bounding box of the four jogged corners so capture direction cannot swap dimensions (a bug found in live hardware use and fixed); the off-square diagnostic measures box-corner→nearest-point specifically so a skipped/duplicated corner is caught instead of scoring zero; sub-1mm double-clicks are deduped in the reducer. _(src/core/scene/board-capture.ts:63-91,145-164; src/ui/laser/board-capture/use-board-capture.ts:22-97)_
- **BoardShape union made circle boards nearly free downstream** — Because findRegistrationBoxes keys on kind+color rather than shape, Fit/Array/align/lock/remove and burn placement all worked for circles with zero downstream change; boardFitRegion returns the inscribed square (d/√2) for a circle so fitted/arrayed art stays inside the arc; the discriminated union ends in assertNever everywhere it is matched. _(src/ui/state/board-capture-actions.ts:52-79, src/core/scene/board-fit-region.ts:10-19, src/core/scene/board-capture.ts:28-32)_
- **Production-hazard guards on Fill/Array and calibration trust** — Arraying selects the whole grid so a re-click cannot silently stack a second overlapping grid (double-burn); tile counts are capped per-axis (100) and total (500) with non-finite gaps clamped before they can poison transforms or G-code; the lens wizard gates Apply behind trust warnings, pose-diversity checks, and an Original/Corrected perceptual A/B. _(src/ui/state/board-tile-actions.ts:62-69, src/core/scene/tile-into-region.ts:22-29,86-90, src/ui/camera/wizard/ReviewStep.tsx:70-105)_

### Findings

#### S7-F1 [MAJOR] Manual 4-point alignment clicks mis-map on non-4:3 camera frames (letterbox ignored)

_Area: mechanism · Effort: S · verified: CONFIRMED_

The machine-camera feed renders with width:100%, aspectRatio 4/3, objectFit:'contain' (NetworkCameraView.tsx:257-263), so any frame whose natural aspect is not 4:3 (16:9 is common) is letterboxed inside the element. clickToIntrinsicPixel maps the click linearly over the element's full bounding rect (lines 32-43), not the displayed image content, so clicked bed corners resolve to wrong intrinsic pixels — e.g. a 16:9 frame gets its y coordinates compressed by ~33%. The homography then solves against wrong correspondences and the overlay/trace are systematically mis-registered, with no way for the operator to notice (the overlay is consistently wrong versus physical reality). The unit test only exercises a 4:3 natural size matching the element (NetworkCameraView.test.ts:5-6), so the defect is invisible to the suite.

- **Evidence:** src/ui/camera/NetworkCameraView.tsx:32-43,58-68,257-263; src/ui/camera/NetworkCameraView.test.ts:5-23
- **LightBurn reference:** LightBurn's camera alignment taps targets on the raw captured image itself, so display letterboxing cannot skew the correspondence.
- **Recommendation:** Compute the object-fit content rectangle from the natural aspect vs the element box and map clicks through it (reject clicks in the letterbox bars); add a 16:9-frame test case.

#### S7-F2 [MAJOR] Persisted camera alignment is applied to frames of any resolution — no guard, and USB resolution is unpinned

_Area: mechanism · Effort: M · verified: CONFIRMED_

CameraAlignment records frameWidth/frameHeight (camera-alignment.ts:14-15) but no consumer checks them: WorkspaceCameraOverlay warps whatever still/stream it gets (WorkspaceCameraOverlay.tsx:31-60) and buildCameraTraceImage warps the capture with alignment.homography without comparing frame size to the alignment's (trace-from-camera.ts:46-66). getUserMedia is requested with no resolution constraints (web-camera.ts:68-71), so a later session can legitimately deliver a different default resolution; a homography solved at 1280×960 applied to 640×480 pixels mis-places everything by 2×. The calibration path has exactly this guard (frameMatchesCalibration + scaleIntrinsicsToFrame) — the alignment path has none, so a trace could compile artwork at wrong machine coordinates and burn in the wrong place with no warning.

- **Evidence:** src/core/camera/camera-alignment.ts:14-15,27-40; src/ui/camera/WorkspaceCameraOverlay.tsx:31-60; src/ui/camera/trace-from-camera.ts:46-66; src/platform/web/web-camera.ts:68-71
- **LightBurn reference:** LightBurn pins the camera capture resolution as part of the camera selection, so calibration/alignment and later captures share a pixel basis.
- **Recommendation:** At overlay/trace time, compare the frame size against alignment.frameWidth/Height; either rescale the homography (a diagonal similarity pre-multiply, mirroring scaleIntrinsicsToFrame) or refuse with a typed 'resolution-mismatch' message. Consider pinning ideal width/height in getUserMedia constraints.

#### S7-F3 [MAJOR] WORKFLOW.md camera flows F-CAM1/F-CAM4 have drifted from the shipped implementation

_Area: workflow · Effort: S · verified: CONFIRMED_

F-CAM1 describes engraving four alignment targets and dragging four on-screen markers onto the engraved crosshairs (WORKFLOW.md:2700-2704); no drag-marker flow exists anywhere in src/ui/camera (grep for drag: zero hits), and the only manual alignment is clicking the four BED CORNERS on the machine-camera preview (NetworkCameraView.tsx:70-76) — USB cameras have no manual path at all. F-CAM4 describes standalone 'Add markers to project' and 'Auto-align' buttons (WORKFLOW.md:2759-2766); both now live only inside the Align-to-bed wizard (AutoAlignControls.tsx:9-25 opens the wizard; the marker burn is wizard-internal). Bed corners are also a lower-accuracy, often-occluded reference than burned targets, so the surviving manual path is weaker than what the doc (and LightBurn) describe.

- **Evidence:** WORKFLOW.md:2698-2712,2757-2776; src/ui/camera/NetworkCameraView.tsx:70-76; src/ui/camera/AutoAlignControls.tsx:9-25
- **LightBurn reference:** LightBurn's manual camera alignment wizard has the user tap the burned target crosses at known coordinates — never bed corners.
- **Recommendation:** Rewrite F-CAM1/F-CAM4 to match the shipped wizard-centric flow (the wizard is arguably better than LightBurn's tap flow), and either retire the bed-corner manual path or upgrade it to click the burned markers.

#### S7-F4 [MAJOR] Registration Jig panel can silently unlock, replace, or re-purpose a captured board

_Area: workflow · Effort: M · verified: PARTIAL_

Place Board and the Registration Jig share the single registration box (only one may exist — applyAddRegistrationBox drops any existing box, registration-box-actions.ts:53-57). ADR-124 deliberately locks the captured board because its canvas position encodes the physical work origin (DECISIONS.md:6025). But the jig panel, openable at any time, treats that same box as a jig: it offers a one-click Lock/unlock toggle and a Create/Replace outline button (RegistrationJigOutlineControls.tsx:20-68) with no awareness that the box is a measured board. Unlock + stray drag silently breaks centering, Fill/Array, and burn placement — the exact failure the lock exists to prevent — and 'Create outline' silently deletes the measured board in favor of a typed jig.

- **Evidence:** src/ui/workspace/RegistrationJigOutlineControls.tsx:20-71; src/ui/state/registration-box-actions.ts:49-71; DECISIONS.md:6023-6025
- **LightBurn reference:** Not directly applicable (LightBurn has neither feature); the hazard is internal consistency, not parity.
- **Recommendation:** Tag the box's provenance (jig vs captured board) on the object or scene; have the jig panel show a warning state ('This outline is a captured board — unlocking/replacing breaks its physical registration') or disable unlock/replace for captured boards.
- **Verifier's correction (PARTIAL):** The headline hazard is real and the citations check out: applyAddRegistrationBox drops any existing registration box (registration-box-actions.ts:54-57) and Place Board routes through it (board-capture-actions.ts:95); the box is identified by reserved color only with no provenance field (registration-layer.ts:44); the always-enabled jig panel (registration-command-family.ts:8-21, App.tsx:59) shows a one-click unlock checkbox for any registration box (RegistrationJigOutlineControls.tsx:62-68) wired to a provenance-blind applySetRegistrationBoxLocked (registration-box-actions.ts:111-127), and DECISIONS.md:6025 (ADR-124 amendment) itself states that a stray drag after unlock "would silently break centering, the ADR-125 Fill/Array, and the burn placement". No ADR records the jig-panel-on-captured-board interplay as deliberate — ADR-126 Decision 3 (DECISIONS.md:6114) mentions lock/remove reuse only as a benefit, and WORKFLOW.md F-BC1's edge states never cover it. However, one leg of the finding is overstated: "'Create outline' silently deletes the measured board in favor of a typed jig" ignores the replace-in-place mitigation at object-insert-actions.ts:83-115, which deliberately preserves the existing box's position AND lock state ("keep an existing box's position and lock state so resizing doesn't re-center it ... or silently unlock it"), while the jig panel pre-seeds its size fields from the existing box's measured dimensions (RegistrationJigOutlineControls.tsx:73-96) — so a naive Replace click reproduces the board at the same position/size/lock, and registration only degrades if the operator actively types a different size or switches shape. Also, the lock is not a hard invariant anywhere: WORKFLOW.md:168 documents Edit-menu "Unlock All" unlocking every locked object, so the jig panel is a mislabeled path to an operation that exists by design elsewhere. Severity major stands for the confirmed unlock/re-purpose portion (the panel's BurnRunToggle can also flip a captured board to "Outline only", reversing the capture-time guide-never-burned decision at DECISIONS.md:5938-5939, risking a mis-placed or unwanted burn on real material).

#### S7-F5 [MINOR] Wrong-first-corner capture yields a correct-looking outline with a wrong origin — cheap plausibility check missing

_Area: workflow · Effort: S_

The geometry is order-independent but the G92 origin is set at the FIRST captured corner; capturing (say) the top-right first draws an identical outline while the origin — and therefore the burn — is at the wrong corner. ADR-124 records this as a known limitation with text guidance as the only mitigation (DECISIONS.md:5916-5922; BoardCaptureSteps.tsx:110-112). But once all four corners are in, corners[0] can be compared against the bounding-box minimum: if the first corner is not (within tolerance) the min-x/min-y corner, the operator captured the wrong corner first — a check requiring no device-origin knowledge, contrary to the ADR's 'would need the device origin' framing for machine-coordinate captures.

- **Evidence:** DECISIONS.md:5916-5922; src/ui/laser/board-capture/BoardCaptureSteps.tsx:108-114; src/core/scene/board-capture.ts:63-91
- **LightBurn reference:** N/A — LightBurn has no corner-capture feature.
- **Recommendation:** After the fourth capture, warn when corners[0] is not the bounding-box min corner (mirroring the off-square warning), with 'Start over' as the suggested fix.

#### S7-F6 [MINOR] No jog controls in the Place Board panel — capture ping-pongs across the screen

_Area: ui-layout · Effort: M_

The capture loop is: jog with the JogPad (inside LaserWindow, the controller column — LaserWindow.tsx:92) then click 'Capture corner' in the floating panel pinned top-left of the canvas (BoardCapturePanel.tsx:83-97), four or more times per board. The live head-position readout softens this, but the operator's mouse crosses the whole screen per corner, and the panel offers post-capture 'Jog head to' buttons — so jog capability is already wired into the panel's dependencies (jogToMachinePosition), just not exposed during capture.

- **Evidence:** src/ui/laser/board-capture/BoardCapturePanel.tsx:83-97; src/ui/laser/LaserWindow.tsx:16,92; src/ui/laser/board-capture/BoardCaptureSteps.tsx:33-55
- **LightBurn reference:** N/A — no LightBurn equivalent; ergonomic comparison is to KerfDesk's own JogPad.
- **Recommendation:** Embed a compact jog cluster (or arrow-key jog while the panel has focus) in the capture phase, reusing the existing gated jog path.

#### S7-F7 [MINOR] core/camera public surface is 2x over the hard export cap, and a legacy camera model ships alongside the live one

_Area: architecture · Effort: M_

src/core/camera/index.ts exports ~44 value symbols plus ~35 types (index.ts:1-79) against CLAUDE.md's 10-soft/20-hard cap on index.ts exports — the module spans homography, fisheye, LM solver, checkerboard detection, markers, warping, sessions, and trust. It also still exports the legacy CameraProfile model (camera-profile.ts, camera-transform.ts) whose UI consumers are gone — its only non-test use is shape validation in profile-catalog.ts:311-389 — while DeviceProfile carries THREE camera fields: legacy cameraProfile (device-profile.ts:137) plus the live cameraCalibration (:162) and cameraAlignment (:165). Two parallel persisted alignment models invite the next contributor to wire the wrong one.

- **Evidence:** src/core/camera/index.ts:1-79; src/core/devices/device-profile.ts:137,162,165; src/core/devices/profile-catalog.ts:311-389
- **Recommendation:** Do the deferred legacy-model cleanup (delete camera-profile/camera-transform and the cameraProfile field with a normalize-time drop), then split the index into calibration/alignment/detection sub-module entry points.

#### S7-F8 [MINOR] PROJECT.md directory map mislabels src/ui/calibration as camera setup UI

_Area: architecture · Effort: S_

PROJECT.md's module map says 'calibration/ — camera/registration setup UI' (PROJECT.md:398), but src/ui/calibration contains the Material Test, Interval Test, and Scan-Offset dialogs (ADR-044 material calibration); all camera calibration/alignment UI lives in src/ui/camera/wizard and src/ui/camera/align-wizard. A contributor sent by the doc lands in the wrong module.

- **Evidence:** PROJECT.md:398; src/ui/calibration/ contents (MaterialTestDialog.tsx, IntervalTestDialog.tsx, ScanOffsetCalibrationDialog.tsx); src/ui/camera/wizard/CameraCalibrationWizard.tsx:1-6
- **Recommendation:** Fix the PROJECT.md map line to 'material/interval/scan-offset calibration dialogs' and note camera setup lives under ui/camera/.

#### S7-F9 [POLISH] Camera panel is a fixed floating panel over the canvas; jig panel is draggable, camera panel is not

_Area: ui-layout · Effort: S_

The Camera panel pins bottom-left over the canvas at fixed coordinates with no drag handle (CameraPanel.tsx:101-118), and its wide monitoring mode grows to 560px — covering part of the very overlay/artwork it controls. The Registration Jig panel already solved this with a drag/keyboard-move handle (RegistrationJigPanel.tsx:58-67). LightBurn users expect Camera Control as a docked window (Window menu); KerfDesk's Tools-menu toggle is fine, but the panel should at least be movable.

- **Evidence:** src/ui/camera/panel/CameraPanel.tsx:97-118; src/ui/workspace/RegistrationJigPanel.tsx:58-67
- **LightBurn reference:** LightBurn's Camera Control is a dockable window that never floats over the workspace uninvited.
- **Recommendation:** Reuse the jig panel's drag/position machinery (ui-store FloatingPanelPosition) for the camera panel.

#### S7-F10 [POLISH] Circle capture: typed diameter silently overrides a jog-measured one with no cross-check

_Area: workflow · Effort: S_

A rim capture adopts the measured diameter into the input field, but typing afterwards overrides it with no warning even when they disagree wildly (CircleCaptureSteps.tsx:61-68) — the rectangle path's equivalent sanity signal (the off-square warning) has no circle counterpart. A typo (e.g. 900 for 90.0) draws a huge board whose Fit/Array then scales artwork off the physical material.

- **Evidence:** src/ui/laser/board-capture/CircleCaptureSteps.tsx:54-95; src/ui/laser/board-capture/BoardCaptureSteps.tsx:75-105 (rectangle warning for contrast)
- **Recommendation:** When both a measured and typed diameter exist and differ by more than a few percent, show the same style of warning before 'Create board outline'.

#### S7-F11 [POLISH] Align wizard Done step leaves the marker pattern as the operator's scene with no restore reminder

_Area: workflow · Effort: S_

burnAlignMarkers replaces the whole scene with the marker pattern (burn-markers-step.ts:31); only the Setup step's copy mentions 'undo restores your work'. The Done step (AlignWizardDetectStep.tsx:63-88) reports success and closes — the operator lands back in a project that is still the five-patch pattern, several steps after the one screen that mentioned undo.

- **Evidence:** src/ui/camera/align-wizard/burn-markers-step.ts:25-32; src/ui/camera/align-wizard/AlignWizardDetectStep.tsx:63-88
- **LightBurn reference:** LightBurn's alignment wizard is self-contained and never replaces the user's open document.
- **Recommendation:** Add 'Restore my artwork (Undo)' as a button on the Done step, or auto-undo the generated scene after the alignment persists.

### Not verified in this sector

- ALL physical accuracy claims are hardware-CLAIMED, not VERIFIED, by the project's own record: overlay-on-bed registration and burn-vs-overlay landing (DECISIONS.md:4954-4955 ADR-109, 4990-4996 ADR-110), live alignment accuracy (DECISIONS.md:5773-5778 ADR-122), bridge camera on real hardware as 'a separate live-machine checkpoint' (DECISIONS.md:5736-5741 ADR-121), and board capture G92/jog/burn (DECISIONS.md:6016-6021 ADR-124, 6122 ADR-126; PROJECT.md:244 'Hardware still CLAIMED'). Nuance: code comments claim a bridge-level hardware pass ('measured live on the Falcon', electron/camera-frame-proxy.ts:16-19,40-45; 'found during the hardware pass', UsbCameraSection.tsx:50-52), but I could not determine that pass's scope, and nothing contradicts the ADRs' statement that registration accuracy was never physically confirmed.
- No perceptual verification was performed this session (read-only audit): I did not render the board outline, the camera overlay, or any trace output; per ADR-124 the board outline itself was never perceptually rendered even at authoring time (DECISIONS.md:6013-6018). Green tests here assert geometry and store transitions, not that anything looks or lands right.
- LightBurn comparisons are from documented/remembered LightBurn behavior (Camera Control window, Update Overlay, tap-the-target alignment wizard, click-to-move tool); I could not run LightBurn side-by-side this session.
- The letterbox click-mapping and resolution-mismatch findings are code-level defect analyses; I could not execute them against a live camera to confirm magnitude.
- Did not audit electron/camera-frame-proxy-policy.ts (origin/redirect/private-network rejection) beyond ADR-121's claims, nor the wizard's live auto-capture loop (use-live-detection.ts, capture-novelty.ts) in depth — F-CAM2's auto-capture behavior is only partially verified.
- Did not run pnpm test/lint/typecheck (forbidden by audit rules); file-size and boundary observations are from reading, not from the CI tooling.

## 8. CNC / Easel mode — grade B+

KerfDesk's CNC mode is far more than a re-skinned laser: a pure Scene-to-CncGroups compiler (profiles with clipper2 radius offsets, pockets with offset/raster fill, v-carve ladders, drill pecks, STL relief rough+finish) feeds a Z-aware GRBL emitter whose safety contract (Z-up rapids, G1 plunges, spin-up dwell, overdeep-cut cap) is re-proven on the emitted text by dedicated invariants, and the beginner pack (ADR-111/112) plus persistent 3D pane give genuine Easel-shaped ergonomics. The three known leads from earlier audits — surfacing NaN, probe gating, and the laser-worded $32 banner — are all verifiably fixed in the current tree. The sector's one critical defect is the in-app multi-bit workflow: an M0 tool-change hold surfaces no Resume, and jog, probe, and Zero-Z are all blocked while a job is active, so the documented re-zero-at-tool-change flow (F-CNC14/15) cannot be performed when streaming from the app, turning a bit swap into a wrong-depth cut. Beyond that, the gaps are beginner-safety defaults diverging from the Easel/Carbide references — no work-zero advisory at Start, through-cut-by-default with tabs off, and raw 1000/1.5 feeds when no material is picked — plus discoverability and doc-drift rough edges. Everything remains hardware-CLAIMED; no output here should be called machine-verified until the 4040 air-cut rows flip.

### What's great

- **Safety invariants are proven on the emitted text, not just on settings** — CNC preflight re-derives the two router non-negotiables from the final G-code string: findPlungedTravelIssues (no XY rapid below safe Z, no rapid plunge, modal-Z tracked) and findOverdeepCutIssues (no Z below stock+1mm), on top of settings checks, bed bounds, no-go zones, and a dropped-layer detector so a layer whose shapes yield zero toolpaths can never be silently omitted. A regression anywhere upstream still blocks the file write (no-partial-output). _(src/core/preflight/cnc-preflight.ts:42-87; src/core/invariants/cnc-motion.ts:20-73; src/core/cnc/compile-cnc-job.ts:83-99)_
- **Compile order encodes machining safety, not just geometry** — compileCncJob puts pockets/engraves/relief clearing before profiles, orders inner contours before outer via containment depth (a hole is cut before the part that contains it is freed), and orderGroupsIntoToolSections makes multi-bit jobs contiguous per bit with profile-carrying sections last so a freed part is never re-machined. Tab handling even inserts an extra pass exactly at the tab top so tab height cannot quantize up to the pass grid. _(src/core/cnc/compile-cnc-job.ts:49-77,306-342,394-431; src/core/cnc/cnc-tool-sections.ts:15-37)_
- **The three known audit leads are all fixed in the current tree** — Surfacing now validates every parameter positive-finite with an iteration cap against memory exhaustion (the old NaN exposure is gone); the probe runner is quadruple-gated (active job, motion op, autofocus, probe-busy) plus Idle-only and capability-gated in the UI with an honest non-GRBL fallback message; and the router export header now records '$32=0 (router mode)' instead of the laser-worded banner (ADR-103 defect fix). The M0 tool-change block also retracts to safe Z before M5/park/M0 and forgets tracked Z so the first post-change move must re-retract. _(src/core/cnc/surfacing.ts:41-49,131-157; src/ui/state/laser-probe-actions.ts:17-42 + src/ui/laser/ProbeControls.tsx:44-58; src/io/gcode/gcode-metadata.ts:63-68; src/core/output/cnc-grbl-strategy.ts:145-160)_
- **ADR-102 three.js containment is textbook** — Exactly one module imports three.js, via dynamic import() with a type-only static import, returning a Result-style no-webgl fallback; heightmap-to-mesh stays a pure core function returning Float32Arrays, so the 3D pane, relief viewer, and cut-preview dialog all share testable geometry with no WebGL in tests. The persistent Cnc3DPane (Easel split-view parity) and the Preview 3D dialog both ride this one seam. _(src/ui/relief-viewer/relief-three-scene.ts:1-40; src/ui/workspace/Cnc3DPane.tsx:106-141; src/ui/workspace/Workspace.tsx:174-180; grep: only one file imports 'three')_
- **Beginner pack composes through one pure engine instead of parallel code paths** — Project material (ADR-112), per-layer material (ADR-111), and the advanced feeds calculator all resolve through the same calculateFeeds chipload function with device.maxFeed capping and floors, so the three UX tiers can never disagree; materialKey is display/round-trip only, keeping G-code byte-identical. Basic/Advanced disclosure hides but never resets values, and the Through-cut button resolves the depth-vs-thickness confusion. _(src/core/cnc/feeds-calculator.ts:103-136; src/ui/layers/CncMaterialRow.tsx:30-53; src/ui/machine/CncSetupPanel.tsx:70-90; src/ui/layers/CncLayerFields.tsx:80-91,95-130)_
- **Mode separation (ADR-101 gate-and-hide) is real and single-choke-point** — The Laser|CNC toggle sits atop the Cuts/Layers rail where a LightBurn user's eyes already live; layer cards fully swap field sets (the laser Line/Fill/Image ModeSelect is hidden in CNC), the Material Library hides, CNC-only panels (Material & Bit, probe, tiling, surfacing, 3D pane) render only for kind==='cnc', chrome relabels via machine-labels.ts, and the CNC-on-non-GRBL start is blocked with an unusually well-reasoned message (G4 dwell semantics). _(src/ui/layers/CutsLayersPanel.tsx:26-66; src/ui/layers/LayerRow.tsx:96-153; src/ui/machine/machine-labels.ts; src/ui/laser/start-job-readiness.ts:33-34,69-75)_

### Findings

#### S8-F1 [CRITICAL] In-app multi-bit job: M0 tool-change pause cannot be completed as documented (no Resume shown, jog/probe/Zero-Z all blocked)

_Area: workflow · Effort: L · verified: CONFIRMED_

The emitter inserts M0 change blocks with the comment 're-zero Z on the stock top, then cycle-start to resume', and F-CNC14/15 document that 'the streaming UI's Resume continues the job' after the operator 'jogs Z to touch the stock top, zeros Z (or probes)'. In the current tree none of that is possible while streaming from the app: (1) an M0 hold does not change the streamer status, so the Resume button never renders (it renders only when status==='paused', which only the app's own Pause sets); the operator sees only Pause+Stop while the machine sits in Hold. (2) Jogging is blocked whenever a job is active ('streaming'/'paused' both count). (3) The probe action is blocked by activeJobCommandBlockMessage. (4) zeroZHere (G92 Z0) asserts no active job. So the operator can (obscurely) resume via Pause-then-Resume, but cannot re-zero Z for the new bit in-app — the new bit's length delta becomes a direct depth error for the entire second tool section (gouged stock/spoilboard, broken bit, or air cut). The documented flow only works when the exported .nc is run through a different sender. Comments naming the next bit are never streamed or surfaced (isSendableGcodeLine drops ';' lines), so the operator is not even told which bit to load.

- **Evidence:** src/core/output/cnc-grbl-strategy.ts:145-160; WORKFLOW.md:1874-1909 (F-CNC14/15); src/ui/laser/JobControls.tsx:36-37 with src/ui/laser/JobRunControls.tsx:16-49 (Resume gated on isPaused); src/ui/state/laser-store-helpers.ts:38-44,68-82 (jog blocked while isActiveJob); src/ui/state/laser-probe-actions.ts:20-29; src/ui/state/laser-origin-actions.ts:36-43,76-82; src/core/controllers/grbl/streamer.ts:100-108 (comments never streamed); src/ui/state/laser-line-handler.ts has no Hold-to-paused transition
- **LightBurn reference:** Not a LightBurn flow (laser apps single-tool). Reference senders (gSender, UGS, CNCjs) pause the STREAM at a tool-change boundary leaving the controller Idle so jog/probe/zero work, and show an explicit 'load tool X' prompt; Easel/Carbide Motion show a modal naming the bit and a guided re-zero step.
- **Recommendation:** Detect tool-change boundaries in the streamer (either stop sending at the M0 line and swallow it, or mark the boundary index at compile time). At the boundary: keep GRBL Idle, show a 'Load <bit name>, re-zero Z, then Continue' prompt, and lift the jog/probe/Zero-Z blocks while section-paused. At minimum today: surface machine Hold state as 'Paused (tool change)' with a working Resume, and document that in-app streaming of multi-bit jobs cannot re-zero Z.

#### S8-F2 [MAJOR] No work-zero (especially Z) confirmation or advisory when starting a CNC job

_Area: workflow · Effort: M · verified: CONFIRMED_

The CNC emitter's whole coordinate contract is 'Z0 = stock top (operator zeros the bit on the stock before running)'. But prepareStartJob's machine checks are only: no active job/motion/controller op, no alarm, status Idle, and the GRBL-dialect gate — nothing checks or even warns that a work Z (or XY) zero was ever set. The advisory set for CNC (stock footprint, machine limits, dropped rasters) has no work-zero item either. A beginner who homes and hits Start runs the job in machine coordinates: the first 'G1 Z-1.5' can drive the bit somewhere completely unrelated to the stock top. The store already tracks workOriginActive and WCO frames, so a cheap advisory is possible.

- **Evidence:** src/core/output/cnc-grbl-strategy.ts:10-13 (Z0=stock-top contract); src/ui/laser/start-job-readiness.ts:198-225 (findMachineStartIssues — no zero check) and 116-123 (warnings list); src/ui/laser/machine-job-warnings.ts:17-28 (CNC advisory set)
- **LightBurn reference:** Easel's Carve flow is a forced walkthrough (material secured, bit confirmed, work zero set) before the spindle turns; Carbide Motion requires the zeroing screen before Run. LightBurn (laser) at least frames + origin-gates; KerfDesk's CNC start has neither analog.
- **Recommendation:** Add a CNC-only advisory (WARN, not block, consistent with ADR-111 philosophy) when starting with no active work offset / never-zeroed Z this session, plus a short pre-carve checklist dialog on Start in CNC mode (clamps, bit, zero) that can be dismissed 'don't show again'.

#### S8-F3 [MAJOR] Default CNC layer is a full through-cut profile with holding tabs OFF, and nothing warns

_Area: workflow · Effort: S · verified: CONFIRMED_

DEFAULT_CNC_LAYER_SETTINGS is cutType 'profile-outside', depthMm 6.35 — exactly DEFAULT_CNC_STOCK.thicknessMm (6.35) — with tabsEnabled: false. So the out-of-box job is a through-cut outline that fully frees every part (and every hole slug) with no tabs. cnc-tabs.ts itself documents why that is dangerous ('a through-cut part... thrown by the spindle'); preflight allows depth ≤ stock+1mm and has no 'through-cut without tabs' advisory. The ADR-111 'Through cut' button makes reaching this state one click. No ADR records tabs-off-by-default as a deliberate divergence.

- **Evidence:** src/core/scene/machine.ts:193-198,217-230; src/core/cnc/cnc-tabs.ts:1-8; src/core/preflight/cnc-preflight.ts:112-120 (depth check only); DECISIONS.md grep for 'tabs' shows no ADR on the default
- **LightBurn reference:** Easel automatically adds tabs to through-cut outline paths by default (user removes them explicitly); Carbide Create prompts/encourages tabs on through contours. KerfDesk silently defaults to none.
- **Recommendation:** Either default tabsEnabled true whenever depthMm >= stock thickness on a profile cut, or add a save/start advisory: 'Layer X cuts through the stock with no holding tabs.' Record the chosen default in an ADR.

#### S8-F4 [MAJOR] With no material picked, layers still get the exact 'cut-wrecking' default feeds ADR-111 was written about (1000 mm/min, 1.5 mm/pass)

_Area: workflow · Effort: S · verified: PARTIAL_

ADR-111's context names feed 1000 / depth-per-pass 1.5 on 6mm ply with a 1/8" bit as the hazard that motivated the beginner pack. The mitigation is opt-in: feeds only become material-derived if the user picks a project material (ADR-112) or per-layer material (ADR-111); text/drawn shapes never seed even then (documented follow-up). A beginner who skips the Material dropdown gets 1000/1.5/12000RPM on the default 1/8" bit with zero guidance, and the limit advisory only fires if a controller is connected AND its $110/$111 happen to be lower. Easel has no such raw-default path: settings always derive from material+bit.

- **Evidence:** src/core/scene/machine.ts:215-230 (defaults with 'Conservative wood/MDF starting point' comment); DECISIONS.md:5000-5010 (ADR-111 context naming 1000/1.5), 5085-5090 (ADR-112 seeding scope); src/ui/laser/cnc-machine-limit-warnings.ts referenced from machine-job-warnings.ts:24 (connected-only)
- **LightBurn reference:** Easel/Carbide (the CNC references) never expose raw defaults — feeds always come from the material+bit pair chosen up front.
- **Recommendation:** Default the project material to Softwood (or prompt for material on first CNC-mode entry, Easel-style), so calculateFeeds seeds every layer from day one; keep 'Custom' for pros. Alternatively add a connected-independent advisory when a layer's feeds are the untouched defaults and no materialKey is set.
- **Verifier's correction (PARTIAL):** The mechanical facts are all confirmed: DEFAULT_CNC_LAYER_SETTINGS is exactly 1000 mm/min / 1.5 mm/pass / 12000 RPM (src/core/scene/machine.ts:217-230) on the default 1/8" em-3175 bit (machine.ts:236); DEFAULT_CNC_STOCK has no materialKey (machine.ts:193-198) so seedLayerFromStockMaterial no-ops (src/ui/state/cnc-project-material.ts:94-97); detectCncMachineLimitWarnings returns [] when limits===null (src/ui/laser/cnc-machine-limit-warnings.ts:18) and detectMachineJobWarnings defaults controllerSettings to null (machine-job-warnings.ts:17-19); the connection-independent preflight only bounds feed by device.maxFeed=6000 default (src/core/preflight/cnc-preflight.ts:102, src/core/devices/device-profile.ts:235), which never fires at 1000. But the hazard framing collapses on the code's own arithmetic: the very mitigation the finding says the beginner misses produces MORE aggressive numbers than the default. For the exact ADR-111 scenario (plywood-MDF, 3.175 mm bit, 12000 RPM, 2 flutes) calculateFeeds fills 1440 mm/min / 1.6 mm/pass, and the recommended Softwood default fills 1200 / 1.6 (CHIPLOAD_CHART and DEPTH_FACTOR, src/core/cnc/feeds-calculator.ts:62-79, 103-135) — so defaulting the material would seed faster, deeper cuts, not rescue the beginner from 1000/1.5. DECISIONS.md also weakens the finding: ADR-111 records "Diagnosis pointed at mechanical/setup causes" (DECISIONS.md:5003-5004), i.e. the wandered cut was not attributed to these feeds; ADR-111 #1 records "absent = manual 'Custom'" and ADR-112 records "'Custom' clears the association and leaves feeds for hand-tuning" — the opt-in shape is the maintainer's documented decision, and since ADR-112 the project Material picker is visible the moment CNC mode opens (src/ui/machine/CncSetupPanel.tsx:66-79) with Basic mode hiding raw feed fields, so guidance is not "zero". The code comment (machine.ts:215-216) records the default as matching Easel's recommended wood/MDF settings for a 1/8" bit, which 1000/300/1.5 approximately does — undercutting "Easel has no such raw-default path" as a numeric hazard. Residual true gap: nothing forces a material pick and no connected-independent advisory flags untouched default feeds with no materialKey — a workflow-polish divergence from Easel's forced flow, not a major hazard, and the proposed fix as written would worsen the numbers it targets.

#### S8-F5 [MINOR] STL relief import is drag-and-drop only — no menu/toolbar command, no help topic

_Area: ui-layout · Effort: S_

DXF got a 'file.import-dxf' command (menu-visible); STL did not — importStlFiles is reachable exclusively via window drag-drop. Nothing in the command registry, toolbar, or help mentions STL, so the flagship H.4/H.5/H.8 relief-carving feature is undiscoverable unless the user already knows to drag an .stl onto the canvas. The laser-mode drop toast is good, but only fires after the user has already discovered the gesture.

- **Evidence:** src/ui/app/stl-import-action.ts:1-6; src/ui/app/use-import-drag-drop.ts:87-92 (only call site); src/ui/commands/command-types.ts:26-28 and command-families.ts:34-35 (import-svg/dxf/image exist, no import-stl); help-topics.ts grep for 'STL' = no matches
- **LightBurn reference:** Not a LightBurn concept. VCarve/Carbide Create expose 3D model import through the File/Model menu; Easel Pro via the Import button.
- **Recommendation:** Add 'file.import-stl' (CNC-gated the same way relief properties are) next to Import DXF, and a help topic naming the relief workflow (import STL, set width/depth, pick roughing/finishing bits).

#### S8-F6 [MINOR] WORKFLOW.md drift on the CNC surface: '8 starter tools' vs 18 in tree; F-CNC14 promises a Resume that is not rendered during an M0 hold

_Area: workflow · Effort: S_

F-CNC1 step 2 says the CNC setup panel shows a 'bit selector (8 starter tools)'; DEFAULT_CNC_TOOLS now carries 18 bits. F-CNC14 step 2 says 'GRBL holds until cycle start; the streaming UI's Resume continues the job', but Resume is only rendered when the app-side streamer status is 'paused', which an M0 hold never sets (see the critical finding). Doc drift on the safety-relevant flow is worse than doc drift on the count.

- **Evidence:** WORKFLOW.md:1522 vs src/core/scene/machine.ts:163-188; WORKFLOW.md:1882-1883 vs src/ui/laser/JobRunControls.tsx:37-48 and JobControls.tsx:36-37
- **LightBurn reference:** N/A (doc hygiene).
- **Recommendation:** Fix F-CNC1's count (or say 'starter bit library'); rewrite F-CNC14/15 to describe the actual in-app behavior until the tool-change UX lands, so the docs stop promising an impossible step.

#### S8-F7 [MINOR] compile-cnc-job.ts is at 378 counted code lines (soft limit 250, hard 400); tile-plan.ts at 275

_Area: architecture · Effort: M_

The sector's central compiler file is 33 lines under the hard ESLint cap and 128 over the soft cap; every new cut type or pass option lands here (the file already dispatches profile/pocket/engrave/v-carve/drill/relief plus tabs, direction, ramps). tile-plan.ts is also past soft. Next feature in either file forces an unplanned split mid-diff.

- **Evidence:** Measured this session: grep -vE '^\s*(//|$)' over src/core/cnc/compile-cnc-job.ts = 378 lines, src/core/cnc/tile-plan.ts = 275 lines; limits per CLAUDE.md size table
- **Recommendation:** Tidy-first split before the next CNC feature: move the pass builders (contourMajorPasses/depthMajorPasses/tab ladder helpers, lines ~306-390) into a cnc-passes.ts, keeping compileCncJob as the dispatcher.

#### S8-F8 [POLISH] Surfacing wizard hardcodes feed 2500 / plunge 600 with no user control and no device.maxFeed cap

_Area: mechanism · Effort: S_

SurfacingPanel exposes width/height/stepover/total-depth but bakes DEFAULT_FEED_MM_PER_MIN=2500 and DEFAULT_PLUNGE_MM_PER_MIN=600 into the program; buildSurfacingProgram validates positive-finite but never caps against device.maxFeed the way compileCncJob does (capFeed). GRBL will clamp to $110/$111 at runtime so the risk is low, but a slow machine faces at a different effective feed than the file claims, and the operator cannot slow a facing pass for MDF vs ply without editing the .nc.

- **Evidence:** src/ui/machine/SurfacingPanel.tsx:19-20,99-100; src/core/cnc/surfacing.ts:131-157 (validation only, no cap); contrast src/core/cnc/compile-cnc-job.ts:433-436
- **LightBurn reference:** gSender/OpenBuilds surfacing wizards expose feed as an editable field.
- **Recommendation:** Add feed/plunge fields (prefilled from the calculator for the active bit + project material) and cap both to device.maxFeed in buildSurfacingProgram.

### Not verified in this sector

- Any real-hardware behavior: every Phase H row is Built with hardware passes CLAIMED (PROJECT.md:115-135); no 4040 air-cut evidence was checked this session, and per ADR-098 nothing here should be called machine-verified.
- Perceptual fidelity of v-carve depth fields, relief roughing terraces/finishing scallops, and pocket coverage — the suite has analytic perceptual tests (vcarve-perceptual.test.ts, relief tests) but I did not render or visually compare any output; green tests are not fidelity.
- GRBL firmware-side behavior during an M0 Hold (rejection of $J jog and deferral of buffered G10/G92) — stated from protocol knowledge, not exercised; the app-side blocks in the critical finding are verified in code regardless.
- Easel's current auto-tab and carve-walkthrough behavior — from product knowledge, not re-verified against a live Easel session this session.
- Whether ESLint actually flags compile-cnc-job.ts/tile-plan.ts today (did not run pnpm lint per read-only rules); counted-line numbers were measured with grep, which may differ slightly from the ESLint counter.
- Live behavior of the Cnc3DPane (recompute latency on large jobs, WebGL rendering) and the .lf2 CNC round-trip — code read (Cnc3DPane.tsx, deserialize-project.ts) but never executed.
- The streamed-job experience end-to-end (M0 hold appearance, status readouts) — inferred statically from JobControls/JobRunControls/laser-line-handler; no dev server was run.

## 9. Trace engine & raster/image fidelity — grade B+

The trace engine is now fully in-house: Line Art/Smooth/Sharp route to the clean-room contour backend (contour-trace.ts), Edge Detection shares its finisher behind a local-contrast mask, and Centerline is a from-scratch medial-axis pipeline — the potrace-derived code is gone per ADR-123, with imagetracerjs surviving only as a UI-unreachable multi-colour fallback. The Trace dialog realizes ADR-030's LightBurn control model (Cutoff/Threshold band, Ignore Less Than, Smoothness, Optimize, alpha mask, Fade Image, Show Points, boundary crop/enhance, opt-in delete-after) and preview and commit share one trace function and one 2048px decode cap. The weak flank is the raster/image side and the documentation: rotated raster images cannot engrave at all (LightBurn can), the burn-grid resample is nearest-neighbor only, the perceptual harness — deep and genuinely excellent for trace — contains zero coverage of the dither/emit pipeline, and PROJECT.md still describes the Phase E tracer as imagetracerjs with centerline as an open gap, both false in the tree. One live UI trap: Line Art's silent auto-Sketch promotion makes the Cutoff/Threshold controls inert on colour-rich images with no off switch.

### What's great

- **Preview = commit parity in the Trace dialog** — The live preview and the committed trace run the SAME function (traceImageWithBoundaryMode) on the SAME pixel grid — PREVIEW_MAX_EDGE_PX is deliberately pinned to the commit cap (2048) so the dialog cannot preview one pixel grid and commit another, and a latest-token guard plus a source-revalidation check (P2-A, sameTraceSource) prevent stale or misregistered commits. _(src/ui/trace/image-loader.ts:27-30; src/ui/trace/use-trace-preview.ts:6-11,62-74; src/ui/trace/ImportImageDialog.tsx:254-305,333-341)_
- **One shared geometry finisher across trace lanes, with the closed-ring seam invariant enforced** — Line Art/Smooth/Sharp and Edge Detection all finish through contourPolylinesFromMask (mid-crack walk → corner-safe smoothing → arc evening → simplify → bounded spline), so all lanes share one quality bar; closeRingEndpoints forces every closed ring to return to its start point, closing the class of bug where renderers/emitters draw points as given and a 'closed' ring engraved with a physical seam gap (ADR-100 third amendment). _(src/core/trace/contour-trace.ts:82-124,133-182; src/core/trace/edge-trace.ts:55-75; src/core/trace/centerline/trace-centerline.ts:40-43)_
- **Perceptual harness with analytic instruments that see past IoU** — Beyond IoU/precision/recall (compare.ts), the harness carries purpose-built instruments for exactly what IoU is blind to: perpendicular-deviation straightness on a jittered rotated bar (waviness), roundness, glyph fidelity, a real-logo acceptance fixture asserting filled contours with zero open polylines, a G-code-string burn rasterizer, and a rated benchmark loop that emits machine-readable fix prompts. This is the documented countermeasure to the green-tests-lie failure mode (ADR-025/ADR-100). _(src/core/trace/contour-straightness.test.ts:1-48; src/__fixtures__/perceptual/compare.ts:1-30; src/__fixtures__/perceptual/arch-house-baseline.test.ts:24-60; src/__fixtures__/perceptual/gcode-rasterize.test.ts; src/__fixtures__/perceptual/trace-benchmark-loop.ts:21-66)_
- **ADR-030's LightBurn Trace control model fully realized, including the B4 extras** — Cutoff/Threshold brightness band, Ignore Less Than, Smoothness, Optimize, Trace alpha mask, Sketch Trace, Fade Image, Show Points, drag-a-boundary crop with Clear Boundary, and an opt-in Delete Image After Trace (default keep, ADR-026) are all present and wired to real engine parameters; manual Cutoff/Threshold correctly overrides Otsu ('explicit user input wins'). _(src/ui/trace/TraceSettingsControls.tsx:83-146; src/ui/trace/TracePreview.tsx:66-102; src/ui/trace/ImportImageDialog.tsx:163-166; src/core/trace/trace-image.ts:307-320)_
- **Pure-core discipline and worker offload in the trace path** — core/trace and core/raster contain no DOM/clock/random access (the only 'window.' hits are a local variable named window in smooth-arc-noise.ts); tracing runs in a dedicated Web Worker with an inline fallback, keeping the 50-500ms preprocess+trace window off the main thread while the worker reuses one module/tracer cache across preset changes. _(src/core/trace/smooth-arc-noise.ts:110-136; src/ui/trace/trace-worker.ts:1-61)_
- **Raster compile guards fail loudly instead of silently corrupting** — A pure raster budget rejects freeze-class jobs before any large allocation (target-grid driven, 4M px / 64MB caps); emitRasterGroup validates bounds/feed/overscan/dot-width/scan-offset for non-finite values; the lumaBase64 decoder rejects malformed input with explicit errors; wide white gaps rapid across with laser hard-off (ADR-039); device-origin and mirror flips are XOR-composed so double-flips cancel. _(src/core/raster/raster-budget.ts:1-21; src/core/raster/emit-raster.ts:36-42,443-477; src/core/job/compile-job-raster.ts:112-198)_

### Findings

#### S9-F1 [MAJOR] Line Art's auto-Sketch promotion silently disables Cutoff/Threshold with no off switch

_Area: workflow · Effort: S · verified: CONFIRMED_

preprocessForTrace checks shouldUseSketchTrace BEFORE applyThreshold, and the Line Art preset ships autoSketchTrace:true. On any image the colour heuristic classifies as colour-rich (>=0.2% saturated pixels), the sketch branch wins and the user's Cutoff/Threshold band is never applied — yet the dialog still shows both controls live, and for Line Art the Sketch checkbox is replaced by a note, so there is no way to force sketch OFF. A user dragging Cutoff/Threshold on a colour logo sees the preview not respond and has no explanation. mergeLightBurnTraceSettings deletes useOtsuThreshold on manual band entry but does not clear the sketch promotion.

- **Evidence:** src/core/trace/trace-image.ts:250-259; src/core/trace/trace-presets.ts:39; src/core/trace/auto-sketch-trace.ts:8-35; src/ui/trace/TraceSettingsControls.tsx:135-143; src/ui/trace/trace-options.ts:33-56; DECISIONS.md:1235,1245
- **LightBurn reference:** LightBurn's Sketch Trace is an explicit checkbox, default off (ADR-030 records defaults 0/128/2/1.000/0.2/off/off); the Cutoff/Threshold band always governs the trace when set. No ADR records this auto-promotion divergence.
- **Recommendation:** Either suppress auto-sketch whenever the user has manually set Cutoff/Threshold (explicit input wins, matching the Otsu precedence rule at trace-image.ts:307), or make the Line Art note a real tri-state control (Auto/On/Off). Record the auto-promotion as an ADR either way.

#### S9-F2 [MAJOR] Rotated raster images cannot engrave at all; compile ignores rotation and preflight blocks the job

_Area: mechanism · Effort: M · verified: CONFIRMED_

compileRasterGroup resamples the UNROTATED luma over the rotated object's axis-aligned bounding box (rasterBoundsInMachineCoords maps corners through the full transform then takes min/max); orientRasterLumaForMachine handles mirror flips only. The compile-job test at :247 asserts only the AABB, not rotated pixels. Preflight catches this ('unsupported-raster-transform': clear rotation before engraving), so it fails honestly rather than silently — but the flow dead-ends: the canvas happily rotates the image (generic rotate drag kind exists) and the user discovers the limitation only at Start/Save.

- **Evidence:** src/core/job/compile-job-raster.ts:52-77,112-133; src/core/job/raster-bounds.ts:16-34; src/core/job/compile-job-raster.test.ts:247-258; src/core/preflight/preflight.ts:298-322; src/ui/workspace/use-workspace-drag.ts:58
- **LightBurn reference:** LightBurn engraves rotated images by resampling the bitmap through its transform onto the scan grid. Divergence is a code comment, not a DECISIONS.md ADR.
- **Recommendation:** Implement rotated-raster engraving by inverse-transform sampling the source luma per target pixel of the machine-space AABB (white outside the footprint) — the resample loop in compile-job-raster is the single seam. Until then, surface the limitation at rotation time on image-mode objects, and record the divergence in DECISIONS.md.

#### S9-F3 [MAJOR] Image-mode burn-grid resampling is nearest-neighbor only — photos alias when downscaled to lines/mm

_Area: mechanism · Effort: M · verified: CONFIRMED_

resampleLumaNearest is the only resampler between the stored source luma and the burn grid. Downsampling a multi-megapixel photo to e.g. 10 lines/mm point-samples one source pixel per target pixel: thin dark features drop out or shimmer, textures moiré, and the result is dither-input dependent on sub-pixel placement. Nothing measures this — no perceptual fixture covers the raster pipeline (see next finding), and the trace side already learned this exact lesson (bilinear supersampling, evaluated kernels, ADR-100 amendments).

- **Evidence:** src/core/raster/luma-resample.ts:27-46; src/core/job/compile-job-raster.ts:60-66
- **LightBurn reference:** LightBurn resamples images to the scan grid with smooth (area/bilinear-class) filtering; its engraves of downscaled photos do not show NN aliasing. Exact kernel not verifiable this session.
- **Recommendation:** Use area-averaging (box filter over the source footprint) for downscale and bilinear for upscale in resampleLuma; keep nearest for passThrough. Add a perceptual fixture: known gradient/photo → resample → dither → mean-tone-per-region comparison against the source.

#### S9-F4 [MAJOR] Zero perceptual coverage of the raster/image (dither/emit) pipeline — Image-mode fidelity claims rest on structural tests plus a pending hardware burn

_Area: architecture · Effort: M · verified: CONFIRMED_

src/__fixtures__/perceptual contains no reference to dither, emitRaster, linesPerMm, or RasterImage — the harness covers trace (deeply), SVG import, box sheets, and vector toolpaths only. dither.test.ts asserts endpoints and determinism (all-black→sMax etc.), never tonal fidelity of an actual image. PROJECT.md records F.2.f hardware burn as still pending. So there is no evidence anywhere — instrument or burn — that a Floyd-Steinberg/grayscale engrave tonally resembles its source; per the project's own rule 4 this must not be described as verified.

- **Evidence:** grep of src/__fixtures__/perceptual for dither|emitRaster|linesPerMm|RasterImage: no matches; src/core/raster/dither.test.ts:32-59; PROJECT.md:100
- **LightBurn reference:** Not a parity item; a fidelity-proof gap under the project's own ADR-025/CLAUDE.md #2 regime.
- **Recommendation:** Extend the existing instruments to the raster lane: (a) dither a gradient/photo fixture and compare block-mean tone vs source luma (catches kernel and sMin/sMax mapping bugs); (b) run emitRasterGroup output through the existing rasterizeGcodeBurn and IoU it against the dithered mask (catches emit geometry bugs); (c) keep the hardware burn checklist item open until burned.

#### S9-F5 [MAJOR] PROJECT.md and WORKFLOW.md materially misdescribe the shipped trace engine

_Area: workflow · Effort: S · verified: CONFIRMED_

PROJECT.md Phase E still says tracing runs 'via imagetracerjs', calls the outline-vs-centerline gap 'the known open gap — the next frontier', and lists the ADR-030 control realignment as 'Phase assignment + build order pending maintainer decision (2026-05-29)'; the tech list names imagetracerjs as THE Phase E vectorizer. In the tree: the binary presets route to the in-house contour backend (ADR-123), Centerline is a shipped preset with its own pipeline, and every ADR-030 control (B1-B4) is live in the dialog. WORKFLOW.md's Phase E flows are still four STUB lines while trace is among the most-reworked features in the app (only F-F5 region-enhance is documented). Under the doc-as-spec regime (ADR-016, CLAUDE.md read-in-order), every future session starts by reading stale facts.

- **Evidence:** PROJECT.md:91-93,233-238,303; WORKFLOW.md:850-856; src/core/trace/trace-to-paths.ts:189-200; src/core/trace/trace-presets.ts:50-75; src/ui/trace/TraceSettingsControls.tsx:83-146
- **LightBurn reference:** n/a — internal doc drift.
- **Recommendation:** Rewrite PROJECT.md Phase E to reflect ADR-123 (in-house engine, imagetracerjs = unreachable fallback), mark the centerline gap closed and ADR-030 shipped, and write the real F-E1..E4 flows (presets, live preview, boundary crop/enhance, delete-after, error/empty states) into WORKFLOW.md.

#### S9-F6 [MINOR] Every filled-contours trace commits an object-level Fill operationOverride — unrecorded LightBurn divergence

_Area: workflow · Effort: S_

The Trace dialog adds a 'Fill style' picker (Scanline / Follow Shape / Island Fill) whose value always produces operationOverride {mode:'fill', fillStyle} on the committed TracedImage (traceFillStyle defaults to 'scanline' and is always passed for filled-contours). The traced object therefore fills regardless of its layer's mode — layer-mode semantics ('a layer's mode applies to every object on it') are bypassed by default. Defensible product behavior for filled contours, but no ADR records it (grep of DECISIONS.md for operationOverride/fill style: none), and it compounds the already-ledgered TracedImage-vs-plain-vectors divergence (§8.6 #1).

- **Evidence:** src/ui/trace/ImportImageDialog.tsx:88,120-124,283-293,343-350; src/ui/trace/dialog-parts.tsx:22,48-72; src/core/job/compile-job-raster.ts:99-102; DECISIONS.md:1080 (§8.6 ledger)
- **LightBurn reference:** LightBurn's trace outputs plain vectors on the active layer; Line vs Fill is decided by the layer's cut setting, not baked into the traced object at trace time.
- **Recommendation:** Record the trace-time fill override as an ADR (or drop the default override and let layer mode govern, matching LightBurn); sequence with the §8.6 #1 TracedImage elimination it interacts with.

#### S9-F7 [MINOR] Dead Canny-era modules linger after the ADR-115/123 engine replacements

_Area: architecture · Effort: S_

edge-reconnect.ts (279 lines) has zero importers anywhere; edge-subpixel.ts is imported only by its own test; canny-edges.ts + canny-gradient.ts survive only because the perceptual benchmark fixture imports cannyEdges. ADR-115 explicitly flagged these as 'orphaned modules pending a separate cleanup commit'; ADR-123 deleted edge-ink-support and the potrace family but left this set. The standing own-engine directive is to delete superseded tracer machinery.

- **Evidence:** grep of src for edge-reconnect imports: none; src/core/trace/edge-subpixel.test.ts:2; src/__fixtures__/perceptual/trace-benchmark-loop.ts:2; src/core/trace/canny-edges.ts:8; DECISIONS.md:5282-5286
- **LightBurn reference:** n/a.
- **Recommendation:** Delete edge-reconnect.ts and edge-subpixel.ts (+tests); either delete the canny benchmark case or move cannyEdges into the fixtures dir so core/ carries no dead engine code.

#### S9-F8 [MINOR] core/trace public surface exceeds the index.ts export cap; legacy tests-only API still exported

_Area: architecture · Effort: M_

core/trace/index.ts exports 24 value symbols plus 9 types (hard limit 20 per CLAUDE.md — 'the module is doing too much; split it'), including traceImageToSvgString which the index's own comment says 'no app code calls today (tests only)'. Related size-limit debt: TracePreview.tsx ~374, emit-raster.ts ~365, stroke-chains.ts ~353, trace-image.ts ~330 counted code lines — all past the 250 soft limit (under the 400 hard cap).

- **Evidence:** src/core/trace/index.ts:19-53 (export list + 'tests only' note at :11-12); line counts measured via grep-based blank/comment exclusion this session
- **LightBurn reference:** n/a.
- **Recommendation:** Delete traceImageToSvgString or move it into test helpers; split the preprocessing primitives (despeckle/median/otsu/raster-prep quartet) into a sub-barrel; schedule splits for the four warning-band files before the next feature touches them.

#### S9-F9 [MINOR] Trace dialog controls are number inputs, not sliders, and lack LightBurn's shortcut/context entry points

_Area: ui-layout · Effort: S_

All trace settings render as type="number" fields; LightBurn's Trace window uses draggable sliders (threshold scrubbing with live preview is the core interaction). There is no Alt+T shortcut on tools.trace-image (no shortcut at all) and no right-click/canvas context path to Trace — entry is the Toolbar group + menu only (both good placements, correctly gated on a selected raster). The 300ms-debounced live preview already exists, so sliders would complete the muscle-memory match.

- **Evidence:** src/ui/trace/TraceSettingsControls.tsx:234-258; src/ui/common/Toolbar.tsx:122-137; src/ui/commands/AppMenuBar.tsx:155; grep for a trace shortcut: none; grep of WorkspaceContextBar.tsx for trace: none
- **LightBurn reference:** LightBurn: Tools > Trace Image (Alt+T) or right-click a selected image; the dialog's threshold/smoothness are sliders scrubbed against the live preview. (Shortcut/menu details from product knowledge, not re-verified this session.)
- **Recommendation:** Render range+number paired inputs for Cutoff/Threshold/Smoothness (the debounced preview already absorbs scrubbing); add Alt+T; add Trace Image to the selection context bar when a raster is selected.

#### S9-F10 [MINOR] Image engrave resolution clamped to 5-25 lines/mm and 4M target pixels — a hard ceiling LightBurn does not have

_Area: workflow · Effort: L_

normalizeLinesPerMm clamps to [5, 25] (127-635 DPI) and the raster budget rejects any job whose target grid exceeds 4M pixels (a 200x200mm image at 10 lines/mm is exactly at the cap; 300x300mm at 10/mm is refused). The budget is a deliberate, well-documented freeze guard, but the combination means large-format or coarse/stylized engraves that LightBurn runs are simply impossible here, and the 5/mm floor also precludes coarse-interval effects.

- **Evidence:** src/core/raster/raster-units.ts:4-10; src/core/raster/raster-budget.ts:12-15; WORKFLOW.md:949-951
- **LightBurn reference:** LightBurn permits much wider interval ranges (coarser and finer) and streams arbitrarily large raster jobs rather than pre-materializing the full grid.
- **Recommendation:** Medium-term: stream raster rows (dither+emit per row band) so MAX_RASTER_PIXELS can rise or disappear — emit-raster's own header lists async-iterable emit as planned future work; short-term: lower the lines/mm floor (the budget already guards the real cost).

#### S9-F11 [MINOR] LightBurn image-mode parity gap: no Halftone/Newsprint screens; image overscan fixed at 5mm, not per-layer

_Area: mechanism · Effort: M_

The dither module offers 11 modes (threshold, FS, Jarvis, Stucki, Atkinson, Burkes, Sierra x3, ordered/Bayer, grayscale) — strong error-diffusion coverage — but no angle-screened Halftone/Newsprint modes, which LightBurn users pick for wood/photo work. Separately, raster overscan is the compile-time DEFAULT_OVERSCAN_MM constant; PROJECT.md itself notes 'image overscan is a fixed 5mm default (not per-layer)', while fill overscan IS per-layer (layer.fillOverscanMm).

- **Evidence:** src/core/raster/dither.ts:59-120,215-329; src/core/job/compile-job-raster.ts:93; src/core/job/compile-job.ts:140,180; PROJECT.md:347
- **LightBurn reference:** LightBurn's Image Mode list includes Halftone and Newsprint screens and exposes per-cut overscan settings for image layers. (Mode list from product knowledge; not re-verified against a LightBurn install this session.)
- **Recommendation:** Add a per-layer image overscan field mirroring fillOverscanMm (small, symmetric change); treat halftone screens as a scoped follow-up with its own perceptual fixture.

#### S9-F12 [POLISH] imagetracerjs fallback is unreachable from the app yet retains a documented degenerate default

_Area: architecture · Effort: S_

All five presets are 2-colour fixed-palette or centerline/edge, so every UI path routes to in-house backends; multi-file trace pins Line Art. The imagetracerjs lane fires only for non-preset multi-colour options no UI produces — and its DEFAULT_TRACE_OPTIONS entry (batch-trace's fallback when a job carries no options) hits the known quantizer degeneration on binary input (full-frame rectangle, documented in ADR-025 and the M10 retry note). Retention is ADR-recorded (ADR-123: 'imagetracerjs stays'), so this is dead-weight risk, not an unrecorded divergence.

- **Evidence:** src/core/trace/trace-to-paths.ts:189-200; src/core/trace/contour-trace.ts:36-40; src/ui/commands/multi-file-trace-action.ts:36; src/core/trace/batch-trace.ts:41; src/ui/trace/trace-options.ts:154-161; DECISIONS.md:946-949,5830-5831
- **LightBurn reference:** n/a.
- **Recommendation:** Pin batch-trace's fallback to TRACE_PRESETS['Line Art'] instead of DEFAULT_TRACE_OPTIONS, and open the question with the maintainer whether the multi-colour fallback earns its ~80KB lazy chunk or should be deleted to complete the own-engine directive.

### Not verified in this sector

- No rendered or perceptual verification was run this session (read-only audit): every fidelity statement here is from code, tests, and ADR records — not from rendered output. In particular I have NOT verified that current trace output looks correct on any image.
- LightBurn behaviors are cited from DECISIONS.md's own ADR-027/030 research records plus product knowledge; no live LightBurn side-by-side was performed (ADR-123 itself records that as outstanding). Specific unverified LightBurn details: the exact Image Mode list (Halftone/Newsprint naming), Alt+T as the Trace shortcut, slider (vs numeric) controls in the current LightBurn build, and its image resampling kernel.
- Whether ESLint/CI actually flags core/trace/index.ts's export count or the 250+-counted-line files — lint was not run; line counts are grep-based approximations of the counted-code metric.
- Whether the workspace UI actually lets a user rotate a raster image via canvas handles (generic rotate drag kind exists; only the compile/preflight behavior was verified in code and tests).
- Hardware state: the F.2.f image-mode burn (PROJECT.md) and the own-engine trace burns (ADR-123 'rendered and reviewed but not burned') remain unverified on a machine.
- The TRACE_AUDIT=1 render harness and PERCEPTUAL_ARTIFACTS outputs were not executed; their coverage is described from source only.
- Dialog behavior of the Edge preset's Sensitivity/Detail mappings against real images (derivation constants read in code only).

## 10. Architecture & code health (cross-cutting) — grade A-

The enforcement machinery is unusually real: eslint.config.mjs implements the exact CLAUDE.md boundary matrix, cycle ban, core-purity globals/imports/AST bans, complexity and size caps, and both `pnpm lint` and `pnpm typecheck` ran completely clean this session (zero errors, zero warnings) across 872 non-test source files, with only 11 eslint-disables repo-wide. Core purity goes beyond the configured rules — greps found zero Date/performance.now/randomUUID/setTimeout in non-test src/core — and discriminated unions with assertNever/switch-exhaustiveness are pervasive. The debt is at the documented-but-unenforced edges: the Result<T,E> discipline does not exist anywhere in core (geometry booleans throw user-facing strings and the store branches via silent try/catch — the exact banned anti-pattern), the 250-line soft tier and the index.ts export caps are fiction (76 files past soft, camera/index.ts at ~80 exported symbols vs a hard cap of 20), and there are 8 verifiably dead modules/barrels. Nothing critical; this is an A-grade codebase with specific, fixable drift between what the docs claim is enforced and what the config actually enforces.

### What's great

- **The CLAUDE.md enforcement matrix is real config, not aspiration — and the repo passes it clean today** — eslint.config.mjs encodes the exact core/io/platform/ui dependency matrix with default-disallow plus no-unknown-files, import/no-cycle at error, complexity 12, function 80, file 400 counted; `pnpm lint` and `pnpm typecheck` both exited 0 with zero output this session. CI runs the whole gate via release:check (typecheck+lint+lint:electron+format:check+license+audit+test+builds+file-size). _(eslint.config.mjs:44-57,115-128; package.json:27; .github/workflows/ci.yml:45-46; lint/typecheck runs this session (both exit 0, no output))_
- **Core purity is verified-clean beyond what the rules require** — Beyond the configured bans (window/document/fetch/console/process globals, node:* imports, Date.now/new Date/Math.random AST selectors), greps across non-test src/core found zero performance.now, randomUUID, setTimeout, or Date usage of any kind. The deterministic-G-code non-negotiable is actually load-bearing on this purity. _(eslint.config.mjs:220-273; grep of src/core for performance.now|randomUUID|Date.now|new Date|setTimeout returned zero non-test hits)_
- **Discriminated-union + exhaustiveness discipline is pervasive and compiler-enforced** — switch-exhaustiveness-check is a type-aware error and assertNever appears in 39 non-test files, so new SceneObject/Group variants become localized compile errors exactly as ADR-014 intended. State types across stores are tagged unions (ConnectionState, ToolMode, TextDialogState, CameraBridgeProbeResult), not boolean soup. _(eslint.config.mjs:183; src/core/job/job-bounds.ts:76; src/ui/state/laser-store.ts:67-73; src/ui/state/ui-store.ts:40-70; src/platform/types.ts:111-134)_
- **Regressions get turned into permanent static gates** — The H13 freeze bug (native dialog suspending the Stop button mid-job) became a no-restricted-properties/globals ban with exactly one exempt wrapper module; the white-on-white FontPicker regression became an AST-level ban on raw hex/rgb() literals in ui chrome (ADR-047). This 'lint rule as postmortem' habit is worth preserving. _(eslint.config.mjs:142-165,282-309)_
- **State layer is split into ~90 small, individually-tested slice modules** — ui/state holds ~90 action modules, nearly all with a co-located sibling .test.ts, composed by flat slice factories; the whole-tree median file is small (top file is 554 raw lines in an 872-file src). Escape-hatch usage is near zero: 11 eslint-disables in all of non-test src, 10 of them the documented scene-data-color exception. _(src/ui/state/ directory listing (~90 module+test pairs); src/ui/state/store.ts:425-466; eslint-disable count grep (11 hits))_
- **PlatformAdapter stays narrow with discriminated-union results at the seam** — The web/Electron seam is 6 top-level members with grouped sub-adapters (serial, camera, cameraBridge), each probe/health result modeled as a tagged union with failure reasons — so ui/ never touches platform/web directly and error states are typed, matching ADR-011. _(src/platform/types.ts:147-168,111-134; eslint.config.mjs:38-41 (main.tsx composition-root exception documented))_

### Findings

#### S10-F1 [MAJOR] Result<T,E> discipline does not exist: core throws user-facing strings for control flow and the UI branches via silent catch — the exact banned anti-pattern

_Area: architecture · Effort: M · verified: CONFIRMED_

CLAUDE.md's Pure Core section mandates 'return a Result<T, E> discriminated union' instead of throwing for control flow, but no Result type exists anywhere in src/core (grep for 'type Result|Result<' found zero files; ~25 core files use ad-hoc {ok:true}/{kind:'ok'} shapes instead). core/geometry boolean/weld/offset/dogbone throw user-facing messages for expected user-input conditions ('The result is empty — the selected shapes do not overlap that way.', 'The offset collapsed the shape — use a smaller inward distance.'), and the JSDoc contract says 'callers surface the message' — but the store actions swallow every one with bare `catch { return state; }` (4 call sites), literally CLAUDE.md's banned 'try { parseX() } catch { return null }' shape. Nothing in the type system marks these core functions as throwing, so every future consumer must rediscover it. Note: WORKFLOW.md F-CNC22 (lines 2088-2095) does document silent no-op for empty results, so the end-user behavior matches spec — the violations are the throw-based control flow itself and the stale core contract comment.

- **Evidence:** src/core/geometry/vector-path-booleans.ts:36-38 (stale 'callers surface the message' contract), :47,59,79,91; src/ui/state/vector-path-actions.ts:76-79,131-135,163-167,195-199; CLAUDE.md 'Pure core' + 'Anti-patterns' sections; grep 'Result<' in src/core = 0 files; grep "ok: true|kind: 'ok'" = 25+ core files
- **LightBurn reference:** LightBurn disables boolean tools until a valid selection exists; its feedback for empty boolean results was not verified this session (listed under notVerified).
- **Recommendation:** Standardize the already-common ad-hoc {kind:'ok'|'error'} shapes into one shared core Result<T,E> helper, convert the geometry ops (booleans, weld, offset, dogbone) to return it, delete the stale JSDoc, and have the actions handle the error variant explicitly (even if the handling stays a documented no-op).

#### S10-F2 [MAJOR] The 250-line soft tier is fiction — no warn rule exists, 76 files have drifted past it, and two files sit pinned at the 400 hard cap

_Area: architecture · Effort: S · verified: CONFIRMED_

CLAUDE.md ('Lint warning at soft, error at hard'), ADR-015, and PROJECT.md non-negotiable 15 all state a 250-counted-line soft limit surfaced as a lint warning. eslint.config.mjs configures only the 400 error tier — no warn tier exists at all. Measured result: 76 of 872 non-test src files exceed 250 counted lines, 25 exceed 350, and io/svg/parse-svg.ts plus ui/library/DesignLibraryDialog.tsx sit at ~400 counted (zero headroom — the next edit to either forces an unplanned split mid-feature). The splits that do happen are scissors-splits: scene-mutations.ts's own header says it was 'extracted from store.ts so the latter stays under the 400-line hard cap' and describes two responsibilities joined with '+'.

- **Evidence:** eslint.config.mjs:17,115 (single 400 error tier); CLAUDE.md size table; DECISIONS.md:271-282 (ADR-015); PROJECT.md non-negotiable 15; measured counted-lines: parse-svg.ts=400, DesignLibraryDialog.tsx=400, 25 files >350, 76 of 872 >250; src/ui/state/scene-mutations.ts:1-7
- **Recommendation:** Add a second max-lines entry at warn/250 (and max-lines-per-function warn/40 if the 40-soft is wanted too), then schedule concept-driven splits of the two 400-pinned files and store.ts before the next feature touches them, rather than splitting under duress.

#### S10-F3 [MAJOR] index.ts public-API caps (10 soft / 20 hard) are unenforced and heavily violated; ui bypasses barrels; core/geometry has no barrel at all

_Area: architecture · Effort: M · verified: CONFIRMED_

ADR-015 caps index.ts public exports at 20 hard; PROJECT.md non-negotiable 12 says 'module boundaries are public APIs'. No lint rule or script checks this. Actual counts: core/camera/index.ts has 40 export statements (~80 exported symbols), core/job 37 statements, core/scene 34, controllers/grbl 23, core/devices 22. Separately, the 'cross-module imports go through index.ts' rule is unenforceable by the current boundaries config and is violated: 17 ui files import core/raster/raster-budget and raster-units which are NOT exported from core/raster's barrel; src/core/geometry has no index.ts at all so its 4 ui consumers must deep-import; io/project's serialize/deserialize are deep-imported past its existing barrel. The camera and job modules are, by the ADR's own definition, 'doing too much'.

- **Evidence:** DECISIONS.md:277 (ADR-015); PROJECT.md non-negotiable 12; src/core/camera/index.ts:1-79; export-statement counts (camera 40, job 37, scene 34, grbl 23, devices 22); grep: 10 ui files import '../../core/raster/raster-budget', 7 import raster-units, neither appears in src/core/raster/index.ts; ls src/core/geometry (no index.ts); src/ui/state/vector-path-actions.ts:1-12
- **Recommendation:** Add entry-point enforcement (eslint-plugin-boundaries supports element entry points, or a small scripts/ check mirroring check-file-size-policy.mjs), create core/geometry/index.ts, export raster-budget/raster-units from the raster barrel, and split the camera and job barrels along their existing sub-domains (calibration vs alignment vs warp; compile vs bounds vs fill).

#### S10-F4 [MINOR] Eight verifiably dead modules: four orphan files (zero importers, not even tests) and four never-imported controller barrels

_Area: architecture · Effort: S_

A full import-graph scan (all src + electron, tests included as importers, Worker URL loads accounted for) found: src/ui/laser/LaserLog.tsx (a GRBL console component, referenced only in comments — ConsolePanel.tsx appears to have superseded it), src/core/trace/edge-reconnect.ts, src/io/project/project-validator-primitives.ts, and src/ui/layers/material-library-panel-test-helpers.tsx are imported by nothing at all. Additionally the marlin/smoothieware/fluidnc/grblhal index.ts barrels are never imported — select-controller-driver.ts and controllers/index.ts reach directly into ./<driver>/driver, so the barrels are dead weight that also contradicts the barrel-only-imports rule. Dead orphans also silently violate the co-located-test rule (LaserLog has no test).

- **Evidence:** orphan scan over 872 files + confirming greps: no import of LaserLog (comment refs only at src/ui/app/use-active-job-wake-lock.ts:4, src/ui/laser/LaserWindow.tsx:241), zero hits for edge-reconnect/project-validator-primitives/material-library-panel-test-helpers outside their own files; src/core/controllers/select-controller-driver.ts:7-12 and src/core/controllers/index.ts:24-27 import ./<x>/driver directly
- **Recommendation:** Delete the four orphan files (or re-wire LaserLog if it was meant to ship), and either route driver imports through the four sub-barrels or delete the barrels — pick one convention and keep it consistent with the entry-point enforcement from the previous finding.

#### S10-F5 [MINOR] AppState is a ~200-member god-interface: every feature must edit store.ts (already at 381/400 counted), and slice state contracts are re-declared structurally per file

_Area: architecture · Effort: L_

The main Zustand store composes 38 slice factories into one flat intersection of 25 action types plus ~120 inline members. The composition pattern itself is disciplined, but it makes store.ts a mandatory-edit hotspot for every new feature (import + intersection member + spread ≈ 8 lines each) while the file sits 19 counted lines under the hard cap — the next two features force an emergency split. Secondary symptom: because slices can't import AppState (circular), each action file re-declares the state subset it touches as its own structural type (e.g. VectorPathState, StateSlice with the comment 'Restating just the fields used'), duplicating the state shape in many files where it can silently drift.

- **Evidence:** src/ui/state/store.ts:132-318 (intersection type), 425-466 (38 spreads), 381 counted lines measured; src/ui/state/vector-path-actions.ts:34-39; src/ui/state/scene-mutations.ts:41-47
- **Recommendation:** Move the ~120 inline member declarations out of store.ts into their owning slice files (each slice exports its state+actions type; store.ts becomes pure composition), and consider carving the biggest domains (layers, registration/board, clipboard/group) into sub-stores as laser/ui/camera already are.

#### S10-F6 [MINOR] Geometry/math micro-duplication: the AABB extend pattern is written 4+ times and `clamp` 5+ times verbatim; frame-bounds hand-mirrors compileJob's inclusion rules

_Area: architecture · Effort: M_

There is no shared numeric/geometry primitives module, so MutableBounds + infinity-init + extendPoint is re-implemented in job-bounds.ts, frame-bounds.ts, island-fill.ts, and vector-path-tools.ts (plus boundsCenter twice: drill-peck.ts and island-fill.ts), and a bare `function clamp(` appears verbatim in at least 5 core files with ~20 more clamp* variants. CLAUDE.md's own rule is extract on the second occurrence. The riskier documented duplication: computeFrameBounds deliberately re-implements compileJob's layer/object inclusion semantics ('mirrors compileJob's layer/object inclusion rules') — if the two drift, Frame traces a different area than the burn; today only comments keep them aligned.

- **Evidence:** src/core/job/job-bounds.ts:28,174-182; src/core/job/frame-bounds.ts:3-6,29,121-141; src/core/job/island-fill.ts:166-190; src/core/cnc/drill-peck.ts:54; clamp grep (camera-profile.ts:340, compile-job-raster.ts:204, object-power-scale.ts:33, canny-gradient.ts:120, edge-trace.ts:103, +20 variants)
- **Recommendation:** Add core/geometry/aabb.ts (Bounds type + extend/union/center) and a shared clamp in a numeric utils module; more importantly, add a property test asserting computeFrameBounds is contained within computeJobBounds across the fixture corpus so the documented mirror can never drift silently.

#### S10-F7 [MINOR] Laser store models mutually-exclusive operations as five parallel fields guarded at runtime instead of one discriminated union

_Area: mechanism · Effort: M_

LaserState carries autofocusBusy: boolean, probeBusy: boolean, motionOperation: X|null, controllerOperation: Y|null, and streamer: Z|null side by side; their mutual exclusion (you cannot jog while probing, stream while autofocusing, etc.) is enforced only by runtime guard helpers (assertAutofocusIdle, motionOperationCommandBlockMessage, controllerOperationCommandBlockMessage, activeJobCommandBlockMessage). Illegal states (probeBusy && streamer!==null) are representable in the type. This is exactly the N-states-of-one-thing case CLAUDE.md's discriminated-union rule targets, and it sits in the most safety-sensitive store in the app.

- **Evidence:** src/ui/state/laser-store.ts:81-112 (field list), :48-55 (guard-helper imports from laser-store-helpers)
- **LightBurn reference:** Not a LightBurn-parity issue; internal state modeling only.
- **Recommendation:** Introduce a single `activeOperation: {kind:'idle'|'autofocus'|'probe'|'motion',...|'controller',...|'job', streamer}` union; the guard helpers collapse into one exhaustive switch and dual-operation states become unrepresentable.

#### S10-F8 [MINOR] CLAUDE.md doc drift: Immer is claimed as an available dependency but is not installed; the 150/250 React-component limits are unreachable dead letter

_Area: workflow · Effort: S_

(a) CLAUDE.md's mutable-state rule says to use 'produce from Immer (already a Zustand dependency)' — immer is only an OPTIONAL peer of zustand and is absent from node_modules, so following the doc's instruction produces an unresolvable import; a future session could waste time or add an unvetted dependency. (b) CLAUDE.md/ADR-015 state React component limits of 150 soft/250 hard lines, but max-lines-per-function is enforced at 80 counted lines and function components are functions — a 150-line component already fails lint, so the documented allowance can never be used. Both are the kind of doc-vs-tree contradiction CLAUDE.md itself says must stop a session.

- **Evidence:** CLAUDE.md 'Mutable state' section; pnpm-lock.yaml zustand@4.5.7 block (immer under peerDependencies with peerDependenciesMeta optional); node_modules/immer absent (checked); eslint.config.mjs:18,116-119; DECISIONS.md:274
- **Recommendation:** Fix CLAUDE.md: drop the Immer claim (spread-only, matching actual practice) or actually add immer; replace the component-limit row with the real rule (components are capped by the 80-line function limit; split into subcomponents beyond that).

#### S10-F9 [POLISH] Lint warnings are invisible to CI: `pnpm lint` has no --max-warnings budget

_Area: workflow · Effort: S_

`pnpm lint` is bare `eslint .`, so warn-tier rules never fail CI. Today that is exactly one rule (react-hooks/exhaustive-deps, deliberately warn per the config comment) and the repo currently has zero warnings — but the moment the recommended 250-line warn tier is added, drift past the soft limit will again be invisible in CI, recreating the current 76-file backlog. A warning budget keeps the soft tier meaningful without making it a hard gate.

- **Evidence:** package.json:15 ('lint': 'eslint .'); eslint.config.mjs:130-135; lint run this session produced zero warnings
- **Recommendation:** Change the script to `eslint . --max-warnings <current-count>` and ratchet the number down, or emit a warning-count line in the CI job summary so growth is at least visible in review.

### Not verified in this sector

- Exact ESLint counted-line numbers per file — my blank/comment-excluding counter is an approximation of max-lines' skipBlankLines/skipComments algorithm; the authoritative fact verified is that eslint (400 cap) passes repo-wide, so no file exceeds 400 by ESLint's count.
- LightBurn's exact behavior for empty boolean results and collapsed inward offsets (message box vs silent no-op) — KerfDesk's silent no-op is documented intent in WORKFLOW.md F-CNC22, but I could not compare against a live LightBurn install this session.
- Per-export dead code flowing through barrels — the orphan scan only detects wholly-unimported files; symbols re-exported from index.ts files but never consumed (e.g. possible legacy camera-model exports noted in prior session memory) were not measured.
- Process-enforced rules (PR review rejecting untested source changes, G-code snapshot acknowledgment lines) — these are review-time policies with no static artifact to audit.
- Cyclomatic-complexity headroom — lint green proves every function is ≤12, but I did not measure how many functions sit at 11-12 (one refactor away from a gate failure).
- Any runtime, perceptual, or test-suite behavior — no tests, builds, or dev server were run per audit rules; all claims here are static-analysis only.
- electron/ directory internals beyond its lint config — eslint.electron.config.mjs was read and mirrors the size/strictness rules (no boundaries plugin there, reasonable for a single-process tree), but electron sources themselves were not deep-audited.

## 11. UI information architecture & button layout (the whole shell) — grade B+

Code-derived map (not visually verified): the shell is three stacked top bars (menu bar File/Edit/Tools/Arrange/Laser-or-CNC/Window/Help; a text-button toolbar with file/import/create/trace/export/preview groups plus build+connection badges; a LightBurn-style numeric-edits bar with 9-anchor grid and X/Y/W/H/rotation), a left icon tool strip (Select/Node/Measure/Rect/Ellipse/Polygon/Star/Pen/Position-laser + Lib), a center canvas hosting three corner-anchored floating panels (Place Board top-left, Registration Jig top-right, Camera bottom-left), fixed right rails (CNC 3D pane when in CNC mode, then Cuts/Layers at 320px, then the Laser/Machine window at 300px with connection, jog, probe, job controls and console), a status bar, bottom-right toasts, and a stationary-right-click context menu. The architecture behind this is excellent — a single typed command registry feeds every surface with test-enforced tooltip coverage, one machine-kind gate (ADR-101), one modal kit with a real focus-trap contract, and deliberately hardened E-stop reachability — and every newer feature (camera, boards, box generator, CNC material picker, trace) has a discoverable, patterned entry point except STL relief import, which is drag-drop only. The main deductions are LightBurn muscle-memory divergences that no ADR records: selecting an object collapses the layer list into a closed disclosure, there is no one-click color-palette layer assignment, the right rails cannot be collapsed or managed from the Window menu, and Ctrl+I imports only SVG where LightBurn's single Import accepts everything; plus a handful of consistency slips (two dialogs bypass the modal kit letting global shortcuts leak behind them, an undefined --lf-bg token, stale shortcut docs).

### What's great

- **Single command registry feeds every surface, with disabled-reason tooltips everywhere** — buildAppCommands produces one typed AppCommand list (id, family, label, title, shortcut, enabled, disabledReason, active) consumed identically by the menu bar, top toolbar, and right-click context bar; disabled commands stay visible with a reason in the tooltip, and toggles expose aria-pressed. Menus, toolbar and context bar can never drift from each other. _(src/ui/commands/command-registry.ts:22-39; command-types.ts:98-110; AppMenuBar.tsx:106-131; Toolbar.tsx:91-113; WorkspaceContextBar.tsx:83-105)_
- **CNC/laser gating happens at one choke point (ADR-101)** — gateCommandsForMachineKind filters the laser-only set (18 ids) from buildAppCommands' output, so menu, toolbar and context menu hide laser concepts in CNC mode uniformly, with a classification checklist for new commands documented in the module and the policy recorded in ADR-101. _(src/ui/commands/machine-command-gate.ts:1-49; DECISIONS.md:4191-4216)_
- **Tooltip/help coverage is test-enforced, not aspirational** — Every CommandId must have a COMMAND_HELP topic, stale topics fail, and a 'meaningful tooltip' assertion rejects placeholder text; tools, menus, and named controls (console, device setup, preview playback) have typed help ids rendered as title + data-help-id on every button. _(src/ui/help/help-topics.test.ts:19-38; help-topics.ts:6-64; consumed in AppMenuBar.tsx:111-119, Toolbar.tsx:92-104, ToolStrip.tsx:37-42)_
- **One modal kit with a real a11y contract** — All 19 dialog surfaces (box generator, calibration grids, cut settings, machine setup, trace, shortcuts...) compose kit/Dialog, which centralizes focus trap, Escape, initial focus, focus restore, and modalDepth registration so global shortcuts yield while any modal is open — verified by grep showing exactly one lf-dialog-backdrop definition in the tree (two bespoke exceptions filed as a finding). _(src/ui/kit/Dialog.tsx:14-61; src/ui/common/use-dialog-a11y.ts:37-102; use-register-modal.ts:13-20; grep: only kit/Dialog.tsx contains 'lf-dialog-backdrop')_
- **E-stop reachability is engineered into the shell, not assumed** — Ctrl+. Stop deliberately ignores the modal-open and editable-target gates every other shortcut honors; window.alert/confirm/prompt degrade to non-blocking toasts (failing closed) while a job streams so no dialog can suspend the event loop with the beam armed; Stop stays mounted through 'done'/'errored' streamer states. _(src/ui/laser/use-job-shortcuts.ts:5-10,43-50; src/ui/state/job-aware-dialogs.ts:1-47; src/ui/laser/JobControls.tsx:38-45)_
- **Newer features share one coherent entry-point pattern** — Camera (ADR-107), Place Board (ADR-124), and Registration Jig (ADR-057) are each a single Tools-family toggle command with active state, opening a floating canvas panel at a fixed corner (board top-left, jig top-right draggable, camera bottom-left), with all feature actions inside the panel — the same shape three times, mirrored in both the Tools menu and the toolbar, so none of them reads as bolted-on. _(src/ui/commands/camera-command-family.ts:1-22; board-capture-command-family.ts:1-21; registration-command-family.ts:1-21; panel positions: camera/panel/CameraPanel.tsx:101-105, laser/board-capture/BoardCapturePanel.tsx:83-87, workspace/RegistrationJigPanel.tsx:357-361)_

### Findings

#### S11-F1 [MAJOR] Selecting an object collapses the layer list (and Material Library) into closed <details>

_Area: ui-layout · Effort: S · verified: CONFIRMED_

CutsLayersPanel wraps LayerList and MaterialLibraryPanel in a CollapsedPanel (<details> with no `open` attribute, i.e. collapsed by default) whenever any object is selected, to make room for SelectedObjectProperties. Since users have a selection during most editing, the Cuts/Layers list — the panel's namesake — is hidden by default exactly when the user wants to check or change a layer's mode/power/output for the selected artwork. The collapse also resets every time selection state flips because the tree swaps between wrapped and unwrapped renders.

- **Evidence:** src/ui/layers/CutsLayersPanel.tsx:48-64 (hasSelection branch), :89-102 (CollapsedPanel renders <details> without open); no ADR records this divergence (grep of DECISIONS.md for collapse/palette found nothing layer-panel related)
- **LightBurn reference:** LightBurn's Cuts/Layers window is always visible; selecting an object highlights its layer row, and per-shape properties live in a separate Shape Properties window, never displacing the layer list.
- **Recommendation:** Keep the layer list always visible (scroll if needed); render SelectedObjectProperties above it or in its own collapsible section instead of demoting Layers. At minimum default the Layers <details> to open and persist its open state across selection changes.

#### S11-F2 [MAJOR] No LightBurn-style color palette for one-click layer assignment

_Area: workflow · Effort: M · verified: CONFIRMED_

Assigning selected artwork to a layer requires finding the target layer's card in the (collapsed, see previous finding) list and clicking its per-card 'Assign' button; creating a layer requires a color-picker + 'Add' form at the top of the panel. This is the single most-used LightBurn gesture and it is several clicks deep here.

- **Evidence:** src/ui/layers/AssignSelectionButton.tsx:4-20; src/ui/layers/AddLayerControls.tsx:8-38; App.tsx mounts no palette strip (src/ui/app/App.tsx:51-75); not recorded as a deliberate divergence in DECISIONS.md
- **LightBurn reference:** LightBurn shows a color palette strip (docked at the bottom/left); with a selection, one click on a color chip assigns the selection to that layer, creating the layer if needed.
- **Recommendation:** Add a compact palette strip (existing layer colors + a few defaults) docked under the StatusBar or atop the Cuts/Layers rail: click = assign selection / set active drawing layer, matching LightBurn muscle memory. The store action assignSelectionToLayer already exists.

#### S11-F3 [MAJOR] Right rails are fixed-width and non-collapsible; the Window menu cannot show/hide any panel

_Area: ui-layout · Effort: M · verified: CONFIRMED_

CutsLayersPanel (320px) and LaserWindow (300px) are always mounted side by side; only the CNC 3D pane can collapse (to 44px). In CNC mode the right chrome totals ~932px plus the left tool strip, leaving roughly 300-500px of canvas on 1280-1512px windows (the codebase itself targets 1512px for the toolbar fit). The Window menu contains only Preview / Fit View / Project Notes / Undo History — no panel visibility toggles, so a LightBurn user who looks in Window to manage panels (or to find Camera Control) finds nothing.

- **Evidence:** src/ui/app/App.tsx:54-66; src/ui/layers/CutsLayersPanel.tsx:106-113 (width 320, flexShrink 0); src/ui/laser/LaserWindow.tsx:239-256 (width 300, flexShrink 0); src/ui/workspace/Cnc3DPane.tsx:164-177 (only collapsible rail); src/ui/commands/command-families.ts:331-380 (windowCommands has no panel toggles)
- **LightBurn reference:** LightBurn's right-side windows (Cuts/Layers, Laser, Move, Camera Control, Console...) are dockable, tabbable, and individually shown/hidden from the Window menu.
- **Recommendation:** Add collapse toggles to both right rails (the Cnc3DPane pattern already exists) and register them as window.* commands so the Window menu lists every panel — this also gives Camera/Board/Jig panels a LightBurn-shaped home in the Window menu alongside their Tools entries.

#### S11-F4 [MAJOR] Import is fragmented into three type-filtered commands; Ctrl+I only accepts .svg

_Area: workflow · Effort: S · verified: CONFIRMED_

File menu has Import SVG... (Ctrl+I, picker filtered to .svg), Import DXF... (menu-only, no shortcut), and Import Image... (separate picker). A migrating user pressing Ctrl+I to import a PNG or DXF gets a picker that refuses the file. Drag-and-drop already routes SVG/DXF/PNG/JPG/STL from one drop handler, proving unified dispatch exists — only the picker path is fragmented.

- **Evidence:** src/ui/commands/command-families.ts:34-42 (three commands, only import-svg has Ctrl+I); src/ui/app/file-actions.ts:43 (accept ['.dxf']) and :58 (accept ['.svg']); src/ui/commands/platform-image-files.ts:15; unified drag-drop at src/ui/app/use-import-drag-drop.ts:63-88
- **LightBurn reference:** LightBurn has a single File > Import (Ctrl+I) whose picker accepts every importable format (svg, dxf, png, jpg, bmp, ...) and dispatches by extension.
- **Recommendation:** Make Ctrl+I open one picker accepting .svg/.dxf/.png/.jpg (reusing the drag-drop dispatch), keep the specific commands as menu conveniences.

#### S11-F5 [MAJOR] DesignLibraryDialog and Viewer3DDialogShell bypass the kit Dialog contract (no focus trap, no Escape, no modal registration)

_Area: architecture · Effort: S · verified: CONFIRMED_

Every other dialog (19 checked) composes kit/Dialog, which wires useDialogA11y (Escape, focus trap, focus restore) and useRegisterModal (increments ui-store modalDepth so global shortcuts yield). These two build bespoke role=dialog divs with neither hook: Escape does not close them, focus is not trapped, and because modalDepth stays 0, global shortcuts stay live behind them — including Ctrl+Enter Start job, whose only guards are isModalOpen and connection state. A user browsing the design library on a connected machine can start a burn from behind the dialog.

- **Evidence:** src/ui/library/DesignLibraryDialog.tsx:5-12 (imports: no useDialogA11y/useRegisterModal), :92 (bespoke role=dialog); src/ui/relief-viewer/Viewer3DDialogShell.tsx:7-8, :55; contract: src/ui/kit/Dialog.tsx:26-29; gate: src/ui/state/ui-store.ts:351-353; Start-job gate: src/ui/laser/use-job-shortcuts.ts:26-33
- **LightBurn reference:** N/A (internal consistency / shortcut-gating issue).
- **Recommendation:** Port both to kit Dialog (or at minimum add useDialogA11y + useRegisterModal). Add a test asserting every role=dialog surface registers into modalDepth.

#### S11-F6 [MINOR] var(--lf-bg) is referenced in six components but never defined in tokens.css

_Area: ui-layout · Effort: S_

tokens.css defines --lf-bg-0/-1/-2/-input only. Six styles reference the nonexistent --lf-bg: on MachineModeToggle's ACTIVE segment it is the text color over the accent-blue fill, so the declaration is invalid-at-computed-value and falls back to inherited dark text on #1976d2 — roughly 3.5:1, below the WCAG AA 4.5:1 the project targets. The other five fall back to transparent backgrounds (selected-object badge, safety banner, machine-settings rows, design-library label).

- **Evidence:** definitions: src/ui/theme/tokens.css:23-90 (no --lf-bg); usages: src/ui/machine/MachineModeToggle.tsx:68, src/ui/layers/LayerRow.tsx:72, src/ui/laser/SafetyNoticeBanner.tsx:61, src/ui/laser/MachineSettingsPanel.tsx:298, src/ui/laser/MachineSetupStyles.ts:29, src/ui/library/DesignLibraryDialog.tsx:350; repo-wide grep for '--lf-bg:' returns nothing
- **LightBurn reference:** N/A (token bug).
- **Recommendation:** Replace with --lf-on-fill (text on accent) / --lf-bg-1 (surfaces) as appropriate, and add a static test or lint that every var(--lf-*) referenced in src/ui exists in tokens.css.

#### S11-F7 [MINOR] In-app Shortcuts dialog and WORKFLOW.md both lag shipped shortcuts (clipboard, group, Convert to Bitmap)

_Area: workflow · Effort: S_

Ctrl+C/X/V, Ctrl+G/Ctrl+Shift+G are implemented in EDIT_BINDINGS and registered on the Edit commands, and Ctrl+Shift+B opens Convert to Bitmap — but none appear in shortcut-list.ts (the single source for the Shortcuts dialog and toolbar hover hint, whose own header warns 'keep in sync... the audit caught the old hint omitting four shipped shortcuts'). WORKFLOW.md F-A15 still documents Cut/Copy as 'not implemented'. The only doc-sync test pins just the Ctrl+E/Ctrl+Shift+E swap.

- **Evidence:** implemented: src/ui/app/shortcuts.ts:199-217 (c/x/v/g), :317-320 (Ctrl+Shift+B); missing from src/ui/common/shortcut-list.ts:21-83; stale doc WORKFLOW.md:485-487; narrow test src/ui/app/shortcuts-docs.test.ts:5-13
- **LightBurn reference:** N/A (internal doc/UI drift; the bindings themselves match LightBurn).
- **Recommendation:** Add the missing rows to shortcutFamilies, fix F-A15, and extend shortcuts-docs.test.ts to diff shortcutFamilies against the command registry's shortcut strings so this cannot drift again.

#### S11-F8 [MINOR] Laser/Machine right rail keeps Console and Jog permanently expanded — density the maintainer already flagged

_Area: ui-layout · Effort: M_

LaserWindow stacks DeviceSetup buttons, ConnectionBar, StatusDisplay, full JogPad, ProbePanel, JobControls (placement + origin + Home/Auto-focus/Frame/Start + start-from-line + progress) and a full ConsolePanel (transcript, filters, input, quick-command buttons) in a 300px scrolling column. Only ProbePanel uses the collapsible <details> pattern; Console — the least-used surface for beginners — is always fully expanded at the bottom, pushing the rail into long scrolls.

- **Evidence:** src/ui/laser/LaserWindow.tsx:63-102 (mount order); src/ui/laser/ProbePanel.tsx:13-19 (the only <details>); src/ui/laser/ConsolePanel.tsx:14-50 (no collapse affordance)
- **LightBurn reference:** LightBurn separates these into Laser, Move, and Console dockable windows the user can hide; Console is typically a tab, not always-expanded chrome.
- **Recommendation:** Wrap Console (and optionally JogPad) in the ProbePanel <details> pattern, defaulting Console closed; this matches the prior maintainer feedback about grouping the controller panel into collapsible sections.

#### S11-F9 [MINOR] STL relief import is reachable only by drag-and-drop — no menu or toolbar entry exists

_Area: workflow · Effort: S_

importStlFiles is wired solely into the window drop handler; the CommandId union has no import-stl, so no File-menu item, toolbar button, or context-menu entry exposes it. DXF import got a File-menu command in the same phase. WORKFLOW F-CNC7 documents drag-only, so this is doc-consistent, but a CNC user cannot discover relief import from any visible UI surface.

- **Evidence:** src/ui/app/stl-import-action.ts:1-7; only consumer src/ui/app/use-import-drag-drop.ts:21,88; no stl id in src/ui/commands/command-types.ts:21-96; WORKFLOW.md:1648-1656
- **LightBurn reference:** N/A for STL (LightBurn has no relief carving); the app's own convention (every import has a File-menu command) is the reference here.
- **Recommendation:** Add a CNC-gated 'file.import-stl' command (Import STL Relief...) to the File family, using the existing CNC_ONLY gate set like file.open-gcode.

#### S11-F10 [MINOR] CommandShell subscribes to entire stores, rebuilding the whole command surface on every 250ms status poll

_Area: architecture · Effort: M_

useAppCommands calls useStore() and useLaserStore() with no selector, so the menu bar, toolbar, numeric-edits bar and context bar all re-render — and buildAppCommands re-derives ~70 command objects (including selection scans like selectedConvertibleVectors and open-fill-contour counts over the scene) — on every store mutation, including the laser status poll while connected. Other code acknowledges this poll-driven re-render cost (tokens.css bans shadows on these surfaces; use-dialog-a11y defends against it).

- **Evidence:** src/ui/commands/use-app-commands.ts:46-47; derivations at :119-149; poll acknowledged at src/ui/common/use-dialog-a11y.ts:44-47 and src/ui/theme/tokens.css:18-20
- **LightBurn reference:** N/A (implementation).
- **Recommendation:** Select the specific slices the context needs (or split laser-derived fields into a memoized sub-hook keyed on connection/streamer/motion state) so the poll only re-renders the few controls that read machine state.

#### S11-F11 [MINOR] Box Fit Test falls into the Tools menu's leftover block, separated from Box Generator

_Area: ui-layout · Effort: S_

MENU_GROUPS.tools lists box-generator in the first group and the calibration generators in the second, but tools.box-fit-test (registered immediately after box-generator, and functionally its calibration companion per ADR-119) is absent from every group, so the fallback places it in the trailing leftovers block at the very bottom of a ~25-item menu, after Convert to Bitmap.

- **Evidence:** src/ui/commands/AppMenuBar.tsx:136-164 (MENU_GROUPS lacks box-fit-test), :166-180 (leftovers appended last); registration order src/ui/commands/command-families.ts:269-282
- **LightBurn reference:** N/A (feature has no LightBurn equivalent; internal grouping consistency).
- **Recommendation:** Add 'tools.box-fit-test' next to 'tools.box-generator' in MENU_GROUPS (or into the calibration group), and add a test asserting every registered tools command appears in a named group.

#### S11-F12 [MINOR] WORKFLOW.md F-A2 still documents the pre-Phase-G left toolbar ('Select, Pan, Zoom-fit, Preview-toggle')

_Area: workflow · Effort: S_

The actual left rail is the ADR-051 ToolStrip: Select, Node, Measure, Rect, Ellipse, Polygon, Star, Pen, Position-laser plus a Lib button; Preview lives in the top toolbar and Window menu. The Phase-A spec text was never updated, so docs-as-spec (ADR-016) is drifted for the first screen a reader checks.

- **Evidence:** WORKFLOW.md:50 vs src/ui/workspace/ToolStrip.tsx:17-27; preview toggle in src/ui/common/Toolbar.tsx:136
- **LightBurn reference:** Actual ToolStrip contents are good LightBurn parity (left tool column with select/node/shapes/position-laser); only the doc is wrong.
- **Recommendation:** Update F-A2's Visible elements list to the current ToolStrip + top-toolbar Preview; consider a doc-sync test like shortcuts-docs.test.ts.

#### S11-F13 [POLISH] Top toolbar is 14 text-label buttons that barely fit 1512px; 'Lib' is a text stub in an icon rail

_Area: ui-layout · Effort: M_

Toolbar buttons are label-only (New, Open, Save, Save As..., Import SVG..., Import Image..., Text..., Registration Jig, Camera, Place Board, Box Generator..., Trace Image..., Convert to Bitmap..., Save G-code..., Preview) and code comments admit gap and badge were shrunk so the row fits a 1512px window; anything narrower wraps to two rows. In the icon-based ToolStrip, the design-library entry is a bespoke 'Lib' text button rather than an IconButton, the only non-icon item in the rail.

- **Evidence:** src/ui/common/Toolbar.tsx:122-137 (groups), :53-56 and :146-148 (fit-at-1512 comments), :139-144 (flexWrap fallback); src/ui/workspace/ToolStrip.tsx:50-58 (Lib text button)
- **LightBurn reference:** LightBurn's main toolbar is compact icons with tooltips, fitting far more commands in less width.
- **Recommendation:** Move to icon+tooltip toolbar buttons (kit/icons.tsx and IconButton already exist) or at least iconify the five panel/generator toggles; give the design library a proper icon in the ToolStrip.

#### S11-F14 [POLISH] Machine mode switch (Laser | CNC) lives inside the Cuts/Layers panel

_Area: ui-layout · Effort: S_

The project-level machine-kind toggle — which re-labels menus, hides 18 commands, swaps every layer card's field set and mounts the 3D pane — is a small segmented control at the top of the Cuts/Layers rail. It is discoverable but semantically it is a project/device-level switch, not a layers concern; a user hunting for 'CNC mode' will try File/Window/Device Settings first. No ADR records the placement (ADR-101 governs gating, not the toggle's home).

- **Evidence:** src/ui/machine/MachineModeToggle.tsx:1-27 (comment says 'top of the Cuts/Layers rail'); mounted at src/ui/layers/CutsLayersPanel.tsx:40
- **LightBurn reference:** N/A (LightBurn has no CNC mode; nearest analogue is the device selector in the Laser window).
- **Recommendation:** Consider surfacing machine kind next to the device/connection badge in the top toolbar (where device identity already lives), or at least mirroring it in the machine-labeled menu.

### Not verified in this sector

- This entire screen map is code-derived (App.tsx mount order, style constants, command tables); nothing was rendered, screenshotted, or driven in a browser this session, so actual visual layout, wrapping behavior, and overlap were not verified.
- The MachineModeToggle contrast failure from the undefined --lf-bg token is inferred from CSS invalid-at-computed-value fallback rules; the actual computed color and contrast ratio were not measured in a browser.
- The claim that CommandShell re-renders at the 250ms poll rate is inferred from selector-less store hooks plus in-code comments acknowledging poll-driven re-renders; it was not profiled.
- LightBurn comparisons rest on the project's documented baseline semantics (CLAUDE.md rule 3, ADR-027) and general product knowledge; no side-by-side with a running LightBurn instance was performed, and specific LightBurn toolbar icon contents were deliberately not asserted.
- Electron native menu parity (PROJECT.md promises 'native menus' on desktop) was not checked against electron/ main-process code.
- Viewer3DDialogShell was assessed from imports and grep (no a11y hooks found); every line of the file was not read.
- Dark-mode absence was verified as deliberate (ADR-049 records the single light chrome superseding ADR-047), so it was not filed as a finding; whether operators want a dark theme was not assessed.
- Keyboard-only operability of the full shell (menu bar roving focus, details-summary menus) was reasoned from code but not exercised.

## 12. Onboarding, help, error UX & docs — grade B

First-run is a deliberately quiet experience (splash → empty workspace with a drop hint, no welcome modal per WORKFLOW F-A1), with a well-architected, manually-launched Device Setup wizard (ADR-092) whose draft-commit reducer, readiness checklist, and passive nudge are genuinely better designed than most of the category. Error copy is a standout: GRBL alarms/errors are decoded into title+detail+action, and safety notices name the physical E-stop and explain why software cannot help. The weak flank is long-form help: the entire Help menu renders through window.alert, its two guides point at docs/ paths that are not shipped in the web bundle, the connect-failure path never cross-links the excellent troubleshooting guide, and the in-app shortcut reference plus WORKFLOW.md have both drifted from the shipped shortcut set. Beginner mode (ADR-111) is CNC-only and default-on (Basic), which is good design, but the laser side has no equivalent disclosure.

### What's great

- **Test-enforced help coverage — tooltips cannot drift from the command registry** — help-topics.test.ts builds the real command registry for BOTH machine kinds and fails if any command lacks a help topic, if a topic is stale, or if a tooltip is not a meaningful sentence (length/whitespace/punctuation heuristic). This is an anti-drift mechanism most apps lack entirely. _(src/ui/help/help-topics.test.ts:18-32,125-135)_
- **Safety/error copy names the physical control and the reason software can't help** — write-failed, disconnect-during-job, stream-stalled, controller-reboot, and mid-job error:N notices all say exactly what state the machine may be in and direct the operator to the physical E-stop; GRBL alarms decode to title+detail+positionLost+recovery action, and error codes carry corrective hints (e.g. 'Set $22=1 first'). _(src/ui/state/laser-safety-notice.ts:72-98,121-189; src/core/controllers/grbl/alarm-codes.ts:20-115; src/core/controllers/grbl/error-codes.ts:29-52)_
- **Device Setup wizard: pure reducer + draft-commit + degraded modes that actually work** — Step logic is a pure useReducer (device-setup-flow.ts), profile commits only on Finish via replaceDeviceProfile so Cancel is clean, the Finish gate is a pure readiness checklist with blocking (bed, $30) vs informational items, and a live effect keeps detected $$ values in sync mid-wizard. Disconnected and $$-silent modes degrade to manual entry without blocking, matching WORKFLOW F-C7's error/edge states. _(src/ui/laser/device-setup/DeviceSetupWizard.tsx:54-83; src/ui/laser/device-setup/device-setup-flow.ts:29-37; src/ui/laser/device-setup/device-setup-readiness.ts:46-65; WORKFLOW.md:826-836)_
- **Nag-free onboarding nudge honoring the no-modal contract** — The wizard never auto-opens (ADR-092 records auto-open as maintainer-rejected); instead a passive nudge gives the 'Set up device' button primary emphasis plus a one-line note only while connected to a profile never run through setup, keyed by profile signature in localStorage with fail-soft reads. The button sits at the top of the machine rail, above Connect — exactly where a LightBurn user looks for Devices. _(src/ui/laser/device-setup/device-setup-nudge.ts:21-30; src/ui/laser/device-setup/DeviceSetupControls.tsx:38-64; src/ui/laser/LaserWindow.tsx:70-78; DECISIONS.md:3351-3356,3394-3396)_
- **PWA update UX is job-aware and the repeat-nag bug is fixed at root** — The update banner is suppressed while a job streams (a reload can abort motion), 'Later' persists keyed to the running __APP_VERSION__ so workbox re-firing 'waiting' on every load cannot re-nag, and a strictly-newer SW clears the dismissal via updatefound and forces a re-render. Storage failures degrade safely in both directions. _(src/ui/app/PwaUpdatePrompt.tsx:40-48,64-69; src/ui/app/pwa-update-dismissal.ts:14-40)_
- **No dialog can ever freeze the Stop button** — All native alert/confirm/prompt calls route through job-aware wrappers that degrade to toasts during an active job and fail CLOSED for confirm/prompt — help, About, and error dialogs are structurally incapable of suspending the event loop while the laser is firing. _(src/ui/state/job-aware-dialogs.ts:25-47)_

### Findings

#### S12-F1 [MAJOR] In-app help points users at docs/ files that are not shipped, from inside a window.alert that cannot link

_Area: workflow · Effort: M · verified: CONFIRMED_

The Help menu's two long-form entries ("Can't connect?" and "Safety & liability") render CONNECTION_HELP_TEXT / SAFETY_NOTICE_TEXT through jobAwareAlert → window.alert. Both end with 'Full guide: docs/connection-troubleshooting.md' / 'docs/safety.md', but public/ contains no docs (only eula.txt, third-party-notices.txt, splash.jpg, etc.), so on kerfdesk.com those paths resolve to nothing and the user cannot follow them — and a native alert can't hyperlink anyway. The two markdown guides are excellent but effectively unreachable from the product they document.

- **Evidence:** src/ui/help/connection-help.ts:39; src/ui/help/safety-notice.ts:36; src/ui/commands/CommandShell.tsx:88-90; src/ui/state/job-aware-dialogs.ts:25-31; public/ glob (404.html, _headers, _redirects, favicon.svg, download.html, eula.txt, third-party-notices.txt, splash.jpg — no docs/)
- **LightBurn reference:** LightBurn's Help menu opens real documentation surfaces (online docs, quick-start material), not native alerts with unreachable file paths.
- **Recommendation:** Short term: replace the trailing 'docs/...' lines with the full GitHub URL (or ship the two markdown files under public/docs/ and reference the deployed URL). Medium term: move the two help texts from jobAwareAlert into the existing Dialog kit (as ShortcutsDialog already does) so links, headings, and scrolling work.

#### S12-F2 [MAJOR] Connect failure is a dead end — the failure site never points at the troubleshooting guide that exists one menu away

_Area: workflow · Effort: S · verified: CONFIRMED_

The single most common new-user failure (missing CH340 driver → empty port picker → cancel) returns silently to disconnected (per F-B1 spec), and a hard failure shows only 'Failed: <raw browser error>' in the ConnectionBar. Neither path mentions the Help-menu 'Can't connect?' entry or the driver table, so the operator hits a wall at exactly the moment the (very good) troubleshooting content is needed. The 2s handshake timeout message in the console log is good ('Check baud rate…') but lives in the log, not at the button.

- **Evidence:** src/ui/laser/ConnectionBar.tsx:46; src/ui/state/laser-connection-actions.ts:69-71,98-101,172-181; docs/connection-troubleshooting.md:34-57; WORKFLOW.md:553-558
- **LightBurn reference:** LightBurn's 'Find My Laser' failure path keeps the user inside a guided flow with retry/troubleshooting guidance rather than a raw error string.
- **Recommendation:** When connection.kind === 'failed' (and optionally after a cancelled picker), render a 'Can't connect? Troubleshooting' link/button next to the error that fires the existing showConnectionHelp command. One-line wiring; the content already exists.

#### S12-F3 [MINOR] Shortcut references drifted from shipped shortcuts — again, and the doc says the opposite of the code

_Area: workflow · Effort: S_

shortcuts.ts ships Ctrl+C/X/V scene clipboard (scene-clipboard-actions.ts exists with tests), Ctrl+G/Ctrl+Shift+G group/ungroup, and Ctrl+Shift+B Convert to Bitmap — none of which appear in the ShortcutsDialog data (shortcut-list.ts) or its hover hint. WORKFLOW.md F-A15 still says 'Cmd/Ctrl+X — Cut (not implemented)' and 'no scene-object clipboard yet'. The shortcut-list.ts header even warns a prior audit (M27/A.5) caught the same class of omission; there is no coverage test keeping it in sync (unlike help-topics.test.ts).

- **Evidence:** src/ui/app/shortcuts.ts:199-226,317-320; src/ui/state/scene-clipboard-actions.ts:23-25; src/ui/common/shortcut-list.ts:1-93 (no clipboard/group/bitmap rows); WORKFLOW.md:485-487
- **LightBurn reference:** LightBurn documents its full shortcut set (Ctrl+G group, Ctrl+Shift+B convert to bitmap) in its help; KerfDesk deliberately adopted those LightBurn bindings but hides them from its own reference.
- **Recommendation:** Add the missing rows to shortcut-list.ts, correct WORKFLOW.md F-A15, and add a registry-style sync test (mirror help-topics.test.ts) asserting every binding in shortcuts.ts/use-job-shortcuts.ts appears in shortcutFamilies().

#### S12-F4 [MINOR] Import toasts leak stale internal roadmap jargon ('wait for Phase D', 'Phase E will support these')

_Area: workflow · Effort: S_

SVG import still ignores <text> and <image> elements (parse-svg.ts counts them), and the info toasts tell users to 'convert to paths, or wait for Phase D' and that 'Phase E will support these'. Phases D and E shipped long ago (the app has an Add Text tool and a raster Import Image command in the toolbar; CONTRIBUTING.md says shipped through Phase K). A user cannot know what 'Phase D' means, and the promise is stale — the features exist via other doors.

- **Evidence:** src/ui/app/import-toasts.ts:41,49; src/io/svg/parse-svg.ts:35-36,468-469; src/ui/common/Toolbar.tsx:122-137 ('tools.add-text', 'file.import-image'); CONTRIBUTING.md:3
- **LightBurn reference:** LightBurn imports SVG text/images or reports the limitation in user terms; it never references internal roadmap phases in UI copy.
- **Recommendation:** Reword to actionable copy: 'text elements ignored — convert to paths in your design tool, or use Tools → Add Text' and 'embedded images ignored — import the image file directly (File → Import Image)'.

#### S12-F5 [MINOR] WORKFLOW F-C7 has drifted from the shipped Device Setup wizard

_Area: workflow · Effort: S_

F-C7 documents six steps (Connect & read → Identify → Confirm → Placement & safety → Sync → Review); the code has seven — a 'Set work zero (probe)' step is undocumented, and step 4 is titled 'Homing & options', not 'Placement & safety'. F-C7's empty state also claims the readiness checklist flags 'every safety item (bed, origin, power scale, homing, identity)' as needing attention, but the code hardcodes identity, origin, and homing as always confirmed/non-blocking — only bed and power-scale block Finish.

- **Evidence:** WORKFLOW.md:817,829-830; src/ui/laser/device-setup/device-setup-flow.ts:29-37; src/ui/laser/device-setup/DeviceSetupWizard.tsx:35-43; src/ui/laser/device-setup/device-setup-readiness.ts:67-75,148-168
- **Recommendation:** Update F-C7 to the seven-step order and the actual blocking/informational split (WORKFLOW.md is declared the source of truth; UI changes contradicting it require a doc update first per its own header).

#### S12-F6 [MINOR] Brave caveat specified in WORKFLOW is missing from every shipped message

_Area: workflow · Effort: S_

WORKFLOW.md specifies the WebSerial-unsupported message as '…Chrome, Edge, Brave (may require enabling under Brave Shields/flags), or Arc…'. The shipped strings list Brave with no caveat (LaserWindow hint, connection help text), and the wizard's connect step says only 'use Chrome or Edge'. If Brave ships with Web Serial gated (as the doc asserts), a Brave user passes the isSupported() check yet gets an empty/blocked picker with no hint. Three surfaces also give three different browser lists.

- **Evidence:** WORKFLOW.md:36; src/ui/laser/LaserWindow.tsx:119-122; src/ui/help/connection-help.ts:12-14; src/ui/laser/device-setup/DeviceSetupConnectStep.tsx:64-68
- **LightBurn reference:** Not applicable (LightBurn is native and needs no browser guidance) — this is an internal doc-vs-code contract drift.
- **Recommendation:** Verify Brave's current Web Serial default on hardware, then either add the caveat to the shipped strings and the troubleshooting doc, or correct WORKFLOW.md; unify the browser list across the three surfaces from one constant.

#### S12-F7 [MINOR] Beginner mode exists only for CNC; the laser side has no simplified disclosure

_Area: ui-layout · Effort: L_

ADR-111's Basic/Advanced disclosure is a well-placed, default-on design (beginners get Basic without finding anything; the 'Advanced cut settings' checkbox lives in the Cuts/Layers panel and persists), but CncAdvancedToggle returns null outside CNC mode and no equivalent exists for laser layer cards, which always expose every field. ADR-111 scopes itself to CNC explicitly, so the laser gap is unaddressed rather than deliberately rejected.

- **Evidence:** src/ui/layers/CncAdvancedToggle.tsx:10-14; src/ui/layers/CutsLayersPanel.tsx:47; src/ui/state/ui-store.ts:194-196,231-235; DECISIONS.md:4998-5030; WORKFLOW.md:2301-2321
- **LightBurn reference:** LightBurn offers an app-wide Beginner Mode toggle in Settings that simplifies laser-side surfaces (stated from general knowledge; not verified against a LightBurn install this session).
- **Recommendation:** Design a laser-side Basic/Advanced disclosure for the layer cut-settings cards reusing the persisted-flag pattern (a second ui-store flag or a shared one), keeping Basic = mode/power/speed/passes.

#### S12-F8 [MINOR] Help menu contents lag the marketed feature set — no in-app path to any feature guide

_Area: ui-layout · Effort: S_

The Help menu has exactly three entries (About, Can't connect?, Safety & liability). The features the README markets hardest — Place Board, Registration Jig, tracing modes, camera alignment — have no in-app help beyond tooltips, and there is no 'Online documentation' link to kerfdesk.com or the GitHub README, so the substantial getting-started material is invisible from inside the app. docs/ holds only the two guides.

- **Evidence:** src/ui/commands/command-families.ts:382-410 (the full help family); src/ui/commands/command-types.ts:94-96; docs/ glob (connection-troubleshooting.md, safety.md only); README.md:22-82
- **LightBurn reference:** LightBurn's Help menu links to documentation, quick-start guides, and community/support resources.
- **Recommendation:** Add a 'Help → Online documentation' command that opens the hosted README/docs URL (external link, S effort), and consider a Keyboard Shortcuts entry in the Help menu mirroring the toolbar button for discoverability.

#### S12-F9 [POLISH] help-topics.ts is past the soft file-size limit and mixes registry types with two data tables

_Area: architecture · Effort: S_

help-topics.ts is 388 raw lines, the bulk being the TOOL_HELP/MENU_HELP/CONTROL_HELP literals plus the id-type unions and helper functions — comfortably past the 250 counted-line soft limit (though under the 400 hard cap). COMMAND_HELP was already extracted to command-help-topics.ts; the CONTROL_HELP table (145-335) is the obvious next extraction.

- **Evidence:** src/ui/help/help-topics.ts:19-62,145-335 (wc -l: 388); src/ui/help/command-help-topics.ts (315 lines, prior extraction)
- **Recommendation:** Extract CONTROL_HELP (and its key union) to control-help-topics.ts mirroring the existing command-help-topics.ts split; re-export from help-topics.ts to keep call sites stable.

### Not verified in this sector

- Any rendered appearance or live behavior — no dev server, build, or test run this session; all findings are from static reading of source, docs, and git log.
- Brave's actual current default for Web Serial (whether a flag/shield toggle is required) — WORKFLOW.md:36 asserts it, but I could not verify browser behavior in-session.
- LightBurn's exact Beginner Mode scope and Help-menu contents — stated from general knowledge, not checked against a LightBurn install this session.
- Electron desktop behavior of PwaUpdatePrompt / service-worker registration (virtual:pwa-register inside the desktop shell) — whether registration fails benignly or logs errors on every launch.
- Whether kerfdesk.com hosts any documentation outside the app bundle (which would mitigate the dead docs/ references).
- ESLint counted-code line numbers for help-topics.ts (raw wc -l only; lint was not run).
- Device Setup wizard behavior against real hardware ($$ read on connect, firmware writes, origin-corner G-code flip) — ADR-092 itself records these as hardware-unverified (DECISIONS.md:3418-3421).
- The visual quality of the startup splash and empty-workspace first paint (main.tsx splash logic read, not observed).

## 13. Performance & robustness (static analysis) — grade B-

KerfDesk's performance architecture is deliberate and mostly sound: heavy trace/rasterization runs in timeout-guarded Web Workers, a layered budget system (4M-px raster cap, 100k/20k compile-complexity gates, 2048px decode cap, oversized-line refusal) refuses work before it can freeze the tab, canvas strokes are batched per color with a cached decimation parachute and an honest "display simplified" notice, and undo is interaction-scoped over capped, structurally-shared snapshots. The debt is concentrated in a handful of hot loops the guardrails don't cover: three object-returning Zustand selectors (currentOutputScope) re-render the App root and the CNC 3D pane on every store update — in CNC mode recomputing a full compile + removal grid per mousemove; the preview toolpath recompiles on the main thread every 250 ms status poll while connected (blanking the route each cycle); the GRBL streamer's queued.slice(1) makes long raster jobs O(N^2) in total array copying; and the image-mode compile path is uncached with a character-at-a-time base64 decoder, unlike the fills which got ADR-050's bounded caches. Fixes are mostly small and surgical (stable selector keys, an index cursor, a raster-luma cache), and none of the findings are safety- or G-code-correctness-affecting — they are responsiveness and memory issues that surface exactly in the flagship scenarios: a photo engrave with Preview open on a connected machine, and CNC-mode editing.

### What's great

- **Heavy trace and vector-rasterization work runs in Web Workers with defensive lifecycles** — The full trace pipeline (preprocess + contour/centerline/edge trace) runs in a dedicated module worker, and Convert-to-Bitmap has its own worker for rasterization + PNG/luma encoding. Both clients have 30 s timeouts that terminate a hung worker and reject all pending callers, crash-retirement with fresh-worker recovery on the next call, and bounded inline fallbacks (160k px trace / 500k px convert) so a worker failure degrades instead of freezing. The live trace preview is debounced 300 ms so slider drags don't thrash the worker. _(src/ui/trace/trace-worker.ts:1-61; src/ui/trace/use-trace-worker-client.ts:39-119,165-196; src/ui/raster/convert-bitmap-worker-client.ts:12-13,44-104; src/ui/trace/use-trace-preview.ts:49)_
- **Layered refuse-before-freeze budget system** — Work that could freeze the tab is bounded by explicit, named budgets checked BEFORE allocation: raster compile refuses over 4 M target pixels / 64 MB working set (with the byte-per-pixel accounting documented), preview/estimate compile is gated by cheap raw-scene segment counters (100k raw / 20k estimated-fill) before any hatching or optimization runs, image decode for trace is capped at a 2048 px edge, inline trace at 160k px, and a G-code line longer than the RX buffer is refused at Start instead of silently jamming the streamer at 0/N. _(src/core/raster/raster-budget.ts:12-70; src/core/job/preparation-complexity.ts:17-27; src/ui/workspace/draw-preview.ts:129-130; src/ui/trace/image-loader.ts:27; src/core/controllers/grbl/streamer.ts:125-140; src/ui/state/laser-job-actions.ts:64-73)_
- **Design-canvas rendering has real, documented perf engineering: batched strokes + cached decimation with an honest UI notice** — Vector strokes are batched to one beginPath/stroke per color (the comment records the 5000-stroke post-import freeze this fixed), oversized scenes are decimated through a WeakMap-keyed display cache that preserves connectivity (endpoint-keeping vertex stride, fixing the earlier 'disconnected dashes' artifact), and the user is told 'Large scene - display simplified for performance' rather than being shown silently degraded geometry. The 120k threshold raise is justified with measurements in the comment. _(src/ui/workspace/draw-scene.ts:363-370; src/ui/workspace/display-polylines.ts:20-69; src/ui/workspace/draw-complexity.ts:1-26; src/ui/workspace/draw-vector-strokes.ts:43-61)_
- **The per-mousemove-recompile class of bug has been found, fixed, and memorialized in code** — useJobEstimate carries an in-code post-mortem (audit H16) of the exact pathology — dragging re-ran compile incl. the raster pipeline once per mousemove — and fixes it with a 250 ms trailing debounce plus a synchronous first render. The same discipline shows elsewhere: numeric fields commit through useDebouncedCommit app-wide, the wheel handler subscribes once and reads state at event time, and Workspace deliberately uses three primitive selectors with a comment explaining why a bundled object selector would force redraws. _(src/ui/laser/use-job-estimate.ts:1-16,35-45; src/ui/common/NumberField.tsx:21-31; src/ui/workspace/use-workspace-wheel.ts:1-44; src/ui/workspace/Workspace.tsx:123-135)_
- **Interaction-scoped undo with a capped, structurally-shared history** — Drags snapshot the project once at beginInteraction and push a single undo entry at endInteraction — per-mousemove setObjectTransform mutations never enter history, and Esc rolls back to the snapshot without polluting the stack. The undo/redo stacks hold immutable Project references (spread-based structural sharing, so unchanged objects/rasters are shared, not copied) and are capped at 50 entries; console log and serial transcript are similarly capped at 200/500. _(src/ui/state/store-actions.ts:15,102-137,218-243; src/ui/state/scene-mutations.ts:28,72-74; src/ui/state/laser-store-helpers.ts:17,31-33; src/ui/state/laser-transcript.ts:4,49)_
- **Streaming robustness is modeled as a pure, terminal-absorbing state machine** — The GRBL streamer is a pure reducer with discriminated statuses where terminal states absorb late acks (trailing oks after error:N cannot report a clean finish), alarms wipe in-flight accounting so dead-stream acks can't be claimed, an untracked-ack ledger prevents phantom RX-budget refills, and uncommanded reboots mid-job are detected via the banner and error the stream instead of leaving a live progress bar. Autosave pauses during streaming so the render/ack loop owns the CPU. _(src/core/controllers/grbl/streamer.ts:142-151,199-243,285-294; src/ui/state/laser-stream-ack.ts:22-28; src/ui/state/laser-line-handler.ts:182-199; src/ui/state/autosave.ts:11,155)_

### Findings

#### S13-F1 [MAJOR] CNC 3D pane recomputes full compile + removal grid on every store update (defeated memoization)

_Area: mechanism · Effort: S · verified: CONFIRMED_

Cnc3DPane subscribes with `useStore((s) => currentOutputScope(s))`, a selector that builds a fresh object every call (store.ts:414-423). Zustand 4.5 (package.json:52) uses Object.is equality, so the pane re-renders on EVERY useStore update — including `setCursorMm`, which fires on every pointer-move over the canvas even when just hovering (use-workspace-drag.ts:298-299, store-actions.ts:203). The fresh `outputScope` is then a dep of useDesignRemovalGrid's useMemo (Cnc3DPane.tsx:103), so the memo body — a synchronous buildPreviewToolpath (compile + optimize) plus computeRemovalGrid over a ~500x500-cell grid (Cnc3DPane.tsx:76-102) — re-runs per store update while in CNC mode with the pane expanded. The `useDeferredValue(project)` mitigation (line 34, commented 'deferred so typing stays snappy') is fully defeated. In laser mode the body early-returns (line 75), so this is CNC-only.

- **Evidence:** src/ui/workspace/Cnc3DPane.tsx:32,34,73-103; src/ui/state/store.ts:414-423; src/ui/state/store-actions.ts:203; src/ui/workspace/use-workspace-drag.ts:298-299; package.json:52
- **LightBurn reference:** Not applicable (Easel-style pane); the relevant parity bar is that design-canvas interaction stays fluid, which LightBurn maintains during any drag.
- **Recommendation:** Memoize the output scope by value (e.g. select a stable string key, or wrap with useShallow / a custom equality), and make the useMemo key the deferred project + that stable key. One-line class of fix at each of the three currentOutputScope call sites.

#### S13-F2 [MAJOR] Preview toolpath fully recompiles every 250 ms status poll while a machine is connected

_Area: mechanism · Effort: S · verified: CONFIRMED_

usePreviewToolpath subscribes to `statusReport` and lists it in its rebuild effect deps (use-preview-toolpath.ts:29,45-85). Every 250 ms status poll (laser-connection-actions.ts:40 STATUS_POLL_MS=250, :221 setInterval) stores a brand-new report object (laser-status-line.ts:141 `statusReport: report`), so with Preview open and a controller connected the effect re-runs 4x/second: it calls setToolpath(null) (blanking the route for at least one paint) then re-runs prepareOutput → compileJob → optimize → buildToolpath on the main thread via setTimeout(0) (use-preview-toolpath.ts:50-70,90-93; draw-preview.ts:116-148). resolveJobPlacement only needs position data for 'current-position'/origin modes (job-placement.ts:39-55), and in the default 'absolute' mode the resolved placement is identical across polls — the recompiles are pure waste. Compounds with the uncached raster compile (next finding) into continuous main-thread load during a running job with Preview open.

- **Evidence:** src/ui/workspace/use-preview-toolpath.ts:29,45-93; src/ui/state/laser-status-line.ts:130-147; src/ui/state/laser-connection-actions.ts:40,221; src/ui/job-placement.ts:39-55
- **LightBurn reference:** LightBurn's Preview is computed once when opened and does not visibly recompute or flicker while a controller is connected; KerfDesk diverges.
- **Recommendation:** Depend on the *resolved placement* (or only the specific fields the active startFrom mode needs), not the raw statusReport object; skip setToolpath(null) when the rebuild inputs are value-equal to the previous build.

#### S13-F3 [MAJOR] App-root re-render storm: object-returning selector in useShortcuts re-renders the whole tree per mousemove

_Area: architecture · Effort: S · verified: CONFIRMED_

useShortcuts — mounted at the App root (App.tsx:44) — subscribes with `useStore((s) => currentOutputScope(s))` (use-shortcuts.ts:45). Because the selector returns a fresh object each call, App re-renders on every useStore update: every pointer-move over the canvas (setCursorMm), every drag transform tick, every selection change. It also subscribes to laser-store statusReport/wcoCache (use-shortcuts.ts:70-72), adding a 4 Hz App re-render while connected. None of App's children (CommandShell, ToolStrip, CutsLayersPanel, LaserWindow, dialogs — App.tsx:51-75) are memoized, so each of these is a full-tree React reconcile. The canvas redraw effect itself is guarded by primitive deps (Workspace.tsx:123-125 documents this exact discipline), so this wastes CPU on reconciliation rather than repainting — but at pointermove rate it is the dominant React cost of simply moving the mouse. use-job-estimate.ts:26 has the same selector inside Workspace.

- **Evidence:** src/ui/app/use-shortcuts.ts:45,70-72; src/ui/app/App.tsx:44,51-75; src/ui/state/store.ts:414-423; src/ui/laser/use-job-estimate.ts:26; src/ui/workspace/Workspace.tsx:123-135
- **Recommendation:** Shortcut handlers should read state at event time via useStore.getState() (the pattern use-workspace-wheel.ts:26-40 already uses) instead of subscribing; alternatively subscribe with a shallow/value-equal selector. Audit the three currentOutputScope subscription sites together.

#### S13-F4 [MAJOR] GRBL streamer queue is O(N^2) over a job: queued.slice(1) copies the whole remaining array per line sent

_Area: mechanism · Effort: M · verified: CONFIRMED_

The pure streamer holds `queued: ReadonlyArray<string>` and step() advances with `queued = queued.slice(1)` inside its send loop (streamer.ts:162-176). step() runs on every ack (laser-stream-ack.ts:40), so each refill copies the entire remaining queue. For an N-line job total work is O(N^2) array copying on the main thread: a photo raster engrave can emit hundreds of thousands to millions of lines, so early in the job each single ack triggers a copy of a ~10^5-10^6-element array — a multi-MB memcpy per line at GRBL ack rates, concurrent with UI rendering. Each ack additionally performs two store set() calls (recordInboundLine's log[200-cap]+transcript[500-cap] copies, laser-line-handler.ts:81-100, then advanceStream's set), so per-ack constant costs stack on top. Vector jobs (thousands of lines) are fine; big raster jobs degrade progressively.

- **Evidence:** src/core/controllers/grbl/streamer.ts:48-62,162-176; src/ui/state/laser-stream-ack.ts:37-45; src/ui/state/laser-line-handler.ts:81-100; src/ui/state/laser-store-helpers.ts:17,31-33
- **LightBurn reference:** LightBurn streams large raster jobs for hours without the sender UI degrading; a sender whose per-line cost grows with remaining job size diverges from that bar.
- **Recommendation:** Keep the state machine pure but replace the shrinking array with a frozen lines array plus a head-index cursor (queuedIndex); onAck's inFlight slice(1) is buffer-bounded and fine. This preserves determinism and the existing tests' semantics.

#### S13-F5 [MAJOR] Raster (image-mode) compile is uncached and its pure-JS base64 decode is pathologically slow

_Area: mechanism · Effort: M · verified: CONFIRMED_

compileRasterGroup re-runs the full pipeline on every compile with zero memoization: decodeBase64Luma → applyLumaAdjustments → resampleLumaNearest → mask → orient → dither (compile-job-raster.ts:36-97). decodeBase64Luma avoids atob for core purity but does `BASE64_ALPHABET.indexOf(char)` per character and cleanBase64Luma builds a multi-megabyte string via `clean += char` one character at a time (compile-job-raster.ts:145-183) — for a 4 M-px image (~5.3 M base64 chars) this alone is tens of millions of operations. Fills got exactly this treatment via ADR-050's bounded WeakMap caches (compile-job.ts:38-43, fill-hatching-cache.ts:4-10), but rasters did not. Every prepareOutput consumer pays it: preview rebuild (draw-preview.ts:131), the 250 ms-debounced live estimate (use-job-estimate.ts), job-intent warnings and MachineSetupRasterDiagnostics which each call compileJob independently (job-intent-warnings.ts:50, MachineSetupRasterDiagnostics.tsx:125), save, and Start. Combined with the statusReport rebuild loop this dithers a 4 M-px image 4x per second.

- **Evidence:** src/core/job/compile-job-raster.ts:36-97,145-183; src/core/job/compile-job.ts:38-43; src/core/job/fill-hatching-cache.ts:4-10; src/ui/laser/job-intent-warnings.ts:50; src/ui/laser/MachineSetupRasterDiagnostics.tsx:125
- **Recommendation:** Extend the ADR-050 pattern: a WeakMap keyed on the RasterImage object with a settings-string sub-key, output-invariant and count-capped, covering at least the decoded luma (decode dominates) if not the dithered sValues. Replace char-wise indexOf/concat with a 256-entry lookup table writing directly into the output Uint8Array.

#### S13-F6 [MINOR] Raster-preview canvas cache grows without bound across settings changes

_Area: mechanism · Effort: S_

previewCanvasCache keys entries by dataUrl PLUS every burn setting (power, minPower, linesPerMm, dither, negative, mask hash — draw-raster-preview.ts:108), but pruneRasterPreviewCache only evicts entries whose dataUrl is no longer live (draw-raster-preview.ts:70-79). Each entry is a full-resolution canvas (up to 4 M px ≈ 16 MB RGBA). Stepping a power or lines/mm control through N values while Preview is open accumulates N full-size canvases for the lifetime of the image in the scene — scrubbing a slider through 50 values can pin ~800 MB. The sibling caches (rasterImageCache, tintedTraceSourceCache, draw-raster.ts:21-43) are keyed by dataUrl only and prune correctly.

- **Evidence:** src/ui/workspace/draw-raster-preview.ts:40-41,70-79,98-135; src/ui/workspace/draw-raster.ts:21-43
- **Recommendation:** Keep at most one (or a small LRU of) settings-variant per dataUrl: on insert, delete other keys sharing the same entry.dataUrl. The key already embeds the dataUrl so this is a small change in schedulePreviewCanvasBuild.

#### S13-F7 [MINOR] Preview route rendering re-slices the toolpath and issues one stroke() per step every playback frame

_Area: mechanism · Effort: M_

During rAF playback (use-preview-playback.ts:42-61 advances scrubberT per frame), each frame calls sliceToolpath — a linear scan that also materializes a fresh `whole` array of all completed steps (toolpath-slice.ts:9-29) — and drawPreview draws the future ghost + completed steps with a separate beginPath/stroke per step and per-travel setLineDash toggles (draw-preview.ts:100-113,154-193,242-287). This is the same one-stroke-per-primitive pathology the design canvas fixed with per-color batching — draw-scene.ts:363-370 documents that 5000 strokes per redraw froze the canvas, and draw-complexity.ts:1-10 notes the 120k budget assumes ONE batched stroke. drawWholeSteps only decimates above 120k steps, so up to 120k stroke() calls per frame are permitted. drawObjectsFaint additionally bypasses the display-polyline cache, re-counting and re-decimating every frame (draw-preview.ts:80 calls buildDisplayPolylines directly vs draw-scene.ts:375-380 which uses the WeakMap cache).

- **Evidence:** src/ui/workspace/draw-preview.ts:80,100-113,154-193,242-287; src/core/job/toolpath-slice.ts:9-29; src/ui/workspace/draw-scene.ts:363-380; src/ui/workspace/draw-complexity.ts:1-10; src/ui/workspace/use-preview-playback.ts:42-61
- **LightBurn reference:** LightBurn's preview scrubs and plays smoothly on dense raster/fill jobs.
- **Recommendation:** Precompute cumulative step lengths once per toolpath and binary-search the cut index per frame (no array rebuild); batch cut strokes into one path per color and travels into one dashed path; route drawObjectsFaint through the DisplayPolylineCache.

#### S13-F8 [MINOR] Autosave serializes the whole project synchronously to localStorage — janks and silently ceases to protect photo-heavy projects

_Area: workflow · Effort: M_

Every 30 s while dirty, startAutosaveLoop runs serializeProject + JSON.stringify + a synchronous localStorage.setItem on the main thread (autosave.ts:66-93,147-160). The file's own header notes the ~5 MB localStorage cap (autosave.ts:10). A project containing one imported photo (dataUrl + lumaBase64 easily several MB) both (a) blocks the main thread for the serialize/write each tick and (b) permanently fails with 'quota' — the failure is surfaced via onWriteFailure, but the practical result is that exactly the projects with the most invested work have no crash recovery. Streaming pause (line 155) is good discipline.

- **Evidence:** src/ui/state/autosave.ts:1-14,29,66-93,147-160
- **LightBurn reference:** LightBurn's timed backup writes project files to disk and is not bounded by a browser storage quota; KerfDesk's web build cannot match that with localStorage.
- **Recommendation:** Move autosave to IndexedDB (async, hundreds of MB) with the serialize step chunked or moved to a worker; keep localStorage only as a legacy fallback. Surface the quota failure as a persistent banner, not a transient toast, since it means recovery is off.

#### S13-F9 [MINOR] WORKFLOW.md documents a 10,000-segment display-simplification threshold; code uses 120,000 (doc drift)

_Area: workflow · Effort: S_

WORKFLOW.md:318 states '> 10,000 path segments: warning shown … the canvas renders a bounded display sample'. The code deliberately raised the budget to 120,000 because the 10k budget tripped on a single traced logo (draw-complexity.ts:6-10, LARGE_SCENE_SEGMENT_THRESHOLD = 120_000), with the rationale recorded only in the code comment. WORKFLOW.md:323 also claims raster-sim live updates land 'within the same 100 ms budget' — I found no enforced 100 ms budget in the preview rebuild path (draw-raster-preview.ts schedules via setTimeout(0) with no deadline). Per this audit's rules, drift between WORKFLOW.md intent and code is a finding even when the code is the better answer.

- **Evidence:** WORKFLOW.md:318,323; src/ui/workspace/draw-complexity.ts:6-10; src/ui/workspace/draw-raster-preview.ts:115-157
- **Recommendation:** Update WORKFLOW.md to the 120k threshold and either implement or delete the 100 ms raster-sim claim.

#### S13-F10 [MINOR] Canvas is fully cleared and redrawn on every state change with no rAF coalescing

_Area: mechanism · Effort: M_

drawScene starts with clearRect and repaints bed, grid, stock, no-go zones, all objects, overlays and rulers on every draw-effect run (draw-scene.ts:85-141); the effect fires per relevant store change (Workspace.tsx:248-296) with no requestAnimationFrame coalescing, so two same-tick updates that escape React batching paint twice. Mitigations are real — batched strokes, WeakMap display cache, decimation — but structural costs remain per frame: drawGrid issues one beginPath/stroke per grid line (draw-scene.ts:226-241, ~300 strokes on a large bed), strokePolylinesBatched re-applies the object transform to every vertex in JS per frame instead of using ctx.setTransform (draw-vector-strokes.ts:14-24,78-81), and liveRasterDataUrls + pruneRasterImageCaches rebuild a Set over all objects per frame (draw-scene.ts:93,200-206). At the 120k-segment ceiling during a drag this is ~120k JS transform ops + Path2D appends per pointermove.

- **Evidence:** src/ui/workspace/draw-scene.ts:85-141,226-241,200-206; src/ui/workspace/Workspace.tsx:248-296; src/ui/workspace/draw-vector-strokes.ts:8-25,78-81
- **Recommendation:** Lowest-cost wins in order: batch the grid into one path; wrap the draw effect body in a one-frame rAF coalescer; longer term, cache static layers (bed/grid/rulers) to an offscreen canvas keyed on view+bed, and use ctx.setTransform per object so vertex mapping happens in the rasterizer.

#### S13-F11 [POLISH] CNC preview scrub recomputes the removal grid from scratch per bucket

_Area: mechanism · Effort: M_

useCncRemovalGrid quantizes scrubberT into 120 buckets so a drag reuses memoized results (use-cnc-removal-grid.ts:21,34) — but each NEW bucket recomputes the entire ~1M-cell grid from length 0 up to the cut length (uptoLengthMm, line 62), inside useMemo on the render path. During playback that is ~4 full-grid recomputes/second; scrubbing backwards recomputes buckets already visited earlier in the drag (useMemo holds only the last value).

- **Evidence:** src/ui/workspace/use-cnc-removal-grid.ts:21-66
- **Recommendation:** Make the simulation incremental: keep the previous bucket's grid and stamp only the toolpath interval since, recomputing from zero only when scrubbing backwards; or move grid computation off-render into an effect + worker.

### Not verified in this sector

- No runtime measurements were taken (read-only audit, no dev server): all frame-rate, compile-duration, memory-growth and streaming-throughput claims are derived from static call-path analysis, not profiling.
- Actual GRBL ack rates for dense raster jobs (which set the constant factor on the O(N^2) streamer finding) were not measured against real hardware.
- Whether the browser coalesces pointermove events to <=1 per frame in this app (affects the magnitude, not existence, of the per-mousemove re-render findings).
- The perceptual quality of the 120k-budget decimated display and of the raster burn simulation vs LightBurn — requires the perceptual harness / a rendered comparison, per ADR-025 and CLAUDE.md rule 2.
- LightBurn's internal implementation of preview caching, autosave and streaming — only its user-observable behavior (no preview flicker while connected, disk-based timed backup, no sender degradation on long jobs) is asserted.
- Electron/platform serial transport performance (platform/ was outside this sector's directories).
- Real memory footprint of the 50-snapshot undo stack on large projects (structural sharing via spread was verified in code, e.g. store-actions.ts:295-305, but not measured).
- Whether the workbox/PWA precache of worker chunks affects first-trace latency (io/pwa outside scope).

## 14. Test & CI quality — grade B+

KerfDesk's test infrastructure is unusually deliberate for a project this size: a four-layer taxonomy (663 test files / ~3,940 statically-counted cases) of unit tests, fast-check property suites (29 files use fast-check; 100-seed fuzz on determinism, laser-off, bounds, power-scale, per-layer settings, registration placement), byte-pinned G-code snapshots that route through the exact shipped Save/Start composition, and an ADR-025 perceptual harness with analytic ground truth whose measuring instruments are themselves tested first. CI is a single Linux job running the full release gate (typecheck, eslint incl. boundary/purity/size rules, repo-wide prettier, license and dependency audit, tests, both builds, and the 600-raw-line backstop), with deploy correctly gated on CI success and SHA-pinned. The main weaknesses are enforcement-by-convention where CLAUDE.md claims CI enforcement (the snapshot-acknowledgment and tests-with-source gates exist only in PR review), a coverage asymmetry that concentrates fuzz and byte-pinning on the GRBL dialect while Marlin/Smoothie get one laser-off fixture each, zero perceptual coverage for raster/Image-mode engraving and the camera pipeline, and the complete absence of any browser-level E2E harness for a canvas-centric app whose jsdom tests deliberately stub canvas to a no-op. Safety-critical G-code invariants 1/3/5/7 are genuinely property-tested; invariants 2/4/6 are example-tested only, with the Save-path no-partial-output behavior untested.

### What's great

- **Production-composition G-code snapshot corpus that pins exactly what the machine runs** — emit-gcode.snapshot.test.ts explicitly documents and closes the classic hole where snapshots pin a test-only pipeline: it routes fill+overscan (donut with hole), raster threshold dither, mixed line/fill/image, curve flattening, user-origin placement, and a multi-tool CNC pocket+tabbed-profile job through the exact Save/Start composition (prepareOutput -> strategy -> preflight). Its header states the rationale: 'Any change to these snapshots is a change to what the machine runs.' The companion emit-gcode-layer-settings.snapshot.test.ts adds three-modes-three-different-settings byte-pinning to catch layers swapping each other's power/speed — a gap found by audit and closed with a targeted corpus entry. _(src/io/gcode/emit-gcode.snapshot.test.ts:1-14,184-204,239-312; src/io/gcode/emit-gcode-layer-settings.snapshot.test.ts:1-7)_
- **Reusable invariant predicates applied uniformly across property, snapshot, and dialect tests** — core/invariants/predicates.ts implements the safety invariants (laser-off-on-travel with sticky-S and M107 Marlin semantics, bounds, expected-S power scale) as pure Issue-returning predicates, deliberately liberal in parsing so they can validate G-code from any source. The same functions back the 100-seed fuzz suites, every snapshot corpus's invariant block, the Marlin/Smoothie unit tests, and (per the file comment) runtime preflight — one instrument, one definition of 'safe', everywhere. _(src/core/invariants/predicates.ts:1-157; used in grbl-strategy.property.test.ts, pipeline.snapshot.test.ts:64-92, emit-gcode.snapshot.test.ts:206-232, marlin-strategy.test.ts:64)_
- **Perceptual harness with analytic ground truth and instrument-first discipline (ADR-025)** — The trace/fill perceptual harness rasterizes pipeline output and IoU-compares against ground truth that is computed from the same closed-form predicate that generated the source image — so truth cannot drift and no golden PNGs need re-blessing. The rasterizer and comparator are themselves pinned against hand-computed pixel counts BEFORE being trusted to judge the tracer (rasterize.test.ts, compare.test.ts). Fill is verified both at the toolpath level and by parsing the emitted G-code back into a burn mask (rasterizeGcodeBurn handles modal state, comments, compact words — itself unit-tested), and V-carve is proven against an analytic pyramid-frustum groove. _(DECISIONS.md:866-925 (ADR-025); src/__fixtures__/perceptual/compare.ts:1-30; toolpath-rasterize.test.ts:27-70; gcode-rasterize.test.ts:7-55; src/core/cnc/vcarve-perceptual.test.ts:18-22)_
- **Firmware simulators over a fake serial port drive full UI-lifecycle tests for three controller families** — src/__fixtures__/controllers wires a pure GRBL firmware reducer onto a fake serial port with setTimeout-scheduled responses (real latency ordering under fake timers), exposing alarm injection (triggerAlarm) and cable-yank simulation; Marlin and Smoothie simulators plus a Ruida decoder exist alongside. These drive laser-lifecycle simulator tests in ui/state for all three dialects — protocol-level integration coverage of connect/stream/alarm/disconnect without hardware. _(src/__fixtures__/controllers/grbl-simulator.ts:1-39; consumers: src/ui/state/laser-lifecycle.simulator.test.ts, laser-lifecycle-marlin.simulator.test.ts, laser-lifecycle-smoothie.simulator.test.ts, src/core/controllers/ruida/ruida.test.ts)_
- **Flake mitigations are unit-tested policy modules with measured rationale, not magic numbers** — ciBudgetMs (CI-vs-local wall-clock budgets) and vitestMaxWorkers (1 on CI to keep a core free for vitest's orchestrator on the 2-vCPU runner; 4 locally) each live in src/__fixtures__ with co-located tests (ci-budget.test.ts, vitest-workers.test.ts) and comments citing the measured failure they prevent ('4 workers -> two onTaskUpdate timeouts, 2 -> one'). They read process.env per-call to stay order-independent, and live outside src/core deliberately because core tests cannot touch `process` — the flake fix respects the purity architecture. _(src/__fixtures__/ci-budget.ts:1-32; src/__fixtures__/vitest-workers.ts:1-25; vitest.config.ts:19-22)_
- **Deploy pipeline is race-proof: gated on CI success and pinned to the validated SHA, with a repo-identity guard** — deploy.yml triggers on workflow_run completion of CI on main, checks the conclusion, and checks out github.event.workflow_run.head_sha explicitly — with a comment explaining that GITHUB_SHA would otherwise deploy a different commit than the one CI validated (push race / stale re-run). It then re-runs the full release:check before publishing. scripts/assert-correct-repo.mjs additionally verifies the origin remote and worktree-aware folder identity before any release run, defending against deploying a look-alike checkout. _(.github/workflows/deploy.yml:12-16,38,42-49,71-72; scripts/assert-correct-repo.mjs:12-58)_

### Findings

#### S14-F1 [MAJOR] "Snapshot change acknowledged" and "source-without-tests" gates are claimed as CI-enforced but are convention-only

_Area: workflow · Effort: S · verified: CONFIRMED_

CLAUDE.md states "CI rejects PRs that: Modify source without modifying or adding tests... Modify the G-code snapshot without an explicit acknowledgment line in the PR description: Snapshot change acknowledged: <reason>". The actual CI (ci.yml) is a single job that runs `pnpm release:check`; no workflow step reads the PR description, and a repo-wide grep for 'Snapshot change acknowledged' matches only docs and test-file comments (CONTRIBUTING.md:17, pipeline.snapshot.test.ts:9-11, emit-gcode.snapshot.test.ts:10, CLAUDE.md). A G-code snapshot can be re-recorded and merged with no acknowledgment if human review slips — and G-code snapshots are the project's stated last line of defense for silently-wrong machine output (PROJECT.md success metric: "A fix that changes G-code output produces a visible snapshot diff in CI" — the diff exists, but nothing forces it to be acknowledged).

- **Evidence:** .github/workflows/ci.yml:16-46; package.json release:check script; CONTRIBUTING.md:17; src/io/svg/pipeline.snapshot.test.ts:8-11; grep of .github/ for 'acknowledged' = no matches
- **Recommendation:** Add a tiny CI step (pull_request event) that, when `git diff --name-only` against the base touches `**/__snapshots__/*.snap` for the G-code corpora, greps `github.event.pull_request.body` for the acknowledgment line and fails otherwise. Alternatively soften CLAUDE.md to say 'PR review rejects' (as PROJECT.md non-negotiable 16 already honestly does) so agents don't rely on a gate that doesn't exist.

#### S14-F2 [MAJOR] Raster engrave (Image mode) has zero perceptual coverage — the one LightBurn headline mode with no fidelity instrument

_Area: mechanism · Effort: M · verified: PARTIAL_

The perceptual harness (ADR-025) covers trace extensively, fill via IoU>=0.9 mask comparison (toolpath-rasterize.test.ts:45-48 including annulus hole preservation), boxes, centerline, and V-carve (analytic groove, vcarve-perceptual.test.ts:18-22). Raster/Image mode has: property tests for laser-off/determinism/overscan-bounds (emit-raster.property.test.ts:58-90) and one byte-pinned production fixture — a 2x2 black/white checker at threshold dither (emit-gcode.snapshot.test.ts:101-118). No test rasterizes emitted raster G-code back to a mask and compares it to the source luma: grep for compareMasks/IoU under src/core/raster matches only the property/unit emit tests, and src/__fixtures__/perceptual contains no raster-image/linesPerMm/engrave test. An inverted-luma, mirrored-row, or dither-mapping regression would keep every property green and show up only as snapshot churn on a 2x2 fixture — churn that (per the previous finding) needs no CI-enforced acknowledgment.

- **Evidence:** src/core/raster/emit-raster.property.test.ts:57-90; src/io/gcode/emit-gcode.snapshot.test.ts:101-118; grep 'raster-image|linesPerMm|engrave' in src/__fixtures__/perceptual = no files; grep 'compareMasks|iou' in src/core/raster = emit-raster tests only
- **LightBurn reference:** Image mode (dithered/grayscale raster engrave of a bitmap) is one of LightBurn's three core modes; its output fidelity is exactly the class of bug the maintainer's 'green tests are not fidelity' rule exists for.
- **Recommendation:** Reuse the existing instruments: feed a known synthetic grayscale gradient + an asymmetric glyph through the production emitGcode raster path, rasterize with rasterizeGcodeBurn (already parses M4/S-modal G-code), and assert IoU/orientation against the analytically-known dither of the source (threshold dither of a binary image has an exact truth mask).
- **Verifier's correction (PARTIAL):** Core claim CONFIRMED by direct inspection: no perceptual/IoU instrument exists for Image-mode raster engrave. Grep for `mode: 'image'` under src/__fixtures__/perceptual returns zero matches; `compareMasks` consumers (11 files) are all trace/import/fill/box — none raster; `rasterizeGcodeBurn` is consumed only by toolpath-rasterize.test.ts (fill mode, IoU>=0.9 at lines 45-48, exactly as cited) and its own parser test. Cited files check out: emit-raster.property.test.ts:58-117 asserts only laser-off/determinism/coordinate-bounds; emit-gcode.snapshot.test.ts:101-118 is the 2x2 threshold checker, byte-pinned only (plus the same fixture reused in emit-gcode-layer-settings.snapshot.test.ts:85-102 with S-value-set assertions, still no geometry); vcarve-perceptual.test.ts:18-22 is the analytic-groove comment as cited. DECISIONS.md does NOT record the omission as deliberate — the opposite: ADR-028 (line 1144) says "ADR-025 (perceptual harness is the fidelity gate for raster output)", asserting a gate that does not exist for the raster G-code path, and ADR-025 itself (line 866) is scoped to the trace pipeline. HOWEVER, the finding's headline failure scenario is REFUTED: an "inverted-luma, mirrored-row, or dither-mapping regression" would NOT "keep every [test] green and show up only as snapshot churn." Each named class is pinned by expectation-based unit tests: dither.test.ts:33-41,63-77,137-149 pins black→sMax/white→0 and the exact grayscale luma→S curve per algorithm; compile-job-raster.test.ts:67-79 pins production luma→S ([0,128,255]→[300,200,0]), :151-174 pins row/column machine orientation per origin, :179-245 pins mirror and negative-scale semantics; emit-raster.test.ts:125-137,193-228 byte-pins exact per-row Y coordinates and full motion sequences. The genuine residual exposure is narrower: seam/composition regressions and content fidelity at realistic scale — notably src/core/raster/luma-resample.ts has NO sibling test at all, and the only resample assertion (compile-job-raster.test.ts:81-88) checks output dimensions, never content, so a content-mangling resample at non-trivial linesPerMm would indeed pass everything and surface only as snapshot churn. Severity major stands: headline mode, repo's own ADR claims a fidelity gate that isn't there, and a real undetectable regression class (resample content, dither pattern at scale) exists; the recommendation is feasible as written since rasterizeGcodeBurn already parses the emitted M4/S-modal output.

#### S14-F3 [MAJOR] Marlin and Smoothieware dialects get one laser-off fixture each; GRBL gets 100-seed fuzz x 7 properties and byte-pinned snapshots

_Area: mechanism · Effort: S · verified: CONFIRMED_

grblStrategy has 100-seed fast-check properties for determinism, laser-off, bounds, power-scale, fill-overscan (grbl-strategy.property.test.ts) plus per-layer S/F correctness fuzz (grbl-strategy-per-layer-settings.property.test.ts) plus the production-composition snapshot corpus. marlin-strategy.test.ts and smoothieware-strategy.test.ts each call findLaserOnTravelIssues on a single hand-built fixture (lines 64 and 47 respectively) — no fuzz, no determinism property, no bounds property, no byte-pinned output through emitGcode (the snapshot corpus uses createProject()'s default GRBL device, so selectOutputStrategy never routes to the other dialects in any snapshot). A Marlin fan-mode (M106/M107) regression that arms the laser on travel across some input class would pass CI green — and laser-on-travel is non-negotiable #3, a fire-safety invariant.

- **Evidence:** src/core/output/marlin-strategy.test.ts:64; src/core/output/smoothieware-strategy.test.ts:47; src/core/output/grbl-strategy.property.test.ts:110-236; src/io/gcode/emit-gcode.snapshot.test.ts:39-41 (createProject default device)
- **LightBurn reference:** LightBurn treats every controller dialect as equally load-bearing; a dialect-specific laser-on-travel bug is the exact failure class its users report as fires.
- **Recommendation:** Parametrize the existing arbJob/arbMixedJob property suite over [grblStrategy, marlinStrategy, smoothiewareStrategy] (the predicates already understand M107 per predicates.ts:46-49), and add one Marlin-device and one Smoothie-device fixture to the emitGcode snapshot corpus.

#### S14-F4 [MAJOR] No browser-level/E2E test harness at all — WORKFLOW.md flows are never executed end-to-end, and jsdom's canvas is a no-op stub

_Area: workflow · Effort: L · verified: CONFIRMED_

All 653 src test files run under vitest+jsdom (vitest.config.ts:12); there is no e2e/ directory and no playwright.config.ts (verified absent). The setup file deliberately installs a no-op 2D canvas context so 'draw calls succeed' invisibly (jsdom-canvas-setup.ts:1-18) — meaning the entire canvas workspace (the primary UI surface of a LightBurn-style app: selection, drag, zoom, preview rendering) can regress to a blank or garbled render while every test stays green. UI .test.tsx files assert component logic, not pixels or real event loops. For a mouse-driven CAD app this is the single largest class of regression that passes CI green.

- **Evidence:** vitest.config.ts:12-17; src/__fixtures__/jsdom-canvas-setup.ts:1-18; ls e2e / playwright.config.ts = not found; package.json devDependencies (no playwright/@testing-library)
- **LightBurn reference:** LightBurn's value is interactive canvas manipulation; KerfDesk has no automated check that its equivalent surface renders or responds at all.
- **Recommendation:** Add a minimal smoke-level browser harness (Playwright) exercising 3-4 WORKFLOW.md golden paths: import SVG -> object appears on canvas -> assign layer -> Save G-code produces non-empty file. Even a screenshot-diff of the workspace after a scripted import would catch blank-canvas regressions. Needs design (worktree/dev-server hygiene per collaboration rule 4).

#### S14-F5 [MINOR] PROJECT.md #13 'All invariants property-tested' is overstated: invariants 2, 4, 6 have example-based tests only, and the Save-path 'no partial output' has no test

_Area: mechanism · Effort: S_

Coverage per safety invariant: #1 bounds — property (grbl-strategy.property.test.ts:134-147, emit-raster.property.test.ts:86+); #3 laser-off — property (grbl-strategy.property.test.ts:123-132, emit-raster.property.test.ts:58-67); #5 determinism — property (grbl-strategy.property.test.ts:111-121, 214-224); #7 power-scale — property (grbl-strategy.property.test.ts:149-181, per-layer fuzz in grbl-strategy-per-layer-settings.property.test.ts). But #2 origin honesty — example-based unit tests only (origin-transform.test.ts:9-45 covers all five origins, job-origin.test.ts:32-58); #6 units honest — example-based unit tests only (parse-svg.test.ts:70-127, and svg-units.ts has no sibling test file); #4 no partial output — the Start path is tested (start-job-readiness.test.ts:221 'keeps existing project preflight failures as Start blockers') but the Save path's preflight-fail early-return (file-actions.ts:143-147) has no test: grep for 'preflight' in file-actions.test.ts returns nothing.

- **Evidence:** src/core/devices/origin-transform.test.ts:9-45; src/io/svg/parse-svg.test.ts:70-127; src/ui/app/file-actions.ts:143-147 vs grep 'preflight' in file-actions.test.ts = no matches; src/ui/laser/start-job-readiness.test.ts:221; PROJECT.md:268
- **Recommendation:** Add a file-actions test that a preflight-failing project produces zero pickFileForSave/write calls; add a small property test for origin round-trip (toMachineCoords∘toSceneCoords = id for arbitrary origin+point) and for unit parsing (parseSvgLengthMmOrNull scale laws). Or amend PROJECT.md #13 to name which invariants are property-tested.

#### S14-F6 [MINOR] `pnpm lint` does not include the repo-wide prettier check that gates CI — local-green/CI-red formatting trap, and CLAUDE.md's session-hygiene list omits it

_Area: workflow · Effort: S_

CI's only job runs `pnpm release:check`, whose chain includes `pnpm format:check` (`prettier --check .`). But `pnpm lint` is `eslint .` only, and CLAUDE.md's 'Session hygiene' section instructs running exactly `pnpm test`, `pnpm lint`, `pnpm typecheck` before declaring work done — none of which catches a formatting violation anywhere in the repo (prettier checks .md/.yml/.json too, files eslint never sees). An agent or contributor following the documented checklist can push a commit that fails CI (and, on main, blocks the CI-gated auto-deploy).

- **Evidence:** package.json scripts: lint='eslint .', format:check='prettier --check .', release:check chain; CLAUDE.md 'Session hygiene' section (test/lint/typecheck only); .github/workflows/ci.yml:45-46
- **Recommendation:** Either fold format:check into the lint script (`eslint . && prettier --check .`) or add `pnpm format:check` to CLAUDE.md's session-hygiene list. One line either way.

#### S14-F7 [MINOR] `pnpm audit --audit-level=low` sits inside the PR gate, before tests — any new upstream advisory fails every PR and deploy, unrelated to the diff

_Area: architecture · Effort: S_

release:check runs `audit:deps` (`pnpm audit --audit-level=low`) as step 7, before `pnpm test`. The moment any advisory — even severity 'low' — is published against any transitive dependency, every PR, every main push, and the CI-gated Cloudflare deploy go red until someone bumps or overrides the dep, and the failure masks the test signal for that run (tests never execute). This is a self-inflicted CI outage vector with no relationship to the code under review. No ADR in DECISIONS.md was found recording this placement as deliberate (not exhaustively searched).

- **Evidence:** package.json: release:check='... pnpm license-check && pnpm audit:deps && pnpm test && ...'; audit:deps='pnpm audit --audit-level=low'
- **Recommendation:** Move the audit to a scheduled (cron) workflow that opens an issue, or run it after tests with continue-on-error + a visible report, or keep it blocking but at --audit-level=high with a pnpm.auditConfig allowlist for accepted lows.

#### S14-F8 [MINOR] PR CI runs on Linux only; the Windows target (the shipped desktop platform and the maintainer's dev OS) is only exercised at release-tag time

_Area: architecture · Effort: S_

ci.yml runs on ubuntu-latest for every PR/push. release-desktop.yml re-runs the full release:check on windows-latest — but only on `v*` tags or manual dispatch. CRLF handling, path-separator assumptions, and case-sensitivity differences (all previously bitten in this repo per doc comments about EOL traps) therefore surface at release time, the most expensive moment. The repo already has evidence of platform sensitivity: check-file-size-policy.mjs normalizes \r\n explicitly (line 30), and scripts/assert-correct-repo.mjs handles worktree layouts.

- **Evidence:** .github/workflows/ci.yml:19 (runs-on: ubuntu-latest); .github/workflows/release-desktop.yml:16-19,31 (tags + windows-latest); scripts/check-file-size-policy.mjs:30
- **Recommendation:** Add a weekly scheduled (or label-triggered) windows-latest CI leg running release:check, so platform drift is caught between releases without doubling every PR's CI cost on a 2-vCPU plan.

#### S14-F9 [MINOR] Single monolithic CI job serializes 11 gates; one early failure hides all downstream signal and feedback is slow on a 1-worker runner

_Area: architecture · Effort: M_

The entire gate is one `pnpm release:check` invocation: guard:repo -> typecheck -> lint -> lint:electron -> format:check -> license-check -> audit:deps -> test -> build:web -> build:electron-main -> check:file-size, with && chaining. A prettier or audit failure means the PR author learns nothing about tests or build; the 600-raw-line backstop (check:file-size) runs dead last, after the ~4k-test suite and two builds. Combined with vitestMaxWorkers=1 on CI (vitest-workers.ts:12, deliberately, for the 2-vCPU orchestrator-starvation flake) and always-on perceptual tests carrying 120s timeouts (arch-house-baseline.test.ts:27, trace-benchmark-loop.test.ts:13), wall-clock feedback per push is long and all-or-nothing.

- **Evidence:** package.json release:check; .github/workflows/ci.yml:45-46; src/__fixtures__/vitest-workers.ts:12; src/__fixtures__/perceptual/arch-house-baseline.test.ts:25-27; src/__fixtures__/perceptual/trace-benchmark-loop.test.ts:11-13
- **Recommendation:** Split ci.yml into 2-3 parallel jobs (static checks: typecheck+lint+format+license+file-size; tests; builds). Cheap static gates fail fast and independently; the test job's result stays visible even when formatting fails. Keep release:check as-is for deploy/release parity.

#### S14-F10 [MINOR] Camera and relief pipelines have no image-level fidelity coverage (math-unit tests only)

_Area: mechanism · Effort: M_

Camera tests are linear-algebra unit tests (matrix3d, mat3, homography, fisheye under src/core/camera) plus budgeted calibration sweeps (calibrate-sweep.test.ts, detect-checkerboard.test.ts use ciBudgetMs). Nothing renders a distorted synthetic frame through the full undistort->homography->overlay path and checks the result perceptually, so a sign flip that keeps individual matrix tests green could still place camera overlays mirrored on the workspace. Relief/STL has a G-code snapshot (relief-roughing.test.ts.snap) and marching-squares units but no heightmap-vs-carve perceptual check analogous to the V-carve analytic-groove proof. Hardware passes for camera remain CLAIMED, making synthetic fidelity tests the only available instrument.

- **Evidence:** src/core/camera/*.test.ts (matrix3d, mat3, homography, fisheye, calibrate-sweep, detect-checkerboard); grep 'camera' in src/__fixtures__/perceptual = no test files; src/core/relief/__snapshots__/relief-roughing.test.ts.snap
- **LightBurn reference:** LightBurn's camera overlay alignment is calibration-verified end-to-end in-product; KerfDesk verifies only the constituent matrices.
- **Recommendation:** Extend the ADR-025 analytic-truth pattern: synthesize a checkerboard frame with known distortion parameters, run the full camera pipeline, and IoU-compare the rectified board against the analytic grid. For relief, stamp a known analytic heightmap (hemisphere) and compare the removal grid, mirroring vcarve-perceptual.test.ts.

#### S14-F11 [POLISH] Coverage is collected but ungated — no thresholds, so coverage can silently decay

_Area: architecture · Effort: S_

vitest.config.ts configures v8 coverage with text/html/json reporters and sensible include/exclude, but defines no `thresholds` block, and no CI step runs test:coverage at all (release:check runs plain `pnpm test`). Coverage is thus a local curiosity: a PR deleting half the tests of a module would pass CI with no signal. Given the project's stated posture that structure tests are the floor (not the ceiling), a floor that can erode unnoticed is worth pinning.

- **Evidence:** vitest.config.ts:23-28 (no thresholds); package.json release:check (runs 'pnpm test', not test:coverage)
- **Recommendation:** Either add per-directory thresholds for src/core (the pure, easily-covered pipeline) to vitest coverage config, or record an ADR that coverage is intentionally ungated so the omission is a decision rather than an accident.

### Not verified in this sector

- Actual runtime test count and pass state — I did not run the suite (per instructions). Static count: 663 test files (554 .test.ts + 99 .test.tsx in src, 10 in electron), ~3,940 `it(`/`test(` declarations by grep; loops expand more at runtime.
- CI wall-clock duration and real-world flake rate under maxWorkers=1 with the 120s-timeout perceptual tests — no CI run logs examined this session.
- Whether GitHub branch protection requires the CI check before merge — repo settings are not visible in the tree.
- Whether the 'Snapshot change acknowledged' convention has ever been violated in merged history — did not audit PR bodies.
- Coverage percentages — did not run test:coverage.
- Behavior of the 13 TRACE_AUDIT=1-gated perceptual audit harnesses (read statically; never executed).
- Whether an ADR records the pnpm-audit-in-PR-gate placement or the ungated-coverage choice as deliberate — searched DECISIONS.md non-exhaustively (~5,000 lines).
- WORKFLOW.md end-to-end flow correctness — no executable harness exists to check it, and I did not audit its prose in depth (other sectors cover it).
- Perceptual IoU thresholds' calibration quality (e.g. whether IoU>=0.9 at 32x32 for fill is tight enough to catch real hatch defects) — would need rendered-output comparison against LightBurn, which is exactly what the harness cannot prove statically.

---

## Appendix: completeness critique (verbatim)

The 14 sectors give strong coverage of user-visible flows (import, canvas, layers, preview, G-code, machine control, camera, CNC, trace) and of cross-cutting code health, performance, docs, and CI. But the fleet was UI-flow-centric and missed four real subsystems that exist in the tree: (1) the entire project-persistence layer (src/io/project with serializers, migrations, and a validator suite) plus crash/mid-job checkpoint recovery (src/core/recovery + CheckpointResumeBanner) — data-loss and laser-resume safety live here; (2) the Electron desktop platform (electron/ main process, auto-update, CSP/trusted-renderer/private-network policies, native serial, RTSP camera bridge) and web-vs-desktop feature parity — zero sector looked at it despite Windows desktop being the shipped platform; (3) the non-GRBL controller stack — a complete Ruida binary/.rd/UDP implementation plus grblHAL, FluidNC, Marlin, Smoothieware drivers and auto-detection — where coverage only ever mentions GRBL/Marlin/Smoothie text dialects; (4) the device/machine-profile lifecycle (core/devices catalog data, profile application/suggestions, io/machine-profile import/export, LightBurn .lbdev import, safety zones), where wrong catalog numbers translate directly into gantry crashes or fires. Cross-feature undo semantics and licensing files were partially grazed by existing sectors and rank below these four.

Gap sectors named (all four audit attempts failed on a session token limit; unaudited):

- **Project persistence, save-format migration, autosave & crash/job recovery** — No sector audited the save/load/versioning layer or mid-job power-loss resume. This is the data-loss surface (does a v1 project still open, does autosave restore silently drop fields, does a corrupt checkpoint brick startup?) and a motion-safety surface (checkpoint resume re-arms a laser at a position the controller may no longer trust). Performance sector only noted autosave jank; import sector only covered artwork formats.
- **Electron desktop platform: security posture, auto-update, and web-vs-desktop parity** — The shipped desktop platform (and the maintainer's dev OS per CI findings) has a 431-line Electron main process, an auto-updater, CSP and trusted-renderer policies, native serial-port selection, and an RTSP camera bridge — and not one of the 14 sectors opened the electron/ directory. Update integrity, IPC surface validation, and which features silently exist only on one platform are all unexamined.
- **Non-GRBL controller stack: Ruida .rd binary path, grblHAL/FluidNC drivers, controller auto-detection** — src/core/controllers/ ships six families including a complete Ruida implementation (rd-encoder, swizzle, UDP session, driver) and a binary .rd file save action reachable from the UI — a laser output format where an encoding bug means wrong power/speed on hardware. Coverage only ever discusses GRBL text dialects (with Marlin/Smoothie noted as under-tested); Ruida, grblHAL, FluidNC, capability gating, and auto-detection were never audited by anyone.
- **Device/machine profile lifecycle & catalog data correctness** — Wrong profile data is physically dangerous: a wrong bed size defeats bounds preflight, a wrong $30/maxPowerS mis-scales laser power, wrong scan-offset ruins raster fidelity. The tree has a factory catalog (falcon-profiles.ts), profile suggestion/confidence logic, profile import/export, a LightBurn .lbdev importer, and safety zones — the machine-control sector audited jog/console/streaming and onboarding grazed the setup wizard, but nobody audited profile data, editing, switching, or import fidelity.
