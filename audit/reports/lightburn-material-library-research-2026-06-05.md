# LightBurn Parity Research - Material Library

Date: 2026-06-05
Repo: `C:\Users\Asus\LaserForge-2.0`
Mode: research / audit only
Status: no production code changes

## Research Program Status

1. Material Test - researched and saved in `audit/reports/lightburn-material-test-research-2026-06-05.md`.
2. Interval Test - researched and saved in `audit/reports/lightburn-interval-test-research-2026-06-05.md`.
3. Material Library - this report.
4. Advanced Cut Settings Editor - next dependency to research.
5. Optimization Settings.
6. Richer trace controls.
7. Vector editing tools.
8. Device / console workflow.

## Executive Decision

Build Material Library in phases. Do not try to clone every LightBurn behavior in the first implementation.

The correct first slice is:

1. A LaserForge-native, deterministic material-library JSON file.
2. Explicit Load / Save / Save As / Create New / Merge workflows.
3. `Create from layer`.
4. `Assign` to a chosen layer.
5. Device mismatch warnings.
6. Tests proving assigned settings affect the same Preview / Save / Start pipeline as manual layer edits.

Defer `Link` until a second phase. LightBurn's Link behavior is not just a copy operation; it stores a relationship, keeps linked layer settings synced to the library preset, and makes normal cut-setting edits read-only. LaserForge does not yet have the required external library reference model, active-layer workflow, stable library storage, or missing-library UX.

Do not make LightBurn `.clb` the canonical format. LightBurn documents `.clb` as its Material Library file type, but the public docs do not describe a stable interchange schema. Use `.clb` only as a later compatibility importer if fixture-based research proves it can be parsed safely and legally.

## Official Reference Baseline

Official LightBurn pages used:

- LightBurn Material Library: https://docs.lightburnsoftware.com/latest/Reference/MaterialLibrary/
- LightBurn 2.1 Material Library path used by the repo study: https://docs.lightburnsoftware.com/2.1/Reference/MaterialLibrary/
- LightBurn Cut Settings Editor: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/
- LightBurn Material Test: https://docs.lightburnsoftware.com/latest/Reference/MaterialTest/
- LightBurn Interval Test: https://docs.lightburnsoftware.com/latest/Reference/IntervalTest/

Repo-local LightBurn study evidence:

- `LIGHTBURN-STUDY.md` section 7.7 records Material Library behavior: `.clb` files, Material Name, Thickness / No Thickness, Description, Create New from Layer, Assign, Link, Manage Library actions, and device association.
- `LIGHTBURN-STUDY.md` section 8.5 records the LaserForge gap: no Material Library / `.clb`.
- `audit/reports/lightburn-workflow-implementation-plan-2026-06-05.md` records Material Library as a deferred larger track after the Cut Settings Editor and storage / format decisions.

## What LightBurn Does

LightBurn's Material Library is a docked workflow surface, not only a settings file.

Core behaviors:

- Libraries are managed as `.clb` files.
- Operators can load, save, save as, create new, merge, rename, unload, and select libraries.
- A library entry is grouped by Material Name, then Thickness, or by a No Thickness title for surface operations.
- Each entry has a Description that identifies the actual preset.
- `Create New from Layer` copies the active layer's current cut settings into a new library entry.
- `Assign` copies a preset's settings into the active layer. Future library edits do not affect that layer.
- `Link` connects the active layer to the library entry. Future preset edits update linked layers, and normal cut-setting edits are disabled until the layer is unlinked.
- Libraries are associated with devices so the right library can be reloaded with the active machine profile.

Important implication: `Assign` and `Link` are different data models. Treating them as the same operation with different button text would be a LightBurn divergence and a source of unsafe operator confusion.

## Current LaserForge Truth

LaserForge has enough layer recipe fields to implement Assign, but not enough infrastructure to implement full LightBurn Link safely.

### Layer Recipe Surface Exists

`src/core/scene/layer.ts` already stores:

- `mode`
- `minPower`
- `power`
- `speed`
- `passes`
- `hatchAngleDeg`
- `hatchSpacingMm`
- `fillOverscanMm`
- `fillBidirectional`
- `ditherAlgorithm`
- `linesPerMm`

These fields are the applied recipe surface. A Material Library preset should copy into these fields.

