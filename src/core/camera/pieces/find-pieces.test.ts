import { describe, expect, it } from 'vitest';
import { warpFrameToBedImage } from '../model/bed-image';
import { overheadPose, wideLens } from '../model/model-fixtures';
import { findPieces, MIN_PIECE_AREA_MM2, type DetectedPiece } from './find-pieces';
import {
  BLUE_ACRYLIC,
  placedPolygon,
  PLYWOOD,
  renderBedPicture,
  renderCameraPicture,
  type RenderedPiece,
} from './piece-render-fixtures';
import { relativeRotationDeg } from './piece-placements';

const REGION = { x: 0, y: 0, width: 300, height: 220 };
const PPM = 2;

function rect(x: number, y: number, angleDeg: number, colour = PLYWOOD): RenderedPiece {
  return { kind: 'rect', centre: { x, y }, length: 80, width: 50, angleDeg, colour };
}

// Axis difference folded into [0, 90].
function axisError(a: number, b: number): number {
  const d = Math.abs((((a - b) % 180) + 180) % 180);
  return Math.min(d, 180 - d);
}

function find(pieces: ReadonlyArray<RenderedPiece>, reference: { x: number; y: number } | null) {
  const image = renderBedPicture({ region: REGION, pixelsPerMm: PPM, pieces, noise: 4 });
  return findPieces({
    image,
    region: REGION,
    pixelsPerMm: PPM,
    reference,
    minAreaMm2: MIN_PIECE_AREA_MM2,
  });
}

describe('findPieces on a flattened bed picture', () => {
  const layout: RenderedPiece[] = [
    rect(200, 60, 23),
    rect(70, 60, 0),
    { kind: 'disc', centre: { x: 205, y: 160 }, radius: 32, colour: PLYWOOD },
    rect(75, 158, 140),
    // A 3 mm offcut: smaller than the smallest piece.
    { kind: 'disc', centre: { x: 140, y: 110 }, radius: 3, colour: PLYWOOD },
  ];

  it('finds each blank in rows with its centre, size and angle', () => {
    const pieces = find(layout, null);
    expect(pieces).toHaveLength(4);
    const expected = [
      { x: 70, y: 60, angle: 0 },
      { x: 200, y: 60, angle: 23 },
      { x: 75, y: 158, angle: 140 },
    ];
    expected.forEach((want, index) => {
      const piece = pieces[index] as DetectedPiece;
      expect(Math.hypot(piece.rect.centre.x - want.x, piece.rect.centre.y - want.y)).toBeLessThan(
        0.5,
      );
      expect(piece.rect.length).toBeGreaterThanOrEqual(79);
      expect(piece.rect.length).toBeLessThanOrEqual(81);
      expect(piece.rect.width).toBeGreaterThanOrEqual(49);
      expect(piece.rect.width).toBeLessThanOrEqual(51);
      expect(axisError(piece.rect.axisDeg, want.angle)).toBeLessThan(1);
      expect(piece.shape).toBe('oblong');
      expect(piece.headingDeg).toBeNull();
      expect(piece.partial).toBe(false);
    });
    const disc = pieces[3] as DetectedPiece;
    expect(disc.shape).toBe('round');
    expect(Math.hypot(disc.rect.centre.x - 205, disc.rect.centre.y - 160)).toBeLessThan(0.5);
    expect(disc.areaMm2).toBeGreaterThan(Math.PI * 31 ** 2);
    expect(disc.areaMm2).toBeLessThan(Math.PI * 33 ** 2);
  });

  it('tells a blank as bright as the bed apart by its colour at the reference point', () => {
    const blue = [rect(80, 70, 10, BLUE_ACRYLIC), rect(210, 150, -35, BLUE_ACRYLIC)];
    const pieces = find(blue, { x: 80, y: 70 });
    expect(pieces).toHaveLength(2);
    expect(
      Math.hypot((pieces[1]?.rect.centre.x ?? 0) - 210, (pieces[1]?.rect.centre.y ?? 0) - 150),
    ).toBeLessThan(0.6);
    expect(axisError(pieces[1]?.rect.axisDeg ?? NaN, 145)).toBeLessThan(1);
  });

  it('works the same with the reference point on the bed', () => {
    const pieces = find(layout, { x: 140, y: 205 });
    expect(pieces).toHaveLength(4);
  });

  it('marks a piece that runs off the picture as partial', () => {
    const pieces = find([rect(70, 60, 0), rect(290, 150, 0)], null);
    expect(pieces.map((piece) => piece.partial)).toEqual([false, true]);
  });

  it('gives a lopsided piece a heading that fixes a full turn', () => {
    // An arrow: its mass sits behind the rectangle's centre.
    const arrow = [
      { x: -30, y: -20 },
      { x: 20, y: -20 },
      { x: 35, y: 0 },
      { x: 20, y: 20 },
      { x: -30, y: 20 },
    ];
    const pieces = find(
      [
        { kind: 'polygon', points: placedPolygon(arrow, { x: 70, y: 70 }, 0), colour: PLYWOOD },
        { kind: 'polygon', points: placedPolygon(arrow, { x: 210, y: 140 }, 200), colour: PLYWOOD },
      ],
      null,
    );
    expect(pieces).toHaveLength(2);
    const [first, second] = pieces as [DetectedPiece, DetectedPiece];
    expect(first.headingDeg).not.toBeNull();
    expect(second.headingDeg).not.toBeNull();
    expect(relativeRotationDeg(first, second)).toBeCloseTo(-160, 0);
  });
});

describe('findPieces through the camera model', () => {
  it(
    'finds 3 mm blanks where they lie on the bed from a tilted fisheye picture',
    { timeout: 30_000 },
    () => {
      const lens = wideLens();
      const pose = overheadPose();
      const layout = [
        rect(110, 110, 12),
        rect(290, 120, 75),
        rect(120, 280, 160),
        rect(280, 290, 45),
      ];
      const frame = renderCameraPicture({ lens, pose, pieces: layout, thicknessMm: 3, noise: 3 });
      const region = { x: 20, y: 30, width: 360, height: 340 };
      const image = warpFrameToBedImage(frame, lens, pose, {
        region,
        pixelsPerMm: PPM,
        surfaceHeightMm: 3,
      });
      expect(image).not.toBeNull();
      if (image === null) return;
      const pieces = findPieces({
        image,
        region,
        pixelsPerMm: PPM,
        reference: null,
        minAreaMm2: MIN_PIECE_AREA_MM2,
      });
      expect(pieces).toHaveLength(4);
      const want = [
        { x: 110, y: 110, angle: 12 },
        { x: 290, y: 120, angle: 75 },
        { x: 120, y: 280, angle: 160 },
        { x: 280, y: 290, angle: 45 },
      ];
      want.forEach((w, index) => {
        const piece = pieces[index] as DetectedPiece;
        expect(Math.hypot(piece.rect.centre.x - w.x, piece.rect.centre.y - w.y)).toBeLessThan(0.8);
        expect(axisError(piece.rect.axisDeg, w.angle)).toBeLessThan(1);
      });
    },
  );
});
