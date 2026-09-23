import { expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import { fillVectorGroupsWithCoverage } from './rasterize-vector-fill';

it('retains dense photo tone within the bitmap worker budget', () => {
  const source = densePhoto();
  const width = 1000;
  const height = 750;
  const grid = { width, height, ink: 0, luma: new Uint8Array(width * height).fill(255) };
  const start = performance.now();
  fillVectorGroupsWithCoverage(
    grid,
    [{ objects: [{ paths: [{ polylines: source.polylines, fillRule: 'evenodd' }] }] }],
    { minX: 0, minY: 0, maxX: source.width, maxY: source.height },
    width / source.width,
    height / source.height,
  );
  // The same 410,240 vertices previously cost a full edge scan per subrow.
  // A generous real worker budget catches that regression without requiring
  // a precise timing match on machines with different CPU speeds.
  expect(performance.now() - start).toBeLessThan(30_000);
  const meanLuma = grid.luma.reduce((sum, luma) => sum + luma, 0) / grid.luma.length;
  const expectedMean = 255 * (1 - source.area / (source.width * source.height));
  expect(Math.abs(meanLuma - expectedMean)).toBeLessThan(0.25);
}, 45_000);

function densePhoto() {
  const width = 4000;
  const height = 3000;
  const columns = 320;
  const samples = 640;
  const polylines: Polyline[] = [];
  let area = 0;
  for (let column = 0; column < columns; column += 1) {
    const left: Vec2[] = [];
    const right: Vec2[] = [];
    const centre = ((column + 0.5) * width) / columns;
    let previousHalfWidth = 0;
    for (let sample = 0; sample <= samples; sample += 1) {
      const halfWidth = (width / columns) * (0.27 + 0.21 * Math.sin(sample * 0.71 + column));
      const y = (sample * height) / samples;
      left.push({ x: centre - halfWidth, y });
      right.push({ x: centre + halfWidth, y });
      // Independent trapezoid area: adjacent half-widths add to the mean
      // full ribbon width. The ribbons never overlap their neighbours.
      if (sample > 0) area += ((previousHalfWidth + halfWidth) * height) / samples;
      previousHalfWidth = halfWidth;
    }
    polylines.push({ closed: true, points: [...left, ...right.reverse()] });
  }
  return { polylines, width, height, area };
}
