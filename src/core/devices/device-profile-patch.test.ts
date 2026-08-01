import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CameraAlignment, CameraCalibration } from '../camera';
import type { CameraCaptureBinding } from '../camera/capture-binding';
import { resolveEffectiveScanDirection } from '../job/scan-direction-policy';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from './device-profile';
import { deviceProfileWithInteractivePatch } from './device-profile-patch';

const CAMERA_FOCAL_LENGTH_PX = 800;
const CAMERA_PRINCIPAL_X_PX = 320;
const CAMERA_PRINCIPAL_Y_PX = 240;
const CAMERA_FRAME_WIDTH_PX = 640;
const CAMERA_FRAME_HEIGHT_PX = 480;
const CAMERA_RMS_PX = 0.4;
const INITIAL_CALIBRATION_EPOCH = 1;
const REPLACEMENT_CALIBRATION_EPOCH = 2;
const MAX_GENERATED_CAPTURE_DIMENSION_PX = 4096;
const MAX_GENERATED_SOURCE_ID_LENGTH = 40;

const CAMERA_CALIBRATION: CameraCalibration = calibrationAt(INITIAL_CALIBRATION_EPOCH);

const RECTIFIED_ALIGNMENT: CameraAlignment = alignmentWithBasis('rectified');

const cameraCaptureBindingArbitrary: fc.Arbitrary<CameraCaptureBinding> = fc.record({
  version: fc.constant(1 as const),
  sourceKind: fc.constantFrom<CameraCaptureBinding['sourceKind']>(
    'usb',
    'machine-jpeg',
    'machine-rtsp',
  ),
  sourceId: fc.string({ minLength: 1, maxLength: MAX_GENERATED_SOURCE_ID_LENGTH }),
  width: fc.integer({ min: 1, max: MAX_GENERATED_CAPTURE_DIMENSION_PX }),
  height: fc.integer({ min: 1, max: MAX_GENERATED_CAPTURE_DIMENSION_PX }),
  resizeMode: fc.constantFrom<CameraCaptureBinding['resizeMode']>(
    'none',
    'crop-and-scale',
    'unknown',
  ),
});

type CaptureBindingField = Exclude<keyof CameraCaptureBinding, 'version'>;

const captureBindingFieldArbitrary = fc.constantFrom<CaptureBindingField>(
  'sourceKind',
  'sourceId',
  'width',
  'height',
  'resizeMode',
);

function calibrationAt(calibratedAt: number, capture?: CameraCaptureBinding): CameraCalibration {
  return {
    intrinsics: {
      fx: CAMERA_FOCAL_LENGTH_PX,
      fy: CAMERA_FOCAL_LENGTH_PX,
      cx: CAMERA_PRINCIPAL_X_PX,
      cy: CAMERA_PRINCIPAL_Y_PX,
    },
    distortion: [0, 0, 0, 0],
    imageWidth: CAMERA_FRAME_WIDTH_PX,
    imageHeight: CAMERA_FRAME_HEIGHT_PX,
    rmsPx: CAMERA_RMS_PX,
    calibratedAt,
    ...(capture === undefined ? {} : { capture }),
  };
}

function alignmentWithBasis(basis: CameraAlignment['basis']): CameraAlignment {
  return {
    homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    frameWidth: CAMERA_FRAME_WIDTH_PX,
    frameHeight: CAMERA_FRAME_HEIGHT_PX,
    basis,
    alignedAt: INITIAL_CALIBRATION_EPOCH,
  };
}

function captureWithChangedField(
  capture: CameraCaptureBinding,
  field: CaptureBindingField,
): CameraCaptureBinding {
  switch (field) {
    case 'sourceKind':
      return { ...capture, sourceKind: capture.sourceKind === 'usb' ? 'machine-jpeg' : 'usb' };
    case 'sourceId':
      return { ...capture, sourceId: `${capture.sourceId}-replacement` };
    case 'width':
      return { ...capture, width: capture.width + 1 };
    case 'height':
      return { ...capture, height: capture.height + 1 };
    case 'resizeMode':
      return { ...capture, resizeMode: capture.resizeMode === 'none' ? 'unknown' : 'none' };
  }
}