Do not store these session-specific fields in a reusable material preset:

- `id`
- `color`
- `visible`
- `output`

Do not put raster adjustment fields in the first material recipe:

- brightness
- contrast
- gamma
- invert

Those belong to `RasterImage` / selected image adjustment workflow today, not the layer recipe.

### Current Store Can Apply Assign

`src/ui/state/store.ts` exposes `setLayerParam(layerId, patch)`. That path already:

- updates the layer in the scene,
- pushes undo,
- clears redo,
- marks the project dirty.

That is the right implementation path for `Assign`.

### Active Layer Is Missing

LaserForge has selected objects, but not a dedicated active Cuts/Layers row. Material Library needs an explicit target layer.

Required before implementation:

- add or define active layer selection, or
- require the action to be launched from a specific `LayerRow`.

Do not infer the target layer from selected objects. A selection can contain multiple colors, and a selected raster/vector object does not necessarily represent the layer the operator intends to edit.

### Persistent Library Storage Is Missing

`src/platform/types.ts` currently supports:

- open file picker,
- save file picker,
- serial access.

It does not expose an app-data directory, persistent settings store, IndexedDB / OPFS abstraction, or Electron user-data storage.

Therefore V1 should use explicit user-owned files:

- Load Library: file picker.
- Save Library: save picker / existing save target when available.
- Save Library As: save picker.
- Merge Library: open another library file and merge into the current in-memory library.

Avoid hidden `localStorage` or hidden IndexedDB as the canonical material store in the first implementation.

### Stable Device Association Is Missing

`src/core/devices/device-profile.ts` stores a device name and machine parameters, but no stable device ID. LightBurn associates libraries with devices; LaserForge can only approximate this initially.

V1 should store a device hint:

- device name,
- bed size,
- maxPowerS,
- maxFeed,
- origin,
- laserModeEnabled.

When the active device differs, warn. Do not silently block by default, because users may intentionally reuse a library across similar machines. Do not silently ignore mismatch, because max power scale and feed limits are safety-relevant.

### Project Scope Is Not Yet Approved

`PROJECT.md` still lists "Material library, cut tests, power/speed wizards" as out of scope without a project revision and ADR.

Under the repo's own governance, implementation needs:

- `PROJECT.md` scope revision, and
- `DECISIONS.md` ADR covering storage, schema, LightBurn parity, and safety copy.

## Recommended Data Model

Canonical file extension: `.lfml.json`

Rationale:

- deterministic like `.lf2`;
- human-readable;
- easy to validate;
- avoids undocumented `.clb` reverse engineering as the foundation;
- compatible with web and Electron through existing file picker APIs.

Proposed shape:

```ts
type MaterialLibraryDocument = {
  readonly format: 'laserforge-material-library';
  readonly librarySchemaVersion: 1;
  readonly libraryId: string;
  readonly name: string;
  readonly deviceHint?: MaterialLibraryDeviceHint;
  readonly entries: ReadonlyArray<MaterialPreset>;
};

type MaterialLibraryDeviceHint = {
  readonly name: string;
  readonly bedWidth: number;
  readonly bedHeight: number;
  readonly maxFeed: number;
  readonly maxPowerS: number;
  readonly minPowerS: number;
  readonly laserModeEnabled: boolean;
  readonly origin: string;
};

type MaterialPreset = {
  readonly id: string;
  readonly materialName: string;
  readonly thicknessMm?: number;
  readonly title?: string;
  readonly description: string;
  readonly recipe: CutRecipe;
  readonly revision: string;
};

type CutRecipe = {
  readonly mode: 'line' | 'fill' | 'image';
  readonly minPower: number;
  readonly power: number;
  readonly speed: number;
  readonly passes: number;
  readonly hatchAngleDeg: number;
  readonly lineIntervalMm: number;
  readonly fillOverscanMm: number;
  readonly fillBidirectional: boolean;
  readonly ditherAlgorithm: string;
};
```

Store `lineIntervalMm` canonically in presets.

Mapping:

- Fill layer: `Layer.hatchSpacingMm = lineIntervalMm`.
- Image layer: `Layer.linesPerMm = 1 / lineIntervalMm`.
- Display DPI: `DPI = 25.4 / lineIntervalMm`.

This matches the Interval Test research: interval is the operator-facing physical spacing; DPI and lines/mm are derived views.

