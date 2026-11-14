// Rolling audit v13 Y1-P2-2 / Y1-P3-2 (ADR-663 Amendment 5): the camera-moved
// check, run on a bed plane rendered through the fixture lens, against the
// true overlay error of each move. One whole-surround shift said nothing for a
// roll of 0.5-2 degrees, a 3-degree tip or a 20 mm slide, and read a 2 mm
// slide as 1.4 mm; patches fitted on the bed measure all of them.

import { describe, expect, it } from 'vitest';
import { bedPoint, pixelToBed, projectWorldPoint, type CameraPose } from './camera-model';
import { overheadPose, wideLens } from './model-fixtures';
import { bedMotionFromPatches, bedSamplePoints, compareViews } from './view-motion';
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

  // Camera audit v2 K2-P3-1: the sign is what the type documents.
  it('gives each displacement as where the drawn point truly is, less the point', () => {
    const after = slidPose(pose, 5, 0);
    const outcome = compare(after);
    if (outcome.kind !== 'measured') throw new Error('expected a measured slide');
    const [centre] = bedSamplePoints(BED, BED);
    const [reported] = outcome.displacementsMm;
    if (centre === undefined || reported === undefined) throw new Error('expected the centre');
    // The calibration draws the centre at this pixel; the moved camera sees there:
    const pixel = projectWorldPoint(lens, pose, bedPoint(centre.x, centre.y, 0));
    const truly = pixel === null ? null : pixelToBed(lens, after, pixel, 0);
    if (truly === null) throw new Error('expected the centre in the picture');
    expect(reported.x).toBeCloseTo(truly.x - centre.x, 0);
    expect(reported.y).toBeCloseTo(truly.y - centre.y, 0);
  });

  // Camera audit v2 K2r-P3-1: a flip setting changed is no small move.
  it('does not measure a mirrored picture as a move', () => {
    const view = viewThumbnail(renderView(lens, pose, machineScene(cutParts, { gantryY: 300 })));
    const mirrored = new Uint8Array(view.data.length);
    for (let y = 0; y < view.height; y += 1) {
      for (let x = 0; x < view.width; x += 1) {
        mirrored[y * view.width + x] = view.data[y * view.width + (view.width - 1 - x)] ?? 0;
      }
    }
    const outcome = compareViews({
      reference,
      current: { ...view, data: mirrored },
      lens,
      pose,
      bedWidthMm: BED,
      bedHeightMm: BED,
    });
    expect(outcome.kind).not.toBe('measured');
  });

  it('turns down a fit that mirrors the bed, even when every patch matches', () => {
    // Each patch of a left-right mirrored picture shows across the middle.
    const width = 192;
    const height = 108;
    const patches = [];
    for (const cy of [12, 30, 54, 78, 96]) {
      for (const cx of [10, 30, 60, 132, 162, 182]) {
        patches.push({ cx, cy, dxPx: width - 1 - 2 * cx, dyPx: 0, score: 1 });
      }
    }
    const args = {
      lens,
      pose,
      thumbWidth: width,
      thumbHeight: height,
      bedWidthMm: BED,
      bedHeightMm: BED,
    };
    expect(bedMotionFromPatches({ ...args, patches })).toBeNull();
    // The same patches moved, not mirrored, are measured.
    const slid = patches.map((patch) => ({ ...patch, dxPx: 3 }));
    expect(bedMotionFromPatches({ ...args, patches: slid })).not.toBeNull();
  });
});
