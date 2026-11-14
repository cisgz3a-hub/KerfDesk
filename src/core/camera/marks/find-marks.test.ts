import { describe, expect, it } from 'vitest';
import { warpFrameToBedImage } from '../model/bed-image';
import { overheadPose, wideLens } from '../model/model-fixtures';
import {
  renderBedPicture,
  renderCameraPicture,
  type RenderedPiece,
} from '../pieces/piece-render-fixtures';
import { findMarks, type FoundMark, type Point } from './find-marks';
import { printedMark, printedSheet } from './mark-fixtures';
import { matchMarkPair } from './match-mark-pair';

const REGION = { x: 0, y: 0, width: 400, height: 300 };
const PPM = 4;
const SHEET = printedSheet({
  centre: { x: 200, y: 150 },
  deg: 7,
  width: 297,
  height: 210,
  marks: [
    { at: { x: -130, y: -90 }, style: 'ring', sizeMm: 8 },
    { at: { x: 130, y: -90 }, style: 'ring', sizeMm: 8 },
    { at: { x: -130, y: 90 }, style: 'cross', sizeMm: 10 },
    { at: { x: 130, y: 90 }, style: 'dot', sizeMm: 6 },
  ],
});

function nearest(marks: ReadonlyArray<FoundMark>, p: Point): number {
  return Math.min(...marks.map((m) => Math.hypot(m.centre.x - p.x, m.centre.y - p.y)));
}

describe('findMarks on a flattened bed picture', () => {
  const image = renderBedPicture({
    region: REGION,
    pixelsPerMm: PPM,
    pieces: SHEET.pieces,
    noise: 4,
  });
  const marks = findMarks({ image, region: REGION, pixelsPerMm: PPM, minSizeMm: 2, maxSizeMm: 30 });

  it('finds rings, crosses and dots on the sheet, and nothing on the honeycomb or in the artwork block', () => {
    // The four marks and the artwork's letter-like ring, which looks just like one.
    expect(marks).toHaveLength(5);
    for (const centre of SHEET.markCentres) expect(nearest(marks, centre)).toBeLessThan(0.1);
    expect(nearest(marks, SHEET.artworkRingCentre)).toBeLessThan(0.1);
  });

  it('keeps only marks of the size asked for', () => {
    const small = findMarks({
      image,
      region: REGION,
      pixelsPerMm: PPM,
      minSizeMm: 5,
      maxSizeMm: 7,
    });
    expect(small).toHaveLength(2);
    expect(nearest(small, SHEET.markCentres[3] as Point)).toBeLessThan(0.1);
  });
});

describe('matchMarkPair', () => {
  const image = renderBedPicture({
    region: REGION,
    pixelsPerMm: PPM,
    pieces: SHEET.pieces,
    noise: 4,
  });
  const marks = findMarks({ image, region: REGION, pixelsPerMm: PPM, minSizeMm: 2, maxSizeMm: 30 });

  it('takes the pair at the design spacing that lies nearest the design targets, in order', () => {
    // The design's top marks, 260 mm apart, where the canvas shows them.
    const result = matchMarkPair(
      [
        { x: 70, y: 70 },
        { x: 330, y: 70 },
      ],
      marks,
    );
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    const [topLeft, topRight] = SHEET.markCentres as [Point, Point];
    expect(nearest([result.pair.first], topLeft)).toBeLessThan(0.1);
    expect(nearest([result.pair.second], topRight)).toBeLessThan(0.1);
    expect(result.pair.rotationDeg).toBeCloseTo(7, 1);
    expect(result.pair.scale).toBeCloseTo(1, 3);
    // The bottom row is the same distance apart.
    expect(result.pair.otherPairs).toBe(1);
  });

  it('finds nothing when no two marks are the design spacing apart', () => {
    const result = matchMarkPair(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      marks,
    );
    expect(result).toEqual({ kind: 'none', marksFound: 5 });
  });
});

