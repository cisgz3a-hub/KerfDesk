# T06 Fill Selection — refuter report
Tree: origin/main @ 856cb3ae1 (`C:\Users\stolk\kd-t1\t06-main`). Command id: `tools.fill-selection`. Scratch: `C:\Users\stolk\kd-t1\zz-t06r`.

## Verdicts

| Claim | Verdict | One line |
|---|---|---|
| T06-P1-1 | **CONFIRMED, P1** | Reproduced with three real LightBurn `.clb` libraries from the tree's own corpus, with an independent decode. Fill Selection fills at the cut recipe and stays linked to it. The inspector switch on the same shape takes the engrave recipe. Energy ratio with real libraries on the default device: 11.7× to 24.7×. The auditor's 38.6× is correct arithmetic, but only for the repo test fixture. No Job Review warning, and the review label says the cut preset is "linked current". Nothing makes the bypass deliberate. |
| T06-P2-1 | **CONFIRMED at P2, scope narrowed, oracle corrected** | The reset of tuned Fill settings stands, and a plain LightBurn import reaches it: a Scan layer with two shapes goes from 25 %/3000/0.2 mm/45° to 30 %/1500/0.1 mm/0°. Dropping the other operations is the command's documented "Move" behaviour, so that part is P3 (it is already P3-6). The auditor's oracle is wrong: ADR-496 §4 lists Fill selection among the places that create a fresh operation. The right oracle is "Make unique" and the tool's own unshared path, which both keep the settings. |
| T06-P2-2 | **SEVERITY CHANGED → P3** | The silent no-op reproduces. But "an Undo step each press" is wrong: there is one step on the first press, and a second press returns `{}` (undo +1 after two presses). In the more plausible variant (op Fill, artwork-own Line) nothing changes and there is no Undo step at all. Reach is narrow: no UI control creates an artwork-own override on drawn or imported art. The inspector already says "This artwork has its own settings" and shows its Mode. |

### T06-P1-1: is the bypass deliberate? No.
- **ADR-496 §6** applies to any mode switch: "When an operation still exactly as its linked recipe left it is switched to another mode, it takes the best recipe for the new mode. So a cut switched to Fill does not engrave at cutting power." It names no surface.
- **Amendment 1** (2026-10-22) extended §6 to the Cut Settings Process select, after rolling-v2 06-P2-3. Its refuter wrote: "ADR-496 §6 names 'a mode switch' with no surface restriction … so it is not a deliberate scope." The same reasoning covers Fill Selection.
- **ADR-496 §4** names Fill Selection: "Add layer and Fill selection separately". So the ADR author had the tool in view. Commit 2b6427392 wired only the isolate branch (`seedFreshLaserLayer`) and left `ensureOperationIsFill` alone. The commit message says "An untouched operation switched to another mode takes that mode's recipe" without exceptions.
- **No other document scopes the tool:**
  - WORKFLOW F-A7g item 3: "Switching an untouched operation to another mode takes that mode's recipe".
  - No Fill-repair ADR or WORKFLOW section describes Fill Selection. Its only spec is the help tooltip, "Move selected vector artwork to its own Fill layer" (`command-help-topics.ts:206`).
- **LightBurn:** LightBurn has no Fill Selection command, and a layer mode change there keeps the layer's numbers. KerfDesk decided otherwise for recipe-linked operations (§6). With no linked recipe, or no recipe for the new mode, KerfDesk also keeps the numbers (LightBurn-like). So the ADR wants Fill Selection to behave like the inspector switch, and LightBurn parity does not apply to linked operations.

