import { beforeAll, describe, expect, it } from 'vitest';
import type { GrayImage } from '../corner-subpix';
import {
  bedPoint,
  cameraCentre,
  pixelToBed,
  projectWorldPoint,
  type CameraPose,
  type LensModel,
} from '../model/camera-model';
import { lookAt, overheadPose, wideLens } from '../model/model-fixtures';
import { calibrateFromBedTarget } from './bed-calibration';
import { bedTargetLayout, type BedTargetLayout } from './bed-target';
import { detectRingMarks } from './ring-detect';
import { renderTargetScene } from './target-render-fixtures';
import { matchBedTarget } from './target-match';

const SHEET = { x: 5, y: 5, width: 390, height: 390 };
const THICKNESS = 3;

let lens: LensModel;
let pose: CameraPose;
let layout: BedTargetLayout;
let frame: GrayImage;

beforeAll(() => {
  lens = wideLens(960);
  pose = overheadPose();
  layout = bedTargetLayout({ area: SHEET });
  frame = renderTargetScene({
    lens,
    pose,
    layout,
    sheet: SHEET,
    sheetThicknessMm: THICKNESS,
    noise: 4,
    honeycombPitchMm: 6,
  });
});

describe('bed target layout', () => {
  it('covers the area with rings and places the anchor L inside it', () => {
    expect(layout.marks).toHaveLength(100);
    const anchors = layout.marks.filter((m) => m.anchor).map((m) => [m.col, m.row]);
    expect(anchors).toEqual([
      [0, 0],
      [1, 0],
      [0, 2],
    ]);
    for (const mark of layout.marks) {
      expect(mark.x - layout.ringDiameterMm / 2).toBeGreaterThanOrEqual(SHEET.x);
      expect(mark.y + layout.ringDiameterMm / 2).toBeLessThanOrEqual(SHEET.y + SHEET.height);
    }
  });
});

describe('ring detection', () => {
  it('finds rings at the projected centres to a fraction of a pixel', () => {
    const rings = detectRingMarks(frame);
    let matched = 0;
    for (const mark of layout.marks) {
      const truth = projectWorldPoint(lens, pose, bedPoint(mark.x, mark.y, THICKNESS));
      const nearest = rings
        .filter((r) => r.anchor === mark.anchor)
        .map((r) => Math.hypot(r.x - (truth?.x ?? 0), r.y - (truth?.y ?? 0)))
        .sort((a, b) => a - b)[0];
      if (nearest !== undefined && nearest < 0.5) matched += 1;
    }
    // The far row is only a few pixels across at this resolution.
    expect(matched).toBeGreaterThanOrEqual(85);
  });
});

describe('target matching', () => {
  it('indexes the found rings onto the right grid cells', () => {
    const match = matchBedTarget(detectRingMarks(frame), layout);
    expect(match.kind).toBe('ok');
    if (match.kind !== 'ok') return;
    for (const { mark, pixel } of match.correspondences) {
      const truth = projectWorldPoint(lens, pose, bedPoint(mark.x, mark.y, THICKNESS));
      expect(Math.hypot(pixel.x - (truth?.x ?? 0), pixel.y - (truth?.y ?? 0))).toBeLessThan(1);
    }
  });

  it('reports a mirrored camera image instead of fitting it', () => {
    const rings = detectRingMarks(frame).map((r) => ({ ...r, x: frame.width - 1 - r.x }));
    expect(matchBedTarget(rings, layout)).toEqual({ kind: 'failed', reason: 'mirrored-image' });
  });

  it('fails plainly when the anchors are not visible', () => {
    const rings = detectRingMarks(frame).filter((r) => !r.anchor);
    expect(matchBedTarget(rings, layout)).toEqual({ kind: 'failed', reason: 'anchors-not-found' });
  });
});

describe('calibrateFromBedTarget', () => {
  it('recovers the camera from one photo to a tenth of a millimetre on the bed', () => {
    const result = calibrateFromBedTarget({ frame, layout, sheetThicknessMm: THICKNESS });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.foundMarks).toBeGreaterThanOrEqual(80);
    expect(result.rmsErrorMm).toBeLessThan(0.2);
    expect(Math.abs(result.cameraHeightMm + cameraCentre(pose).z)).toBeLessThan(2);
    // Independent check on points that are not marks, including heights the
    // target never sat at: the model is a real 3D ray map.
    for (const height of [0, 12]) {
      for (let y = 30; y <= 370; y += 85) {
        for (let x = 30; x <= 370; x += 85) {
          const pixel = projectWorldPoint(lens, pose, bedPoint(x, y, height));
          const seen = pixelToBed(result.lens, result.pose, pixel ?? { x: 0, y: 0 }, height);
          expect(Math.hypot((seen?.x ?? 0) - x, (seen?.y ?? 0) - y)).toBeLessThan(0.4);
        }
      }
    }
  });
});

describe('calibrateFromBedTarget with a camera looking straight down', () => {
  it('uses the measured camera height to stay right above and below the target', () => {
    const downPose = lookAt([200, 200, -400], [200, 200.001, 0]);
    const downFrame = renderTargetScene({
      lens,
      pose: downPose,
      layout,
      sheet: SHEET,
      sheetThicknessMm: THICKNESS,
      noise: 4,
    });
    // A tape-measure reading 10 mm off the true 400 mm.
    const result = calibrateFromBedTarget({
      frame: downFrame,
      layout,
      sheetThicknessMm: THICKNESS,
      measuredCameraHeightMm: 410,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(Math.abs(result.cameraHeightMm - 400)).toBeLessThan(12);
    for (const height of [0, 20]) {
      for (let y = 60; y <= 340; y += 70) {
        for (let x = 60; x <= 340; x += 70) {
          const pixel = projectWorldPoint(lens, downPose, bedPoint(x, y, height));
          const seen = pixelToBed(result.lens, result.pose, pixel ?? { x: 0, y: 0 }, height);
          expect(Math.hypot((seen?.x ?? 0) - x, (seen?.y ?? 0) - y)).toBeLessThan(0.6);
        }
      }
    }
  });
});