describe('deviceProfileWithInteractivePatch', () => {
  it('clears calibration that becomes invalid after an interactive bed resize', () => {
    const calibrated = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 1500, offsetMm: 3 }],
      scanOffsetCalibrationStatus: 'verified' as const,
    };

    const resized = deviceProfileWithInteractivePatch(calibrated, {
      bedWidth: 100,
      bedHeight: 100,
    });

    expect(resized.scanningOffsets).toEqual([]);
    expect(resized.scanOffsetCalibrationStatus).toBeUndefined();
    expect(resolveEffectiveScanDirection(resized, true)).toEqual({
      bidirectional: false,
      reason: 'uncalibrated-4040-fallback',
    });
  });

  it('retains valid calibration while preserving max-feed clamping', () => {
    const calibrated = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 1500, offsetMm: 3 }],
      scanOffsetCalibrationStatus: 'verified' as const,
    };

    const patched = deviceProfileWithInteractivePatch(calibrated, { maxFeed: 500 });

    expect(patched.scanningOffsets).toEqual(calibrated.scanningOffsets);
    expect(patched.scanOffsetCalibrationStatus).toBe('verified');
    expect(patched.controlledLaserOffTravelFeedMmPerMin).toBe(500);
  });

  it('clears lifecycle status when the interactive table is emptied', () => {
    const calibrated = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 1500, offsetMm: 0.1 }],
      scanOffsetCalibrationStatus: 'verified' as const,
    };

    const cleared = deviceProfileWithInteractivePatch(calibrated, { scanningOffsets: [] });

    expect(cleared.scanningOffsets).toEqual([]);
    expect(cleared.scanOffsetCalibrationStatus).toBeUndefined();
  });

  it('clears a rectified camera alignment when lens calibration changes', () => {
    const profile = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      cameraCalibration: CAMERA_CALIBRATION,
      cameraAlignment: RECTIFIED_ALIGNMENT,
    };

    const recalibrated = deviceProfileWithInteractivePatch(profile, {
      cameraCalibration: calibrationAt(REPLACEMENT_CALIBRATION_EPOCH),
    });

    expect(recalibrated.cameraCalibration?.calibratedAt).toBe(REPLACEMENT_CALIBRATION_EPOCH);
    expect(recalibrated.cameraAlignment).toBeUndefined();
  });

  it('retains a raw camera alignment when lens calibration changes', () => {
    const rawAlignment = alignmentWithBasis('raw');
    const profile = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      cameraCalibration: CAMERA_CALIBRATION,
      cameraAlignment: rawAlignment,
    };

    const recalibrated = deviceProfileWithInteractivePatch(profile, {
      cameraCalibration: calibrationAt(REPLACEMENT_CALIBRATION_EPOCH),
    });

    expect(recalibrated.cameraAlignment).toBe(rawAlignment);
  });

  it('retains a rectified camera alignment for unrelated profile edits', () => {
    const profile = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      cameraCalibration: CAMERA_CALIBRATION,
      cameraAlignment: RECTIFIED_ALIGNMENT,
    };

    const renamed = deviceProfileWithInteractivePatch(profile, { name: 'Renamed profile' });

    expect(renamed.cameraAlignment).toBe(RECTIFIED_ALIGNMENT);
  });

  it('retains a rectified alignment when the calibration value is unchanged', () => {
    const profile = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      cameraCalibration: CAMERA_CALIBRATION,
      cameraAlignment: RECTIFIED_ALIGNMENT,
    };

    const unchanged = deviceProfileWithInteractivePatch(profile, {
      cameraCalibration: calibrationAt(INITIAL_CALIBRATION_EPOCH),
    });

    expect(unchanged.cameraAlignment).toBe(RECTIFIED_ALIGNMENT);
  });

  it('retains a rectified alignment supplied with its replacement calibration', () => {
    const replacementAlignment = {
      ...RECTIFIED_ALIGNMENT,
      alignedAt: REPLACEMENT_CALIBRATION_EPOCH,
    };
    const profile = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      cameraCalibration: CAMERA_CALIBRATION,
      cameraAlignment: RECTIFIED_ALIGNMENT,
    };

    const replacedPair = deviceProfileWithInteractivePatch(profile, {
      cameraCalibration: calibrationAt(REPLACEMENT_CALIBRATION_EPOCH),
      cameraAlignment: replacementAlignment,
    });

    expect(replacedPair.cameraAlignment).toBe(replacementAlignment);
  });

  it('preserves the calibration/alignment invariant across generated patch combinations', () => {
    fc.assert(
      fc.property(
        fc.record({
          currentEpoch: fc.integer({ min: 1, max: 1000 }),
          nextEpoch: fc.integer({ min: 1, max: 1000 }),
          basis: fc.constantFrom<CameraAlignment['basis']>('raw', 'rectified'),
          hasAlignment: fc.boolean(),
          suppliesReplacement: fc.boolean(),
          capture: cameraCaptureBindingArbitrary,
        }),
        ({ currentEpoch, nextEpoch, basis, hasAlignment, suppliesReplacement, capture }) => {
          const inheritedAlignment = hasAlignment ? alignmentWithBasis(basis) : undefined;
          const replacementAlignment = suppliesReplacement
            ? { ...alignmentWithBasis(basis), alignedAt: nextEpoch }
            : undefined;
          const profile = {
            ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
            cameraCalibration: calibrationAt(currentEpoch, capture),
            ...(inheritedAlignment === undefined ? {} : { cameraAlignment: inheritedAlignment }),
          };
          const patched = deviceProfileWithInteractivePatch(profile, {
            cameraCalibration: calibrationAt(nextEpoch, capture),
            ...(replacementAlignment === undefined
              ? {}
              : { cameraAlignment: replacementAlignment }),
          });

          if (replacementAlignment !== undefined) {
            expect(patched.cameraAlignment).toBe(replacementAlignment);
          } else if (
            inheritedAlignment === undefined ||
            basis === 'raw' ||
            currentEpoch === nextEpoch
          ) {
            expect(patched.cameraAlignment).toBe(inheritedAlignment);
          } else {
            expect(patched.cameraAlignment).toBeUndefined();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('preserves camera alignment across generated unrelated edits', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.constantFrom<CameraAlignment['basis']>('raw', 'rectified'),
        (name, basis) => {
          const alignment = alignmentWithBasis(basis);
          const profile = {
            ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
            cameraCalibration: calibrationAt(INITIAL_CALIBRATION_EPOCH),
            cameraAlignment: alignment,
          };

          const patched = deviceProfileWithInteractivePatch(profile, { name });

          expect(patched.cameraAlignment).toBe(alignment);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('clears inherited rectified alignment for generated capture-binding changes', () => {
    fc.assert(
      fc.property(
        cameraCaptureBindingArbitrary,
        captureBindingFieldArbitrary,
        (currentCapture, changedField) => {
          const profile = {
            ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
            cameraCalibration: calibrationAt(INITIAL_CALIBRATION_EPOCH, currentCapture),
            cameraAlignment: RECTIFIED_ALIGNMENT,
          };
          const patched = deviceProfileWithInteractivePatch(profile, {
            cameraCalibration: calibrationAt(
              INITIAL_CALIBRATION_EPOCH,
              captureWithChangedField(currentCapture, changedField),
            ),
          });

          expect(patched.cameraAlignment).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });
});
