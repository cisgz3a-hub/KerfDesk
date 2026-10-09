# Rolling audit — LightBurn importers (.lbrn project, .clb library, .lbdev device)

- **When:** 2026-07-17 12:31 (+08)
- **Tree:** `origin/main` @ `b8f773e5` (audit branch rebased onto it).
- **Scope:** the third io-importer family after SVG (iter 3, found a P1) and DXF (iter 16, found a P2) — `src/io/lightburn/{lbrn-import,lbrn-geometry,clb-import,lbdev-import}.ts` + the caller-side `src/ui/app/import-source-limits.ts`.
- **Method:** static read to ground truth, then a **6-dimension adversarial review** (layer-parity, geometry, resource-bounds, rules, dead-code/drift, test-coverage) run as a workflow: each dimension found independently, then **every one of the 25 raised findings was adversarially verified** (try-to-refute, default REFUTED/DOWNGRADED). **1 refuted, 24 survived** → deduplicated to **2 P2 + 6 distinct P3s**. I independently cross-checked two seeds myself (see Verified clean).
- **Report-only** per CLAUDE.md collaboration rule 1 — nothing was fixed.

---

## P2-1 — `.lbrn` project import silently drops fill/scan CutSetting fields the sibling `.clb` importer reads

`importedLayers` reads **only** speed, maxPower, numPasses, and mode from each CutSetting ([lbrn-import.ts:103-113](../../src/io/lightburn/lbrn-import.ts)) and silently drops every other field. The KerfDesk `Layer` type **has** the target fields — `minPower`, `hatchSpacingMm`, `hatchAngleDeg`, `fillOverscanMm`, `fillBidirectional`, `airAssist`, `linesPerMm` ([layer.ts:23-44](../../src/core/scene/layer.ts)) — and the sibling `.clb` importer reads all of them into those exact fields ([clb-import.ts:107-125](../../src/io/lightburn/clb-import.ts): `interval → hatchSpacingMm/linesPerMm`, `minpower → minPower`, `scanangle → hatchAngleDeg`, `overscanning → fillOverscanMm`, `bidirectional → fillBidirectional`, `airassist → airAssist`). So the drop is a **genuine parity gap on LightBurn's own project format**, not a scope limit — and `createLayer` backfills the omitted fields with defaults (`hatchSpacingMm 0.1`, `fillOverscanMm 5`, `minPower 0`).

