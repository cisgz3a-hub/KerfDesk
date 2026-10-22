# Rolling audit v2 — Laser UI settings (06 `laser-ui-settings`)

- **When:** 2026-10-21 15:05–15:45   **Tree:** origin/main @ `faf5a54f1` (audit worktree HEAD
  `50321cbe0`; no `src/` difference between the two)
- **Scope:** `src/ui/layers/**` (operation inspector, inline laser fields, Cut Settings dialog,
  per-artwork overrides, power multiplier, sub-layer rows) and `src/ui/laser/job-review/**`
  (Job Review cards, Save, draft, store hold), plus the store actions they call
  (`setLayerParam`, `setObjectsOperationOverrideForOperation`, `updateLayerSubLayer`,
  `sceneWithModeSwitchRecipe`) and `core/effective-output`. Governing: ADR-317 (+ 2026-09-12
  amendment), ADR-306, ADR-348 Amd 1, ADR-224 (+ partial compiled summary amendment), ADR-638
  (+ Amd 1), ADR-646 (+ Amd 1), ADR-496 §6, ADR-629, WORKFLOW F-A7 and F-A6j.
- **Lenses run:** L1, L3, L4, L7 in depth; L6 lightly (Save/Apply failure paths). L2 skipped
  (no outside-world assumption in this UI beyond HTML constraint validation, checked by REPRO in
  jsdom). L5 skipped (no trust boundary in these folders; project-file input belongs to 13).
- **Counts:** 14 raised → refuter: 14 confirmed, 0 plausible, 0 refuted → P1 0 / P2 4 / P3 10
  (+ 1 KNOWN overlap, not re-raised). One severity change: P2-1 → P3 (not reachable from the
  mounted UI or any loadable older file; see P2-1).
- **Refuter (2026-10-21):** own repros, not the auditor's: `zz-06r-subop-undo.test.tsx`
  (job-review), `zz-06r-override-pin.test.tsx`, `zz-06r-cutsettings.test.tsx` and
  `zz-06r-p3.test.tsx` (layers), all driving the real inspector, Cut Settings, Job Review card or
  store action, with `compileJob`/`emitGcode` where output is claimed. Deleted afterwards.
- **Repros:** focused Vitest files named `zz-06-*.test.tsx` beside the code they import, run with
  `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run <file>`.
  They were temporary and have been deleted from the tree; each finding states its setup and the
  observed output.
- **Already known in this area (not re-raised):** 03-P2-6 (contour entry reported as effective),
  03-P3-11, 03-P3-15, 03-P3-16 (Job Review speed unrounded), 02-P2-1 (raw `setState` bypass in
  `personal-artwork-actions.ts`).

## Headline

The ordinary path is sound: a value typed in the inspector reaches the project and the G-code
exactly (37.5 % → `S375`, 100 in/min → `F2540`, 3 passes), blanks never commit, `1e3`/commas are
refused, and multi-selection Cut Settings writes only the fields that changed. The problems sit
where two surfaces model the same setting. (1) Job Review's sub-operation card shows and saves the
sub-operation's base while compile applies the artwork's parent override: it said 25 % "Saved"
and the job burned `S300`. (2) Cut Settings opened for **one** artwork that already has its own
settings writes every field into that artwork's override, so later operation edits silently skip
it while the inspector says "Edits apply to all of them". (3) Switching Process inside Cut Settings
skips the ADR-496 recipe reseed, so a cut switched to Fill keeps 90 % / 400 mm/min. (4) Cut
Settings' native number constraints refuse values the app itself stores (inch-entered speeds,
LightBurn powers and angles), blocking Apply for an edit elsewhere. (5) One Job Review Save is
several undo steps.

## Findings

### P2-1 (refuter: now P3, latent) — Job Review's sub-operation card shows and saves the base while compile burns the artwork's parent override
- **Where:** `src/ui/laser/job-review/JobReviewOperations.tsx:127` (`settings={subLayer.settings}`),
  `:131` (`onSave` → `updateLayerSubLayer` only); precedence at
  `src/core/effective-output/effective-output.ts:33` (`[layer.id, layer.bindingOperationId]`).
- **Anchor:** Contract — ADR-317 §4 "All effective laser settings consumers use the existing
  effective-operation helper"; Twin — the parent card in the same file (`:105`
  `reviewRowSettings` + `:146-154` artwork owners), which was fixed for exactly this
  (controller audit speed-2), and the hover readout (ADR-348 Amd 1 §2 resolves sub-operations
  through `effectiveOperationForObject`).
