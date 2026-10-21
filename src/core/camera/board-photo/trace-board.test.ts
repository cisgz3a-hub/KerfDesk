import { describe, expect, it } from 'vitest';
import { pointInPolygon, sizeBoardOutline, type Vec2 } from '../../scene';
import { applyHomography, invertMat3, solveHomography, type Mat3 } from '../homography';
import { writeBilinear, type RgbaImage } from '../rgba-image';
import { orderQuadCorners, photoToMm } from './photo-quad';
import { rectifiedRegion, rectifyPhoto } from './rectify-photo';
import { traceBoardOutline } from './trace-board';

const L_SHAPE: ReadonlyArray<Vec2> = [
  { x: 10, y: 10 },
  { x: 220, y: 10 },
  { x: 220, y: 70 },
  { x: 90, y: 70 },
  { x: 90, y: 160 },
  { x: 10, y: 160 },
];
const REFERENCE = [
  { x: 25, y: 20 },
  { x: 75, y: 20 },
  { x: 75, y: 60 },
  { x: 25, y: 60 },
] as const;

describe('photo rectify and board trace', () => {
  it('recovers a perspectively photographed L board to its measured size', () => {
    const bed = renderScene();
    const bedToPhoto = solveHomography([
      { src: { x: 0, y: 0 }, dst: { x: 20, y: 20 } },
      { src: { x: 250, y: 0 }, dst: { x: 580, y: 25 } },
      { src: { x: 250, y: 180 }, dst: { x: 575, y: 450 } },
      { src: { x: 0, y: 180 }, dst: { x: 25, y: 455 } },
    ]);
    expect(bedToPhoto.ok).toBe(true);
    if (!bedToPhoto.ok) return;
    const photo = warpBedToPhoto(bed, bedToPhoto.matrix, 600, 480);
    const taps = orderQuadCorners(
      REFERENCE.map((point) => applyHomography(bedToPhoto.matrix, point)),
    );
    expect(taps).not.toBeNull();
    if (taps === null) return;
    const toMm = photoToMm(taps, { widthMm: 50, heightMm: 40 });
    expect(toMm).not.toBeNull();
    if (toMm === null) return;
    const info = rectifiedRegion(photo.width, photo.height, toMm, { widthMm: 50, heightMm: 40 });
    const rectified = rectifyPhoto(photo, toMm, info.region, info.pixelsPerMm);
    const tapMm = applyHomography(toMm, applyHomography(bedToPhoto.matrix, { x: 150, y: 40 }));
    const traced = traceBoardOutline({
      rectified,
      region: info.region,
      pixelsPerMm: info.pixelsPerMm,
      tapMm,
    });
    expect(traced.ok).toBe(true);
    if (!traced.ok) return;
    const sized = sizeBoardOutline(traced.outlineMm, 200, 140);
    expect(sized).not.toBeNull();
    if (sized === null) return;
    expect(
      Math.abs(polygonArea(sized) - polygonArea(normalizedTrueShape())) /
        polygonArea(normalizedTrueShape()),
    ).toBeLessThan(0.03);
    for (const corner of normalizedTrueShape()) {
      expect(
        Math.min(...sized.map((point) => Math.hypot(point.x - corner.x, point.y - corner.y))),
      ).toBeLessThan(2);
    }
  });
});

function renderScene(): RgbaImage {
  const pixelsPerMm = 2;
  const width = 500;
  const height = 360;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const mm = { x: (x + 0.5) / pixelsPerMm, y: (y + 0.5) / pixelsPerMm };
      const onReference = mm.x >= 25 && mm.x <= 75 && mm.y >= 20 && mm.y <= 60;
      const value = onReference ? 245 : pointInPolygon(mm, L_SHAPE) ? 190 : 25;
      const offset = (y * width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function warpBedToPhoto(bed: RgbaImage, transform: Mat3, width: number, height: number): RgbaImage {
  const inverse = invertMat3(transform);
  if (inverse === null) throw new Error('Expected invertible fixture transform');
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const mm = applyHomography(inverse, { x, y });
      writeBilinear(data, (y * width + x) * 4, bed, mm.x * 2, mm.y * 2);
    }
  }
  return { data, width, height };
}

function normalizedTrueShape(): Vec2[] {
  return L_SHAPE.map((point) => ({
    x: ((point.x - 10) * 200) / 210,
    y: ((point.y - 10) * 140) / 150,
  }));
}

function polygonArea(points: ReadonlyArray<Vec2>): number {
  return Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length] as Vec2;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
}
