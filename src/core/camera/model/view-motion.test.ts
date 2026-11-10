// Rolling audit v13 Y1-P2-2 / Y1-P3-2 (ADR-663 Amendment 5): the camera-moved
// check, run on a bed plane rendered through the fixture lens, against the
// true overlay error of each move. One whole-surround shift said nothing for a
// roll of 0.5-2 degrees, a 3-degree tip or a 20 mm slide, and read a 2 mm
// slide as 1.4 mm; patches fitted on the bed measure all of them.

import { describe, expect, it } from 'vitest';
import type { CameraPose } from './camera-model';
import { overheadPose, wideLens } from './model-fixtures';
import { bedSamplePoints, compareViews } from './view-motion';
import {
  cutParts,
  machineScene,
  plainSheet,
  renderView,
  slidPose,
  trueBedErrorsMm,
  turnedPose,
} from './view-motion-testing';
import { MOVED_MM, viewThumbnail } from './view-shift';

const BED = 400;
const lens = wideLens(768);
const pose = overheadPose();
const scene = machineScene(plainSheet, { gantryY: 120 });
const reference = viewThumbnail(renderView(lens, pose, scene));

function compare(after: CameraPose, current = machineScene(cutParts, { gantryY: 300 })) {
  return compareViews({
    reference,
    current: viewThumbnail(renderView(lens, after, current)),
    lens,
    pose,
    bedWidthMm: BED,
    bedHeightMm: BED,
  });
}

function worstTrueMm(after: CameraPose): number {
  return Math.max(...trueBedErrorsMm(lens, pose, after, bedSamplePoints(BED, BED)));
}

describe('compareViews on a rendered machine', () => {
  it('reads a camera that stayed put as steady, whatever is on the bed or where the gantry is', () => {
    for (const current of [
      machineScene(cutParts, { gantryY: 300 }),
      machineScene(plainSheet, { gantryY: -60 }),
      machineScene(cutParts, { gain: 1.3 }),
    ]) {
      const outcome = compare(pose, current);
      expect(outcome.kind).toBe('measured');
      if (outcome.kind === 'measured') expect(outcome.worstMm).toBeLessThan(0.5);
    }
  });

  it.each([
    ['slides 1.5 mm', slidPose(pose, 1.5, 0)],
    ['slides 5 mm', slidPose(pose, 5, 0)],
    ['slides 20 mm', slidPose(pose, 0, 20)],
    ['slides 40 mm', slidPose(pose, 40, 0)],
    ['rolls 0.5°', turnedPose(pose, 'z', 0.5)],
    ['rolls 1°', turnedPose(pose, 'z', 1)],
    ['rolls 2°', turnedPose(pose, 'z', 2)],
    ['tips 1°', turnedPose(pose, 'x', 1)],
    ['tips 3°', turnedPose(pose, 'x', 3)],
    ['tips 6°', turnedPose(pose, 'x', 6)],
    ['pans 1°', turnedPose(pose, 'y', 1)],
    ['is knocked: slides 6 mm and rolls 1°', turnedPose(slidPose(pose, 6, 0), 'z', 1)],
  ])('warns when the camera %s, with the worst bed error to within 15 %%', (_, after) => {
    const truth = worstTrueMm(after);
    const outcome = compare(after);
    expect(outcome.kind).toBe('measured');
    if (outcome.kind !== 'measured') return;
    expect(outcome.worstMm).toBeGreaterThanOrEqual(MOVED_MM);
    // A slide of a couple of millimetres is read to within half a millimetre.
    expect(Math.abs(outcome.worstMm - truth)).toBeLessThan(Math.max(0.5, 0.15 * truth));
  });

  it('measures a roll at the corners, where it is, not at the still centre', () => {
    const after = turnedPose(pose, 'z', 1);
    const outcome = compare(after);
    if (outcome.kind !== 'measured') throw new Error('expected a measured roll');
    const [centre, ...corners] = outcome.displacementsMm.map((d) => Math.hypot(d.x, d.y));
    expect(centre).toBeLessThan(MOVED_MM);
    for (const corner of corners) expect(corner).toBeGreaterThan(4);
  });

  it('calls a view that no longer matches weak, not steady', () => {
    // Tipped so far that the surround is out of reach of every patch.
    expect(compare(turnedPose(pose, 'x', 14)).kind).toBe('weak');
    expect(compare(slidPose(pose, 0, 150)).kind).toBe('weak');
  });

  it('says nothing when the surround is too plain to compare', () => {
    // No texture anywhere, the bed's own edge included.
    const plain = machineScene(() => 128, { plain: true });
    const plainReference = viewThumbnail(renderView(lens, pose, plain));
    const outcome = compareViews({
      reference: plainReference,
      current: viewThumbnail(renderView(lens, slidPose(pose, 5, 0), plain)),
      lens,
      pose,
      bedWidthMm: BED,
      bedHeightMm: BED,
    });
    expect(outcome.kind).toBe('none');
  });
});
