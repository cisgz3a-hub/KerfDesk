# Professional Design Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a professional built-in design library that imports owned manufacturing templates first, license-safe artwork second, and presents everything through categorized/searchable/filterable library UX.

**Architecture:** Replace the current flat lucide-only manifest with a metadata-rich catalog that separates catalog validation, filtering, owned SVG/template generation, external artwork provenance, and React dialog rendering. Static artwork and fixed templates continue through the existing `parseSvg` -> `importSvgObject` pipeline; generated manufacturing entries use local generator functions and store insertion paths so inserted objects stay editable.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest/jsdom, existing SVG parser/import pipeline, existing scene insertion helpers, lucide-static, CC0/Openclipart provenance.

---

## File Structure

- Create `src/ui/library/design-library-types.ts`
  - Shared catalog, provenance, filter, and insert types.
- Create `src/ui/library/design-library-filter.ts`
  - Pure filtering/search/sorting helpers for the dialog and tests.
- Create `src/ui/library/design-library-validation.ts`
  - Pure catalog validator used by tests and future audit gates.
- Create `src/ui/library/design-library-owned-svg.ts`
  - Owned laser/CNC template SVG generator helpers and owned entries.
- Create `src/ui/library/design-library-lucide.ts`
  - Existing lucide entries converted into metadata-rich entries.
- Create `src/ui/library/design-library-cc0.ts`
  - Curated Openclipart/CC0 entries with source URLs, downloaded dates, hashes, and SVG text.
- Modify `src/ui/library/design-library.ts`
  - Compose all entry groups and export `DESIGN_LIBRARY`, categories, and filter constants.
- Modify `src/ui/library/DesignLibraryDialog.tsx`
  - Replace tab-only UI with category/search/filter/card grid/import-visible UI.
- Modify `src/ui/workspace/ToolStrip.tsx`
  - Replace the text-only `Lib` button with a normal icon-style library button if the icon set supports it cleanly.
- Create `src/ui/library/design-library-catalog.test.ts`
  - Catalog schema, provenance, uniqueness, sorting, and parseability tests.
- Create `src/ui/library/design-library-filter.test.ts`
  - Search/filter/sort unit tests.
- Create `src/ui/library/DesignLibraryDialog.test.tsx`
  - Dialog behavior tests for filters, insert, and import-visible.
- Modify `src/ui/workspace/ToolStrip.test.tsx`
  - Verify the library button remains discoverable and opens the dialog.

## Task 1: Metadata-Rich Catalog Foundation

**Files:**

- Create: `src/ui/library/design-library-types.ts`
- Create: `src/ui/library/design-library-validation.ts`
- Create: `src/ui/library/design-library-catalog.test.ts`
- Modify: `src/ui/library/design-library.ts`

- [ ] **Step 1: Write the failing catalog validation test**

Create `src/ui/library/design-library-catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseSvg } from '../../io/svg';
import { DESIGN_LIBRARY, LIBRARY_CATEGORIES } from './design-library';
import { validateDesignLibraryCatalog } from './design-library-validation';

describe('design library catalog', () => {
  it('has professional metadata for every entry', () => {
    const result = validateDesignLibraryCatalog(DESIGN_LIBRARY);
    expect(result).toEqual([]);
    expect(DESIGN_LIBRARY.length).toBeGreaterThan(40);
    expect(LIBRARY_CATEGORIES).toContain('Laser Templates');
    expect(LIBRARY_CATEGORIES).toContain('CNC Templates');
    expect(LIBRARY_CATEGORIES).toContain('Icons & Symbols');
  });

  it('uses stable unique ids', () => {
    const ids = DESIGN_LIBRARY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))).toBe(true);
  });

  it('parses every SVG-backed entry through the production SVG importer', () => {
    for (const entry of DESIGN_LIBRARY) {
      if (entry.insert.kind !== 'svg') continue;
      const result = parseSvg({
        svgText: entry.insert.svgText,
        id: `test-${entry.id}`,
        source: `Library: ${entry.title}`,
      });
      expect(result.object, entry.id).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Verify the test fails for the current flat catalog**

Run:

```powershell
pnpm exec vitest run src/ui/library/design-library-catalog.test.ts
```

Expected: FAIL because `design-library-validation.ts` and the richer catalog fields do not exist.

- [ ] **Step 3: Add catalog types**

Create `src/ui/library/design-library-types.ts`:

```ts
export type LibraryCategory =
  | 'Laser Templates'
  | 'CNC Templates'
  | 'Test & Calibration'
  | 'Jigs & Fixtures'
  | 'Boxes & Joinery'
  | 'Signs & Plaques'
  | 'Decorative Artwork'
  | 'Icons & Symbols';

