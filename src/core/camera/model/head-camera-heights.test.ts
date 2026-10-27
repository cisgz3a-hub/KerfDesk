// A head camera's heights (ADR-449 Amendment 2, rolling audit v4 H6-P1-2 and
// H6-P2-1), measured with the real stitch, warp and projection on frames
// ray-cast through the camera: a stitched picture flattens a height area at
// its own height, and a calibration records the head's Z and is refused away
// from it, because a raised camera misplaces the bed.

import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../rgba-image';
import { bedMapper, bedPoint, projectWorldPoint, type LensModel } from './camera-model';
import { normalizeCameraModelRecord, type CameraModelRecord } from './camera-model-record';
import {
  HEAD_CAMERA_Z_TOLERANCE_MM,
  headCameraView,
  headCameraZChange,
  modelAtHead,
} from './head-camera';
import { stitchHeadCameraPictures } from './head-camera-stitch';
import type { SurfaceHeightArea } from './height-areas';
import { lookAt, savedCameraModel } from './model-fixtures';

// A close-up camera on the head, 60 mm above the bed and looking straight
// down 30 mm right of and 10 mm behind the beam (the head-camera.test fixture).
const HEAD_AT_CALIBRATION = { x: 100, y: 80 };
const CAMERA_OFFSET = { x: 30, y: 10 };
const CAMERA_HEIGHT_MM = 60;
const HEAD = { x: 150, y: 120 };
// The lens axis meets the bed here with the head at HEAD.
const AXIS = { x: HEAD.x + CAMERA_OFFSET.x, y: HEAD.y + CAMERA_OFFSET.y };

const LENS: LensModel = {
  intrinsics: { fx: 500, fy: 500, cx: 319.5, cy: 179.5 },
  distortion: [0.01, -0.004, 0, 0],
  imageWidth: 640,
  imageHeight: 360,
};

function headCameraModel(headZAtCalibrationMm?: number): CameraModelRecord {
  const cx = HEAD_AT_CALIBRATION.x + CAMERA_OFFSET.x;
  const cy = HEAD_AT_CALIBRATION.y + CAMERA_OFFSET.y;
  return {
    ...savedCameraModel(),
    lens: LENS,
    pose: lookAt([cx, cy, -CAMERA_HEIGHT_MM], [cx, cy + 1e-3, 0]),
    mount: {
      kind: 'head',
      headAtCalibrationMm: HEAD_AT_CALIBRATION,
      ...(headZAtCalibrationMm === undefined ? {} : { headZAtCalibrationMm }),
    },
  };
}

// A 3 mm sheet with a 20 mm box on it; a dark 3 mm square sits on the box top,
// 15.8 mm from the lens axis.
const SHEET_MM = 3;
const BOX: SurfaceHeightArea = {
  id: 'box',
  x: 185,
  y: 125,
  width: 20,
  height: 20,
  surfaceHeightMm: 20,
};
const MARK = { x: AXIS.x + 15, y: AXIS.y + 5 };

function onMark(point: { x: number; y: number }): boolean {
  return Math.abs(point.x - MARK.x) <= 1.5 && Math.abs(point.y - MARK.y) <= 1.5;
}

function inBox(point: { x: number; y: number }): boolean {
  return (
    point.x >= BOX.x &&
    point.x <= BOX.x + BOX.width &&
    point.y >= BOX.y &&
    point.y <= BOX.y + BOX.height
  );
}

// What the camera at `record`'s pose sees with the head at HEAD: each ray
// hits the box top when it lands on it, else the sheet.
function photograph(record: CameraModelRecord): RgbaImage {
  const at = modelAtHead(record, HEAD);
  const toBed = bedMapper(at.lens, at.pose);
  const { imageWidth: width, imageHeight: height } = at.lens;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const top = toBed({ x, y }, BOX.surfaceHeightMm);
      const dark = top !== null && inBox(top) && onMark(top);
      data.set(dark ? [0, 0, 0, 255] : [200, 200, 200, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

// The dark pixels' centre, in bed mm.
function markCentre(image: RgbaImage, region: { x: number; y: number }, ppm: number) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      if ((image.data[i + 3] ?? 0) === 255 && (image.data[i] ?? 255) < 100) {
        sx += x;
        sy += y;
        n += 1;
      }
    }
  }
  if (n === 0) throw new Error('mark not seen');
  return { x: region.x + (sx / n + 0.5) / ppm, y: region.y + (sy / n + 0.5) / ppm };
}