- **Scenario:** Operation "Cut" (80 %) with enabled sub-operation "Score" (20 %); artwork `a` on Cut
  with `operationOverride.byOperation.L = { power: 30 }` (the inspector writes this key when the
  artwork has its own settings). `layerFromSubLayer` sets `bindingOperationId = L`, so the Score
  run of `a` resolves to 30 %. Job Review: Score card reads **20 %**; Edit → 25 → Save shows
  **25 %** and "Saved"; the program still burns Score at **30 %**. Save changed nothing that runs.
  Only the folded **Partial compiled summary** shows 30 %.
- **Evidence:** REPRO — temporary `src/ui/laser/job-review/zz-06-subop.test.tsx` rendering
  `JobReviewOperations` and calling `prepareOutput`/`emitGcode`:
  `Power % for Cut Score=20` · compiled `{"layer":"L:S","power":30}` · `distinct S on G1 ["S300"]`;
  after Save: `Power % for Cut Score=25` · compiled still `{"layer":"L:S","power":30}`, `S300`.
- **Reachability note:** the sub-layer editor (`src/ui/layers/LayerSubLayers.tsx`) is no longer
  mounted (only a test renders it), so sub-operations come from projects saved while it was
  (2026-06-17 → 2026-09-22) and from hand-edited files. Job Review still shows editable cards for
  them.
- **Refuter:** CONFIRMED as a mechanism; **severity P2 → P3** (latent, not reachable by an ordinary
  user). Own repro (`zz-06r-subop-undo.test.tsx`, real card + `compileJob` + `emitGcode`): card
  `20` → Save → `25`, compiled `{"layer":"L:S","power":30}` and `S300` both times. Reachability is
  narrower than the note above: `<LayerSubLayers>` was mounted only 2026-06-17 → 2026-07-15
  (`git grep` at `53f518075~1` vs `53f518075`); the commit that unmounted it also raised the
  schema to v3 and added `migrateV2OperationBindings`, which turns every v2 sub-layer into an
  ordinary operation with `subLayers: []` on load (own repro: `[{"id":"L","subLayers":[]},
  {"id":"L:S","subLayers":[]}]`; also `migrations.test.ts:176`). No UI, importer (`src/io/**`),
  MCP or electron path creates sub-layers since; `addLayerSubLayer` is called only from the
  unmounted component. Only a hand-edited or generated v3+ file reaches this card.
- **Fix direction:** Build the sub-operation card from `reviewRowSettings(layerFromSubLayer(...),
  objects)` and route its Save through the same artwork-owner patching as the parent card (owners
  resolved for the sub-operation id), or show the compiled values read-only.

### P2-2 — Cut Settings for one artwork with its own settings pins every field into its override, so later operation edits never reach it
- **Where:** `src/ui/layers/SelectedLaserOperationFields.tsx:92-95` (`selectionCount` only when
  more than one artwork) → `src/ui/layers/CutSettingsDialog.tsx:45-46` (no `selectionCount` → the
  whole form, `withoutUntouchedLineDefaults`, not `changedCutSettingsPatch`) → `onApply:
  setOverride`.
- **Anchor:** Contract — ADR-317 §1 "omitted fields inherited from the operation base"; WORKFLOW
  F-A7 "An absent artwork power-mode override inherits the assigned operation". Twin — the same
  dialog with two selected artworks writes only the changed field.
- **Scenario:** Artwork `a` already owns `{ power: 30 }` (traced or photo-engraved artwork, or any
  earlier own-settings edit). Select only `a` → More cut settings → change Passes → Apply. The
  override becomes 24 fields (`speed`, `mode`, `powerMode: "auto"`, hatch, kerf, overscan, dither,
  …). Later the operator selects sibling `b` on the same operation; the inspector says "Shared by 2
  artworks. Edits apply to all of them."; Speed → 600. `b` runs 600, `a` keeps 1000. The same
  happens for Paste settings, a material preset applied to the operation, Reset to Default, and a
  later Constant/Dynamic choice on the operation (`a` now holds explicit Auto).
- **Evidence:** REPRO — temporary `src/ui/layers/zz-06-override-pin.test.tsx` through the real
  inspector → More cut settings → native `requestSubmit`:
  one artwork: `byOperation.op = {"power":30,"mode":"line","powerMode":"auto","minPower":0,"speed":1000,"passes":2,…24 keys}`;
  after operation speed 600: compiled `a 1000 mm/min`, `b 600`; scope text
  `Shared by 2 artworks. Edits apply to all of them.`
  Two artworks, same steps: `byOperation.op = {"power":30,"passes":2}` and both follow 600.