export type LibraryMachineMode = 'laser' | 'cnc';
export type LibraryEntryKind = 'owned-template' | 'bundled-artwork';
export type LibraryOperation =
  | 'line'
  | 'fill'
  | 'image'
  | 'profile'
  | 'pocket'
  | 'drill'
  | 'v-carve'
  | 'calibration';

export type LibrarySourceKind = 'owned' | 'lucide' | 'cc0' | 'public-domain';

export type LibraryProvenance = {
  readonly sourceKind: LibrarySourceKind;
  readonly license: string;
  readonly sourceUrl?: string;
  readonly downloadedAt?: string;
  readonly assetHash?: string;
  readonly notice?: string;
};

export type LibrarySvgInsert = {
  readonly kind: 'svg';
  readonly svgText: string;
};

export type LibraryGeneratedInsert = {
  readonly kind: 'generated-scene';
  readonly generatorId: string;
};

export type LibraryInsert = LibrarySvgInsert | LibraryGeneratedInsert;

export type LibraryEntry = {
  readonly id: string;
  readonly title: string;
  readonly category: LibraryCategory;
  readonly subcategory: string;
  readonly kind: LibraryEntryKind;
  readonly machineModes: ReadonlyArray<LibraryMachineMode>;
  readonly operations: ReadonlyArray<LibraryOperation>;
  readonly tags: ReadonlyArray<string>;
  readonly provenance: LibraryProvenance;
  readonly previewSvgText: string;
  readonly insert: LibraryInsert;
};
```

- [ ] **Step 4: Add validation helper**

Create `src/ui/library/design-library-validation.ts`:

```ts
import type { LibraryEntry } from './design-library-types';

export function validateDesignLibraryCatalog(entries: ReadonlyArray<LibraryEntry>): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) issues.push(`${entry.id}: invalid id`);
    if (ids.has(entry.id)) issues.push(`${entry.id}: duplicate id`);
    ids.add(entry.id);
    if (entry.title.trim() === '') issues.push(`${entry.id}: missing title`);
    if (entry.subcategory.trim() === '') issues.push(`${entry.id}: missing subcategory`);
    if (entry.machineModes.length === 0) issues.push(`${entry.id}: missing machine modes`);
    if (entry.operations.length === 0) issues.push(`${entry.id}: missing operations`);
    if (entry.tags.length === 0) issues.push(`${entry.id}: missing tags`);
    if (entry.previewSvgText.trim() === '') issues.push(`${entry.id}: missing preview SVG`);
    if (entry.provenance.license.trim() === '') issues.push(`${entry.id}: missing license`);
    if (entry.provenance.sourceKind !== 'owned' && entry.provenance.sourceUrl === undefined) {
      issues.push(`${entry.id}: missing external source URL`);
    }
    if (
      (entry.provenance.sourceKind === 'cc0' || entry.provenance.sourceKind === 'public-domain') &&
      (entry.provenance.downloadedAt === undefined || entry.provenance.assetHash === undefined)
    ) {
      issues.push(`${entry.id}: missing public-domain provenance`);
    }
    if (entry.insert.kind === 'svg' && entry.insert.svgText.trim() === '') {
      issues.push(`${entry.id}: missing SVG insert text`);
    }
  }
  return issues;
}
```

- [ ] **Step 5: Convert the current catalog to the new shape**

Modify `src/ui/library/design-library.ts` so `DESIGN_LIBRARY` exports `ReadonlyArray<LibraryEntry>`. Preserve the current lucide entries, but map them to:

```ts
{
  id: 'icon-bird',
  title: 'Bird',
  category: 'Icons & Symbols',
  subcategory: 'Animals',
  kind: 'bundled-artwork',
  machineModes: ['laser', 'cnc'],
  operations: ['line'],
  tags: ['animal', 'line-art', 'icon'],
  provenance: {
    sourceKind: 'lucide',
    license: 'ISC',
    sourceUrl: 'https://lucide.dev/license',
    notice: 'Lucide icons are distributed under the ISC license.',
  },
  previewSvgText: bird,
  insert: { kind: 'svg', svgText: bird },
}
```

- [ ] **Step 6: Verify green**

Run:

```powershell
pnpm exec vitest run src/ui/library/design-library-catalog.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/ui/library/design-library-types.ts src/ui/library/design-library-validation.ts src/ui/library/design-library-catalog.test.ts src/ui/library/design-library.ts
git commit -m "feat(library): add catalog metadata foundation"
```

## Task 2: Professional Filtering and Sorting

**Files:**

- Create: `src/ui/library/design-library-filter.ts`
- Create: `src/ui/library/design-library-filter.test.ts`

- [ ] **Step 1: Write failing filter tests**

Create `src/ui/library/design-library-filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { filterDesignLibrary } from './design-library-filter';
import type { LibraryEntry } from './design-library-types';

