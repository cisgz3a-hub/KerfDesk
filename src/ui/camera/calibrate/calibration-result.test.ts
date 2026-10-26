// How a one-photo calibration is graded (ADR-441 and Amendment 4), on
// rendered photos of the engraved target through the real detector and fit.

import { beforeAll, describe, expect, it } from 'vitest';
import type { GrayImage } from '../../../core/camera/corner-subpix';
import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import {
  normalizeCameraModelRecord,
  type CameraModelRecord,
} from '../../../core/camera/model/camera-model-record';
import { lookAt, savedCameraModel, wideLens } from '../../../core/camera/model/model-fixtures';
import { calibrateFromBedTarget } from '../../../core/camera/target/bed-calibration';
import { bedTargetLayout, bedTargetLayoutWithRings } from '../../../core/camera/target/bed-target';
import { renderTargetScene } from '../../../core/camera/target/target-render-fixtures';
import { targetAreaForBed } from './calibration-actions';
import { targetLayoutMismatch } from '../../../core/camera/target/target-coverage';
import {
  calibrationFailureMessage,
  calibrationGrade,
  cameraModelFromCalibration,
  ringsTooSmallMessage,
} from './calibration-result';

const SHEET_MM = 3;

function calibrated(frame: GrayImage, area: BedArea): CameraModelRecord {
  const layout = bedTargetLayout({ area });
  const calibration = calibrateFromBedTarget({ frame, layout, sheetThicknessMm: SHEET_MM });
  if (calibration.kind !== 'ok') throw new Error(`calibration failed: ${calibration.reason}`);
  return cameraModelFromCalibration({
    calibration,
    capture: null,
    targetHeightMm: SHEET_MM,
    targetArea: area,
    calibratedAt: new Date(0),
  });
}

describe('a target engraved with another margin than the one assumed', () => {
  // Engraved with a 20 mm margin; after a restart the wizard's margin is 5 mm.
  const engraved = targetAreaForBed(400, 400, 20);
  const assumed = targetAreaForBed(400, 400, 5);
  let frame: GrayImage;
  beforeAll(() => {
    frame = renderTargetScene({
      lens: wideLens(1280),
      pose: lookAt([200, 60, -420], [200, 205, 0]),
      layout: bedTargetLayout({ area: engraved }),
      sheet: { x: 0, y: 0, width: 400, height: 400 },
      sheetThicknessMm: SHEET_MM,
      noise: 3,
      honeycombPitchMm: 6,
    });
  });

  it('is not graded good, though every ring it matched fits', () => {
    const record = calibrated(frame, assumed);
    // The figures alone look perfect: the whole model is shifted instead.
    expect(record.accuracy.rmsErrorMm).toBeLessThan(0.25);
    expect(targetLayoutMismatch(record)).toEqual({
      foundCols: 9,
      foundRows: 9,
      cols: 10,
      rows: 10,
    });
    const grade = calibrationGrade(record);
    expect(grade.tone).toBe('rough');
    expect(grade.headline).toBe('These rings look like a target engraved with other settings.');
    expect(grade.advice).toContain('enter the margin it was engraved with');
  }, 60_000);

  it('is graded on its figures when matched to the layout that was engraved', () => {
    const record = calibrated(frame, engraved);
    expect(targetLayoutMismatch(record)).toBeNull();
    expect(calibrationGrade(record).tone).toBe('good');
  }, 60_000);
});

describe('a target that covers only part of what the camera sees', () => {
  const saved = savedCameraModel();
  const withTarget = (targetArea: BedArea): CameraModelRecord => ({
    ...saved,
    accuracy: { ...saved.accuracy, targetArea },
  });

  it('says the bed outside the target is estimated, without a figure for it', () => {
    const grade = calibrationGrade(withTarget({ x: 50, y: 50, width: 300, height: 300 }));
    expect(grade.tone).toBe('good');
    expect(grade.advice).toMatch(
      /^About 4\d % of the bed the camera sees lies outside the target\. The accuracy is measured on its rings; outside the target the picture is estimated\./,
    );
  });

  it('says nothing more for a target over the whole bed', () => {
    expect(calibrationGrade(withTarget({ x: 5, y: 5, width: 390, height: 390 })).advice).toBeNull();
  });

  it('says it of a head camera whose picture reaches past its small target', () => {
    const head: CameraModelRecord = {
      ...withTarget({ x: 180, y: 130, width: 40, height: 40 }),
      lens: {
        intrinsics: { fx: 900, fy: 900, cx: 639.5, cy: 359.5 },
        distortion: [0.02, -0.01, 0, 0],
        imageWidth: 1280,
        imageHeight: 720,
      },
      pose: lookAt([203, 148, -100], [203, 148.001, 0]),
      mount: { kind: 'head', headAtCalibrationMm: { x: 200, y: 150 } },
    };
    expect(calibrationGrade(head).advice).toMatch(
      /^About \d+ % of the picture lies outside the target\./,
    );
  });
});