describe('findMarks through the camera model', () => {
  it(
    'places marks on a sheet on 3 mm material from a tilted fisheye picture',
    { timeout: 90_000 },
    () => {
      const lens = wideLens();
      const pose = overheadPose();
      const sheet = printedSheet({
        centre: { x: 200, y: 200 },
        deg: -4,
        width: 297,
        height: 210,
        marks: [
          { at: { x: -130, y: -90 }, style: 'ring', sizeMm: 10 },
          { at: { x: 130, y: 90 }, style: 'cross', sizeMm: 12 },
        ],
        topMm: 3,
      });
      const frame = renderCameraPicture({
        lens,
        pose,
        pieces: sheet.pieces,
        thicknessMm: 3,
        noise: 3,
      });
      const region = { x: 20, y: 60, width: 360, height: 280 };
      const image = warpFrameToBedImage(frame, lens, pose, {
        region,
        pixelsPerMm: PPM,
        surfaceHeightMm: 3,
      });
      expect(image).not.toBeNull();
      if (image === null) return;
      const marks = findMarks({ image, region, pixelsPerMm: PPM, minSizeMm: 2, maxSizeMm: 30 });
      // The two marks and the artwork's letter-like ring.
      expect(marks).toHaveLength(3);
      for (const centre of sheet.markCentres) expect(nearest(marks, centre)).toBeLessThan(0.3);
      // The design's targets are 316 mm apart, where the canvas shows them.
      const [first, second] = sheet.markCentres as [Point, Point];
      const result = matchMarkPair(
        [
          { x: first.x + 12, y: first.y - 8 },
          { x: second.x + 12, y: second.y - 8 },
        ],
        marks,
      );
      expect(result.kind).toBe('found');
      if (result.kind !== 'found') return;
      expect(nearest([result.pair.first], first)).toBeLessThan(0.3);
      expect(nearest([result.pair.second], second)).toBeLessThan(0.3);
      expect(Math.abs(result.pair.scale - 1)).toBeLessThan(0.002);
    },
  );
});

// Camera audit v2 K3-P2-3 (ADR-443 Amendment 4): a ring 20-30 % under tape
// was accepted with its centre up to 1.3 mm off.
describe('a mark partly covered', () => {
  const region = { x: 0, y: 0, width: 40, height: 30 };
  const centre = { x: 20, y: 15 };
  const paper: RenderedPiece = {
    kind: 'rect',
    centre,
    length: 40,
    width: 30,
    angleDeg: 0,
    colour: [236, 236, 230],
  };
  function marksUnderTape(share: number, side: 'right' | 'top'): FoundMark[] {
    const covered = 6 * share;
    const tape: RenderedPiece =
      side === 'right'
        ? {
            kind: 'rect',
            centre: { x: centre.x + 3 - covered / 2 + 5, y: centre.y },
            length: covered + 10,
            width: 12,
            angleDeg: 0,
            colour: [244, 244, 240],
          }
        : {
            kind: 'rect',
            centre: { x: centre.x, y: centre.y - 3 + covered / 2 - 5 },
            length: 12,
            width: covered + 10,
            angleDeg: 0,
            colour: [244, 244, 240],
          };
    const pieces =
      share === 0
        ? [...printedMark('ring', centre, 6), paper]
        : [tape, ...printedMark('ring', centre, 6), paper];
    const image = renderBedPicture({ region, pixelsPerMm: PPM, pieces, noise: 2 });
    return findMarks({
      image,
      region,
      pixelsPerMm: PPM,
      minSizeMm: 0.6 * 6,
      maxSizeMm: 1.6 * 6,
      expectedSizeMm: { minMm: 6, maxMm: 6 },
    });
  }

  it('finds the whole mark where it is', () => {
    const marks = marksUnderTape(0, 'right');
    expect(marks).toHaveLength(1);
    expect(nearest(marks, centre)).toBeLessThan(0.05);
  });

  // About a tenth covered is within a pixel or two of a whole mark: taken
  // only when its centre is still within 0.3 mm.
  it('takes a mark a tenth covered only where its centre still is', () => {
    for (const side of ['right', 'top'] as const) {
      const marks = marksUnderTape(0.1, side);
      if (marks.length > 0) expect(nearest(marks, centre)).toBeLessThan(0.3);
    }
  });

  it.each([0.15, 0.2, 0.25, 0.3])('refuses it %s covered, from the side or the top', (share) => {
    expect(marksUnderTape(share, 'right')).toEqual([]);
    expect(marksUnderTape(share, 'top')).toEqual([]);
  });
});