const entry = (patch: Partial<LibraryEntry>): LibraryEntry => ({
  id: 'base-entry',
  title: 'Base Entry',
  category: 'Icons & Symbols',
  subcategory: 'Symbols',
  kind: 'bundled-artwork',
  machineModes: ['laser'],
  operations: ['line'],
  tags: ['base'],
  provenance: { sourceKind: 'owned', license: 'KerfDesk proprietary asset' },
  previewSvgText: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>',
  insert: { kind: 'svg', svgText: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>' },
  ...patch,
});

describe('filterDesignLibrary', () => {
  const entries = [
    entry({ id: 'laser-kerf-comb', title: 'Kerf Comb', category: 'Test & Calibration', kind: 'owned-template', tags: ['kerf', 'plywood'] }),
    entry({ id: 'cnc-pocket-test', title: 'Pocket Depth Test', category: 'CNC Templates', kind: 'owned-template', machineModes: ['cnc'], operations: ['pocket'], tags: ['depth', 'router'] }),
    entry({ id: 'flower-art', title: 'Flower Silhouette', category: 'Decorative Artwork', machineModes: ['laser', 'cnc'], tags: ['flower', 'nature'] }),
  ];

  it('searches title, category, subcategory, and tags', () => {
    expect(filterDesignLibrary(entries, { search: 'kerf' }).map((item) => item.id)).toEqual(['laser-kerf-comb']);
    expect(filterDesignLibrary(entries, { search: 'nature' }).map((item) => item.id)).toEqual(['flower-art']);
  });

  it('composes machine, kind, operation, and source filters', () => {
    expect(filterDesignLibrary(entries, { machine: 'cnc', kind: 'owned-template', operation: 'pocket' }).map((item) => item.id)).toEqual(['cnc-pocket-test']);
  });

  it('sorts by category then title', () => {
    expect(filterDesignLibrary(entries, {}).map((item) => item.id)).toEqual(['cnc-pocket-test', 'flower-art', 'laser-kerf-comb']);
  });
});
```

- [ ] **Step 2: Verify red**

Run:

```powershell
pnpm exec vitest run src/ui/library/design-library-filter.test.ts
```

Expected: FAIL because `design-library-filter.ts` does not exist.

- [ ] **Step 3: Implement the filter helper**

Create `src/ui/library/design-library-filter.ts`:

```ts
import type { LibraryEntry, LibraryEntryKind, LibraryMachineMode, LibraryOperation, LibrarySourceKind } from './design-library-types';

export type LibraryFilters = {
  readonly search?: string;
  readonly category?: LibraryEntry['category'] | 'all';
  readonly machine?: LibraryMachineMode | 'all';
  readonly kind?: LibraryEntryKind | 'all';
  readonly operation?: LibraryOperation | 'all';
  readonly sourceKind?: LibrarySourceKind | 'all';
};

export function filterDesignLibrary(
  entries: ReadonlyArray<LibraryEntry>,
  filters: LibraryFilters,
): LibraryEntry[] {
  const query = filters.search?.trim().toLowerCase() ?? '';
  return entries
    .filter((entry) => filters.category === undefined || filters.category === 'all' || entry.category === filters.category)
    .filter((entry) => filters.machine === undefined || filters.machine === 'all' || entry.machineModes.includes(filters.machine))
    .filter((entry) => filters.kind === undefined || filters.kind === 'all' || entry.kind === filters.kind)
    .filter((entry) => filters.operation === undefined || filters.operation === 'all' || entry.operations.includes(filters.operation))
    .filter((entry) => filters.sourceKind === undefined || filters.sourceKind === 'all' || entry.provenance.sourceKind === filters.sourceKind)
    .filter((entry) => query === '' || haystack(entry).includes(query))
    .slice()
    .sort((a, b) => `${a.category}\u0000${a.title}`.localeCompare(`${b.category}\u0000${b.title}`));
}

function haystack(entry: LibraryEntry): string {
  return [entry.title, entry.category, entry.subcategory, ...entry.tags].join(' ').toLowerCase();
}
```

- [ ] **Step 4: Verify green**

Run:

```powershell
pnpm exec vitest run src/ui/library/design-library-filter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/ui/library/design-library-filter.ts src/ui/library/design-library-filter.test.ts
git commit -m "feat(library): add catalog filtering"
```

## Task 3: Owned Manufacturing Templates (A)

**Files:**

- Create: `src/ui/library/design-library-owned-svg.ts`
- Modify: `src/ui/library/design-library.ts`
- Modify: `src/ui/library/design-library-catalog.test.ts`

- [ ] **Step 1: Add failing coverage for owned template categories**

Append this test to `src/ui/library/design-library-catalog.test.ts`:

```ts
it('includes owned laser and CNC manufacturing templates', () => {
  const ids = new Set(DESIGN_LIBRARY.map((entry) => entry.id));
  expect(ids).toContain('laser-power-speed-grid');
  expect(ids).toContain('laser-kerf-comb');
  expect(ids).toContain('laser-line-interval-test');
  expect(ids).toContain('cnc-profile-fit-test');
  expect(ids).toContain('cnc-pocket-depth-test');
  expect(ids).toContain('cnc-dogbone-corner-test');
  expect(DESIGN_LIBRARY.filter((entry) => entry.kind === 'owned-template').length).toBeGreaterThanOrEqual(16);
});
```

- [ ] **Step 2: Verify red**

Run:

```powershell
pnpm exec vitest run src/ui/library/design-library-catalog.test.ts
```

Expected: FAIL because owned manufacturing entries are not in the catalog yet.

- [ ] **Step 3: Add owned SVG generators and entries**

Create `src/ui/library/design-library-owned-svg.ts` with local SVG helpers and entries. Keep SVGs plain shapes only. The exact first-pass entries are:

| id | title | category | subcategory | machine | operations | SVG recipe |
| --- | --- | --- | --- | --- | --- | --- |
| `laser-power-speed-grid` | Power / Speed Grid | Test & Calibration | Laser tests | laser | line, fill, calibration | 5 by 6 grid of rectangles |
| `laser-line-interval-test` | Line Interval / LPI Test | Test & Calibration | Laser tests | laser | line, calibration | 8 horizontal hatch strips |
| `laser-kerf-comb` | Kerf Comb | Test & Calibration | Fit tests | laser | line, calibration | comb outline with 9 slot lines |
| `laser-tab-bridge-strip` | Tab / Bridge Strip | Test & Calibration | Cut tests | laser | line, calibration | long strip with 6 bridge gaps |
| `registration-mark-sheet` | Registration Mark Sheet | Test & Calibration | Registration | laser, cnc | line, calibration | four crosshair circles |
| `camera-alignment-marker-sheet` | Camera Alignment Marker Sheet | Test & Calibration | Camera | laser, cnc | line, calibration | checker/cross marker grid |
| `sign-plaque-blank` | Sign / Plaque Blank | Signs & Plaques | Blanks | laser, cnc | line, profile | rounded plaque outline and center guide |
| `coaster-border-blank` | Coaster Border Blank | Signs & Plaques | Blanks | laser, cnc | line, profile | square coaster outline with inset border |
| `keychain-hole-blank` | Keychain Blank | Signs & Plaques | Blanks | laser | line, profile | rounded rectangle and hole |
| `ornament-hole-blank` | Ornament Blank | Signs & Plaques | Blanks | laser | line, profile | circle and hanging hole |
| `box-small-tray-preset` | Small Tray Box Preset | Boxes & Joinery | Box presets | laser, cnc | line, profile | six panel rectangles with tab guide lines |
| `box-pencil-box-preset` | Pencil Box Preset | Boxes & Joinery | Box presets | laser, cnc | line, profile | elongated six panel layout |
| `box-electronics-box-preset` | Electronics Box Preset | Boxes & Joinery | Box presets | laser, cnc | line, profile, drill | panels plus four mounting holes |
| `box-open-bin-preset` | Open Bin Box Preset | Boxes & Joinery | Box presets | laser, cnc | line, profile | five panel tray layout |
| `cnc-profile-fit-test` | CNC Profile Fit Test | CNC Templates | Fit tests | cnc | profile | nested inside/outside rectangles and circles |
| `cnc-pocket-depth-test` | Pocket Depth Test | CNC Templates | Pocket tests | cnc | pocket | 4 by 3 pocket rectangles |
| `cnc-drill-grid` | Drill Grid | CNC Templates | Drill tests | cnc | drill | 5 by 4 circle grid |
| `cnc-dogbone-corner-test` | Dogbone Corner Test | CNC Templates | Joinery tests | cnc | profile, drill | inside-corner square with corner relief circles |
| `cnc-v-carve-sample` | V-Carve Sample | CNC Templates | V-bit tests | cnc | v-carve, line | stars, diamonds, and parallel guide lines |
| `cnc-spoilboard-surfacing` | Spoilboard Surfacing Pattern | CNC Templates | Surfacing | cnc | pocket, calibration | serpentine surfacing guide path |
| `cnc-hold-down-jig` | Hold-Down Jig Strip | Jigs & Fixtures | Workholding | cnc | profile, drill | long strip, slots, and bolt holes |

Use this file shape and fill the array with all entries from the table:

```ts
import type { LibraryEntry } from './design-library-types';

const OWNED_PROVENANCE = {
  sourceKind: 'owned',
  license: 'KerfDesk proprietary asset',
  notice: 'Authored for KerfDesk/LaserForge in this repository.',
} as const;

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function line(x1: number, y1: number, x2: number, y2: number): string {
  return `<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" stroke="#000000" stroke-width="0.1"/>`;
}

function rect(x: number, y: number, w: number, h: number): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000000" stroke-width="0.1"/>`;
}

