import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../rgba-image';
import { bedMapper, bedPoint, projectWorldPoint, type LensModel } from './camera-model';
import type { CameraModelRecord } from './camera-model-record';
import { lookAt, savedCameraModel } from './model-fixtures';
import {
  headCameraView,
  isHeadCameraModel,
  modelAtHead,
  planHeadCaptures,
  shiftedPose,
} from './head-camera';
import { stitchHeadCameraPictures } from './head-camera-stitch';

// A close-up camera on the head: 60 mm above the bed, looking straight down
// at a spot 30 mm right of and 10 mm behind the beam.
const HEAD_AT_CALIBRATION = { x: 100, y: 80 };
const CAMERA_OFFSET = { x: 30, y: 10 };
const CAMERA_HEIGHT_MM = 60;

function headLens(width = 640): LensModel {
  const s = width / 640;
  return {
    intrinsics: { fx: 500 * s, fy: 500 * s, cx: 319.5 * s, cy: 179.5 * s },
    distortion: [0.01, -0.004, 0, 0],
    imageWidth: width,
    imageHeight: Math.round((width * 9) / 16),
  };
}

function headCameraModel(): CameraModelRecord {
  const cx = HEAD_AT_CALIBRATION.x + CAMERA_OFFSET.x;
  const cy = HEAD_AT_CALIBRATION.y + CAMERA_OFFSET.y;
  return {
    ...savedCameraModel(),
    lens: headLens(),
    pose: lookAt([cx, cy, -CAMERA_HEIGHT_MM], [cx, cy + 1e-3, 0]),
    accuracy: {
      rmsErrorMm: 0.03,
      maxErrorMm: 0.08,
      foundMarks: 20,
      expectedMarks: 20,
      targetHeightMm: 0,
      targetArea: { x: 110, y: 70, width: 40, height: 40 },
      marks: [{ x: 120, y: 80, dxMm: 0.01, dyMm: -0.02 }],
    },
    mount: { kind: 'head', headAtCalibrationMm: HEAD_AT_CALIBRATION },
  };
}

describe('a camera that rides on the head', () => {
  it('sees a bed point after the head moves where it saw the point moved back', () => {
    const record = headCameraModel();
    const shift = { x: -42.5, y: 17 };
    const moved = shiftedPose(record.pose, shift);
    const point = bedPoint(140, 95, 3);
    const seen = projectWorldPoint(record.lens, moved, point);
    const before = projectWorldPoint(
      record.lens,
      record.pose,
      bedPoint(point.x - shift.x, point.y - shift.y, 3),
    );
    expect(seen?.x).toBeCloseTo(before?.x ?? NaN, 9);
    expect(seen?.y).toBeCloseTo(before?.y ?? NaN, 9);
  });

  it('moves the pose and the measured rings with the head', () => {
    const record = headCameraModel();
    const at = modelAtHead(record, { x: 150, y: 60 });
    expect(at.mount).toEqual({ kind: 'head', headAtCalibrationMm: { x: 150, y: 60 } });
    expect(at.accuracy.targetArea).toEqual({ x: 160, y: 50, width: 40, height: 40 });
    expect(at.accuracy.marks?.[0]).toMatchObject({ x: 170, y: 60 });
    // The point under the camera travels with the head.
    const underCamera = bedMapper(at.lens, at.pose)({ x: 319.5, y: 179.5 });
    expect(underCamera?.x).toBeCloseTo(150 + CAMERA_OFFSET.x, 3);
    expect(underCamera?.y).toBeCloseTo(60 + CAMERA_OFFSET.y, 1);
    // Moving twice is the same as moving once.
    const twice = modelAtHead(modelAtHead(record, { x: 10, y: 5 }), { x: 150, y: 60 });
    twice.pose.tvec.forEach((t, i) => expect(t).toBeCloseTo(at.pose.tvec[i] ?? NaN, 9));
  });

  it('leaves a fixed camera as it is', () => {
    const fixed = savedCameraModel();
    expect(isHeadCameraModel(fixed)).toBe(false);
    expect(modelAtHead(fixed, { x: 5, y: 5 })).toBe(fixed);
    expect(isHeadCameraModel(headCameraModel())).toBe(true);
  });

  it('finds the clear box the camera sees, relative to the head', () => {
    const view = headCameraView(headCameraModel(), 0);
    expect(view).not.toBeNull();
    if (view === null) return;
    // 80 % of 640 × 360 px at 500 px per unit, 60 mm away: about 61 × 35 mm.
    expect(view.width).toBeGreaterThan(55);
    expect(view.width).toBeLessThan(70);
    expect(view.height).toBeGreaterThan(30);
    expect(view.height).toBeLessThan(38);
    expect(view.x + view.width / 2).toBeCloseTo(CAMERA_OFFSET.x, 0);
    expect(view.y + view.height / 2).toBeCloseTo(CAMERA_OFFSET.y, 0);
  });
});

