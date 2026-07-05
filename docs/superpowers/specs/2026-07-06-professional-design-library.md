# Professional Design Library Spec

**Goal:** Build a fully equipped, professionally categorized built-in library for LaserForge/KerfDesk that starts with owned CNC/laser manufacturing templates, then adds license-safe artwork, then presents both through one import workflow.

**User scope:** A then B then C.

- A: owned manufacturing templates first.
- B: CC0/public-domain or otherwise redistribution-safe artwork second.
- C: everything importable, sorted, filtered, and categorized professionally.

## Current State

The app already has `src/ui/library/DesignLibraryDialog.tsx` and `src/ui/library/design-library.ts`. The current dialog imports lucide SVG icons through the normal `parseSvg` -> `importSvgObject` path. That proves the UI and import path exist, but the library is currently a small line-art starter set, not a professional CAM/CNC library.

The repo is proprietary, and ADR-017/ADR-018 require conservative licensing. The library must not bundle raw files from marketplaces or community sites unless redistribution rights are proven. Openclipart/CC0-style artwork is allowed only with per-entry provenance.

## Requirements

1. The library must support both laser and CNC users.
2. Owned manufacturing templates must be created in our code or authored directly in this repo.
3. External artwork must be limited to redistribution-safe sources such as CC0/public domain, with proof stored in metadata.
4. Every library item must include enough metadata to sort and filter professionally.
5. Importing a library item must produce editable project geometry, not opaque G-code.
6. Existing import safety remains in force: SVG artwork goes through `parseSvg`; generated templates go through existing scene insertion paths such as `importSvgObject` or `insertBoxPanels`.
7. The first implementation must not copy files/code from restricted sites such as Creative Fabrica, Design Bundles, Vectric/Design & Make, 3axis, MakerCase, Easel, CutRocket, or Ponoko unless a future per-asset license review explicitly approves redistribution.

## Catalog Model

Create a richer catalog model under `src/ui/library`:

```ts
type LibraryEntry = {
  readonly id: string;
  readonly title: string;
  readonly category: LibraryCategory;
  readonly subcategory: string;
  readonly kind: 'owned-template' | 'bundled-artwork';
  readonly machineModes: ReadonlyArray<'laser' | 'cnc'>;
  readonly operations: ReadonlyArray<
    'line' | 'fill' | 'image' | 'profile' | 'pocket' | 'drill' | 'v-carve' | 'calibration'
  >;
  readonly tags: ReadonlyArray<string>;
  readonly provenance: LibraryProvenance;
  readonly previewSvgText: string;
  readonly insert: LibraryInsert;
};
```

`LibraryProvenance` stores:

- `sourceKind`: `owned`, `lucide`, `cc0`, or `public-domain`.
- `license`: exact license label.
- `sourceUrl`: upstream page for external assets.
- `downloadedAt`: ISO date for external assets.
- `assetHash`: hash of the bundled SVG text for external assets.
- `notice`: attribution or notice text when required.

`LibraryInsert` supports:

- `svg`: static SVG text parsed by `parseSvg`.
- `boxGeneratorPreset`: launch or quick-insert from the existing box generator.
- `generatedScene`: generated project geometry for owned templates such as test cards, CNC pockets, jigs, slot gauges, and calibration patterns.

## Categories

Top-level categories:

- `Laser Templates`
- `CNC Templates`
- `Test & Calibration`
- `Jigs & Fixtures`
- `Boxes & Joinery`
- `Signs & Plaques`
- `Decorative Artwork`
- `Icons & Symbols`

Professional filters:

- Machine: Laser, CNC, or Both.
- Type: Template, Artwork.
- Operation: Line, Fill, Profile, Pocket, Drill, V-carve, Calibration.
- Source: Owned, Lucide, CC0/Public Domain.
- Tags: plywood, acrylic, MDF, aluminum, kerf, tabs, dogbone, v-bit, spoilboard, signage, ornament, coaster, jig.

## Initial Owned Template Set

The first built-in manufacturing set is authored by us and kept editable:

