import { describe, expect, it } from 'vitest';
import type { FoundMark } from '../../core/camera/marks/find-marks';
import { printedSheet } from '../../core/camera/marks/mark-fixtures';
import type { MarkPair } from '../../core/camera/marks/match-mark-pair';
import { overheadPose, wideLens } from '../../core/camera/model/model-fixtures';
import { renderCameraPicture } from '../../core/camera/pieces/piece-render-fixtures';
import { createProject, type Project } from '../../core/scene';
import { svgObj } from '../state/test-helpers';
import {
  designMarkSizeMm,
  locatePrintCutMarks,
  markPairMessage,
  markPixelsPerMm,
  targetsFromSelection,
} from './print-cut-camera';

// A design with a mark object `size` mm across centred at each point.
function designWithMarks(
  marks: ReadonlyArray<{ id: string; x: number; y: number; size: number }>,
): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: marks.map((mark) => ({
        ...svgObj(mark.id, ['#000000']),
        bounds: {
          minX: mark.x - mark.size / 2,
          minY: mark.y - mark.size / 2,
          maxX: mark.x + mark.size / 2,
          maxY: mark.y + mark.size / 2,
        },
      })),
    },
  };
}

const TARGETS = { first: { x: 70, y: 70 }, second: { x: 330, y: 70 } };

function mark(x: number, y: number): FoundMark {
  return { centre: { x, y }, sizeMm: 8, offCentreMm: 0 };
}

function pair(scale: number, rotationDeg: number, otherPairs: number): MarkPair {
  return {
    first: mark(71, 72),
    second: mark(331, 104),
    scale,
    rotationDeg,
    offsetMm: 2,
    otherPairs,
  };
}

describe('markPixelsPerMm', () => {
  it('uses 4 px/mm on ordinary beds and coarsens only very large ones', () => {
    expect(markPixelsPerMm(400, 400)).toBe(4);
    expect(markPixelsPerMm(1300, 900)).toBeCloseTo(Math.sqrt(4_000_000 / (1300 * 900)));
  });
});

describe('targetsFromSelection', () => {
  const project = designWithMarks([
    { id: 'right', x: 330, y: 70, size: 8 },
    { id: 'left', x: 70, y: 70, size: 8 },
    { id: 'art', x: 200, y: 150, size: 120 },
  ]);

  it('takes the centres of the two selected objects, the left one first', () => {
    expect(targetsFromSelection(project, 'right', new Set(['left']))).toEqual(TARGETS);
  });

  it('gives nothing unless exactly two objects are selected', () => {
    expect(targetsFromSelection(project, 'right', new Set())).toBeNull();
    expect(targetsFromSelection(project, 'right', new Set(['left', 'art']))).toBeNull();
    expect(targetsFromSelection(project, null, new Set())).toBeNull();
  });
});

describe('designMarkSizeMm', () => {
  it('reads the mark size when both targets sit on small design objects', () => {
    const project = designWithMarks([
      { id: 'a', x: 70, y: 70, size: 8 },
      { id: 'b', x: 330, y: 70, size: 10 },
    ]);
    expect(designMarkSizeMm(project, TARGETS)).toEqual({ minMm: 8, maxMm: 10 });
  });

  it('gives nothing when a target is not on a mark-sized object', () => {
    const offCentre = designWithMarks([
      { id: 'a', x: 70, y: 70, size: 8 },
      { id: 'b', x: 332, y: 70, size: 8 },
    ]);
    expect(designMarkSizeMm(offCentre, TARGETS)).toBeNull();
    const large = designWithMarks([
      { id: 'a', x: 70, y: 70, size: 8 },
      { id: 'b', x: 330, y: 70, size: 40 },
    ]);
    expect(designMarkSizeMm(large, TARGETS)).toBeNull();
  });
});

describe('markPairMessage', () => {
  it('reports the measured spacing, print scale and turn', () => {
    expect(markPairMessage({ kind: 'found', pair: pair(1.002, 7.04, 0) }, TARGETS)).toBe(
      'The camera found both marks 260.5 mm apart (designed 260.0 mm, print scale +0.20 %), turned 7.0°.',
    );
  });

  it('says when other pairs fit the spacing too', () => {
    expect(markPairMessage({ kind: 'found', pair: pair(0.999, -1, 1) }, TARGETS)).toContain(
      "print scale -0.10 %), turned -1.0°. 1 other pair of marks is the same distance apart; the pair nearest the design's targets was used.",
    );
    expect(markPairMessage({ kind: 'found', pair: pair(1, 0, 3) }, TARGETS)).toContain(
      '3 other pairs of marks are the same distance apart',
    );
  });

  it('says what was seen when no pair fits', () => {
    expect(markPairMessage({ kind: 'none', marksFound: 1 }, TARGETS)).toContain(
      'The camera found 1 mark-like shape, but no two are 260.0 mm apart (within 2 %).',
    );
    expect(markPairMessage({ kind: 'none', marksFound: 5 }, TARGETS)).toContain(
      '5 mark-like shapes',
    );
  });
});

describe('locatePrintCutMarks', () => {
  it.each([
    [10, 10],
    [6, 14],
  ])(
    'finds both selected %s / %s mm marks in a tilted fisheye frame',
    { timeout: 30_000 },
    (firstSize, secondSize) => {
      // The smaller ring stays within the camera's resolved central field;
      // far-corner 6 mm rings fail even the unfiltered detector on this lens.
      const halfSpan = firstSize === secondSize ? 130 : 80;
      const lens = wideLens();
      const pose = overheadPose();
      const sheet = printedSheet({
        centre: { x: 200, y: 210 },
        deg: 5,
        width: 297,
        height: 210,
        marks: [
          { at: { x: -halfSpan, y: -90 }, style: 'ring', sizeMm: firstSize },
          { at: { x: halfSpan, y: -90 }, style: 'ring', sizeMm: secondSize },
          { at: { x: -halfSpan, y: 90 }, style: 'ring', sizeMm: 10 },
        ],
        topMm: 3,
      });
      const raw = renderCameraPicture({
        lens,
        pose,
        pieces: sheet.pieces,
        thicknessMm: 3,
        noise: 3,
      });
      const [topLeft, topRight] = sheet.markCentres as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      // The design's top marks; the sheet lies a few mm off and turned.
      const targets = {
        first: { x: 202 - halfSpan, y: 110 },
        second: { x: 202 + halfSpan, y: 110 },
      };
      const result = locatePrintCutMarks({
        raw,
        lens,
        pose,
        bedWidthMm: 400,
        bedHeightMm: 400,
        surfaceHeightMm: 3,
        heightAreas: [],
        targets,
        markSizeMm: designMarkSizeMm(
          designWithMarks([
            { id: 'a', ...targets.first, size: firstSize },
            { id: 'b', ...targets.second, size: secondSize },
          ]),
          targets,
        ),
      });
      expect(result?.kind).toBe('found');
      if (result?.kind !== 'found') return;
      const off = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.hypot(a.x - b.x, a.y - b.y);
      expect(off(result.pair.first.centre, topLeft)).toBeLessThan(0.3);
      expect(off(result.pair.second.centre, topRight)).toBeLessThan(0.3);
      expect(result.pair.rotationDeg).toBeCloseTo(5, 0);
      // The left column and diagonal differ in spacing: only the top pair fits.
      expect(result.pair.otherPairs).toBe(0);
    },
  );
});
