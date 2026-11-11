// Rolling audit v13 Y1-P1-1 (ADR-440 Amendment 9): a camera picture of the
// calibrated shape but another size was placed with the lens scaled to it,
// even when the camera had cut out the middle of its sensor instead of
// shrinking its view. Rendered through the fixture lens: a true resize, a
// same-shape centre crop, and what each does to the overlay.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  bedMapper,
  bedPoint,
  projectWorldPoint,
  scaleLens,
  type LensModel,
} from '../../core/camera/model/camera-model';
import { savedCameraModel, overheadPose, wideLens } from '../../core/camera/model/model-fixtures';
import { modelDriftOnMarks } from '../../core/camera/model/model-drift';
import { viewThumbnail } from '../../core/camera/model/view-shift';
import type { RgbaImage } from '../../core/camera/rgba-image';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { resetStore } from '../state/test-helpers';
import { checkSavedCalibration } from './calibrate/saved-calibration-check';
import { cameraModelForFrame } from './camera-model-frame';
import {
  frameRescaleFromView,
  frameRescaleVerdict,
  recordFrameRescale,
  resetFrameRescaleChecks,
} from './frame-rescale-check';
import { checkCameraMoved } from './helpers/moved-check';
import { saveViewReference } from './helpers/view-reference';

const lens = wideLens(1280);
const pose = overheadPose();
const record = savedCameraModel({
  version: 1,
  sourceKind: 'usb',
  sourceId: 'overhead',
  width: 1280,
  height: 720,
  resizeMode: 'none',
});
const capture = { ...record.capture!, width: 640, height: 360 };

// The middle 640 × 360 of the same sensor: the same focal length, the
// principal point moved by the cut.
const cropLens: LensModel = {
  ...lens,
  intrinsics: { ...lens.intrinsics, cx: lens.intrinsics.cx - 320, cy: lens.intrinsics.cy - 180 },
  imageWidth: 640,
  imageHeight: 360,
};