### T06-P1-1: how common is the path?
- **Every drawn shape owns its operation.** `draw-shape-mutation.ts:14` calls `createArtworkOperation`, and drawing leaves the new shape as the sole selection (`:18-21`). Text and SVG import go through `createArtworkOperation` too. Each new operation is seeded by `seedFreshOperation` → `seedFreshLaserLayer` (`fresh-operation-seeding.ts:41`). So "draw a shape, then Tools → Fill Selection" always takes the in-place branch.
- **It needs a Job material with "Take the best recipe" on.** ADR-496 §1-2 make this opt-in, but the switch is on as soon as a material is picked. It also needs a library holding both a cut and an engrave recipe for that material.
  - Every importable `.clb` in the tree's real corpus (`src/__fixtures__/lightburn/external/clb/`) pairs them: h3mul Basswood 2 mm cut 80 %/1100/3 passes with engrave 30 %/3400, Jayson Laser Plywood 3.3 mm, and DDLab Plywood (Finer) 3 mm (`r00-clb-scan.log`).
  - The **shipped Neotronics starter library has no Fill/engrave recipe** (`neotronics-4040-presets.ts`: line and image presets only). There, Fill Selection and the inspector burn the same (100 %/500, both by ADR design). The only difference is that Fill Selection keeps the cut link, which the inspector drops.
  - So the P1 burn needs a user or imported library. A LightBurn library is exactly what a migrating user imports.
- **Nothing flags it before Start.**
  - Preflight issues and `prepareOutput` advisories: none (`codes=[]`).
  - `detectJobIntentWarnings` gives the same two technical notes for the Fill Selection and inspector results. Both fold under Technical notes (`isTechnicalJobIntentNote`).
  - The only energy advisory (`raster-energy-warnings.ts`, ADR-359) measures Image operations only.
  - Job Review's material label (`boundMaterialLabel`) reads "Basswood 2 mm — linked current (revision lightburn-clb-import-v1)". It names the material and thickness, not the preset's mode. So the review actively reassures the operator that a cut preset on a Fill is current.
- **Why P1 and not P2 like rolling-v2 06-P2-3.** That finding was the same bypass in Cut Settings, and it was rated P2 because "the values are visible in the dialog" the user had just applied. Fill Selection has no dialog. The press shows no settings, the result is a whole-area hatch at cut power and passes (fire and char risk on wood), and the review says the link is current. That is "wrong burn" in AREAS.md.

### T06-P1-1: energy ratio (my decode)
Dose is Σ S·len/F over lit G1 moves (proportional to delivered energy; the area is the same 20 × 10 mm rectangle in both runs).

| Library / material | Fill Selection | Inspector switch | Ratio |
|---|---|---|---|
| h3mul Basswood 2 mm | fill p80 s1099.998 ×3 passes, `basswood-cut-3`; S800 F1099, 6000 mm lit | fill p30 s3400, `basswood-engrave-4`; S300 F3400, 2000 mm | **24.7×** |
| Jayson Laser Plywood 3.3 mm | p80 s2400, cut preset; S800 F2400 | p15 s24000 → F clamped to 6000 (device max), S150 | **13.3×** (53× before the feed clamp) |
| DDLab Plywood (Finer) 3 mm | p35 s900, `plywood-finer-cut-19`; S350 F900 | p20 s9000 → F6000, S200 | **11.7×** |
| Shipped Neotronics starter, Basswood / plywood 3 mm | p100 s500, cut preset kept | p100 s500, link dropped | 1.0× (no engrave recipe exists) |

- The auditor's 38.6× (0.9 × 2/400 ÷ 0.35/3000) is right for its fixture. That fixture is the repo's own test library (`laser-recipe-seeding.test.ts:36-44`), so the figure is not a measurement on a real library. With real libraries the ratio is about 12–25× on the default 400 × 400 profile. This is still far beyond any engraving tolerance.
- Ownership dependence is confirmed independently. Two drawn shapes selected together take the isolate path and get `basswood-engrave-4` (30 %/3400). One shape alone gets the cut recipe.

### T06-P2-1 details
- The result depends on whether the operation is shared, which the user cannot see. With the same tuned Fill (25 %/3000/0.2/45°):
  - Shared operation → Fill Selection gives `fill p30 s1500 sp0.1 ang0`. That is 4.8× the dose on artwork that was already filling.
  - **Make unique** on the same shared operation gives `p25 s3000 sp0.2 ang45`, identical, and the dose is unchanged at 166.66.
  - Unshared operation → Fill Selection changes nothing.