- **Refuter:** CONFIRMED, P2. Own repro (`zz-06r-override-pin.test.tsx`, real inspector → More
  cut settings → Passes → `requestSubmit`): one artwork `{power:30}` → 24 keys; sibling's inline
  Speed 600 → compiled `a [1000]`, `b [600]` under "Shared by 2 artworks. Edits apply to all of
  them."; two artworks → `{"power":30,"passes":2}`. Checked for a guard: `setObjectsOperationOverride`
  never prunes values equal to the base, and no ADR chooses a full snapshot for one artwork (ADR-317
  §1 inherits omitted fields; the Sept 12 amendment and the `withoutUntouchedLineDefaults` comment
  both expect artwork patches on the changed-control path). Reach is wider than stated: a freshly
  traced filled image owns `{mode, fillStyle}` from import (`ImportImageDialog.tsx:422-429`), so
  the inspector edits its override and the same Apply pinned 27 keys in the repro.
- **Fix direction:** Pass a change-tracking mode to the dialog whenever it edits an artwork
  override (any count), so only edited controls reach `setObjectsOperationOverrideForOperation`.

### P2-3 — Switching Process inside Cut Settings skips the ADR-496 reseed: a cut switched to Fill keeps cutting power and its cut preset link
- **Where:** `src/ui/state/laser-recipe-seeding.ts:120` (`if (keys.length !== 1 || keys[0] !==
  'mode') return updated;`); `src/ui/layers/CutSettingsDialog.tsx:46` sends the whole form, so the
  patch always has more keys than `mode`.
- **Anchor:** Contract — ADR-496 §6 "When an operation still exactly as its linked recipe left it
  is switched to another mode, it takes the best recipe for the new mode. So a cut switched to
  Fill does not engrave at cutting power." Twin — the inspector's Line/Fill/Image switch
  (`setLayerParam(id, { mode })`) reseeds.
- **Scenario:** Job material Birch 3 mm with "Take the best recipe" on; a new shape is seeded with
  `birch-cut` (90 %, 400 mm/min). Inspector switch to Fill → 35 %, 3000 mm/min, `birch-fill`.
  Cut Settings → Process: Fill → Apply → **Fill at 90 %, 400 mm/min, still linked to
  `birch-cut`** (the Job Review material chip then names the cut preset on a Fill card). The
  values are visible in the dialog, but the protection ADR-496 promises is gone.
- **Evidence:** REPRO — temporary `src/ui/layers/zz-06-cut-settings.test.tsx` (library fixture of
  `CutSettingsDialog.recipe-reseed.audit.test.tsx`): `inspector switch fill 35 3000 birch-fill`;
  `cut-settings switch fill 90 400 birch-cut`. The existing audit test only switches through
  `setLayerParam({ mode })`.
