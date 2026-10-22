# Rolling audit v2 — Vector importers

- **When:** 2026-10-21 17:00 (+08)   **Tree:** origin/main @ `2c8d988db` (audit worktree HEAD
  `e9b06331b`; `git fetch` at the end showed origin/main `c708073a7`, and
  `git diff --stat HEAD origin/main` over the whole scope is empty, so every audited line is
  unchanged on current main).
- **Scope:** `src/io/svg/**`, `src/io/dxf/**`, `src/io/hpgl/**`, `src/io/pdf/**`, `src/io/xml/**`,
  `src/io/stl/**`, `src/io/text/**`, `src/io/palette/**`, `src/io/vector-formats/**` (writers
  skimmed only), `src/ui/import/**`, plus the import glue they call in `src/ui/app`
  (`svg-import-action.ts`, `dxf-import-action.ts`, `import-toasts.ts`, `import-bed-fit-notice.ts`)
  and `src/ui/state/svg-fragment-mutation.ts` / `import-bed-fit.ts` for placement.
  The three SVG routes were all exercised: the streamed worker (`readSvgDocumentFromBlob` →
  `parseSvgWorkerDocument`, the production path), the whole-text worker (`parseSvgInWorker`) and
  the main-thread DOMPurify fallback (`parseSvg`, also used by PDF pages, the library and remote
  control).
  Governing documents: ADR-046 (SVG units), ADR-574 (viewport geometry), ADR-358 Amd 1–3 (clips,
  masks, images), ADR-268 + Amd 1 (budgets, entities, `<use>`), ADR-269 (workers; nested-DXF
  amendment), ADR-357 §5/§7 (PDF, HPGL), ADR-414/580 (STL), ADR-452 (DXF bulges).
- **Lenses run:** L1, L2, L3, L4, L5, L6, L7. All repros were temporary Vitest files named
  `zz-14-*.test.ts` beside the code (run with
  `node ../../../node_modules/vitest/vitest.mjs run <file>`), and all were deleted afterwards.
- **Counts:** 9 raised → refuter: 9 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED → P1 0 / P2 1 / P3 8
  (+ 7 KNOWN). No severity changes. P2-1 is narrowed: its viewBox-only half was already raised on
  2026-07-17 (BQ-20, a pending policy decision), the commonest modern Illustrator result is 283 %
  rather than 75 %, and its ADR-046 contract-drift sub-claim is partly refuted (see Refuted).

## Headline