function hash(i: number, j: number): number {
  const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

// Blocks around a 400 mm bed, `material` on it.
function scene(material: number) {
  return (x: number, y: number): number => {
    if (x >= -5 && y >= -5 && x <= 405 && y <= 405) return material;
    if (Math.max(-x, -y, x - 400, y - 400) > 320) return 128;
    return 50 + 170 * hash(Math.floor(x / 17), Math.floor(y / 13));
  };
}

function render(through: LensModel, value: (x: number, y: number) => number): RgbaImage {
  const toBed = bedMapper(through, pose);
  const { imageWidth: width, imageHeight: height } = through;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bed = toBed({ x, y }, 0);
      const v = bed === null ? 128 : value(bed.x, bed.y);
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const reference = viewThumbnail(render(lens, scene(200)));
const scaled = scaleLens(lens, 640, 360);

function verdictFor(frame: RgbaImage) {
  return frameRescaleFromView({
    reference,
    current: viewThumbnail(frame, reference.width),
    scaledLens: scaled,
    pose,
    bedWidthMm: 400,
    bedHeightMm: 400,
  });
}

beforeEach(() => resetFrameRescaleChecks());

describe('telling a resized picture from a cut-out one', () => {
  it('a scaled lens on a sensor crop puts the bed tens of millimetres off', () => {
    // Where the crop camera shows each bed point, read back through the scaled model.
    const readBack = bedMapper(scaled, pose);
    const worst = [
      [200, 200],
      [100, 100],
      [300, 300],
      [50, 350],
    ].reduce((most, [x = 0, y = 0]) => {
      const pixel = projectWorldPoint(cropLens, pose, bedPoint(x, y));
      const read = pixel === null ? null : readBack(pixel, 0);
      return read === null ? most : Math.max(most, Math.hypot(read.x - x, read.y - y));
    }, 0);
    expect(worst).toBeGreaterThan(30);
  });

  it('proves a true resize from the kept view, whatever is on the bed', () => {
    expect(verdictFor(render(scaled, scene(200)))).toBe('resize');
    expect(verdictFor(render(scaled, scene(60)))).toBe('resize');
  });

  it('finds a same-shape centre crop of the sensor is not the calibrated view', () => {
    expect(verdictFor(render(cropLens, scene(200)))).toBe('differs');
  });
});

describe('cameraModelForFrame and another frame size', () => {
  it('does not place an unproved size, and says why', () => {
    const issue = cameraModelForFrame(record, capture, 640, 360);
    expect(issue.kind).toBe('issue');
    if (issue.kind === 'issue') {
      expect(issue.message).toContain(
        'The camera picture is 640 × 360, not the 1280 × 720 it was calibrated at',
      );
      expect(issue.message).toContain('cutting out part of its view');
    }
  });

  it('places a proved resize with the scaled lens, and refuses a size found to differ', () => {
    recordFrameRescale(record, 640, 360, 'resize');
    const ok = cameraModelForFrame(record, capture, 640, 360);
    expect(ok.kind).toBe('ok');
    if (ok.kind === 'ok') expect(ok.lens.intrinsics.fx).toBeCloseTo(lens.intrinsics.fx / 2, 9);

    recordFrameRescale(record, 640, 360, 'differs');
    const refused = cameraModelForFrame(record, capture, 640, 360);
    expect(refused.kind === 'issue' && refused.message).toContain('does not show the same view');
  });

  it('keeps the calibrated size working with no check at all', () => {
    expect(cameraModelForFrame(record, record.capture ?? null, 1280, 720).kind).toBe('ok');
  });

  it('is a separate check for each calibration', () => {
    recordFrameRescale(record, 640, 360, 'resize');
    const later = { ...record, calibratedAt: '2030-01-01T00:00:00.000Z' };
    expect(cameraModelForFrame(later, capture, 640, 360).kind).toBe('issue');
  });
});

describe('Check camera proves or refutes a new size', () => {
  // Target rings photographed by `through`, as the wizard would find them.
  function marksSeenBy(through: LensModel) {
    const marks = [];
    for (let x = 60; x <= 340; x += 40) {
      for (let y = 100; y <= 300; y += 40) {
        const pixel = projectWorldPoint(through, pose, bedPoint(x, y));
        if (pixel !== null) marks.push({ x, y, pixel, rejected: false });
      }
    }
    return marks;
  }

  it('records a resize when the saved model still places the rings', () => {
    const check = checkSavedCalibration({
      saved: record,
      capture,
      frameWidth: 640,
      frameHeight: 360,
      marks: marksSeenBy(scaled),
      targetHeightMm: 0,
    });
    expect(check.kind).toBe('measured');
    expect(frameRescaleVerdict(record, 640, 360)).toBe('resize');
  });

  it('records that a crop differs when the rings land elsewhere', () => {
    const marks = marksSeenBy(cropLens);
    const check = checkSavedCalibration({
      saved: record,
      capture,
      frameWidth: 640,
      frameHeight: 360,
      marks,
      targetHeightMm: 0,
    });
    expect(check.kind).toBe('measured');
    expect(modelDriftOnMarks(scaled, pose, marks, 0)?.rmsMm).toBeGreaterThan(10);
    expect(frameRescaleVerdict(record, 640, 360)).toBe('differs');
  });
});

describe('the moved check proves a new size on its own', () => {
  const source = {
    kind: 'usb' as const,
    stream: {
      stream: {} as MediaStream,
      sourceId: 'overhead',
      resizeMode: 'none' as const,
      stop: () => undefined,
    },
  };

  beforeEach(() => {
    localStorage.clear();
    resetStore();
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        device: { ...project.device, bedWidth: 400, bedHeight: 400, cameraModel: record },
      },
    });
    useCameraStore.setState({ sourceState: { kind: 'live', source } });
    saveViewReference(record, reference);
  });

  it('proves a resized held picture against the kept view, then places it', () => {
    checkCameraMoved(source, render(scaled, scene(60)));
    expect(frameRescaleVerdict(record, 640, 360)).toBe('resize');
    expect(cameraModelForFrame(record, capture, 640, 360).kind).toBe('ok');
  });

  it('finds a cut-out held picture differs, and keeps refusing it', () => {
    checkCameraMoved(source, render(cropLens, scene(60)));
    expect(frameRescaleVerdict(record, 640, 360)).toBe('differs');
    expect(cameraModelForFrame(record, capture, 640, 360).kind).toBe('issue');
  });
});