describe('planHeadCaptures', () => {
  const view = { x: 5, y: -15, width: 50, height: 30 };
  const bed = { width: 400, height: 300 };

  it('covers an area in overlapping rows, snaking back and forth', () => {
    const plan = planHeadCaptures(view, { x: 100, y: 100, width: 100, height: 60 }, bed, 0.2);
    expect(plan.coversArea).toBe(true);
    // Views centred at x 125, 150, 175 and y 115, 130, 145.
    const xs = [95, 120, 145];
    const ys = [115, 130, 145];
    expect(plan.heads).toEqual([
      ...xs.map((x) => ({ x, y: ys[0] })),
      ...[...xs].reverse().map((x) => ({ x, y: ys[1] })),
      ...xs.map((x) => ({ x, y: ys[2] })),
    ]);
  });

  it('takes one picture of an area smaller than the view', () => {
    const plan = planHeadCaptures(view, { x: 200, y: 150, width: 20, height: 10 }, bed);
    expect(plan.heads).toEqual([{ x: 180, y: 155 }]);
    expect(plan.coversArea).toBe(true);
  });

  it('says when the head cannot reach far enough to see the bed edge', () => {
    // The camera looks 5 mm right of the head, so the left 5 mm needs the head off the bed.
    const plan = planHeadCaptures(view, { x: 0, y: 100, width: 100, height: 30 }, bed);
    expect(plan.heads.every((head) => head.x >= 0)).toBe(true);
    expect(plan.coversArea).toBe(false);
  });
});

describe('stitchHeadCameraPictures', () => {
  // The bed's own picture: smooth colour ramps, so any misplaced pixel shows.
  const bedColour = (x: number, y: number): readonly [number, number, number] => [
    2 * (x - 80),
    3 * (y - 60),
    128,
  ];

  function photograph(record: CameraModelRecord, head: { x: number; y: number }): RgbaImage {
    const at = modelAtHead(record, head);
    const toBed = bedMapper(at.lens, at.pose);
    const { imageWidth: width, imageHeight: height } = at.lens;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const point = toBed({ x, y });
        if (point === null) continue;
        const [r, g, b] = bedColour(point.x, point.y);
        data.set([r, g, b, 255], (y * width + x) * 4);
      }
    }
    return { data, width, height };
  }

  it('puts every picture where the head took it, seams included', () => {
    const record = headCameraModel();
    const area = { x: 110, y: 90, width: 90, height: 50 };
    const view = headCameraView(record, 0);
    if (view === null) throw new Error('no view');
    const plan = planHeadCaptures(view, area, { width: 400, height: 300 });
    expect(plan.heads.length).toBeGreaterThan(3);
    const pictures = plan.heads.map((head) => ({ frame: photograph(record, head), headMm: head }));
    const stitched = stitchHeadCameraPictures(record, pictures, {
      region: area,
      pixelsPerMm: 2,
      surfaceHeightMm: 0,
    });
    expect(stitched).not.toBeNull();
    if (stitched === null) return;
    expect(stitched.width).toBe(180);
    expect(stitched.height).toBe(100);
    let worst = 0;
    for (let y = 2; y < stitched.height - 2; y += 1) {
      for (let x = 2; x < stitched.width - 2; x += 1) {
        const i = (y * stitched.width + x) * 4;
        expect(stitched.data[i + 3]).toBe(255);
        const [r, g] = bedColour(area.x + (x + 0.5) / 2, area.y + (y + 0.5) / 2);
        worst = Math.max(
          worst,
          Math.abs((stitched.data[i] ?? 0) - r),
          Math.abs((stitched.data[i + 1] ?? 0) - g),
        );
      }
    }
    // The colour climbs 2 to 3 levels per mm, so one level is under half a
    // millimetre on the bed; rounding to whole levels alone accounts for 0.5.
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('leaves what no picture saw transparent', () => {
    const record = headCameraModel();
    const stitched = stitchHeadCameraPictures(
      record,
      [{ frame: photograph(record, { x: 100, y: 80 }), headMm: { x: 100, y: 80 } }],
      { region: { x: 0, y: 0, width: 300, height: 200 }, pixelsPerMm: 1, surfaceHeightMm: 0 },
    );
    expect(stitched?.data[3]).toBe(0);
    // The spot under the camera was seen.
    const under = ((80 + CAMERA_OFFSET.y) * 300 + 100 + CAMERA_OFFSET.x) * 4 + 3;
    expect(stitched?.data[under]).toBe(255);
  });
});