- Laser power/speed grid.
- Laser line interval/LPI test.
- Kerf comb and slot-fit gauge.
- Tab/bridge sample strip.
- Registration mark sheet.
- Camera alignment marker sheet.
- Simple name plaque/sign blank.
- Coaster blank with optional border.
- Keychain/ornament blanks with hole variants.
- Box generator starter presets: small tray, pencil box, electronics box, open-top bin.
- CNC inside/outside profile test.
- CNC pocket depth test.
- CNC drill grid.
- CNC dogbone corner test.
- CNC V-carve sample.
- CNC surfacing/spoilboard pattern.
- Clamp/fixture strip and simple hold-down jig.

Entries with meaningful dimensions use generators. Entries with fixed decorative geometry may use static SVG.

## Artwork Set

The second library pass adds curated artwork only from safe sources:

- Keep existing lucide line-art icons, but reclassify them as `Icons & Symbols` with provenance.
- Add CC0/public-domain artwork only when each file has a source URL, license proof, and hash.
- Prefer a small curated starter set over a giant unreviewed bulk dump.
- Store provenance beside the manifest so future audits can prove why each file can ship.

Artwork should be sorted into:

- Nature
- Animals
- Home & Food
- Hobby & Travel
- Signs & Labels
- Decorative Borders
- Seasonal
- Symbols

## UI Design

Upgrade `DesignLibraryDialog` into a professional catalog browser:

- Left rail: top-level categories.
- Header: search field, Laser/CNC segmented filter, Template/Artwork segmented filter.
- Secondary filter row: operation and source filters.
- Main grid: stable cards with preview, title, source badge, machine badges, operation badges.
- Details panel or expanded card: dimensions/defaults, tags, source/provenance, and Insert/Configure action.
- Import visible: batch action that inserts the currently filtered entries with spacing offsets, not the whole library blindly.

The existing `Lib` toolbar button can remain for the catalog refactor. The UI polish pass replaces it with an icon button and tooltip consistent with the rest of the tool strip.

## Data Flow

1. User opens the library.
2. Dialog reads the catalog manifest.
3. Filters produce a visible list.
4. User inserts one entry or all visible entries.
5. Static SVG entries call `parseSvg` and then `importSvgObject`.
6. Generated template entries call focused generators and then insert scene objects/panels.
7. Toasts report success/failure with item names.
8. Inserted objects remain normal editable scene objects and use existing layer/default behavior.

## Testing

Catalog tests:

- Every entry has a stable id, title, category, subcategory, tags, operations, machine modes, and provenance.
- No duplicate ids.
- No entry has missing or unknown category/filter values.
- External assets must have source URL, license, downloaded date, and hash.
- Static SVG entries parse successfully through `parseSvg`.
- Owned generator entries produce finite, non-empty geometry.

UI tests:

- Category navigation filters entries correctly.
- Search filters by title and tags.
- Laser/CNC and operation filters compose correctly.
- Insert calls the correct import path for SVG artwork.
- Generated templates call the correct generator path.
- Batch insert imports only the visible filtered entries and offsets them predictably.

Verification:

- Focused Vitest for catalog and dialog.
- Existing SVG malicious/sanitize tests remain green.
- `pnpm typecheck`.
- `pnpm lint`.
- `pnpm format:check`.
- `pnpm build:web`.
- Browser smoke for opening the library, filtering, inserting one artwork item, and inserting one owned template.

## Implementation Order

1. Refactor the current flat `design-library.ts` into a metadata-rich catalog without changing the visible behavior.
2. Add catalog validation tests and SVG parse tests.
3. Upgrade the dialog UI with category/search/filter support.
4. Add owned manufacturing template generators and entries.
5. Add provenance metadata for existing lucide entries.
6. Add curated CC0/public-domain artwork entries with source proof and hashes.
7. Add batch import for the visible filtered set.
8. Run focused tests, build, and browser smoke.

## Explicit Deferrals

- Do not bundle marketplace packs with restrictive licenses.
- Do not implement online marketplace scraping.
- Do not add a cloud asset service in this pass.
- Do not generate or stream G-code directly from the library.
- Do not claim external artwork is safe without a source URL and license proof.
