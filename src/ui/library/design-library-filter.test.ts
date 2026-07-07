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
  provenance: { sourceKind: 'owned', license: 'KerfDesk proprietary asset' },
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

  it('composes machine, kind, operation, and source filters', () => {
    expect(
      filterDesignLibrary(entries, {
        machine: 'cnc',
        kind: 'owned-template',
        operation: 'pocket',
      }).map((item) => item.id),
    ).toEqual(['cnc-pocket-test']);
  });

  it('sorts by category then title', () => {
    expect(filterDesignLibrary(entries, {}).map((item) => item.id)).toEqual([
      'cnc-pocket-test',
      'flower-art',
      'laser-kerf-comb',
    ]);
  });
});