The importers are in good shape on geometry. Path grammar, arc flags, `<use>`/`<symbol>`/nested
`<svg>`, viewBox mapping, DXF OCS mirroring, bulges, ellipses and nested INSERT transforms all match
the spec in crafted repros. The XML entity, `<use>` and billion-laughs bounds hold on every route.
The one P2 is a units problem: KerfDesk has no Illustrator (72 px/in) handling and no import-DPI
choice. A standard Illustrator SVG therefore imports at 75 % of its artboard size. An Illustrator
"Responsive" or viewBox-only SVG imports at 283 % (or 378 % against Inkscape's reading). The same
artwork saved as PDF-compatible `.ai` imports at true size. (Refuter: viewBox-only is what current
Illustrator writes by default, so 283 % is the usual result. That half was raised on 2026-07-17 as
BQ-20.) The P3s are mostly honesty gaps:
- CSS transforms on artwork are silently misread, while the clip reader refuses them.
- Valid DXF content (layer true colour, fit-point splines) is quietly approximated or dropped.
- The streamed worker crashes with a raw `TypeError` on namespace-prefixed SVG.

## Findings

### P2-1 — Illustrator SVGs import at the wrong physical size: 75 % for a normal export, 283 % for a viewBox-only ("Responsive") export, and there is no import-DPI choice or Illustrator detection
- **Where:** `src/io/svg/svg-units.ts:16` (`CSS_PX_PER_INCH = 96`) and `:7`;
  `src/io/svg/svg-root-viewport.ts:40` (a viewBox-only root keeps 1 user unit = 1 mm). The
  contract text is in `DECISIONS.md` ADR-046, Consequences: "Inkscape/Illustrator mm-sized exports
  import at true physical size; an import DPI *setting* … stays future work". The test comment at
  `src/io/svg/parse-svg.test.ts:81-84` calls `width="50mm" viewBox=…` "the standard Inkscape /
  Illustrator export shape".
- **Anchor:** Ground truth and Twin.
  - LightBurn Settings reference (https://docs.lightburnsoftware.com/latest/Reference/SettingsPreferences/)
    offers SVG import at "96 DPI" ("the default for Inkscape") or "72 DPI" ("the default for Adobe
    Illustrator").
  - The Glowforge community thread
    (https://community.glowforge.com/t/adobe-illustrator-dont-check-responsive-when-exporting-to-svg/10859)
    says the Responsive export "doesn't set the height and width at all".
  - Twin: the PDF route maps 72 pt to 25.4 mm (`pdf-vector-page.ts:69-72`;
    `pdf-vector-page.test.ts:43` expects a 144 × 72 pt page as 50.8 × 25.4 mm). So the same
    artwork imports at different sizes from `.ai`/PDF and from `.svg`.
  - Contract drift: ADR-046's stated rationale (Illustrator exports in mm) does not describe what
    Illustrator writes. Illustrator writes `px` at 72 per inch, or no size at all.
- **Scenario:**
  1. A 1-inch (72 pt) Illustrator artboard saved as SVG (`width="72px" height="72px"
     viewBox="0 0 72 72"`, with the Illustrator DOCTYPE entities, `<switch>` and `i:pgf`) imports
     at **19.05 × 19.05 mm** on all three routes, with no note. A 50 mm coaster burns at 37.5 mm.
  2. The same artboard exported with Responsive ticked (`viewBox="0 0 72 72"` only) imports at
     **72 × 72 mm**.
  3. A viewBox-only 24-unit web icon imports at 24 mm, where Inkscape reads 24 px (6.35 mm).
  4. Legacy Inkscape ≤ 0.91 px files (90 px/in, per the Inkscape wiki "Units In Inkscape") import
     at 93.75 %.
- **Evidence:** REPRO. `zz-14-ai-probe.test.ts` used a realistic Illustrator 16 file on the
  fallback, worker-text and worker-stream routes. Every route gave bounds `maxX 19.049999999999997`
  with notes `[]`. `zz-14-svg-probe.test.ts` gave `illustratorResponsive b=[0,0,72,72]` and
  `illustratorClassic b=[0,0,19.05,19.05]`.
- **Refuter:** CONFIRMED, P2 kept, but narrowed and partly KNOWN.
  - **Repro (my own files, all three routes, 72-unit artboard):** a CS6-shape file
    (`width="72px"`, Generator 16.0.0) and an unitless non-responsive export (`width="72"`) import
    at 19.05 mm (75 %). A modern Save As file (Generator 27.0.0, `viewBox` only) and an Export As
    Responsive file both import at 72 mm (283 %). An Export As file with `width="25.4mm"` imports
    at true size. No route gives a note. There is no import-DPI setting, and nothing detects
    Illustrator: `git grep` finds no such code. ADR-046 still defers the setting, and ADR-574
    keeps the viewBox-only mm rule.
  - **Sources I fetched:**
    - SVG 2 §8 (coords): CSS defines 1 in as 96 px, and a unitless outer `width` counts as px.
    - LightBurn Settings reference: a manual 96 DPI (Inkscape) or 72 DPI (Illustrator) choice; no
      auto-detection is described.
    - Adobe Community threads: Monika Gause says Illustrator "always assumes that your screen
      resolution is 72 ppi". A user's 10 mm box, exported with Responsive off, rendered at 7.5 mm.
    - The Glowforge thread.
    - 28 GitHub repositories whose SVGs carry Illustrator's Generator comment (via `gh search
      code`). Of the 22 files from v17–30 (CC), 21 have only a viewBox and one is unitless. All 5
      files from v15–16 use `px`.
  - **Corrections:**
    - For current Illustrator the usual result is 283 %, not 75 %. That 283 % comes from the
      viewBox-only = 1 mm rule, which the 2026-07-17 laser-burn-quality audit already raised
      (BQ-20, and findings register §D P1 as a pending maintainer policy call). What is new here
      is that Illustrator user units are 72 per inch, so `px`/unitless files import at 75 %, and
      that viewBox-only Illustrator files (283 %) are the common case.
    - The contract-drift sub-claim is partly refuted; see Refuted.
  - **Why P2 and not P1:** the size shows on the canvas and in Job Review before a burn, and
    LightBurn's own default (96) also gives 75 % until the user switches it.
- **Fix direction:** This needs a maintainer decision. Offer the LightBurn-style 96/72 import choice
  (or detect the `Generator: Adobe Illustrator` comment). Reconsider whether viewBox-only should
  mean mm, or at least disclose the assumed unit in the import toast. Correct ADR-046's
  Illustrator claim and the test comment.

### P3-1 — CSS transforms on artwork are silently misread, while the same constructs in a clip are refused
- **Where:** `src/io/svg/svg-presentation.ts:113` feeds the CSS `transform` value to the SVG
  attribute parser. `src/io/svg/svg-transform-attribute.ts:50` turns any unknown function into the
  identity, and `:35` drops units. `translate`/`rotate`/`scale` properties and `transform-origin`
  are never read. The twin, `src/io/svg/svg-clip-presentation.ts:15-16,80`, refuses exactly these
  for clips (ADR-358 Amendment 2 item 4: refuse rather than guess, because "clip geometry decides
  what is cut").
- **Anchor:** Twin (the clip reader against the artwork reader); Ground truth (SVG 2 makes
  `transform` a CSS presentation property; CSS Transforms 1/2 define `translateX`, the `turn`
  unit, `transform-origin` and the individual `translate`/`rotate` properties).
- **Scenario:** the following rectangles import at the wrong place, with no note:
  - `style="transform:translateX(10px)"` → x 0..10 (a browser draws 10..20).
  - `style="translate:10px 0"` → 0..10.
  - `style="rotate:90deg"` → not rotated.
  - `transform="rotate(90)" transform-origin="15 5"` → (-10..0, 10..20) instead of staying at
    (10..20, 0..10).
  - a `<style>` rule `.m{transform:translateY(20px)}` → not moved.
  - `transform="rotate(0.25turn)"` → rotated 0.25°.

  The same `translateX` on a clip child throws "SVG clip paths transformed with CSS are not
  supported."
- **Evidence:** REPRO (`zz-14-css-twin.test.ts`, both fallback and worker). Artwork bounds were
  `[0,0,10,10]`, `[10,0,20,10]` and `[-10,10,0,20]`. The clip cases threw.
- **Refuter:** CONFIRMED, P3 kept. I ran my own repro on all three routes with a 10 mm rect.
  - `style="transform:translateX(10px)"`, `translate:10px 0`, `rotate:90deg` and a `<style>`
    `translateY` rule all leave the rect at 0..10.
  - `rotate(90)` with `transform-origin="5 5"` lands at x −10..0 instead of staying in place.
  - `rotate(0.25turn)` rotates 0.25°.
  - The same `translateX` on a clip child is refused.

  The code agrees: `parseTransformNumbers` drops units, and an unknown function becomes the
  identity.
- **Fix direction:** Reuse the clip module's strict detection for artwork. Either support these CSS
  forms or refuse or disclose them, as clips already do.

### P3-2 — The streamed worker answers a namespace-prefixed SVG with a raw `TypeError`
- **Where:** `src/io/svg/parse-svg-worker.ts:69` removes every element whose qualified tagName is
  not in `SAFE_SVG_TAGS`. With saxes in non-namespace mode (`read-xml-document-from-blob.ts:47`)
  that includes the root `<svg:svg>`. `src/io/svg/parse-svg.ts:373` then reads
  `null.tagName`.
- **Anchor:** Ground truth (Namespaces in XML: `<svg:svg xmlns:svg="http://www.w3.org/2000/svg">` is
  an SVG document that browsers render); METHOD L6 (fail with a truthful message).
- **Scenario:** a prefixed SVG gives the toast "Could not import x.svg: Cannot read properties of
  null (reading 'tagName')" on the production route. The fallback says "document must contain a
  root element". A UTF-16 file is decoded as UTF-8 (`read-xml-document-from-blob.ts:27`) and fails
  as "text data outside of root node" (stream) or with the same `TypeError` (worker-text).
- **Evidence:** REPRO (`zz-14-svg-adversarial.test.ts`): `prefixed.workerStream.error =
  "TypeError: Cannot read properties of null (reading 'tagName')"`.
- **Refuter:** CONFIRMED, P3 kept.
  - My repro of `<svg:svg xmlns:svg=…>` throws the raw `TypeError … (reading 'tagName')` on both
    worker routes, not only the streamed one. The fallback says "document must contain a root
    element".
  - The streamed route uses the same `linkedom/worker` DOM in production as in the test.
    `import-toasts.ts:72` shows the reason verbatim.
  - The UTF-16 part was checked by reading only: `TextDecoder('utf-8')` is hard-coded.
- **Fix direction:** Guard a missing root with a readable error, and either resolve namespaces or
  name the limitation. Sniff a UTF-16 BOM, or report the encoding.

### P3-3 — Entity references that the main route refuses are silently left unexpanded on the other two routes
- **Where:** `src/io/xml/internal-subset-entities.ts:108` ignores entity values that contain `&`,
  and SYSTEM entities are ignored. The streamed builder
  (`src/io/xml/read-xml-document-from-blob.ts:109-121`) then refuses the reference ("undefined
  entity"). `expandInternalSubset` (fallback and worker-text routes) leaves `&b;` as literal text.
- **Anchor:** Twin (ADR-269 item 7: the routes share one geometry walk and are meant to agree).
- **Scenario:** `<!ENTITY a "aa"><!ENTITY b "&a;&a;">` with `&b;`, or `<!ENTITY ext SYSTEM …>`:
  - The production route fails with "SVG parse error: …: undefined entity".
  - The fallback and worker-text routes import, keeping the literal reference. If it sat in a
    `style` attribute, that styling is silently lost.
- **Evidence:** REPRO (`zz-14-svg-adversarial.test.ts`): `nestedEntity` and `externalEntity` gave
  `ok` on fallback and workerText and `error … undefined entity` on workerStream.
- **Refuter:** CONFIRMED, P3 kept.
  - Repro: `<!ENTITY a "stroke:#00f;"><!ENTITY b "&a;fill:none;">` with `style="&b;"`.
  - The fallback and worker-text routes import the rect with its stroke still `#ff0000`, so the
    style is lost with no note. The streamed route refuses it ("undefined entity").
  - Illustrator's own entities are flat, so nested ones are rare in real files.
- **Fix direction:** Make the text routes refuse an ignored-entity reference the same way (or make
  all three expand nested entities under the existing budget).

### P3-4 — A DXF with no units, or `$INSUNITS 0`, imports as millimetres with no note
- **Where:** `src/io/dxf/dxf-document-stream.ts:28` (`0: 1`) and `:98-121` (the default scale is
  1; only an unrecognized value produces a note).
- **Anchor:** Ground truth: LightBurn's reference says that if a DXF "doesn't contain its units,
  you should select the unit … Otherwise, the DXF may import at the wrong scale"
  (docs.lightburnsoftware.com Settings reference). Twin: an unrecognized `$INSUNITS` gets an
  "assuming millimeters" note, but a missing or unitless one gets none.
- **Scenario:** an R12 or unitless inch drawing with a 10-unit line imports as 10 mm (25.4× too
  small), and the toast says only "Imported 1 path".
- **Evidence:** REPRO (`zz-14-dxf-probe.test.ts`): `unitless0` and `noHeader` gave
  `{"notes":[],"bounds":[10,0]}`, while `km` gave the note "Unrecognized $INSUNITS 7 — assuming
  millimeters."
- **Refuter:** CONFIRMED, P3 kept.
  - Repro: with `$INSUNITS 0`, and with no HEADER at all, a 10-unit line imports as 10 mm with
    `notes=[]`. `$INSUNITS 7` gets the "assuming millimeters" note.
  - The LightBurn reference I fetched agrees: when a file has no units, the user should pick
    them.
  - LightBurn itself falls back silently to its configured unit. So the twin is the internal
    note/no-note mismatch, not LightBurn's behaviour.
- **Fix direction:** Add the same "no units in file — assumed millimetres" note, or offer a unit
  choice as LightBurn does.

### P3-5 — DXF layer true colour (group 420) is ignored, so BYLAYER entities take the approximate ACI colour and distinct layers merge into one operation
- **Where:** `src/io/dxf/dxf-document-stream.ts:129-136` (`readLayer` reads only 62/70). Twins:
  `src/io/dxf/dxf-expand.ts:339` honours 420 on entities, and KerfDesk's own writer emits it on
  layers (`src/io/dxf/dxf-writer.ts:293`).
- **Anchor:** Twin (entity against layer; writer against reader); Ground truth (ezdxf `Layer`
  defines `"true_color": DXFAttr(420, dxfversion=DXF2004)`, `ezdxf/entities/layer.py:85`).
- **Scenario:** layers CUT (ACI 1, true colour #ff8000) and SCORE (ACI 1, true colour #c00000)
  with BYLAYER lines both import as `#ff0000` in one path, so they get one operation and one
  power. CAD shows two colours.
- **Evidence:** REPRO (`zz-14-dxf-layer.test.ts`): `[["#ff0000",2],["#00ff00",1]]` (the entity-level
  420 green was kept).
- **Refuter:** CONFIRMED, P3 kept. In my repro, layers CUT (ACI 1, 420 #ff8000) and SCORE
  (ACI 1, 420 #c00000) with BYLAYER lines imported as one `#ff0000` path with 2 polylines.
  The ezdxf `layer.py` I fetched defines `"true_color": DXFAttr(420, dxfversion=DXF2004, …)`.
- **Fix direction:** Read 420 in `readLayer` and prefer it over the ACI approximation.

### P3-6 — A fit-point-only DXF SPLINE (valid for AutoCAD) is dropped with a cryptic note
- **Where:** `src/io/dxf/dxf-entities.ts:179` reads only control points (group 10); fit points
  (11/21) are ignored. `src/io/dxf/dxf-spline.ts:41` then fails.
- **Anchor:** Ground truth: the ezdxf SPLINE documentation says "A SPLINE can be created just from
  fit points - knot values and weights are optional (tested with AutoCAD 2010)."
- **Scenario:** a script-generated DXF (`ezdxf add_spline(fit_points)`) loses every curve. The
  toast says "SPLINE skipped: spline needs 4 control points, has 0".
- **Evidence:** REPRO (`zz-14-dxf-probe.test.ts` `splineFitOnly`): `skipped "1 SPLINE"`, note as
  quoted.
- **Refuter:** CONFIRMED, P3 kept.
  - Repro: a SPLINE with only fit points (`74=4`, no 10/40 groups) is skipped with "spline needs
    4 control points, has 0".
  - The ezdxf quote checks out against the SPLINE page.
  - AutoCAD writes control points as well as fit points, so mainly script-generated files hit
    this.
- **Fix direction:** Interpolate through the fit points (or at least the fit polyline), or say
  plainly that fit-point splines are not supported.

### P3-7 — A rational SPLINE with a non-positive weight produces points far outside its control hull, past the coordinate-magnitude intent and with no note
- **Where:** `src/io/dxf/dxf-entities.ts:192` (weights accepted if finite) and
  `src/io/dxf/flatten-spline-to-tolerance.ts:103` (the flatness bound assumes positive weights).
  The magnitude cap (`dxf-entities.ts` `hasUnreadableGeometry`) checks input tags only.
- **Anchor:** Ground truth (a NURBS curve is in its control hull only for positive weights; the
  file's own comment says "Positive-weight rational Bezier points are convex combinations");
  Contract (the import-boundary magnitude rejection the DXF code mirrors from SVG).
- **Scenario:** a quadratic SPLINE with control points inside 10 × 10 mm and weights `1,-1,1`
  imports a 425-point polyline spanning 1,280 × 81,915 mm. The bed-fit then shrinks the whole
  import.
- **Evidence:** REPRO (`zz-14-dxf-probe.test.ts` `splineNegWeight`):
  `bounds [1280,81915]`, notes `[]`.
- **Refuter:** CONFIRMED, P3 kept, and stronger than reported.
  - Weights `1,-1,1` reproduce 1280 × 81,915 mm with no note. But 81 m is inside the
    `DXF_COORDINATE_MAGNITUDE_MM = 1_000_000` cap, so the auditor's own example does not show the
    cap claim.
  - Weights `1,-2,1` give 5.6e12 × 9.1e12 mm, and `1,-1.001,1` gives 7.7e12 mm. Both are finite,
    far past the cap, and carry no note.
  - Do such files occur? I found no CAD tool documented to write non-positive weights, and the
    standard NURBS form assumes w > 0. So only corrupt or crafted files hit this; it stays latent
    (P3).
- **Fix direction:** Refuse or skip a SPLINE with a weight ≤ 0, with a note.

### P3-8 — `<ellipse>` without `ry` (SVG 2 `auto`) imports nothing, unlike `<rect>`, which implements `auto`
- **Where:** `src/io/svg/shape-to-polylines.ts:164-165`. A missing `ry` falls back to 0 and the
  ellipse is dropped. `rectToSubs` (same file) implements the SVG 2 auto radii.
- **Anchor:** Ground truth: in SVG 2 geometry, rx/ry initial value `auto` resolves to "the
  absolute length used for ry/rx" (https://www.w3.org/TR/SVG2/geometry.html). Twin: the rect
  corner radii.
- **Scenario:** `<ellipse cx="50" cy="50" rx="10">` imports as "SVG has no drawable geometry". A
  browser draws a circle of radius 10.
- **Evidence:** REPRO (`zz-14-svg-probe.test.ts` `ellipseAuto`: `null notes=["SVG has no drawable
  geometry"]` on both routes).
- **Refuter:** CONFIRMED, P3 kept. My repro on all three routes: `<ellipse cx cy rx="10">` gives
  "SVG has no drawable geometry". In the SVG 2 geometry chapter I fetched, rx/ry start as `auto`,
  and an auto ry takes rx's absolute length. Only hand-written or minified files omit ry.
- **Fix direction:** Resolve a missing or auto ellipse radius from the other one, as `rectToSubs`
  does.

### KNOWN (re-verified, not counted as new)
- **K-1 (ten-loop 2026-08-30 loop-01, line 101: "SVG walk depth 256 … undisclosed partial geometry
  … not runtime-reproduced").**
  - **Now reproduced:** with 300 nested `<g>`, all three routes return "SVG has no drawable
    geometry". At depth 5000 the deep path is dropped silently while a shallow sibling imports
    (`polylines=1`).
  - The fallback route instead fails inside DOMPurify ("a node selected for removal could not be
    detached…").
  - `src/io/svg/parse-svg.ts:136,150`. P3. Fix: count and disclose dropped subtrees.
- **K-2 (03-P2-9 / 03-P1-2).** DXF LINE (and ARC) ends are never joined. `twoArcs` here gives two
  open polylines for a full circle.
- **K-3 (10 K-1).** Dogbone loses DXF holes. Not re-checked here.
- **K-4 (July DXF P2-1).** Nested INSERT/MINSERT has no aggregate budget. ADR-269's "Nested DXF
  amendment (2026-09-05)" now accepts this explicitly: "no new count limit", the work is
  cancellable in a worker, and `dxf-nested-insert.test.ts` pins 150,000 instances from < 500 bytes.
  Note the policy twin: ADR-268 Amd 1 bounds the SVG `<use>` form of the same amplification. A
  worker OOM can still take the renderer down; this is for the maintainer to judge.
- **K-5 (July DXF P3-2).** INSERT transform tags bypass the unreadable/magnitude gate. Still live:
  `10=nan` places the block at 0 silently, and `10=1e12` is accepted (`dxf-expand.ts:270-282`).
- **K-6 (July DXF P3-4).** `$INSUNITS` table gaps. Still live: 7 (km) and 21 (US survey feet) get
  "assuming millimeters".
- **K-7 (July DXF P3-6).** `transformCurve`'s unguarded arc branch (`dxf-expand.ts:326`). Still
  present, and unreachable today because DXF native curves are cubics.

## Refuted
The refuter refuted none of the nine raised findings. It refuted one sub-claim of P2-1:
- **"ADR-046's Illustrator rationale is wrong: Illustrator writes `px` at 72 per inch, or no size
  at all."** Only partly true. The Glowforge thread the auditor cites contains a 2017 diff in which
  a non-responsive Export As wrote `width="25.4mm" height="25.4mm" viewBox="0 0 72 72"`. A 2016
  Adobe Community post shows a `pt`-suffixed export. Both import at true size here (repro: 25.4 mm).
  So ADR-046's "Illustrator mm-sized exports import at true physical size" is accurate for that
  export form. Its gap is that it says nothing about the commoner viewBox-only and `px`/unitless
  forms. The test comment at `parse-svg.test.ts:83` is fine as written.

(The auditor's own candidates, rejected before raising.)
- **INSERT scale or mirror leaves elliptical-arc radii and sweep untransformed
  (`dxf-expand.ts:326`).** Unreachable: `parametricEllipseCurve` emits cubics only, and the bulges
  and arcs use it. A repro with an `xscale=-1` and `-Z` INSERT around an ARC is exact. (Kept as
  K-7.)
- **An SVG page larger than the bed shrinks small artwork.** The production fragment route gives
  each entry geometry bounds (`svg-import-entries.ts:36`), so the bed fit measures the artwork,
  not the page.
- **The PDF page size ignores /UserUnit.** PDF.js 6.3 `PageViewport` multiplies scale by
  `userUnit` (`pdfjs-dist/build/pdf.mjs:826`).
- **An HPGL file without `SP` imports nothing.** HP LaserJet HP-GL/2 notes say SP "must be used to
  enable printing"; the importer's note is truthful.
- **The root `transform` is applied inside the viewBox.** ADR-574 places root transforms out of
  scope ("Root transforms … unchanged").

## Verified clean
- **Path grammar** (SVG 2 path data), 14 crafted strings:
  - `Z` then implicit subpath, and `z m` relative;
  - S after C and S after Q, T after Q and T after L (reflection rules);
  - fused arc flags `a5 5 0 1010 0`, large-arc and sweep, implicit lineto after `m`;
  - exponents and `.5.5`, render-up-to-error.
- **Root mapping:** mm, pt and in `width`/`height` with a viewBox; no viewBox means 96 px/in user
  units with the page in mm; `%` and `em` are treated as undeclared, as ADR-046 says; nested
  `<svg>` x/y/viewBox; `<symbol>` through `<use>` with and without width/height (SVG 2 `auto` →
  100 %); `xlink:href`.
- **Styles and colours:** `<style>` class rules including CDATA; colour forms (named, `#rgb`,
  `rgb()`/`%`, `hsl`, `hwb`, 8-digit hex, CSS 4 space syntax) all normalise to lowercase `#rrggbb`.
- **Untrusted SVG** (L5): quadratic entity blowup (4,000-char entity × 20,000 references) is refused
  at 8,388,608 characters on all routes in ≤ 16 ms; external DTD and SYSTEM entities are never
  fetched; a 20⁴ `<use>` bomb is refused with the ADR-268 Amd 1 message (0.9–2.1 s); a path with
  400,000 segments imports in 0.23–0.91 s with the "Large SVG" note; an extreme coordinate (`1e300`)
  is refused; a 2,000-selector descendant chain finishes in ≤ 2.3 s. The worker sanitizer removes
  `on*` attributes and non-local or non-image `href`s.
- **DXF** (checked against hand-computed expected values):
  - ARC, LWPOLYLINE bulge and ELLIPSE under extrusion −Z (the Arbitrary Axis Algorithm mirror);
  - INSERT with xscale −1, with −Z OCS, and with rotation + scale + base point;
  - CRLF, padded values and exponent values; hidden and frozen layers, paper space;
  - binary DXF refusal, truncated-file error;
  - Float64 packing across the worker boundary (`packed-dxf-result.ts`).
- **HPGL:** 40 plotter units per mm; Y flip; Inkscape's default `.hpgl` output (no `IN`, leading
  `;`, `SP1`, 1016 dpi; checked against Inkscape's `hpgl_output.inx` and `hpgl_encoder.py`);
  PA/PR, AA, CI, lowercase and space separators; whole-file refusal with a source diagnostic for
  VS/PW/RO/PG/PCL, as ADR-357 §7 specifies.
- **PDF:** page size 72 pt/in including UserUnit; any text, image, clip, dash, complex colour or
  unknown operator sends the page to the rendered-image route (ADR-357 §5).
- **STL:** binary length signature is authoritative; NaN and Infinity vertices are refused on both
  the ASCII and binary routes; the streamed and whole-buffer parsers use the same detection order.
- **Palette writers:** the ASE block layout (UTF-16BE name with NUL, `RGB `, float32 ×3, type 2
  Normal) and the GPL and CorelDRAW XML forms.

## Not verified
- **AutoCAD's own DXF form for closed periodic splines.** ezdxf quotes the Autodesk developer docs
  as saying that for a periodic spline "the length of knot vector will be greater than the length
  of the control array by 1". If AutoCAD writes that to DXF, the importer's knot-count check would
  skip the spline. KerfDesk's periodic test (`dxf-entities.test.ts:9-45`) uses a synthetic clamped
  fixture and asserts only `closed`. A real AutoCAD sample is needed; this is the most likely
  remaining DXF gap.
- **Illustrator defaults.** Whether "Responsive" is ticked by default in current Illustrator (the
  sources found do not say), and whether LightBurn auto-detects Illustrator files.
- **Whether CorelDRAW PLT output ends with `PG;`,** which ADR-357 §7 would refuse. No primary sample
  was found.
- **ACI 10–249** use a documented hue-band approximation (e.g. ACI 14 → `#a60000`); the real table
  was not compared entry by entry.
- **Writers** under `src/io/vector-formats/**` and `src/io/dxf/dxf-writer.ts` were only skimmed for
  unit constants; round-trip fidelity was not tested. `src/io/text/prepare-text-shaping.ts` (WASM
  loader) was read only.
- **Embedded raster images in SVG** (`svg-image-element.ts`, decode-size bombs) were left to the
  raster areas. In-browser rendering against these imports (Chrome as an oracle) was not run; the
  browser expectations quoted above come from the specifications.
- **Renderer-level OOM** behaviour of a worker given a nested-INSERT bomb (K-4) was not exercised
  in a real browser.

```json
[
  {"id":"P2-1","severity":"P2","area":"vector-importers","file":"src/io/svg/svg-units.ts","line":16,"anchor":"Ground truth: LightBurn SVG DPI 96 (Inkscape) / 72 (Illustrator); Glowforge thread on Responsive export; Twin: PDF route 72pt=25.4mm (pdf-vector-page.ts:69); Contract drift ADR-046 Consequences","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Illustrator SVG imports at 75% (72px or unitless artboard -> 19.05 mm) and a viewBox-only export (current Illustrator default) at 283% (72 units -> 72 mm); no DPI choice or Illustrator detection, while the same .ai imports at true size. Refuter: viewBox-only half KNOWN (2026-07-17 BQ-20); ADR-046 contract-drift sub-claim partly refuted (mm-sized Export As exists)"},
  {"id":"P3-1","severity":"P3","area":"vector-importers","file":"src/io/svg/svg-presentation.ts","line":113,"anchor":"Twin: svg-clip-presentation.ts:15-16 refuses CSS transforms (ADR-358 Amd 2 item 4); Ground truth: SVG 2 transform property, CSS Transforms","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"CSS translateX/translate/rotate/transform-origin/turn units on artwork silently ignored or misread; same constructs on clips are refused"},
  {"id":"P3-2","severity":"P3","area":"vector-importers","file":"src/io/svg/parse-svg-worker.ts","line":69,"anchor":"Ground truth: Namespaces in XML; METHOD L6 truthful failure","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Namespace-prefixed <svg:svg> on the production worker route fails with raw TypeError 'Cannot read properties of null (reading tagName)'; UTF-16 files decoded as UTF-8"},
  {"id":"P3-3","severity":"P3","area":"vector-importers","file":"src/io/xml/internal-subset-entities.ts","line":108,"anchor":"Twin: streamed worker vs fallback/worker-text routes (ADR-269 item 7)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Nested or SYSTEM entity references refused as 'undefined entity' on the streamed route but silently left as literal text on the other two routes"},
  {"id":"P3-4","severity":"P3","area":"vector-importers","file":"src/io/dxf/dxf-document-stream.ts","line":28,"anchor":"Ground truth: LightBurn DXF units guidance; Twin: unrecognized $INSUNITS gets a note","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Unitless ($INSUNITS 0) or header-less DXF silently assumed millimetres with no note"},
  {"id":"P3-5","severity":"P3","area":"vector-importers","file":"src/io/dxf/dxf-document-stream.ts","line":129,"anchor":"Twin: entity 420 (dxf-expand.ts:339) and writer layer 420 (dxf-writer.ts:293); Ground truth: ezdxf Layer true_color DXFAttr(420)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"LAYER true colour ignored: BYLAYER entities take approximate ACI colour and distinct true-colour layers merge into one operation"},
  {"id":"P3-6","severity":"P3","area":"vector-importers","file":"src/io/dxf/dxf-entities.ts","line":179,"anchor":"Ground truth: ezdxf SPLINE docs, fit-point-only splines tested with AutoCAD 2010","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Fit-point-only SPLINE dropped with 'spline needs 4 control points, has 0'"},
  {"id":"P3-7","severity":"P3","area":"vector-importers","file":"src/io/dxf/dxf-entities.ts","line":192,"anchor":"Ground truth: NURBS convex hull needs positive weights (own comment flatten-spline-to-tolerance.ts:101); Contract: import-boundary magnitude rejection","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"SPLINE with weight <= 0 imports points ~82 m outside a 10 mm control hull, with no note; refuter: weights 1,-2,1 give 9.1e12 mm, past the 1e6 mm cap"},
  {"id":"P3-8","severity":"P3","area":"vector-importers","file":"src/io/svg/shape-to-polylines.ts","line":164,"anchor":"Ground truth: SVG 2 geometry rx/ry auto; Twin: rectToSubs auto radii","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"<ellipse rx> without ry imports nothing ('no drawable geometry') instead of a circle"},
  {"id":"K-1","severity":"P3","area":"vector-importers","file":"src/io/svg/parse-svg.ts","line":150,"anchor":"Contract: ADR-268 integrity bound vs undisclosed loss","evidence":"REPRO","verdict":"PENDING","known":true,"summary":"Elements nested deeper than 256 silently dropped; 300-level file reports 'no drawable geometry' (ten-loop loop-01 candidate, now reproduced)"},
  {"id":"K-2","severity":"P2","area":"vector-importers","file":"src/io/dxf/dxf-entities.ts","line":56,"anchor":"see 03-P2-9","evidence":"REPRO","verdict":"PENDING","known":true,"summary":"DXF LINE/ARC ends never joined (03-P2-9 / 03-P1-2)"},
  {"id":"K-3","severity":"P2","area":"vector-importers","file":"src/io/dxf","line":0,"anchor":"see 10 K-1","evidence":"READ","verdict":"PENDING","known":true,"summary":"Dogbone loses DXF holes (10 K-1), not re-checked"},
  {"id":"K-4","severity":"P3","area":"vector-importers","file":"src/io/dxf/dxf-expand.ts","line":246,"anchor":"Contract: ADR-269 nested-DXF amendment accepts it; twin ADR-268 Amd 1 SVG <use> budget","evidence":"READ","verdict":"PENDING","known":true,"summary":"Nested INSERT/MINSERT has no aggregate budget (July DXF P2-1), now accepted by ADR-269"},
  {"id":"K-5","severity":"P3","area":"vector-importers","file":"src/io/dxf/dxf-expand.ts","line":270,"anchor":"see July DXF P3-2","evidence":"REPRO","verdict":"PENDING","known":true,"summary":"INSERT NaN/huge insertion point bypasses unreadable/magnitude gate"},
  {"id":"K-6","severity":"P3","area":"vector-importers","file":"src/io/dxf/dxf-document-stream.ts","line":27,"anchor":"see July DXF P3-4","evidence":"REPRO","verdict":"PENDING","known":true,"summary":"$INSUNITS 3/7/8/11/12/15-21 missing; km and US survey feet assumed mm"},
  {"id":"K-7","severity":"P3","area":"vector-importers","file":"src/io/dxf/dxf-expand.ts","line":326,"anchor":"see July DXF P3-6","evidence":"READ","verdict":"PENDING","known":true,"summary":"transformCurve arc branch unguarded (unreachable today)"}
]
```
