import { describe, expect, it } from 'vitest';
import type { CircularArraySpec, GridArraySpec } from '../../core/scene/array-layout-types';
import { arraySummary } from './array-dialog-summary';

// A 20 x 20 mm design centred on (20, 30).
const bounds = { minX: 10, minY: 20, maxX: 30, maxY: 40 };
const grid: GridArraySpec = { kind: 'grid', rows: 2, columns: 2, spacingX: 2, spacingY: 2 };
const circle: CircularArraySpec = {
  kind: 'circular',
  count: 6,
  centerX: 20,
  centerY: 30,
  radius: 25,
  startAngleDeg: 0,
  rotateCopies: false,
};

describe('Array dialog status line', () => {
  it('describes the default grid', () => {
    expect(arraySummary(grid, bounds)).toBe(
      '2 rows of 2: the original and 3 copies, 22 × 22 mm centre to centre, 42 × 42 mm overall.',
    );
  });

  it('describes one row spaced by centres, and a single column', () => {
    expect(
      arraySummary({ ...grid, rows: 1, columns: 3, spaceBy: 'centres', spacingX: 12 }, bounds),
    ).toBe('1 row of 3: the original and 2 copies, 12 mm centre to centre, 44 × 20 mm overall.');
    expect(arraySummary({ ...grid, rows: 2, columns: 1 }, bounds)).toBe(
      '1 column of 2: the original and 1 copy, 22 mm centre to centre, 20 × 42 mm overall.',
    );
  });

  it('counts shifts and reversed building in the overall size', () => {
    expect(
      arraySummary({ ...grid, columns: 3, reverseColumns: true, rowShift: 11 }, bounds),
    ).toContain('75 × 42 mm overall');
    expect(arraySummary({ ...grid, rows: 1, columns: 2, rowShift: 50 }, bounds)).toContain(
      '42 × 20 mm overall',
    );
  });

  it('says when copies land on top of each other, without stopping them', () => {
    expect(
      arraySummary({ ...grid, rows: 1, columns: 3, spaceBy: 'centres', spacingX: 0 }, bounds),
    ).toContain('Some copies land on top of each other.');
    expect(
      arraySummary(
        { ...grid, rows: 1, columns: 2, spaceBy: 'centres', spacingX: 0, columnShift: 5 },
        bounds,
      ),
    ).not.toContain('on top');
    expect(arraySummary({ ...grid, rows: 1, columns: 1 }, bounds)).toBe(
      'Only the original: add rows or columns to make copies.',
    );
  });

  it('describes a full circle and says the original moves onto it', () => {
    expect(arraySummary(circle, bounds)).toBe(
      'The original and 5 copies, 60° apart all the way round a 25 mm radius. The original moves to the first position.',
    );
  });

  it('describes a partial arc from start to end', () => {
    expect(
      arraySummary(
        { ...circle, count: 5, radius: 10, arc: { kind: 'end', endAngleDeg: 90 } },
        bounds,
      ),
    ).toBe(
      'The original and 4 copies, 22.5° apart from 0° to 90°, on a 10 mm radius. The original moves to the first position.',
    );
    expect(
      arraySummary(
        { ...circle, count: 3, startAngleDeg: 90, arc: { kind: 'step', stepAngleDeg: -45 } },
        bounds,
      ),
    ).toContain('45° apart from 90° to 0°');
  });

  it('says the centre object stays and the original stays when it sits on the circle', () => {
    const around = {
      ...circle,
      centerX: 20,
      centerY: 55,
      startAngleDeg: 270,
      centerObjectId: 'hub',
    };
    expect(arraySummary(around, bounds)).toBe(
      'The original and 5 copies, 60° apart all the way round a 25 mm radius. The centre object stays where it is.',
    );
    expect(arraySummary({ ...around, startAngleDeg: 0 - 90, rotateCopies: true }, bounds)).toBe(
      'The original and 5 copies, 60° apart all the way round a 25 mm radius. The centre object stays where it is.',
    );
    expect(arraySummary({ ...around, rotateCopies: true, startAngleDeg: 270.5 }, bounds)).toContain(
      'The original moves and turns into the first position.',
    );
  });

  it('explains copies that wrap past a full turn or share one place', () => {
    expect(
      arraySummary({ ...circle, count: 5, arc: { kind: 'step', stepAngleDeg: 100 } }, bounds),
    ).toContain('Copies past a full turn land over earlier ones.');
    expect(
      arraySummary({ ...circle, count: 3, arc: { kind: 'step', stepAngleDeg: 360 } }, bounds),
    ).toContain('Every copy lands in the same place.');
    expect(arraySummary({ ...circle, radius: 0 }, bounds)).toContain(
      'Every copy lands in the same place.',
    );
  });

  it('describes point rotation', () => {
    expect(arraySummary({ kind: 'point-rotation', count: 4, totalAngleDeg: -360 }, bounds)).toBe(
      'The original and 3 copies, turned 90° apart about the selection centre.',
    );
    expect(arraySummary({ kind: 'point-rotation', count: 1, totalAngleDeg: 360 }, bounds)).toBe(
      'Only the original: add copies to turn it.',
    );
  });
});