describe('a camera looking straight down with no measured height', () => {
  it('is graded as lined up at the target height only, and keeps saying so once saved', () => {
    // Audit 2026-10-25: the rings fit at 0.07 mm while 25 mm material was 9 mm out.
    const area = targetAreaForBed(400, 400, 5);
    const frame = renderTargetScene({
      lens: wideLens(960),
      pose: lookAt([200, 200, -400], [200, 200.001, 0]),
      layout: bedTargetLayout({ area }),
      sheet: area,
      sheetThicknessMm: SHEET_MM,
      noise: 4,
    });
    const record = calibrated(frame, area);
    expect(record.accuracy.rmsErrorMm).toBeLessThan(0.25);
    expect(record.accuracy.onlyAtTargetHeight).toBe(true);
    const grade = calibrationGrade(record);
    expect(grade.tone).toBe('fair');
    expect(grade.headline).toBe('Lined up at the height of the 3 mm target sheet only.');
    expect(grade.advice).toContain('Measure the height of the camera lens above the bed');
    const saved = normalizeCameraModelRecord(JSON.parse(JSON.stringify(record)));
    expect(saved?.accuracy.onlyAtTargetHeight).toBe(true);
  }, 60_000);

  it('is graded on its figures with a measured height', () => {
    const record = savedCameraModel();
    expect(record.accuracy.onlyAtTargetHeight).toBeUndefined();
    expect(calibrationGrade(record).tone).toBe('good');
  });
});

describe('calibration failures', () => {
  it('tells a target too large for the picture from one whose anchors are covered', () => {
    expect(calibrationFailureMessage('target-too-large')).toContain(
      'The target fills the picture from edge to edge',
    );
    expect(calibrationFailureMessage('anchors-not-found')).toContain('Make sure nothing covers');
  });

  it('suggests the ring size that makes rings too small in the picture findable', () => {
    // 7.7 px for 10 mm rings: 12 px needs 16 mm rings.
    expect(ringsTooSmallMessage(7.7, 10)).toContain('Engrave a new target with 16 mm rings');
    // Beyond 25 mm a larger picture is the better fix.
    expect(ringsTooSmallMessage(3, 10)).toContain('larger picture size or move it closer');
  });

  it('keeps a non-default ring size with the saved calibration', () => {
    const area = targetAreaForBed(400, 400, 5);
    const frame = renderTargetScene({
      lens: wideLens(960),
      pose: lookAt([200, -30, -360], [200, 210, 0]),
      layout: bedTargetLayoutWithRings(area, 16),
      sheet: area,
      sheetThicknessMm: SHEET_MM,
      noise: 3,
      honeycombPitchMm: 6,
    });
    const calibration = calibrateFromBedTarget({
      frame,
      layout: bedTargetLayoutWithRings(area, 16),
      sheetThicknessMm: SHEET_MM,
    });
    if (calibration.kind !== 'ok') throw new Error(`calibration failed: ${calibration.reason}`);
    const record = cameraModelFromCalibration({
      calibration,
      capture: null,
      targetHeightMm: SHEET_MM,
      targetArea: area,
      targetRingDiameterMm: 16,
      calibratedAt: new Date(0),
    });
    expect(record.accuracy.targetRingDiameterMm).toBe(16);
    // Measured against its own 16 mm layout, the full grid is no mismatch.
    expect(targetLayoutMismatch(record)).toBeNull();
    expect(
      normalizeCameraModelRecord(JSON.parse(JSON.stringify(record)))?.accuracy.targetRingDiameterMm,
    ).toBe(16);
  }, 60_000);
});