describe('a head camera stitch with a raised object (H6-P1-2)', () => {
  const record = headCameraModel();
  const region = { x: 165, y: 116, width: 40, height: 28 };
  const ppm = 4;
  const pictures = [{ frame: photograph(record), headMm: HEAD }];

  it('draws a mark on a 20 mm box where it is when the box has its height area', () => {
    const view = headCameraView(record, SHEET_MM);
    expect(view).not.toBeNull();
    const stitched = stitchHeadCameraPictures(record, pictures, {
      region,
      pixelsPerMm: ppm,
      surfaceHeightMm: SHEET_MM,
      heightAreas: [BOX],
    });
    if (stitched === null) throw new Error('nothing stitched');
    const seen = markCentre(stitched, region, ppm);
    expect(Math.hypot(seen.x - MARK.x, seen.y - MARK.y)).toBeLessThan(0.1);
  });

  it('drew it 6.7 mm off at the sheet height, as before the fix', () => {
    const stitched = stitchHeadCameraPictures(record, pictures, {
      region,
      pixelsPerMm: ppm,
      surfaceHeightMm: SHEET_MM,
    });
    if (stitched === null) throw new Error('nothing stitched');
    const seen = markCentre(stitched, region, ppm);
    // The ray to a point 15.8 mm out at 20 mm meets the 3 mm sheet 15.8 × 57/40 mm out.
    const expected = Math.hypot(15, 5) * ((CAMERA_HEIGHT_MM - SHEET_MM) / 40 - 1);
    expect(Math.hypot(seen.x - MARK.x, seen.y - MARK.y)).toBeCloseTo(expected, 0);
    expect(expected).toBeGreaterThan(6.7);
  });
});

describe("a head camera's Z (H6-P2-1)", () => {
  // Where the calibrated model puts a bed point that a camera `raisedMm`
  // higher sees, with the head at HEAD: the misplacement a Z move causes.
  function offWhenRaised(point: { x: number; y: number }, raisedMm: number): number {
    const at = modelAtHead(headCameraModel(), HEAD);
    const raised = lookAt(
      [AXIS.x, AXIS.y, -(CAMERA_HEIGHT_MM + raisedMm)],
      [AXIS.x, AXIS.y + 1e-3, 0],
    );
    const pixel = projectWorldPoint(at.lens, raised, bedPoint(point.x, point.y, 0));
    if (pixel === null) throw new Error('not seen');
    const drawn = bedMapper(at.lens, at.pose)(pixel, 0);
    if (drawn === null) throw new Error('not mapped');
    return Math.hypot(drawn.x - point.x, drawn.y - point.y);
  }

  it('misplaces the bed by 1.43 mm at 15.8 mm from the axis when the head rises 6 mm', () => {
    const off = offWhenRaised(MARK, 6);
    expect(off).toBeCloseTo((Math.hypot(15, 5) * 6) / (CAMERA_HEIGHT_MM + 6), 2);
    expect(off).toBeGreaterThan(1.4);
  });

  it('keeps a Z within the tolerance under 0.15 mm, out to the corner of the clear view', () => {
    const view = headCameraView(headCameraModel(), 0);
    if (view === null) throw new Error('no view');
    const corner = { x: HEAD.x + view.x, y: HEAD.y + view.y };
    expect(offWhenRaised(corner, HEAD_CAMERA_Z_TOLERANCE_MM)).toBeLessThan(0.15);
  });

  it('refuses the calibration away from its recorded Z, and never without one', () => {
    const record = headCameraModel(12.3);
    expect(headCameraZChange(record, 12.3 + HEAD_CAMERA_Z_TOLERANCE_MM - 0.01)).toBeNull();
    expect(headCameraZChange(record, 18.3)).toEqual({ calibratedZMm: 12.3, zMm: 18.3 });
    expect(headCameraZChange(record, 6.3)).toEqual({ calibratedZMm: 12.3, zMm: 6.3 });
    expect(headCameraZChange(headCameraModel(), 18.3)).toBeNull();
  });

  it('keeps the recorded Z when the model follows the head, and when saved and read back', () => {
    const record = headCameraModel(12.3);
    expect(modelAtHead(record, HEAD).mount).toEqual({
      kind: 'head',
      headAtCalibrationMm: HEAD,
      headZAtCalibrationMm: 12.3,
    });
    const read = normalizeCameraModelRecord(JSON.parse(JSON.stringify(record)));
    expect(read?.mount?.headZAtCalibrationMm).toBe(12.3);
    const older = normalizeCameraModelRecord(JSON.parse(JSON.stringify(headCameraModel())));
    expect(older?.mount).toEqual({ kind: 'head', headAtCalibrationMm: HEAD_AT_CALIBRATION });
    const broken = { ...record, mount: { ...record.mount, headZAtCalibrationMm: 'high' } };
    expect(normalizeCameraModelRecord(broken)).toBeUndefined();
  });
});