- **Refuter:** CONFIRMED, P2. Own repro (`zz-06r-cutsettings.test.tsx`) through the mounted
  wiring `LayerRowCutSettings` → `setLayerParam`, Process select changed to Fill, form valid,
  `requestSubmit`: `fill 90 400 birch-cut`; the single-key `setLayerParam({mode})` gives
  `fill 35 3000 birch-fill`. ADR-496 §6 names "a mode switch" with no surface restriction, and
  the dialog's Process select is a mode switch, so it is not a deliberate scope. It needs a job
  material with "Take the best recipe" on (ADR-496's own default when a material is picked).
- **Fix direction:** Decide reseed eligibility on "mode changed and every other submitted field
  equals the stored one" rather than on the patch having a single key, or reseed in the dialog when
  the Process select changes on an untouched linked operation.

### P2-4 — Cut Settings refuses to Apply when a stored value the app itself accepts fails the dialog's native step/range check
- **Where:** `src/ui/layers/CutSettingsInputs.tsx:21` (`step={props.step ?? 1}`) used for Power
  and Speed (`CutSettingsCommonFields.tsx:38,42`); Fill scan angle `step={5}`
  (`CutSettingsFillFields.tsx:34-38`); Fill overscan `step={0.5}` (`:175`); Fill line interval
  `min={0.05}` (`CutSettingsFillDensityFields.tsx:19`).
- **Anchor:** Twin — the inline fields and Job Review accept these values (`english-decimal-input`,
  `step: 'any'` in the Job Review card), the LightBurn importer stores them, and ADR-629 inch
  entry produces them; the image density fields already widen their bounds for exactly this
  reason ("or the browser's range check would block Apply for an unrelated edit",
  `src/ui/raster/image-density-bounds.ts:1-6`). Same class as 2026-09-05 F08-01 (density step
  mismatch), on other fields.
- **Scenario:** Any of: Speed typed as 3.5 in/min with the Inches preference (stored 88.9 mm/min);
  a LightBurn layer at 33.3 mm/s (stored `1997.9999999999998`, shown that way in the box) or
  12.5 % power; a Fill angle of 22.5° set in the inspector or imported; LightBurn overscan
  2.54 mm; interval 0.03 mm. Open Cut Settings, change anything (e.g. Passes), press Apply: the
  browser refuses ("Please enter a valid value. The two nearest valid values are 88 and 89") on a
  field the operator did not touch, and nothing is applied until they round it.
- **Evidence:** REPRO — `zz-06-cut-settings.test.tsx`, real `CutSettingsDialog`, `requestSubmit`:
  `Cut settings power=12.5 {step:true}`, `Cut settings speed=1997.9999999999998 {step:true}` →
  `checkValidity false`, `onApply calls 0`; `speed=88.9 {step:true}` → `onApply calls 0`;
  fill: `hatchAngleDeg=22.5 {step:true}`, `line interval=0.03 {under:true}`,
  `lines per inch=508 {over:true}`, `fillOverscanMm=2.54 {step:true}`.
- **Refuter:** CONFIRMED, P2. Own repro (`zz-06r-cutsettings.test.tsx`) stores each value through
  the real inline field first, then opens Cut Settings from the inspector and edits only Passes:
  inline Power `37.5` → `Cut settings power=37.5 {step:true}`, form invalid, passes stays 1;
  inline Speed `12` in/min (Inches) → stored `304.8` → `speed=304.8 {step:true}`; inline Hatch angle
  `22.5` → `hatchAngleDeg=22.5 {step:true}`. Two lines of evidence: jsdom `ValidityState`, and the
  HTML step rule (step base is `min`; no `novalidate` anywhere in `src/ui`), which Chrome enforces on
  a submit button. So ordinary inline entries (a half percent, most whole in/min speeds) are
  enough; the LightBurn `1997.999…`, 2.54 mm overscan and 0.03 mm interval cases were not re-run.
- **Fix direction:** Use `step="any"` on these boxes and admit the stored value in min/max as
  `imageDensityBounds` does; clamp only edited values in `readCutSettingsPatch`.

### P2-5 — One Job Review Save is several undo steps; one Undo leaves a half-applied edit that the card then misreports
- **Where:** `src/ui/laser/job-review/JobReviewOperations.tsx:152-153` (`setLayerParam` then one
  `setObjectsOperationOverrideForOperation` per owner group, each pushing its own undo snapshot).
  Same pattern: `src/ui/layers/feed-ceiling.tsx:94-95` (Raise Output max feed = profile change +
  speed commit, two steps).
- **Anchor:** Contract — ADR-638 "Save writes them … through the same store actions the Artwork
  panel uses … so undo, dirty and Frame-invalidation behaviour are unchanged" (a panel edit is one
  step). Twin — the inspector's own-settings edit is one `set` call. The 2026-07-10 full sweep
  recorded "every mutation is one snapshot" as verified.
- **Scenario:** Artwork `a` owns `{ power: 80 }`, `b` follows the operation (80 %). Job Review →
  Edit Power 40 → Save: two undo steps. Ctrl+Z once: `a` back to 80 %, the operation base stays
  40 %, `b` burns 40 %. Job Review's card now reads **Power 40 %** (mixed → base) while `a` burns
  `S800`.
- **Evidence:** REPRO — `zz-06-subop.test.tsx` "Undo": `undoStack after one Save 2`;
  after one `undo()`: card `Power % for Cut=40`, compiled `[{power:80},{power:40}]`,
  `distinct S on G1 ["S800","S400"]`.
- **Refuter:** CONFIRMED, P2 (low). Own repro (`zz-06r-subop-undo.test.tsx`, real card Edit →
  Save): `undoStack 2`; one `undo()` → card `40`, compiled `[{power:80},{power:40}]`, G1 `S800`,
  `S400`, base `40`. `pushUndo` has no grouping or coalescing (`undo-stack.ts:61`). The anchor is
  weaker than quoted: ADR-638's "undo … unchanged" means nothing is written before Save, not that
  Save is one step. It stays P2 because the half-undo leaves a job neither before nor after the
  Save, and the card reports one value for both. Artwork owning power is ordinary (any inspector
  edit on traced artwork lands in its override). The feed-ceiling Raise (`feed-ceiling.tsx:93-94`,
  `updateDeviceProfile` + `onRaise`) matches by reading.
