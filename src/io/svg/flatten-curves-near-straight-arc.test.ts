// Rolling audit v11 W5-P1-1, SVG twin (ADR-159 Amendment 3): Chromium 156
// draws M0 0 A1e17 1e17 0 0 1 10 10 through A1e20 as a 10 x 10 line, but
// arcToCubics built the cubic from a centre ~1e16 chords away, and rounding
// bowed it to y 6,145 mm (polyline) and 8,192 mm (canonical cubic).
import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { curveSubpathBounds } from '../../core/scene';
import { arcToCubics } from './flatten-curves';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgWorkerDocument } from './parse-svg-worker';

const SMALL_SWEEP = { xAxisRotationDeg: 0, largeArc: false, sweep: true } as const;
const HUGE_RADII = ['1e16', '2.5e16', '1e17', '1e18', '1e20'];

function distanceFromDiagonal(point: { readonly x: number; readonly y: number }): number {
  return Math.abs(point.x - point.y) / Math.SQRT2;
}

describe('SVG arcs whose radius dwarfs the chord are straight (W5-P1-1)', () => {
  it.each(HUGE_RADII)('arcToCubics gives one straight cubic at radius %s', (radius) => {
    const r = Number(radius);
    const cubics = arcToCubics({ x: 0, y: 0 }, { x: 10, y: 10 }, r, r, {
      rx: r,
      ry: r,
      ...SMALL_SWEEP,
    });
    expect(cubics).toHaveLength(1);
    const [cubic] = cubics;
    expect(cubic?.p0).toEqual({ x: 0, y: 0 });
    expect(cubic?.p3).toEqual({ x: 10, y: 10 });
    for (const point of [cubic?.p1, cubic?.p2]) {
      expect(point).toBeDefined();
      if (point !== undefined) expect(distanceFromDiagonal(point)).toBeLessThan(1e-12);
    }
  });

  it.each(HUGE_RADII)('the import of A%s is the 10 x 10 line Chromium draws', async (radius) => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">' +
      `<path d="M0 0 A${radius} ${radius} 0 0 1 10 10" stroke="#000"/></svg>`;
    const document = await readSvgDocumentFromBlob(
      new NodeBlob([svg], { type: 'image/svg+xml' }) as Blob,
    );
    const result = parseSvgWorkerDocument(document, { id: 'arc', source: 'arc.svg' });
    const path = result.object?.paths[0];
    expect(path?.polylines[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    const curve = path?.curves?.[0];
    expect(curve).toBeDefined();
    if (curve !== undefined) {
      expect(curveSubpathBounds(curve)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    }
  });

  it('keeps a large but real arc as an arc on its circle', () => {
    // Radius 1e5 on a 14.1 mm chord: sagitta 2.5e-4 mm, 1.8e-5 of the chord.
    const r = 1e5;
    const cubics = arcToCubics({ x: 0, y: 0 }, { x: 10, y: 10 }, r, r, {
      rx: r,
      ry: r,
      ...SMALL_SWEEP,
    });
    const cubic = cubics[0];
    if (cubic === undefined) throw new Error('expected a cubic');
    const sagitta = r - Math.sqrt(r * r - 50);
    // The controls sit off the chord, on the sweep side, about 4/3 of the sagitta.
    const offsets = [cubic.p1, cubic.p2].map(distanceFromDiagonal);
    for (const offset of offsets) {
      expect(offset).toBeGreaterThan(sagitta);
      expect(offset).toBeLessThan(2 * sagitta);
    }
  });

  it('leaves a large-arc flag alone: that arc goes round the far side', () => {
    const r = 1e3;
    const cubics = arcToCubics({ x: 0, y: 0 }, { x: 10, y: 10 }, r, r, {
      rx: r,
      ry: r,
      xAxisRotationDeg: 0,
      largeArc: true,
      sweep: true,
    });
    expect(cubics.length).toBeGreaterThan(1);
  });
});
