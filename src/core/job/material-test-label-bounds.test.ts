// ADR-497 Amendment 1 (audit v4 E5-P2-2): no two burned labels of a Material
// Test card touch, so every digit reads as itself.
import { describe, expect, it } from 'vitest';
import type { SceneObject } from '../scene';
import { generateMaterialTestGrid, type MaterialTestGridOptions } from './material-test-grid';

type Box = {
  readonly text: string;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly sizeMm: number;
};

const DIALOG_DEFAULT: MaterialTestGridOptions = {
  rows: 10,
  columns: 10,
  speedMin: 1000,
  speedMax: 3000,
  powerMin: 10,
  powerMax: 40,
  intervalMm: 0.1,
  cellWidthMm: 5,
  cellHeightMm: 5,
  gapMm: 1,
};

const GRIDS: ReadonlyArray<readonly [string, MaterialTestGridOptions]> = [
  ['the dialog default 10 × 10', DIALOG_DEFAULT],
  [
    '4-digit speed columns',
    {
      ...DIALOG_DEFAULT,
      rowParameter: 'power',
      columnParameter: 'speed',
      speedMin: 1000,
      speedMax: 6000,
      maxFeedMmPerMin: 6000,
    },
  ],
  [
    '5-digit speed columns',
    {
      ...DIALOG_DEFAULT,
      rowParameter: 'power',
      columnParameter: 'speed',
      speedMin: 10000,
      speedMax: 20000,
      maxFeedMmPerMin: 36000,
    },
  ],
  [
    'hatch spacing columns',
    { ...DIALOG_DEFAULT, columnParameter: 'interval', intervalMinMm: 0.05, intervalMaxMm: 0.2 },
  ],
  ['power 0 to 100', { ...DIALOG_DEFAULT, powerMin: 0, powerMax: 100 }],
  ['cells without gaps', { ...DIALOG_DEFAULT, gapMm: 0 }],
  ['a cut grid of small cells', { ...DIALOG_DEFAULT, mode: 'line', cellWidthMm: 3, gapMm: 0.5 }],
];

describe('Material Test burned labels', () => {
  it.each(GRIDS)('never touch on %s', (_, options) => {
    const grid = generateMaterialTestGrid(options);
    const labels = labelBoxes(grid.scene.objects);
    expect(labels.length).toBe(options.rows + options.columns);
    for (const [index, a] of labels.entries()) {
      for (const b of labels.slice(index + 1)) {
        // Clear space between two labels at least as wide as the space
        // between two digits of one (one fifth of the digit height).
        const clearance = Math.min(a.sizeMm, b.sizeMm) / 5;
        expect(
          separated(a, b, clearance - 1e-9),
          `"${a.text}" and "${b.text}" touch: ${boxText(a)} / ${boxText(b)}`,
        ).toBe(true);
      }
      for (const cell of grid.cells) {
        expect(separated(a, { ...cell.bounds, text: cell.objectId, sizeMm: 0 }, 0)).toBe(true);
      }
      expect(a.minX).toBeGreaterThanOrEqual(-1e-9);
      expect(a.minY).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('keeps the default column labels centred over their cells at one size', () => {
    const grid = generateMaterialTestGrid(DIALOG_DEFAULT);
    const columns = labelBoxes(grid.scene.objects).slice(0, DIALOG_DEFAULT.columns);
    expect(columns.map((label) => label.text)).toEqual([
      '10',
      '13.33',
      '16.67',
      '20',
      '23.33',
      '26.67',
      '30',
      '33.33',
      '36.67',
      '40',
    ]);
    expect(new Set(columns.map((label) => label.sizeMm.toFixed(6))).size).toBe(1);
    for (const [column, label] of columns.entries()) {
      const cell = grid.cells.find((item) => item.row === 0 && item.column === column)!;
      expect((label.minX + label.maxX) / 2).toBeCloseTo((cell.bounds.minX + cell.bounds.maxX) / 2);
      // Labels sit on the cells' edge of the top gutter; a decimal point
      // hangs a little below the digits.
      expect(cell.bounds.minY - label.maxY).toBeGreaterThan(0.8);
      expect(cell.bounds.minY - label.maxY).toBeLessThanOrEqual(1 + 1e-9);
    }
    // Small enough to fit the 6 mm pitch, no smaller than that needs.
    expect(Math.max(...columns.map((label) => label.maxX - label.minX))).toBeCloseTo(5.4);
  });
});

function labelBoxes(objects: ReadonlyArray<SceneObject>): Box[] {
  return objects.flatMap((object) => {
    if (object.kind !== 'imported-svg' || !object.source?.startsWith('calibration-label:')) {
      return [];
    }
    const { x, y } = object.transform;
    // Digits are as tall as the label size; a decimal point hangs to 5.45 of
    // their 5 units.
    const height = object.bounds.maxY - object.bounds.minY;
    const sizeMm = object.source.includes('.') ? (height * 5) / 5.45 : height;
    return [
      {
        text: object.source.slice('calibration-label:'.length),
        minX: x + object.bounds.minX,
        minY: y + object.bounds.minY,
        maxX: x + object.bounds.maxX,
        maxY: y + object.bounds.maxY,
        sizeMm,
      },
    ];
  });
}

function separated(a: Box, b: Box, clearance: number): boolean {
  return (
    a.maxX + clearance <= b.minX ||
    b.maxX + clearance <= a.minX ||
    a.maxY + clearance <= b.minY ||
    b.maxY + clearance <= a.minY
  );
}

function boxText(box: Box): string {
  return `x ${box.minX.toFixed(2)}..${box.maxX.toFixed(2)} y ${box.minY.toFixed(2)}..${box.maxY.toFixed(2)}`;
}
