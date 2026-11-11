// Rolling audit v13 Y3-P2-1 (ADR-443 Amendment 3): past a quarter turn the
// nearest pairing of the two Print and Cut marks is the swapped one, so the
// cut missed the print by 136-225 mm while the dialog said "turned 0.0°" for
// an upside-down sheet. The printed artwork beside the marks tells the two
// pairings apart.

import { describe, expect, it } from 'vitest';
import {
  applySimilarityPoint,
  solveTwoPointRegistration,
} from '../../registration/similarity-transform';
import type { RgbaImage } from '../rgba-image';
import type { FoundMark, Point } from './find-marks';
import { matchMarkPair } from './match-mark-pair';
import { orientMarkPair, type ArtworkBox } from './pair-orientation';

const BED = 400;
const PPM = 2;
const SHEET = { width: 297, height: 210 };
const CENTRE = { x: SHEET.width / 2, y: SHEET.height / 2 };
// An "L" of printed artwork near the sheet's left: not symmetric under a half turn.
const ARTWORK: ArtworkBox[] = [
  { minX: 40, minY: 60, maxX: 140, maxY: 90 },
  { minX: 40, minY: 90, maxX: 70, maxY: 170 },
];
// The same area, but symmetric about the sheet's centre.
const SYMMETRIC: ArtworkBox[] = [{ minX: 98.5, minY: 75, maxX: 198.5, maxY: 135 }];
const LAYOUTS = {
  diagonal: [
    { x: 15, y: 15 },
    { x: 282, y: 195 },
  ],
  edge: [
    { x: 15, y: 15 },
    { x: 282, y: 15 },
  ],
} as const;

type Sheet = { readonly turnDeg: number; readonly shift: Point };

// Design mm → bed mm: the sheet turned about its centre, laid at the bed's middle.
function toBed(sheet: Sheet, p: Point): Point {
  const a = (sheet.turnDeg * Math.PI) / 180;
  const dx = p.x - CENTRE.x;
  const dy = p.y - CENTRE.y;
  return {
    x: BED / 2 + sheet.shift.x + dx * Math.cos(a) - dy * Math.sin(a),
    y: BED / 2 + sheet.shift.y + dx * Math.sin(a) + dy * Math.cos(a),
  };
}

function toDesign(sheet: Sheet, p: Point): Point {
  const a = (sheet.turnDeg * Math.PI) / 180;
  const dx = p.x - BED / 2 - sheet.shift.x;
  const dy = p.y - BED / 2 - sheet.shift.y;
  return {
    x: CENTRE.x + dx * Math.cos(a) + dy * Math.sin(a),
    y: CENTRE.y - dx * Math.sin(a) + dy * Math.cos(a),
  };
}

function inside(box: ArtworkBox, p: Point): boolean {
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
}

// The camera picture flattened onto the bed: grey bed, white sheet, dark marks and artwork.
function bedImage(
  sheet: Sheet,
  marks: readonly Point[],
  artwork: readonly ArtworkBox[],
): RgbaImage {
  const size = BED * PPM;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const design = toDesign(sheet, { x: (px + 0.5) / PPM, y: (py + 0.5) / PPM });
      const onSheet =
        design.x >= 0 && design.y >= 0 && design.x <= SHEET.width && design.y <= SHEET.height;
      let v = onSheet ? 232 : 110;
      if (onSheet && artwork.some((box) => inside(box, design))) v = 60;
      if (marks.some((m) => Math.hypot(design.x - m.x, design.y - m.y) < 5)) v = 25;
      data.set([v, v, v, 255], (py * size + px) * 4);
    }
  }
  return { width: size, height: size, data };
}

function found(p: Point): FoundMark {
  return { centre: p, sizeMm: 10, offCentreMm: 0 };
}

function orient(layout: keyof typeof LAYOUTS, sheet: Sheet, artwork = ARTWORK) {
  const targets = LAYOUTS[layout];
  const marks = [toBed(sheet, targets[1]), toBed(sheet, targets[0])].map(found);
  const matched = matchMarkPair(targets, marks);
  if (matched.kind !== 'found') throw new Error('expected a pair');
  return orientMarkPair({
    pair: matched.pair,
    targets,
    artwork,
    image: bedImage(sheet, targets, artwork),
    region: { x: 0, y: 0 },
    pixelsPerMm: PPM,
  });
}

// How far the registered cut lands from the print, at the artwork's corner.
function cutMissMm(
  layout: keyof typeof LAYOUTS,
  sheet: Sheet,
  first: Point,
  second: Point,
): number {
  const solved = solveTwoPointRegistration({ design: LAYOUTS[layout], machine: [first, second] });
  if (!solved.ok) throw new Error(solved.reason);
  const corner = { x: 140, y: 170 };
  const cut = applySimilarityPoint(corner, solved.transform);
  const print = toBed(sheet, corner);
  return Math.hypot(cut.x - print.x, cut.y - print.y);
}

describe('orientMarkPair', () => {
  it.each([
    ['diagonal', 0],
    ['diagonal', 30],
    ['diagonal', 88],
    ['diagonal', 92],
    ['diagonal', 120],
    ['diagonal', 180],
    ['diagonal', 270],
    ['diagonal', -100],
    ['edge', 0],
    ['edge', 75],
    ['edge', 88],
    ['edge', 120],
    ['edge', 180],
  ] as const)('pairs %s marks right on a sheet turned %s°, from the print', (layout, turnDeg) => {
    const sheet = { turnDeg, shift: { x: 4, y: 3 } };
    const oriented = orient(layout, sheet);
    expect(oriented.kind).toBe('print');
    const { first, second } = oriented.pair;
    expect(cutMissMm(layout, sheet, first.centre, second.centre)).toBeLessThan(0.1);
    // The turn reported is the sheet's.
    const turn = ((((oriented.pair.rotationDeg - turnDeg) % 360) + 540) % 360) - 180;
    expect(Math.abs(turn)).toBeLessThan(0.1);
  });

  it('turns the nearest pairing round when the print says so (the upside-down sheet)', () => {
    const oriented = orient('diagonal', { turnDeg: 180, shift: { x: 30, y: 20 } });
    expect(oriented.kind).toBe('print');
    if (oriented.kind === 'print') expect(oriented.flipped).toBe(true);
  });

  it('asks for confirmation when the print cannot tell and the sheet is turned far', () => {
    expect(orient('diagonal', { turnDeg: 120, shift: { x: 0, y: 0 } }, SYMMETRIC).kind).toBe(
      'ambiguous',
    );
    expect(orient('diagonal', { turnDeg: 10, shift: { x: 0, y: 0 } }, SYMMETRIC).kind).toBe(
      'nearest',
    );
  });

  it('asks for confirmation without any artwork beside the marks', () => {
    expect(orient('edge', { turnDeg: 88, shift: { x: 0, y: 0 } }, []).kind).toBe('ambiguous');
  });
});