- **Fix direction:** Apply the base patch and the owner patches in one store transaction (one
  `set`, one `pushUndo`); do the same for the feed-ceiling Raise.

### P3 findings

- **P3-1** `src/ui/layers/CutSettingsCommonFields.tsx:24` + `cut-settings-draft.ts:69` +
  `CutSettingsDialog.tsx:46`: Cut Settings shows `min(speed, Output max feed)` and, on the
  operation path (and the one-artwork path of P2-2), writes the whole form, so a speed stored
  above the ceiling is rewritten to the ceiling when only Passes changed. ADR-638 Amendment 1
  fixed exactly this for Job Review Save. No output change today (compile caps), but raising the
  ceiling later no longer restores the operator's speed. REPRO: stored 12000, maxFeed 10000,
  Passes → 2: `patch speed 10000 passes 2`. Anchor: Twin (ADR-638 Amd 1 §1).
  **Refuter:** CONFIRMED, P3. Own repro through the inspector (operation path): stored
  `maxFeed + 2000` = 8000, Passes → 2 → stored `6000`; emitted `F6000` either way.
- **P3-2** `src/ui/laser/job-review/job-review-operation-edit.ts:28-42`,
  `JobReviewLaserOperationCard.tsx:116-128`, `JobReviewOperations.tsx:205`: the card's large
  values and detail line come from scene settings, not the compiled job. Artworks that disagree
  show the base with no Mixed marker (REPRO: card `Power 80`, emitted `S300` and `S800`); the power
  multiplier is not applied to the value or meter (REPRO: card 80 % / 20 %, emitted `S400`/`S100`);
  a speed above Output max feed is shown uncapped where the hover readout says `(capped)`
  (READ); the detail line describes the base fill style, not a traced artwork's own (READ).
  The folded Partial compiled summary has the true values. Anchor: Twin — ADR-348 Amd 1 §2 (hover
  "numbers are what output uses") and the comment at `job-review-operation-edit.ts:1-11`. Overlaps
  03-P3-16 (unrounded speed) — KNOWN part not re-raised.
  **Refuter:** CONFIRMED, P3. The mixed case reproduced inside the P2-5 repro (card `40`, emitted
  `S800`/`S400`); by reading, `reviewRowSettings` keeps the base for any disagreeing field and
  never reads `powerScale`, and `LaserValues` renders `settings.power`/`speed` as given.
- **P3-3** `src/ui/laser/job-review/job-review-operation-draft.ts:76,81` and
  `src/ui/layers/LayerSpeedInput.tsx:90`: a typed negative or zero speed is accepted and stored
  as 1 mm/min with no notice (a sign typo becomes the slowest, hottest feed); power 150 → 100 and
  passes 2.7 → 2 are also silent. REPRO: Job Review `"-1500" → {"speed":1}`, `"0" → {"speed":1}`,
  `"150" → {"power":100}`, `"2.7" → {"passes":2}`; inline `dimensionEntry("-1500") → ok -1500`
  then `clamp(…, 1, maxFeed)`. Anchor: Contract — WORKFLOW F-A7 "Exact entry still accepts 1 mm/min
  up to Output max feed" (a refused value should be refused, not floored).
  **Refuter:** CONFIRMED, P3. Own repro: `saveLaserOperationDraft` gives the four patches above;
  inline Speed `-1500` + blur → stored `1`, box `1`, no alert. The anchor is soft (F-A7 states the
  range, not refusal), and the box does show `1` afterwards, so this is silent clamping, not
  hidden output.
- **P3-4** `src/ui/layers/OperationInspectorControls.tsx:49-51`: "Shared by N artworks. Edits apply
  to all of them." is shown whenever the selected artwork has no own settings, even when sibling
  artworks own the edited field and will not change (ADR-317 precedence). REPRO (text captured
  with a sibling that owns speed; the sibling stayed at 1000 mm/min). Anchor: Contract — ADR-317
  §3 / WORKFLOW F-A7 (the inspector must say which artworks an edit reaches).
  **Refuter:** CONFIRMED, P3. Reproduced inside the P2-2 repro: sibling `b` inspected, text
  "Shared by 2 artworks. Edits apply to all of them.", Speed 600 left `a` at 1000.
  `scopeMessage` reads only `affected` and `overrideEditing`.