Open question: whether to store both `lineIntervalMm` and raw `linesPerMm` for exact round-trip compatibility with current UI. Recommendation: store `lineIntervalMm` canonically, but use a named conversion helper and tests for numeric stability.

## Assign Workflow

Assign can ship in V1.

Flow:

1. Operator opens Material Library panel.
2. Operator selects a preset.
3. Operator selects or targets a layer.
4. Operator clicks Assign.
5. App previews the settings to be copied.
6. App applies the preset recipe with `setLayerParam`.
7. Layer remains editable.
8. Future library edits do not affect the layer.

Operator copy:

> Assign copies these settings to the layer. Future library changes will not affect this layer.

Test requirements:

- all recipe fields copy to the selected layer;
- layer `visible`, `output`, `color`, and `id` do not change;
- project is dirty;
- undo restores the old layer recipe;
- redo reapplies it;
- output generated after Assign contains the new feed and power values.

## Link Workflow

Link should be deferred.

What Link requires:

- `Layer` or project-level metadata for linked preset references;
- `.lf2` schema migration;
- library ID, preset ID, preset revision;
- read-only layer controls for linked fields;
- explicit `Unlink`;
- missing-library warning;
- missing-preset warning;
- stale-preset revision handling;
- behavior when a linked preset is edited while a project is open;
- deterministic output even if the external library file is absent.

If Link is implemented later, compile should still use resolved `Layer` fields. The link metadata should drive UI sync and warnings, not make output depend on loading an external file at emit time.

Possible metadata:

```ts
type MaterialLink = {
  readonly libraryId: string;
  readonly presetId: string;
  readonly presetRevision: string;
};
```

Operator copy:

> Link locks this layer to the library preset. Editing the preset updates linked layers. Unlink to edit this layer manually.

## User Interface Plan

Material Library should live in the right rail near Cuts/Layers, not in Device Settings and not inside each `LayerRow`.

Reasoning:

- LightBurn presents Library as a docked workflow panel.
- Material presets apply to layers.
- LaserForge's Stop / E-stop reachability must remain preserved.
- `LayerRow.tsx` is already dense and should not absorb a large preset-management feature.

Recommended UI:

- Add a collapsible or tabbed `MaterialLibraryPanel` beside Cuts/Layers.
- Keep Laser controls reachable during jobs.
- Add active-layer targeting.
- Add a shared Cut Settings Editor later, then let both `LayerRow` and Material Library edit through it.

Panel controls:

- library selector / name;
- New;
- Load;
- Save;
- Save As;
- Merge;
- search / filter;
- grouped tree: Material Name -> Thickness or No Thickness / Title -> Description;
- Create from layer;
- Assign;
- Link disabled until implemented;
- Update from layer;
- Duplicate;
- Delete;
- Edit description;
- Edit cut settings.

Create / edit metadata fields:

- Material Name;
- Thickness mode: Thickness or No Thickness;
- Thickness mm when thickness mode is enabled;
- Title when No Thickness is enabled;
- Description;
- Device hint readout.

## Safety Rules

Material presets are not universal truth. They are operator records of settings that worked under specific conditions.

Safety-relevant variables:

- material type and batch;
- thickness;
- focus;
- lens;
- air assist;
- diode wattage / CO2 tube power;
- GRBL `$30` max power scale;
- GRBL `$31` min power;
- GRBL `$32` laser mode;
- feed limits;
- acceleration / cornering;
- smoke extraction;
- workholding.

Required warnings:

- device mismatch: warn before applying or starting;
- unverified preset: warn that it must be tested on scrap;
- destructive update: confirm before overwriting preset from layer;
- delete with links: either unlink affected layers or block until resolved;
- future Link edit: warn that linked layers will update.

Do not let a material preset bypass normal Start readiness. Start, Preview, Frame, Save, and G-code export must continue through the same preflight and output pipeline.

## Tests And Verification

### Pure Core

Create `src/core/material-library/` or equivalent pure module.

Tests:

- validate recipe rejects invalid mode;
- reject NaN / Infinity;
- reject negative speed;
- reject `power` outside `0..100`;
- reject `minPower > power`;
- reject non-integer passes;
- reject zero / negative interval;
- convert interval to fill spacing;
- convert interval to image lines/mm;
- deterministic sort or stable insertion rules for entries.