function circle(cx: number, cy: number, r: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#000000" stroke-width="0.1"/>`;
}

function ownedEntry(args: {
  readonly id: string;
  readonly title: string;
  readonly category: LibraryEntry['category'];
  readonly subcategory: string;
  readonly machineModes: LibraryEntry['machineModes'];
  readonly operations: LibraryEntry['operations'];
  readonly tags: ReadonlyArray<string>;
  readonly svgText: string;
}): LibraryEntry {
  return {
    id: args.id,
    title: args.title,
    category: args.category,
    subcategory: args.subcategory,
    kind: 'owned-template',
    machineModes: args.machineModes,
    operations: args.operations,
    tags: args.tags,
    provenance: OWNED_PROVENANCE,
    previewSvgText: args.svgText,
    insert: { kind: 'svg', svgText: args.svgText },
  };
}

export const OWNED_TEMPLATE_ENTRIES: ReadonlyArray<LibraryEntry> = [
  ownedEntry({
    id: 'laser-power-speed-grid',
    title: 'Power / Speed Grid',
    category: 'Test & Calibration',
    subcategory: 'Laser tests',
    machineModes: ['laser'],
    operations: ['line', 'fill', 'calibration'],
    tags: ['laser', 'power', 'speed', 'plywood', 'test'],
    svgText: svg(80, 55, Array.from({ length: 5 }, (_, row) => Array.from({ length: 6 }, (_, col) => rect(5 + col * 12, 5 + row * 9, 9, 6)).join('')).join('')),
  }),
];
```

Each entry in the table must be represented in `OWNED_TEMPLATE_ENTRIES`. Each `svgText` must contain at least one parseable SVG geometry element and must use only finite coordinates accepted by `parseSvg`.

- [ ] **Step 4: Compose owned entries into the catalog**

Modify `src/ui/library/design-library.ts`:

```ts
import { OWNED_TEMPLATE_ENTRIES } from './design-library-owned-svg';

