// Calibrating a camera on the laser head (ADR-449): the target is a small
// square in the middle of the bed, the photo records where the head was, and
// a later check photographed from another head position measures the saved
// calibration placed at that position.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as FrameSource from '../frame-source';
import type { LensModel } from '../../../core/camera/model/camera-model';
import { lookAt } from '../../../core/camera/model/model-fixtures';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import { bedTargetLayout } from '../../../core/camera/target/bed-target';
import { renderTargetScene } from '../../../core/camera/target/target-render-fixtures';
import { captureSourceFrame, type ActiveCameraSource } from '../frame-source';
import {
  calibrationTargetArea,
  HEAD_POSITION_NEEDED,
  photographTarget,
  targetAreaForBed,
} from './calibration-actions';
import { DEFAULT_CALIBRATION_SETTINGS } from './camera-calibration-store';

vi.mock('../frame-source', async (original) => ({
  ...(await original<typeof FrameSource>()),
  captureSourceFrame: vi.fn(),
}));

const BED = { width: 400, height: 300 };
const HEIGHT_MM = 70;
const OFFSET = { x: 3, y: -2 };
const SETTINGS = {
  ...DEFAULT_CALIBRATION_SETTINGS,
  headCamera: true,
  headTargetSizeMm: 40,
  cameraHeightMm: HEIGHT_MM,
};
const lens: LensModel = {
  intrinsics: { fx: 900, fy: 900, cx: 639.5, cy: 359.5 },
  distortion: [0.02, -0.01, 0, 0],
  imageWidth: 1280,
  imageHeight: 720,
};
const source: ActiveCameraSource = {
  kind: 'usb',
  stream: {
    stream: {} as MediaStream,
    sourceId: 'head',
    resizeMode: 'none',
    stop: () => undefined,
  },
};

function photoFromHead(head: { x: number; y: number }): RgbaImage {
  const area = calibrationTargetArea(BED.width, BED.height, SETTINGS);
  const x = head.x + OFFSET.x;
  const y = head.y + OFFSET.y;
  const gray = renderTargetScene({
    lens,
    pose: lookAt([x, y, -HEIGHT_MM], [x, y + 1e-3, 0]),
    layout: bedTargetLayout({ area }),
    sheet: { x: 150, y: 100, width: 100, height: 100 },
    sheetThicknessMm: SETTINGS.sheetThicknessMm,
    noise: 2,
  });
  const data = new Uint8ClampedArray(gray.width * gray.height * 4);
  for (let i = 0; i < gray.width * gray.height; i += 1) {
    const value = gray.data[i] ?? 0;
    data.set([value, value, value, 255], i * 4);
  }
  return { data, width: gray.width, height: gray.height };
}

beforeEach(() => {
  vi.mocked(captureSourceFrame).mockReset();
});

describe('calibrationTargetArea', () => {
  it('puts a head camera target in the middle of the bed', () => {
    expect(calibrationTargetArea(400, 300, SETTINGS)).toEqual({
      x: 180,
      y: 130,
      width: 40,
      height: 40,
    });
    expect(calibrationTargetArea(30, 50, SETTINGS)).toEqual({ x: 0, y: 10, width: 30, height: 30 });
  });

  it('covers the bed inside the margin for a fixed camera', () => {
    expect(calibrationTargetArea(400, 300, DEFAULT_CALIBRATION_SETTINGS)).toEqual(
      targetAreaForBed(400, 300, DEFAULT_CALIBRATION_SETTINGS.marginMm),
    );
  });
});

describe('photographing a head camera target', () => {
  it('asks for the head position before taking the photo', async () => {
    const outcome = await photographTarget({
      source,
      settings: SETTINGS,
      bedWidthMm: BED.width,
      bedHeightMm: BED.height,
      headMm: null,
    });
    expect(outcome).toEqual({ kind: 'failed', message: HEAD_POSITION_NEEDED });
    expect(captureSourceFrame).not.toHaveBeenCalled();
  });

  it('saves where the head was and checks the calibration from another head position', async () => {
    const calibrationHead = { x: 200, y: 150 };
    vi.mocked(captureSourceFrame).mockResolvedValueOnce(photoFromHead(calibrationHead));
    const first = await photographTarget({
      source,
      settings: SETTINGS,
      bedWidthMm: BED.width,
      bedHeightMm: BED.height,
      headMm: calibrationHead,
    });
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') return;
    expect(first.result.record.mount).toEqual({
      kind: 'head',
      headAtCalibrationMm: calibrationHead,
    });
    expect(first.result.record.accuracy.rmsErrorMm).toBeLessThan(0.1);
    // The review picture shows the 40 mm target with room around it, in detail.
    expect(first.result.bedImage).toMatchObject({ width: 640, height: 640 });

    // Five millimetres away the rings sit elsewhere in the picture, and the
    // saved calibration moved with the head still lands on them.
    const laterHead = { x: 205, y: 148 };
    vi.mocked(captureSourceFrame).mockResolvedValueOnce(photoFromHead(laterHead));
    const check = await photographTarget({
      source,
      settings: SETTINGS,
      bedWidthMm: BED.width,
      bedHeightMm: BED.height,
      headMm: laterHead,
      saved: first.result.record,
    });
    expect(check.kind).toBe('ok');
    if (check.kind !== 'ok') return;
    const saved = check.result.savedCheck;
    expect(saved?.kind).toBe('measured');
    if (saved?.kind !== 'measured') return;
    expect(saved.drift.rmsMm).toBeLessThan(0.1);
  }, 30_000);
});
