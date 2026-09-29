import { describe, expect, it } from 'vitest';
import { bedTargetLayout, type BedTargetMark } from './bed-target';
import { missingOuterBand } from './missing-outer-band';

// The wizard's default layout on a 400 mm bed: 10 × 10 rings, 40 mm apart.
const layout = bedTargetLayout({ area: { x: 5, y: 5, width: 390, height: 390 } });
const cols = [...new Set(layout.marks.map((m) => m.col))].sort((a, b) => a - b);
const rows = [...new Set(layout.marks.map((m) => m.row))].sort((a, b) => a - b);
const everywhere = () => true;

function marks(keep: (mark: BedTargetMark) => boolean): BedTargetMark[] {
  return layout.marks.filter(keep);
}

describe('missingOuterBand', () => {
  it('reports a complete smaller grid whose missing outer rings the camera sees', () => {
    // A target engraved with a 20 mm margin matched onto this layout from its
    // anchors fills all but the last column and row.
    const lastCol = cols[cols.length - 1];
    const lastRow = rows[rows.length - 1];
    const found = marks((m) => m.col !== lastCol && m.row !== lastRow);
    expect(found).toHaveLength(81);
    expect(missingOuterBand(layout, found, everywhere)).toEqual({
      foundCols: 9,
      foundRows: 9,
      cols: 10,
      rows: 10,
    });
  });

  it('still reports it with a ring or two lost inside the grid', () => {
    const lastCol = cols[cols.length - 1];
    const found = marks((m) => m.col !== lastCol).filter((_, i) => i !== 40 && i !== 41);
    expect(missingOuterBand(layout, found, everywhere)).toMatchObject({ foundCols: 9, rows: 10 });
  });

  it('says nothing when the missing rings lie outside the picture', () => {
    const lastRow = rows[rows.length - 1];
    const found = marks((m) => m.row !== lastRow);
    expect(missingOuterBand(layout, found, (m) => m.row !== lastRow)).toBeNull();
  });

  it('says nothing about rings missed here and there, or about a complete target', () => {
    const scattered = layout.marks.filter((_, i) => i % 7 !== 3);
    expect(missingOuterBand(layout, scattered, everywhere)).toBeNull();
    expect(missingOuterBand(layout, layout.marks, everywhere)).toBeNull();
  });

  it('says nothing when the found grid has large holes', () => {
    const lastCol = cols[cols.length - 1];
    const holed = marks((m) => m.col !== lastCol && !(m.row > 0 && m.col < 0));
    expect(missingOuterBand(layout, holed, everywhere)).toBeNull();
  });
});