export const DESIGN_LIBRARY: ReadonlyArray<LibraryEntry> = [
  ...OWNED_TEMPLATE_ENTRIES,
  ...LUCIDE_LIBRARY_ENTRIES,
  ...CC0_LIBRARY_ENTRIES,
];
```

Use an empty `CC0_LIBRARY_ENTRIES` export until Task 4 creates the file.

- [ ] **Step 5: Verify green**

Run:

```powershell
pnpm exec vitest run src/ui/library/design-library-catalog.test.ts src/io/svg/parse-svg.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/ui/library/design-library-owned-svg.ts src/ui/library/design-library.ts src/ui/library/design-library-catalog.test.ts
git commit -m "feat(library): add owned manufacturing templates"
```

## Task 4: Curated CC0/Public-Domain Artwork (B)

**Files:**

- Create: `src/ui/library/design-library-cc0.ts`
- Create: `src/ui/library/design-library-cc0-sources.md`
- Modify: `src/ui/library/design-library.ts`
- Modify: `src/ui/library/design-library-catalog.test.ts`

- [ ] **Step 1: Add failing coverage for CC0 artwork provenance**

Append this test to `src/ui/library/design-library-catalog.test.ts`:

```ts
it('includes curated CC0/public-domain artwork with provenance', () => {
  const cc0 = DESIGN_LIBRARY.filter(
    (entry) => entry.provenance.sourceKind === 'cc0' || entry.provenance.sourceKind === 'public-domain',
  );
  expect(cc0.length).toBeGreaterThanOrEqual(8);
  for (const entry of cc0) {
    expect(entry.provenance.sourceUrl).toMatch(/^https:\/\/openclipart\.org\/detail\//);
    expect(entry.provenance.license).toBe('CC0-1.0 / Public Domain');
    expect(entry.provenance.assetHash).toMatch(/^sha256:/);
    expect(entry.provenance.downloadedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
});
```

- [ ] **Step 2: Verify red**

Run:

```powershell
pnpm exec vitest run src/ui/library/design-library-catalog.test.ts
```

Expected: FAIL because no CC0 entries are present yet.

- [ ] **Step 3: Curate only these Openclipart sources**

Use these source pages; download each `Download SVG` target from the page, verify it parses, and record the hash:

```md
- Laser cutter icon: https://openclipart.org/detail/315232/laser-cutter-icon
- Laser In Use: https://openclipart.org/detail/215782/laser-in-use
- Circular flourish optimized: https://openclipart.org/detail/351224/circular-flourish-by-m1981-optimized
- Flower silhouette: https://openclipart.org/detail/238240/flower-silhouette
- Star route: https://openclipart.org/detail/243156/star-route
- Star hatched: https://openclipart.org/detail/243137/star-hatched
- Moose: https://openclipart.org/detail/17449/moose
- Guitar fretboard 25 scale: https://openclipart.org/detail/289994/guitar-fretboard-25-scale
```

Create `src/ui/library/design-library-cc0-sources.md` with those URLs plus this policy note:

```md
# Design Library CC0 Sources

These entries are bundled only because Openclipart states that its clipart is released into the public domain / CC0 and allows commercial use. Each entry stores a source URL, download date, and SHA-256 hash of the bundled SVG text.
```

- [ ] **Step 4: Add CC0 entries**

Create `src/ui/library/design-library-cc0.ts` with this helper and a `CC0_LIBRARY_ENTRIES` array containing exactly the eight source entries from Step 3. Use literal SVG strings downloaded from Openclipart and literal `sha256:` hashes computed from those exact strings:

```ts
import type { LibraryEntry } from './design-library-types';

function cc0Entry(args: {
  readonly id: string;
  readonly title: string;
  readonly subcategory: string;
  readonly tags: ReadonlyArray<string>;
  readonly sourceUrl: string;
  readonly assetHash: string;
  readonly svgText: string;
}): LibraryEntry {
  return {
    id: args.id,
    title: args.title,
    category: 'Decorative Artwork',
    subcategory: args.subcategory,
    kind: 'bundled-artwork',
    machineModes: ['laser', 'cnc'],
    operations: ['line', 'fill'],
    tags: args.tags,
    provenance: {
      sourceKind: 'cc0',
      license: 'CC0-1.0 / Public Domain',
      sourceUrl: args.sourceUrl,
      downloadedAt: '2026-07-06',
      assetHash: args.assetHash,
      notice: 'Openclipart states submitted clipart is released to the public domain under CC0.',
    },
    previewSvgText: args.svgText,
    insert: { kind: 'svg', svgText: args.svgText },
  };
}

export const CC0_LIBRARY_ENTRIES: ReadonlyArray<LibraryEntry> = [];
```

Immediately fill the empty array with all eight literal entries before running the green test. The final committed file must contain no sentinel text such as `FILL_ME`, `PENDING_ASSET`, or fake hashes; the catalog test must check for those strings.

- [ ] **Step 5: Verify green**

Run:

```powershell
pnpm exec vitest run src/ui/library/design-library-catalog.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/ui/library/design-library-cc0.ts src/ui/library/design-library-cc0-sources.md src/ui/library/design-library.ts src/ui/library/design-library-catalog.test.ts
git commit -m "feat(library): add curated public-domain artwork"
```

## Task 5: Professional Dialog UX and Import Controls (C)

**Files:**

- Modify: `src/ui/library/DesignLibraryDialog.tsx`
- Create: `src/ui/library/DesignLibraryDialog.test.tsx`
- Modify: `src/ui/workspace/ToolStrip.tsx`
- Modify: `src/ui/workspace/ToolStrip.test.tsx`

- [ ] **Step 1: Write failing dialog tests**

Create `src/ui/library/DesignLibraryDialog.test.tsx`:

```tsx
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { DesignLibraryDialog } from './DesignLibraryDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderDialog(): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<DesignLibraryDialog />);
  });
  return host;
}