- **P3-5** `src/ui/layers/LayerSpeedInput.tsx:46` (and CNC feed, `CncLayerPrimitives.tsx:71`):
  in/min shows one decimal, while ADR-629 §3 says "Values show up to four decimals". Effects: a
  stored 1 mm/min reads `0 in/min` (contrast `formatDisplayLength`, "never rounding nonzero to 0");
  because the hook's baseline is the rounded value, a typed `3.55` snaps to `3.6` 300 ms later
  while the box still has focus (stored 90.17 mm/min). REPRO (`zz-06-edit-to-gcode.test.tsx`,
  real store, Inches): `box shows 3.6 stored 90.17`; `1 mm/min shows 0`. Anchor: Contract
  (ADR-629 §3).
  **Refuter:** CONFIRMED, P3 (doc/code drift). Own repro (inspector, Inches, fake timers): typed
  `3.55`, still focused after 400 ms → box `3.6`, stored `90.17`; stored 1 mm/min → box `0`. The
  one decimal is deliberate in the ADR-629 commit itself (`f3cfd21de`; `decimals = feed ? 1 : 4`
  in `CncLayerPrimitives.tsx`, and `LayerSpeedInput.inches.test.tsx` pins `59.1`), so the fix may
  be the ADR text rather than the code, but the 0 in/min reading needs a code fix either way.
- **P3-6** `src/ui/laser/job-review/reveal-reviewed-artwork.ts:41`: the one raw
  `useStore.setState` in scope. With Cut selected graphics on, `scopedSelectionProjectPatch` writes
  `project` and `dirty`, bypassing the store creator's `set` wrappers (`numberingEditGuardSetter`,
  `freeProArtworkSetter`, `store.ts:425-434`). It only selects existing artwork, so no Pro or
  geometry change is possible. It avoids `selectObjects` on purpose (that action expands canvas
  groups), so the fix is a store action taking exact ids, not a swap. READ. Anchor: Contract —
  02-P2-1 pattern (the store owns project writes).
  **Refuter:** CONFIRMED by reading, P3. `reveal-reviewed-artwork.ts:41` calls `useStore.setState`
  with `scopedSelectionProjectPatch`, which returns `project` + `dirty: true` when
  `cutSelectedGraphics` is on (`project-job-setup.ts:35-45`); the wrapped setters are built inside
  the store creator (`store.ts:425-433`) and never see it. Selection-only, so no bypass is possible.
- **P3-7** `src/ui/state/object-properties-actions.ts:249-251,337-338`: the override sanitizer maps
  a non-finite `power`, `minPower` or `tabCutPowerPercent` to **100 %** (`clampPowerScale`), a
  fail-to-full-power default. Latent: every current caller passes finite numbers. READ. Anchor:
  Twin — `numberField`/`numericValue` fall back to the stored value instead.
  **Refuter:** CONFIRMED, P3 (latent). Own repro: `setObjectsOperationOverrideForOperation(['a'],
  'op', { power: NaN })` stored `byOperation.op.power = 100`. The only two callers
  (`SelectedLaserOperationFields.tsx:38`, `JobReviewOperations.tsx:149`) pass parsed finite numbers.
- **P3-8** `src/ui/state/store-actions.ts:61-80`: `setLayerParam` always pushes an undo step and
  sets `dirty`, even for an unchanged patch (Cut Settings Apply with no edit, a re-click). REPRO:
  `noop: undo 1 dirty true`. Anchor: Twin — `setObjectsOperationOverride` and
  `setObjectsPowerScale` return `{}` when nothing changed.
  **Refuter:** CONFIRMED, P3. Own repro: `setLayerParam('op', { power: 50 })` on power 50 →
  `undoStack 1`, `dirty true`. Same class as 08-P3-6 (no-op transforms), different action.
