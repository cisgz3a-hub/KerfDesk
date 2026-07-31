import { describe, expect, it } from 'vitest';
import { filterDesignLibrary } from './design-library-filter';
import type { LibraryEntry } from './design-library-types';

const svgText = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>';

const entry = (patch: Partial<LibraryEntry>): LibraryEntry => ({
  id: 'base-entry',
  title: 'Base Entry',
  category: 'Icons & Symbols',
  subcategory: 'Symbols',
  kind: 'bundled-artwork',
  machineModes: ['laser'],
  operations: ['line'],
  tags: ['base'],
  provenance: {
    sourceKind: 'owned',
    sourceName: 'CurveDesk',
    license: 'MIT',
    licenseId: 'MIT',
  },
  previewSvgText: svgText,
  insert: { kind: 'svg', svgText },
  ...patch,
});

describe('filterDesignLibrary', () => {
  const entries = [
    entry({
      id: 'laser-kerf-comb',
      title: 'Kerf Comb',
      category: 'Test & Calibration',
      kind: 'owned-template',
      tags: ['kerf', 'plywood'],
    }),
    entry({
      id: 'cnc-pocket-test',
      title: 'Pocket Depth Test',
      category: 'CNC Templates',
      kind: 'owned-template',
      machineModes: ['cnc'],
      operations: ['pocket'],
      tags: ['depth', 'router'],
    }),
    entry({
      id: 'flower-art',
      title: 'Flower Silhouette',
      category: 'Decorative Artwork',
      machineModes: ['laser', 'cnc'],
      tags: ['flower', 'nature'],
    }),
  ];

  it('searches title, category, subcategory, and tags', () => {
    expect(filterDesignLibrary(entries, { search: 'kerf' }).map((item) => item.id)).toEqual([
      'laser-kerf-comb',
    ]);
    expect(filterDesignLibrary(entries, { search: 'nature' }).map((item) => item.id)).toEqual([
      'flower-art',
    ]);
  });

  it.each([
    ['title', 'title needle', entry({ id: 'title', title: 'Title Needle' })],
    ['category', 'signs & plaques', entry({ id: 'category', category: 'Signs & Plaques' })],
    ['subcategory', 'detail needle', entry({ id: 'subcategory', subcategory: 'Detail Needle' })],
    ['tag', 'tag-needle', entry({ id: 'tag', tags: ['tag-needle'] })],
    [
      'creator',
      'creator needle',
      entry({
        id: 'creator',
        provenance: {
          sourceKind: 'lucide',
          sourceName: 'Lucide',
          creator: 'Creator Needle',
          license: 'ISC',
          licenseId: 'ISC',
        },
      }),
    ],
    [
      'source',
      'source needle',
      entry({
        id: 'source',
        provenance: {
          sourceKind: 'cc0',
          sourceName: 'Source Needle',
          license: 'CC0',
          licenseId: 'CC0-1.0',
        },
      }),
    ],
    [
      'license',
      'friendly permit',
      entry({
        id: 'license',
        provenance: {
          sourceKind: 'owned',
          sourceName: 'CurveDesk',
          license: 'Friendly Permit',
          licenseId: 'FRIENDLY-1.0',
        },
      }),
    ],
  ])('searches %s metadata case-insensitively', (_field, query, matchingEntry) => {
    const distractor = entry({ id: 'distractor' });
    expect(
      filterDesignLibrary([distractor, matchingEntry], {
        search: `  ${query.toUpperCase()}  `,
      }).map((item) => item.id),
    ).toEqual([matchingEntry.id]);
  });

  it('composes category, machine, kind, operation, and source filters', () => {
    expect(
      filterDesignLibrary(entries, {
        category: 'CNC Templates',
        machine: 'cnc',
        kind: 'owned-template',
        operation: 'pocket',
        sourceKind: 'owned',
      }).map((item) => item.id),
    ).toEqual(['cnc-pocket-test']);
  });

  it('treats undefined and all as unfiltered without mutating the input', () => {
    const originalIds = entries.map((item) => item.id);
    expect(filterDesignLibrary(entries, {}).length).toBe(entries.length);
    expect(
      filterDesignLibrary(entries, {
        category: 'all',
        machine: 'all',
        kind: 'all',
        operation: 'all',
        sourceKind: 'all',
      }).length,
    ).toBe(entries.length);
    expect(entries.map((item) => item.id)).toEqual(originalIds);
  });

  it('sorts copies by category then title', () => {
    expect(filterDesignLibrary(entries, {}).map((item) => item.id)).toEqual([
      'cnc-pocket-test',
      'flower-art',
      'laser-kerf-comb',
    ]);
  });
});