beforeEach(() => {
  resetStore();
  useUiStore.getState().setLibraryDialogOpen(true);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('DesignLibraryDialog', () => {
  it('shows professional categories and filters', async () => {
    const h = await renderDialog();
    expect(h.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Design library');
    expect(h.textContent).toContain('Laser Templates');
    expect(h.textContent).toContain('CNC Templates');
    expect(h.querySelector('input[aria-label="Search design library"]')).not.toBeNull();
    expect(h.querySelector('select[aria-label="Machine filter"]')).not.toBeNull();
    expect(h.querySelector('select[aria-label="Operation filter"]')).not.toBeNull();
  });

  it('filters by search text and inserts a visible entry', async () => {
    const h = await renderDialog();
    const search = h.querySelector('input[aria-label="Search design library"]') as HTMLInputElement;
    await act(async () => {
      search.value = 'kerf';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(h.textContent).toContain('Kerf');
    const before = useStore.getState().project.scene.objects.length;
    const insert = h.querySelector('button[aria-label^="Insert Kerf"]') as HTMLButtonElement;
    await act(async () => insert.click());
    expect(useStore.getState().project.scene.objects.length).toBeGreaterThan(before);
  });

  it('imports only the currently visible filtered entries', async () => {
    const h = await renderDialog();
    const machine = h.querySelector('select[aria-label="Machine filter"]') as HTMLSelectElement;
    await act(async () => {
      machine.value = 'cnc';
      machine.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const visibleCards = h.querySelectorAll('[data-library-card]').length;
    const before = useStore.getState().project.scene.objects.length;
    const importVisible = h.querySelector('button[aria-label="Import visible library entries"]') as HTMLButtonElement;
    await act(async () => importVisible.click());
    expect(useStore.getState().project.scene.objects.length).toBeGreaterThan(before);
    expect(visibleCards).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Verify red**

Run:

```powershell
pnpm exec vitest run src/ui/library/DesignLibraryDialog.test.tsx
```

Expected: FAIL because the current dialog has old tabs and no professional filters.

- [ ] **Step 3: Implement dialog filtering and cards**

Modify `src/ui/library/DesignLibraryDialog.tsx`:

- Replace `category` tab state with `filters`.
- Use `filterDesignLibrary(DESIGN_LIBRARY, filters)`.
- Render:
  - category buttons for `LIBRARY_CATEGORIES`,
  - search input,
  - machine/kind/operation/source select controls,
  - stable preview cards with `data-library-card`,
  - `Insert <title>` buttons,
  - `Import visible library entries` button.
- Keep `insert(entry)` using `parseSvg` for `entry.insert.kind === 'svg'`.
- Implement `insertVisible(entries)` by calling `insertEntry(entry, batchOffsetIdx)` for each visible entry and keeping the dialog open until the batch finishes.

- [ ] **Step 4: Update the library toolbar button test**

Append to `src/ui/workspace/ToolStrip.test.tsx`:

```tsx
it('opens the design library from the tool strip', async () => {
  const h = await render(<ToolStrip />);
  const library = h.querySelector('button[aria-label="Open design library"]');

  await act(async () => {
    library?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  expect(useUiStore.getState().libraryDialogOpen).toBe(true);
});
```

- [ ] **Step 5: Verify green**

Run:

```powershell
pnpm exec vitest run src/ui/library/DesignLibraryDialog.test.tsx src/ui/workspace/ToolStrip.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/ui/library/DesignLibraryDialog.tsx src/ui/library/DesignLibraryDialog.test.tsx src/ui/workspace/ToolStrip.tsx src/ui/workspace/ToolStrip.test.tsx
git commit -m "feat(library): add professional catalog browser"
```

## Task 6: Verification and Release Readiness

**Files:**

- Modify only feature files changed by this plan if a command below exposes a feature-specific issue.

- [ ] **Step 1: Run focused library suite**

```powershell
pnpm exec vitest run src/ui/library/design-library-catalog.test.ts src/ui/library/design-library-filter.test.ts src/ui/library/DesignLibraryDialog.test.tsx src/ui/workspace/ToolStrip.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run SVG importer safety smoke**

```powershell
pnpm exec vitest run src/io/svg/parse-svg.test.ts src/io/svg/malicious-corpus.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run static gates**

```powershell
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build:web
```

Expected: PASS.

- [ ] **Step 4: Browser smoke**

Start the web app:

```powershell
pnpm dev:web -- --host 127.0.0.1
```

Smoke in a browser:

- Open the design library.
- Filter to Laser Templates and insert `Power / Speed Grid`.
- Filter to CNC Templates and insert `Pocket Depth Test`.
- Filter to Decorative Artwork and insert one Openclipart/CC0 artwork entry.
- Confirm inserted objects appear on the canvas and can be selected.

- [ ] **Step 5: Commit any verification fixes**

```powershell
git status -sb
git add -- docs/superpowers/plans/2026-07-06-professional-design-library.md src/ui/library src/ui/workspace/ToolStrip.tsx src/ui/workspace/ToolStrip.test.tsx
git commit -m "test(library): verify professional design library"
```

- [ ] **Step 6: Push when ready**

```powershell
git push origin main
```

Only push after the focused suite and static gates pass.

## Completion Checklist

- [ ] A: owned manufacturing templates are present, parseable, importable, and categorized.
- [ ] B: curated public-domain artwork is present with source URLs, dates, hashes, and parseability.
- [ ] C: the dialog sorts, filters, searches, imports one item, and imports the visible filtered set.
- [ ] No restricted marketplace/community assets are bundled.
- [ ] Focused tests pass.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm build:web` pass.
- [ ] Browser smoke proves the workflow is visible and usable.