- **P3-9** (L7; anchor: Contract — ADR-317 Consequences, "DOM tests verify displayed and edited
  laser power against the same artwork's compiled output") Tests restate storage, not output, on
  the paths above:
  `JobReviewOperations.editing.test.tsx:203-218` asserts only `subLayers[0].settings.power` (P2-1);
  `SelectedOperationInspector.ownership.test.tsx:88-120` opens the one-artwork dialog but asserts
  only `powerMode`, never that unchanged fields stay inherited (P2-2);
  `CutSettingsDialog.recipe-reseed.audit.test.tsx` switches mode only via `setLayerParam` (P2-3);
  `cut-settings-output-parity.test.ts` builds `FormData` by hand, so native validity is never
  exercised (P2-4); no test asserts one Job Review Save is one undo step (P2-5). READ.
  **Refuter:** CONFIRMED by reading, P3. Each cited test does what is stated
  (`editing.test.tsx:203-218` checks storage only; the ownership dialog test checks `powerMode`
  only; the reseed test calls `setLayerParam({mode})`; `cut-settings-output-parity.test.ts:145`
  builds `new FormData()`); `undoStack` appears in job-review tests only as seed state.

## Refuted

None. The refuter refuted no finding; the one severity change is P2-1 → P3, counted above, not
as refuted. Candidates the auditor dropped before raising:
- Cut Settings cannot turn Air off (`airAssist: data.has('airAssist') ? true : layer.airAssist`,
  `cut-settings-draft.ts:76`): the dialog has no Air control, so the stored value is kept as
  intended; the material wizard that reuses the reader is area 21.
- A selection change within the 300 ms debounce loses the typed value: blur fires first and
  flushes (`use-debounced-commit.ts` blur handler).
- Huge Passes (999999) hang preparation: `preparation-complexity.ts:134-139,214` budgets segments ×
  passes.
- A sub-operation following its parent artwork override is itself a defect: ADR-317 §1 chooses
  that precedence; only Job Review's disregard of it is raised (P2-1).
- Edits from an artwork without own settings change unselected artwork: by design and disclosed
  ("Shared by N…"); the disclosure's gap is P3-4.

## Verified clean

- **Edited → stored → emitted, operation path:** inspector Power 37.5, Speed 100 in/min, Passes 3
  stored as `{power:37.5, speed:2540, passes:3}` and emitted `G1 … F2540 S375` with 3 passes
  ($30 = 1000). REPRO (`zz-06-edit-to-gcode.test.tsx`). Fill spacing/angle store exactly
  (0.2 mm, 45°).
- **Numeric boundaries on inline fields:** `english-decimal-input` refuses `1e3`, `12,5`, `0x10`
  and blank; the unit-aware Speed box refuses commas and division by zero and accepts typed units
  (`2in` → 50.8 mm/min). Blank drafts never commit and restore the stored value on blur.
- **Document ownership of drafts:** `useDebouncedCommit` drops timers and blur commits across a
  `projectDocumentEpoch` change and on unmount (READ).
- **Multi-selection Cut Settings and inspector:** only changed controls are written
  (`changedCutSettingsPatch`), each artwork's minimum power, dot width and lead angle are reconciled
  to its own limits (`reconcileArtworkBounds`), and edits target only artwork still on the
  operation. REPRO for two artworks (`byOperation.op = {power, passes}` only).
- **Job Review parent card:** shows the value every artwork agrees on and Save reaches artwork that
  owns the field (REPRO: card 30 % = emitted `S300`); Save writes only edited fields (REPRO:
  passes `0` → empty patch); Start and remote approval are held while a card edits
  (`job-review-store.ts:140-142`, READ); CNC cards are read-only (ADR-306; no store writes in
  `JobReviewCnc*`).
- **Image density:** Cut Settings DPI / line interval round-trip through the hidden exact
  `linesPerMm`, and stored densities outside the recommended range stay admissible
  (`image-density-bounds.ts`, existing native-submit tests).
- **Output-run filter:** `artworkOutputRuns` mirrors compile's skip rules for vectors on Image runs,
  bitmaps on Line/Fill runs and trace sources (READ against `compile-job.ts`).
- **Store bypass sweep:** the only raw `useStore.setState` in non-test code under `src/ui/laser`
  and `src/ui/layers` is P3-6; the rest are `useLaserStore`/`useUiStore`/local stores.

## Not verified

- Real-browser validation bubbles and locale-specific `type="number"` comma handling (jsdom
  `ValidityState` was used; Chrome follows the same step/range rules by spec).
- Fill compile from the inspector (the fixture's open polylines produce no fill groups); stored
  values were checked instead.
- The hover readout itself (`src/ui/workspace`), the material wizard and library (`src/ui/material-library`),
  and the CNC field-level numeric paths beyond a skim.
- ADR-646 edit glow beyond reading (display only; PR #1334 is open on it).
- Remote/MCP review approval while a card edits (covered by area 01/05 tests, not re-run).
- Whether projects in the field still carry sub-operations (P2-1 reachability). Refuter: none
  can after a load; v2 files are flattened on open and no current path creates them (see P2-1).
- No hardware, controller or material qualification.

```json
[
  {"id":"P2-1","severity":"P3","area":"laser-ui-settings","file":"src/ui/laser/job-review/JobReviewOperations.tsx","line":127,"anchor":"Contract ADR-317 §4; Twin parent card reviewRowSettings/artwork owners, ADR-348 Amd 1 hover","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Job Review sub-operation card shows and saves the sub-operation base (20%, then 25% 'Saved') while compile burns the artwork's parent override (S300). Refuter: P2 to P3, latent: v2 sub-layers are flattened on load and nothing creates them since schema v3"},
  {"id":"P2-2","severity":"P2","area":"laser-ui-settings","file":"src/ui/layers/SelectedLaserOperationFields.tsx","line":92,"anchor":"Contract ADR-317 §1, WORKFLOW F-A7 power-mode inheritance; Twin multi-artwork dialog path","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Cut Settings for one artwork with own settings writes all 24 fields into its override, so later operation edits skip it while the inspector says edits apply to all"},
  {"id":"P2-3","severity":"P2","area":"laser-ui-settings","file":"src/ui/state/laser-recipe-seeding.ts","line":120,"anchor":"Contract ADR-496 §6; Twin inspector mode switch","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Switching Process to Fill in Cut Settings keeps the cut recipe (90%, 400 mm/min) and its cut preset link instead of reseeding"},
  {"id":"P2-4","severity":"P2","area":"laser-ui-settings","file":"src/ui/layers/CutSettingsInputs.tsx","line":21,"anchor":"Twin inline fields/Job Review/LightBurn import/ADR-629 entry; image-density-bounds precedent; F08-01 class","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Cut Settings Apply is blocked by native step/range checks on stored non-integer speed or power, 22.5° fill angle, 2.54 mm overscan or 0.03 mm interval"},
  {"id":"P2-5","severity":"P2","area":"laser-ui-settings","file":"src/ui/laser/job-review/JobReviewOperations.tsx","line":152,"anchor":"Contract ADR-638 (undo behaviour unchanged); Twin one-step inspector edits","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"One Job Review Save with an artwork owner is two undo steps; one Undo leaves the owner reverted and the base changed, and the card misreports it"},
  {"id":"P3-1","severity":"P3","area":"laser-ui-settings","file":"src/ui/layers/CutSettingsCommonFields.tsx","line":24,"anchor":"Twin ADR-638 Amd 1 §1","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Cut Settings rewrites an untouched speed above Output max feed down to the ceiling"},
  {"id":"P3-2","severity":"P3","area":"laser-ui-settings","file":"src/ui/laser/job-review/job-review-operation-edit.ts","line":28,"anchor":"Twin ADR-348 Amd 1 §2 hover readout","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Job Review card values come from scene settings: mixed artwork shows the base with no Mixed marker, power multiplier and speed cap not applied"},
  {"id":"P3-3","severity":"P3","area":"laser-ui-settings","file":"src/ui/laser/job-review/job-review-operation-draft.ts","line":81,"anchor":"Contract WORKFLOW F-A7 exact-entry range","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Negative or zero speed typed in Job Review or the inline box is silently stored as 1 mm/min"},
  {"id":"P3-4","severity":"P3","area":"laser-ui-settings","file":"src/ui/layers/OperationInspectorControls.tsx","line":50,"anchor":"Contract ADR-317 §3, WORKFLOW F-A7","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"'Edits apply to all of them' ignores sibling artworks that own the edited field"},
  {"id":"P3-5","severity":"P3","area":"laser-ui-settings","file":"src/ui/layers/LayerSpeedInput.tsx","line":46,"anchor":"Contract ADR-629 §3","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"In/min speed shows one decimal (ADR says up to four): 1 mm/min reads 0 in/min and two-decimal entries snap while focused"},
  {"id":"P3-6","severity":"P3","area":"laser-ui-settings","file":"src/ui/laser/job-review/reveal-reviewed-artwork.ts","line":41,"anchor":"Contract store-owned project writes (02-P2-1 pattern)","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Raw useStore.setState writes project and dirty (Cut selected graphics) outside the store's set wrappers"},
  {"id":"P3-7","severity":"P3","area":"laser-ui-settings","file":"src/ui/state/object-properties-actions.ts","line":249,"anchor":"Twin numberField/numericValue fallbacks","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Override sanitizer turns a non-finite power into 100% (latent fail-to-full-power default)"},
  {"id":"P3-8","severity":"P3","area":"laser-ui-settings","file":"src/ui/state/store-actions.ts","line":61,"anchor":"Twin setObjectsOperationOverride/setObjectsPowerScale no-op handling","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"setLayerParam pushes an undo step and marks the project dirty for an unchanged patch"},
  {"id":"P3-9","severity":"P3","area":"laser-ui-settings","file":"src/ui/laser/job-review/JobReviewOperations.editing.test.tsx","line":203,"anchor":"Contract ADR-317 Consequences (DOM tests verify edited power against compiled output)","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Tests for sub-operation Save, one-artwork Cut Settings, dialog mode switch, native validity and Save undo assert storage only or bypass the path"}
]
```