- **Real reach:** importing a LightBurn `.lbrn2` (via `importLightBurnProject`) with a Scan layer and two shapes gives two objects on one Fill op. Fill Selection on one shape resets it to 30 %/1500/0.1/0°, and the G-code gains S300/F1500 rows. A Scan+Cut (Fill+Line) layer opens as fill + line ops on one shape (ADR-388). Fill Selection then leaves one default Fill op, `p30 s1500`: the LightBurn scan settings are lost, and the cut is removed.
- **Oracle correction:** ADR-496 §4 places "Fill selection separately" beside "Add layer" as a point where a new operation takes Make Default and the job recipe. It does not put it with "pasted and cloned operations keep the settings they carry". So the ADR does not forbid a fresh op. It never considered a source that already fills. The stronger oracle is the tool's own unshared branch and Make unique.
- **Dropping other operations:** the tooltip says "Move selected vector artwork to its own Fill layer", and assigning to a layer moves artwork in KerfDesk and LightBurn alike. That half is design, at most P3 for the missing notice (the auditor's P3-6).
- **Severity:** P2. The burn changes on artwork the user had tuned, with no notice. It is visible in the new operation row, and the source already filled, so it is not P1.

### T06-P2-2 details
- Variant 1, the plausible one: op Fill, artwork-own `{power:20, mode:'line'}`. Fill Selection returns `{}`: the project is the same object, undo +0, and the burn is still the 60 mm outline. A silent no-op.
- Variant 2, the auditor's: op Line, own mode Line. The first press flips the op to Fill and the burn is unchanged. The **second press is a no-op** (`ensureOperationIsFill` sees `mode === 'fill'`). Total undo +1 after two presses, not +2.
- **How an override gets there.** The inspector writes `mode` into the override only when `editsOwnSettings` is true, which needs an override to exist already (`SelectedOperationInspector.tsx:255-257`). Nothing in the UI creates the first one on drawn or imported art:
  - `setSelectedObjectsOperationOverride` has no UI caller;
  - "Make unique" clones the operation (`clone-artwork-operations.ts`; `?? null` adds no override);
  - fresh imports strip SVG source-mode overrides (`artwork-operation.ts:71`, `scene-mutations.ts:354`);
  - the v2 migration folds legacy overrides into operation clones (`migrate-v2-operation-bindings.ts:132`).
- Sources found: Material Test cells (top-level override for non-power columns, `material-test-grid.ts:323-340`) and artwork derived from such objects by weld, boolean, offset or join, which keep `operationOverride`. READ only: I did not check whether a re-trace keeps the trace's `{mode:'fill', fillStyle}` (`ImportImageDialog.tsx:462-469`).
- The inspector shows "This artwork has its own settings. The values shown here are used for its output." with Mode Line, so the cause is visible. That is a narrow, self-explaining no-op, so P3. The fix direction stays the same: clear `mode` from the selected artworks' overrides, or give a notice.

## Evidence
All runs used the tree's real modules through Vitest (`--maxWorkers=1`, `NODE_OPTIONS=--no-experimental-webstorage`, jsdom), with my own config `zz-t06r/vitest.config.mts`. Free memory was 2.8 GB. There was no browser run.

My method differs from the auditor's:
- Libraries are the tree's **real** LightBurn `.clb` corpus through `importLightBurnClb`, plus `buildStarterLibrary` for the shipped Neotronics presets, not a hand fixture.
- G-code is decoded by my own parser in `r01-fill-selection.test.ts`: modal G, M3/M4/M5, S and F, with dose Σ S·len/F. I did not use the auditor's `decode.ts`.
- I added Job Review's `boundMaterialLabel` and `detectJobIntentWarnings`, and the real `.lbrn2` importer.

Files:
- `C:\Users\stolk\kd-t1\zz-t06r\r00-clb-scan.test.ts` → `r00-clb-scan.log`: every corpus preset (material, thickness, mode, operation, settings).
- `C:\Users\stolk\kd-t1\zz-t06r\r01-fill-selection.test.ts` → `r01-fill-selection.log`: P1 (three CLBs, starter, two-shape), P2-1 (shared / Make unique / unshared), P2-2 (two variants), extra sub-layer case.
- `C:\Users\stolk\kd-t1\zz-t06r\r02-lbrn.test.ts`: LightBurn Scan and Scan+Cut reach (lines `LBRN …` in the same log).
- `C:\Users\stolk\kd-t1\zz-t06r\r03-review.test.ts`: job-intent warnings before and after (lines `REVIEW …`).

Key log lines (abridged):
```
P1 h3mul [Basswood 2] fill-selection: line p80 s1099.998 x3 preset=basswood-cut-3 -> fill p80 s1099.998 x3 preset=basswood-cut-3 | lit=6000.0mm S=800 F=1099 dose=4367.61 codes=[] | JobReview label: Basswood 2 mm — linked current
P1 h3mul [Basswood 2] inspector:      ... -> fill p30 s3400.002 x1 preset=basswood-engrave-4 | lit=2000.0mm S=300 F=3400 dose=176.47 | ratio 24.7x
P1 starter fill-selection: -> fill p100 s500 preset=neotronics-lt4lds-plywood-3mm-cut | dose=4000.00
P1 starter inspector:      -> fill p100 s500 preset=-                                 | dose=4000.00
P2-1 fill-selection: a now fill p30 s1500 sp0.1 ang0 | b fill p25 s3000 sp0.2 ang45 | dose 166.66 -> 483.33
P2-1 make-unique:    a now fill p25 s3000 sp0.2 ang45 | dose 166.66 -> 166.66
LBRN Scan after FS on first object: lbrn-badge-1[badge Fill:fill p30 s1500 sp0.1 ang0] lbrn-badge-2[Badge:fill p25 s3000 sp0.2 ang45]
LBRN Scan+Cut after FS: lbrn-badge-1[badge Fill:fill p30 s1500 sp0.1 ang0]   (was fill p25 s3000 sp0.2 ang45 + line p25 s3000)
P2-2 v1 op=fill own=line: after = before (60.0 mm outline) | project same=true undo+0
P2-2 v2 op=line own=line: op now fill, burn unchanged 60.0 mm | undo+1 after two presses
REVIEW fill-selection: 2 job-intent warnings, both technical notes (Generic Scan Line runways; no scan-offset table)
```

## Extra findings

### T06R-P3-1: In-place Fill Selection ignores a Fill sub-layer: the area is hatched twice, once at the parent's cut settings, and the outline is lost
- **Severity:** P3, because reach is very low. The behaviour is a wrong burn, but `layer.subLayers` can no longer be created in the app:
  - `LayerSubLayers.tsx` is not mounted anywhere outside a test;
  - LightBurn import materializes sub-layers as separate operations (`lbrn-sub-layers.test.ts`), which take the isolate path.
  - So only older projects that still carry `subLayers` reach it.
- **Where:** `fill-selection-actions.ts:108-111`. `ensureOperationIsFill` looks only at the parent's `mode`. `outputOperationLayers` (`layer.ts:468`) still emits every enabled sub-layer.
- **Repro:** `r01-fill-selection.test.ts`, case "extra". A drawn shape's operation is Line 80 %/600 with an enabled Fill sub-layer 20 %/3000/0.1. Before: 60 mm outline plus 2000 mm fill, dose 213.3. After Fill Selection: parent `fill p80 s600`, sub-layer kept, 4000 mm lit (the area twice), dose 2800 (13×). The outline is gone.
- **Oracle:** the artwork already filled through its sub-layer, and the tooltip promises "its own Fill layer", not a second fill at cut power.
- **Fix:** treat an operation whose enabled sub-layer already fills as Fill, or take the isolate path for operations with sub-layers.

No further P1/P2 found. Checked and clean:
- Command reach: menu and context bar only; no phone, MCP or remote caller (`rg fill-selection|fillSelection src`).
- Locked artwork: unreachable, as the auditor said.
- Raster in a shared operation: correctly routed to isolate, because the filtered raster counts as an unselected user.

## Totals
Claims checked 3:
- CONFIRMED 2: T06-P1-1 at P1; T06-P2-1 at P2, narrowed.
- SEVERITY CHANGED 1: T06-P2-2 from P2 to P3.
- Refuted 0.

Extra raised 1: T06R-P3-1 (P3). Known: none. Rolling-v2 06-P2-3 is the same §6 bypass on the Cut Settings surface, already fixed by ADR-496 Amd 1; Fill Selection is a separate surface it did not cover.