### IO

Create `src/io/material-library/`.

Tests:

- deterministic serializer: same library -> same bytes;
- two-space JSON;
- LF endings;
- trailing newline;
- invalid JSON;
- missing schema;
- future schema;
- malformed entries;
- duplicate IDs;
- invalid thickness / title combination;
- merge duplicate behavior.

### Store

Tests:

- Create from layer captures the recipe and not session fields;
- Assign applies recipe to the selected layer;
- Assign marks dirty;
- Assign supports undo / redo;
- Assign does not couple future preset edits to the layer;
- device mismatch warning is surfaced.

### UI

Tests:

- panel empty state;
- load library cancel path;
- create metadata dialog validation;
- Assign copies into exactly one target layer;
- disabled Link is not exposed as working behavior;
- destructive update confirmation;
- delete confirmation;
- keyboard focus and Escape cancel.

### Output

Use existing `prepareOutput` / `emitGcode` surfaces.

Golden checks:

- Line preset changes emitted feed and power.
- Fill preset changes hatch spacing and overscan behavior.
- Image preset changes `linesPerMm` and dither / grayscale path.
- Round trip: apply preset -> save `.lf2` -> reopen -> generate G-code.

### Hardware / Operator

Hardware proof is still required before claiming the feature "works":

1. Create a library from known safe scrap tests.
2. Save and reload the library.
3. Assign Line, Fill, and Image presets to scrap jobs.
4. Preview.
5. Frame.
6. Start.
7. Verify Stop remains reachable.
8. Photograph results and save emitted G-code.
9. Edit the library after Assign and verify the old layer does not change.
10. If Link is later shipped, verify the linked layer updates and the unlinked layer does not.

## Implementation Order

1. Scope approval:
   - update `PROJECT.md`;
   - add `DECISIONS.md` ADR for Material Library storage and LightBurn parity.
2. Active layer target:
   - introduce an explicit active layer or row-launched target action.
3. Pure recipe model:
   - `CutRecipe`;
   - validation;
   - interval conversion helpers.
4. Native library IO:
   - `.lfml.json`;
   - serializer;
   - deserializer;
   - migrations;
   - validator.
5. Store actions:
   - create preset from layer;
   - assign preset to layer;
   - library in-memory state;
   - dirty state for library file, separate from project dirty state.
6. UI V1:
   - Material Library panel;
   - metadata dialog;
   - Load / Save / Save As;
   - Create from layer;
   - Assign;
   - Update / Duplicate / Delete.
7. Output verification:
   - prove assigned presets affect Preview / Save / Start via existing pipeline.
8. Device mismatch warnings.
9. Optional V2:
   - Link;
   - auto-load per device;
   - stable device IDs;
   - `.clb` import adapter if sample-driven research proves it.

## What Not To Build First

Do not build these first:

- full `.clb` export;
- auto-applied hidden per-user library storage;
- Link without schema migration;
- Material Test cells directly as raw G-code;
- a library UI inside `LayerRow`;
- preset application that bypasses `setLayerParam`;
- preset output that bypasses `prepareOutput` / Start readiness;
- "safe preset" language.

## Cross-Agent Findings

Five read-only agents inspected independent lanes:

- LightBurn behavior lane: confirmed `.clb`, Assign vs Link, Create from Layer, metadata fields, device association, and Manage Library actions.
- Layer model lane: confirmed `Layer` is the correct applied recipe surface, with interval stored canonically as physical spacing.
- Persistence lane: confirmed V1 should be native deterministic JSON and explicit file open/save; `.clb` should not be canonical.
- UI lane: confirmed Material Library belongs near Cuts/Layers in a collapsible / tabbed right-rail surface and needs active-layer targeting.
- Verification lane: confirmed recipe validation, Assign output assertions, UI tests, serialization tests, and hardware proof requirements.

No agent edited files.

## Final Verdict

Material Library is valuable, but it is a medium-to-large feature, not a small toolbar addition.

Best next implementation slice:

1. approve scope and ADR;
2. build active-layer targeting;
3. build native `.lfml.json` library IO;
4. ship Assign only;
5. leave Link disabled / unimplemented until storage and schema support are real.

This follows the LightBurn workflow without pretending LaserForge has LightBurn's entire persistence and linked-layer model yet.