**Corpus-verified:** `src/__fixtures__/lightburn/external/lbrn/acwright-backplane-top.lbrn2` CutSetting C00 carries `minPower=50, interval=0.5, overscan=0` — all discarded, so it imports as minPower 0 / hatch 0.1 mm (5× denser than LightBurn's 0.5) / overscan 5. **Honest scoping:** all five bundled corpus fixtures are `Type="Cut"` (line) layers, so the interval/overscan/angle drops are *inert in the bundled corpus* (they only drive Scan/Fill engraving) — only the `minPower 50→0` drop is an active change there. The "5× denser hatch / dropped angle" scenario is real but needs a Scan/Fill `.lbrn` layer, which the corpus lacks. Severity is P2 because a fill layer engraves visibly wrong vs the parity reference (rule 3); one could argue P3 since operators often re-enter cut settings. No test asserts these fields.

---

## P2-2 — No Y-flip / no bbox-normalization: `.lbrn` imports are likely vertically mirrored (PLAUSIBLE — needs perceptual confirmation)

**Airtight code fact:** `visitVectorShape` bakes only the affine XForm into the curves (`transformCurve`, a pure a/b/c/d/e/f matrix with **no Y sign inversion**) and stores them with `transform: IDENTITY_TRANSFORM` and raw workspace bounds — there is **no Y inversion and no bbox-to-origin normalization** anywhere in the `.lbrn` path ([lbrn-geometry.ts:102-116,309-330](../../src/io/lightburn/lbrn-geometry.ts)). By contrast the sibling DXF importer explicitly flips its Y-up source (`y: maxY - value.y`, [parse-dxf.ts:180-196](../../src/io/dxf/parse-dxf.ts)) with the comment "Flip DXF's Y-up frame to the canvas frame," and the SVG importer is Y-down-native (no flip) — so **the codebase flips Y exactly for Y-up CAD sources**, and KerfDesk's canvas frame is proven Y-down.

**The load-bearing unknown:** whether LightBurn's `.lbrn` document space is Y-up. If it is (LightBurn is a CAD-family app, same as DXF), then every imported `.lbrn` shape is **mirrored top-to-bottom** vs LightBurn — a fidelity bug. **I could not confirm LightBurn's `.lbrn` Y-convention from the tree** (rule 5 — not asserting it). Within-tree corroboration that it's Y-up: the `.lbdev` origin mapper treats `upperleft → rear-left` and `lowerleft → front-left` ([lbdev-import.ts:247-250](../../src/io/lightburn/lbdev-import.ts)) — i.e. upper = rear = high Y, the Y-up convention. **This is the single highest-value thing to check perceptually:** import a `.lbrn` with known orientation and compare to LightBurn's display (CLAUDE.md rule 2). No existing test pins orientation — the corpus snapshot asserts only report counts, never a coordinate ([lbrn-external-corpus.test.ts:17-32](../../src/io/lightburn/lbrn-external-corpus.test.ts)), and the unit test asserts only X bounds.

---

## P3-1 — `.lbrn` mode mapping drops Image (a `type="Image"` CutSetting imports as a Line cut)

`mode = mode.includes('scan') || mode.includes('fill') ? 'fill' : 'line'` ([lbrn-import.ts:106-109](../../src/io/lightburn/lbrn-import.ts)) — `"Image"` matches neither branch and falls through to `'line'`. `LayerMode` supports `'image'` and the `.clb` sibling maps it correctly (`operationMode`, [clb-import.ts:223-227](../../src/io/lightburn/clb-import.ts)). Near-nil practical impact today — `visitShape` treats `Type="Image"/"Bitmap"` as unsupported so no geometry references such a layer, and layers are only created for used colors — but it is a genuine mode-mapping divergence from the `.clb` sibling that would misfire if an Image CutSetting's CutIndex were ever attached to a vector shape.

---

## P3-2 — LightBurn rounded-rect corner radius is dropped (rects always import sharp)

`rectangleCurves` reads only `W` and `H` and emits four straight line segments ([lbrn-geometry.ts:128-148](../../src/io/lightburn/lbrn-geometry.ts)); grep for corner/radius/Cr across the module finds only the ellipse Rx/Ry. Any LightBurn rect with a nonzero corner radius imports as a sharp-cornered rectangle. Lower confidence (LightBurn's exact stored attribute name for the radius was not confirmed, and no fixture exercises a rounded rect), but the code unambiguously discards any rect corner radius.

---

## P3-3 — `.lbdev` device import has no size cap and no XML/XXE hardening

`.lbdev` is the only importer in the family with **no resource guard**: it is absent from `IMPORT_SOURCE_LIMITS` ([import-source-limits.ts:5-20](../../src/ui/app/import-source-limits.ts), which lists native/lbrn/clb/gcode/stl but not lbdev), reads the whole file, and runs `extractFirst` regexes on the raw text ([lbdev-import.ts:40-100,226-234](../../src/io/lightburn/lbdev-import.ts)) with no byte cap and no `<!DOCTYPE|<!ENTITY` check (the `.lbrn`/`.clb` importers all have both). Practical risk is low (device files are tiny, and regex-on-text avoids DOM entity expansion), but it is an unhardened import surface inconsistent with its siblings.

---

## P3-4 — `transformCurve`'s third-segment-kind branch is a bare `else` (no `assertNever`) and is unreachable-yet-lossy

`transformCurve` handles `segment.kind === 'line'` and `=== 'cubic'` then falls through to an **unguarded `else`** that transforms only `to` — assuming the elliptical-arc variant ([lbrn-geometry.ts:317-328](../../src/io/lightburn/lbrn-geometry.ts)). The importer never produces an `elliptical-arc` segment today (rects → lines, ellipses → `parametricEllipseCurve`, paths → line/cubic), so the branch is currently unreachable — but if it ever fired it would silently mis-transform the arc (only `to` moved, center/radii untouched), and a fourth `PathSegment` kind would not be caught at compile time. The `assertNever` the CLAUDE.md discriminated-union rule mandates is absent (same class as the CNC/DXF findings).

---

## P3-5 — Size soft-limit overages, a magic number, and XML-helper duplication across the three importers

`lbrn-geometry.ts` (349 counted) and `lbdev-import.ts` (254 counted) are over the 250 soft limit (under the 400 hard cap — guidance only, no lint tier). The three importers each re-declare near-identical `normalized`/`finiteNumber`/`xmlDepth`/`field`/`attribute` XML helpers — CLAUDE.md's copy-paste-duplication anti-pattern; a shared `lbrn-xml-helpers` module would consolidate them. Plus an unnamed flatten-tolerance literal (`0.025`, [lbrn-geometry.ts:104](../../src/io/lightburn/lbrn-geometry.ts)).

---

## P3-6 — Test-coverage gaps

Verified absent: the dropped `.lbrn` CutSetting fields (P2-1 — no test asserts interval/minPower/angle/overscan); `.lbrn` Y-orientation (P2-2 — no coordinate/sign is ever asserted); `CutIndex ≥ 8` hash-color layer mapping and the `findColorIndex` round-trip; rounded rect; `.lbdev` large-input/no-cap; and `.lbrn` Image mode.

---

## Verified clean (checked hard — including two seeds I refuted myself)

- **The DXF-style decompression bomb is impossible here:** `.lbrn` has `MAX_SHAPES = 50_000` (aggregate) + `MAX_XML_DEPTH = 64` + 20 MB byte cap + `<!DOCTYPE|<!ENTITY` XXE rejection; `.clb` has `MAX_CLB_ENTRIES = 10_000` + the same depth/byte/XXE guards. This is the aggregate cap the DXF importer (iter 16 P2) lacked — a strong contrast.
- **Color↔cutIndex hash has ZERO collisions** (my own computation over 0–255 and the LightBurn-practical 0–29; the hash never lands on an explicit 0–7 color) — so the `colorForCutIndex`/`findColorIndex` round-trip is lossless. A raised collision finding was refuted by this.
- **Text shape XForm is not double-applied** (a raised finding, **refuted**): the Text branch recurses into the `BackupPath` child, which carries its own XForm; the parent Text XForm is LightBurn's redundant copy, so applying only the BackupPath's is correct.
- **`.clb` divide-by-zero guarded** (`linesPerMm: 1 / Math.max(0.001, interval)`); speed mm/sec→mm/min conversion (`×60`) correct in both importers.

## Not verified

- **LightBurn's `.lbrn` Y-axis convention** (P2-2) — the one item that decides a real fidelity bug vs a non-issue; needs a perceptual import-vs-LightBurn comparison, not code reading.
- Rendered fidelity of any import; hardware output.
