import { describe, expect, it } from 'vitest';
import type { GrayImage } from '../corner-subpix';
import { bedTargetLayout, type BedTargetLayout, type BedTargetMark } from './bed-target';
import { detectRingMarks } from './ring-detect';
import { matchBedTarget } from './target-match';

// Independent, ideal top-down pixels exercise the real detector and matcher.
// Resolve every ring at 12 px, isolating layout from camera resolution. This
// does not qualify a physical camera's ability to resolve a small engraved ring.
function targetPhoto(layout: BedTargetLayout): {
  image: GrayImage;
  pixelOf: (mark: BedTargetMark) => { x: number; y: number };
} {
  const scale = 12 / layout.ringDiameterMm;
  const outer = 6;
  const inner = outer - layout.ringWidthMm * scale;
  const minX = Math.min(...layout.marks.map((mark) => mark.x));
  const minY = Math.min(...layout.marks.map((mark) => mark.y));
  const maxX = Math.max(...layout.marks.map((mark) => mark.x));
  const maxY = Math.max(...layout.marks.map((mark) => mark.y));
  const padding = 48 + outer;
  const width = Math.ceil((maxX - minX) * scale + 2 * padding);
  const height = Math.ceil((maxY - minY) * scale + 2 * padding);
  const data = new Float32Array(width * height).fill(220);
  const pixelOf = (mark: BedTargetMark) => ({
    x: padding + (mark.x - minX) * scale,
    y: padding + (mark.y - minY) * scale,
  });
  for (const mark of layout.marks) {
    const centre = pixelOf(mark);
    for (let y = Math.floor(centre.y - outer); y <= Math.ceil(centre.y + outer); y += 1) {
      for (let x = Math.floor(centre.x - outer); x <= Math.ceil(centre.x + outer); x += 1) {
        let ink = 0;
        for (const dy of [-0.25, 0.25]) {
          for (const dx of [-0.25, 0.25]) {
            const radius = Math.hypot(x + dx - centre.x, y + dy - centre.y);
            if (radius <= outer && (mark.anchor || radius >= inner)) ink += 1;
          }
        }
        data[y * width + x] = 220 - ink * 40;
      }
    }
  }
  return { image: { width, height, data }, pixelOf };
}

describe('bed target layout through detection and matching', () => {
  it.each([
    [90, 90],
    [40, 40],
    [60, 190],
    [190, 60],
    [129.999, 169.999],
    [130, 170],
    [130.001, 170.001],
    [175, 175],
    [175, 215],
    [390, 390],
  ])('recognises all marks inside a %s by %s mm area', (width, height) => {
    const area = { x: 5, y: 5, width, height };
    const layout = bedTargetLayout({ area });
    const { image, pixelOf } = targetPhoto(layout);
    const found = detectRingMarks(image);
    const match = matchBedTarget(found, layout);

    expect(found.filter((mark) => mark.anchor)).toHaveLength(3);
    expect(found).toHaveLength(layout.marks.length);
    expect(match.kind).toBe('ok');
    if (match.kind !== 'ok') throw new Error(`Matching failed: ${match.reason}`);
    expect(match.correspondences).toHaveLength(layout.marks.length);
    for (const { mark, pixel } of match.correspondences) {
      const expected = pixelOf(mark);
      expect(Math.hypot(pixel.x - expected.x, pixel.y - expected.y)).toBeLessThan(0.2);
      const radius = layout.ringDiameterMm / 2;
      expect(mark.x - radius).toBeGreaterThanOrEqual(area.x - 1e-9);
      expect(mark.y - radius).toBeGreaterThanOrEqual(area.y - 1e-9);
      expect(mark.x + radius).toBeLessThanOrEqual(area.x + width + 1e-9);
      expect(mark.y + radius).toBeLessThanOrEqual(area.y + height + 1e-9);
    }
  });
});
