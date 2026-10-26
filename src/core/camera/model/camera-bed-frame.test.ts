// Rolling audit 12-P2-2: a calibration is tied to the bed frame its engraved
// target was placed in. The audit's repro calibrated a front-left 400 × 400
// bed, then set the bed to 400 × 410: the same model kept drawing what the
// camera saw at machine Y200 at scene Y200, which now burns at machine Y210.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords, type DeviceProfile } from '../../devices';
import {
  bedFrameShift,
  cameraBedFrameNote,
  cameraModelInBedFrame,
  sceneInBedFrame,
  UNVERIFIED_FRAME_NOTE,
  type CameraBedFrame,
} from './camera-bed-frame';
import { bedMapper, bedPoint, projectWorldPoint, type Vec2 } from './camera-model';
import { normalizeCameraModelRecord, type CameraModelRecord } from './camera-model-record';
import { lookAt, savedCameraModel } from './model-fixtures';
import { modelAtHead } from './head-camera';

const FRONT_LEFT_400: CameraBedFrame = { origin: 'front-left', bedWidthMm: 400, bedHeightMm: 400 };
const calibrated: CameraModelRecord = { ...savedCameraModel(), bedFrame: FRONT_LEFT_400 };

function device(frame: CameraBedFrame): DeviceProfile {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    origin: frame.origin,
    bedWidth: frame.bedWidthMm,
    bedHeight: frame.bedHeightMm,
  };
}

// Where `model` draws the bed point the calibrated camera sees at `physical`
// (scene mm of the calibration's own frame).
function drawnAt(model: CameraModelRecord, physical: Vec2): Vec2 | null {
  const pixel = projectWorldPoint(
    calibrated.lens,
    calibrated.pose,
    bedPoint(physical.x, physical.y),
  );
  return pixel === null ? null : bedMapper(model.lens, model.pose)(pixel);
}

describe('a calibration in the bed frame now', () => {
  it('moves the picture so what it shows burns where it is drawn after a bed-size change', () => {
    const now: CameraBedFrame = { ...FRONT_LEFT_400, bedHeightMm: 410 };
    const placed = cameraModelInBedFrame(calibrated, now);
    expect(placed.kind).toBe('ok');
    if (placed.kind !== 'ok') return;
    // Machine (200, 200) was scene (200, 200); on the 410 mm bed it is (200, 210).
    const drawn = drawnAt(placed.model, { x: 200, y: 200 });
    expect(drawn?.x).toBeCloseTo(200, 6);
    expect(drawn?.y).toBeCloseTo(210, 6);
    if (drawn === null) return;
    const burnsAt = toMachineCoords(drawn, device(now));
    expect(burnsAt.x).toBeCloseTo(200, 6);
    expect(burnsAt.y).toBeCloseTo(200, 6);
    // The saved model itself would draw it at (200, 200), 10 mm off the burn.
    const stale = drawnAt(calibrated, { x: 200, y: 200 });
    expect(stale?.y).toBeCloseTo(200, 6);
    expect(placed.model.bedFrame).toEqual(now);
  });

  it('moves the measured rings and target with it', () => {
    const now: CameraBedFrame = { ...FRONT_LEFT_400, bedHeightMm: 410 };
    const placed = cameraModelInBedFrame(calibrated, now);
    if (placed.kind !== 'ok') throw new Error('expected a usable model');
    const area = calibrated.accuracy.targetArea;
    expect(placed.model.accuracy.targetArea).toEqual(
      area === undefined ? undefined : { ...area, y: area.y + 10 },
    );
  });

  it('asks for a new calibration after an origin change, which no pose can mirror', () => {
    const placed = cameraModelInBedFrame(calibrated, { ...FRONT_LEFT_400, origin: 'rear-left' });
    expect(placed).toEqual({
      kind: 'issue',
      message: expect.stringContaining('Calibrate the camera again, or set the origin back.'),
    });
    expect(cameraBedFrameNote(calibrated, { ...FRONT_LEFT_400, origin: 'rear-left' })).toEqual({
      usable: false,
      message: expect.stringContaining('origin at the front left'),
    });
  });

  it('gives the same record back when nothing changed, and for older records without a frame', () => {
    expect(cameraModelInBedFrame(calibrated, FRONT_LEFT_400)).toEqual({
      kind: 'ok',
      model: calibrated,
    });
    const older = savedCameraModel();
    const placed = cameraModelInBedFrame(older, { ...FRONT_LEFT_400, origin: 'rear-right' });
    expect(placed.kind === 'ok' && placed.model).toBe(older);
    expect(cameraBedFrameNote(calibrated, FRONT_LEFT_400)).toBeNull();
  });

  it('says how far it moved the picture', () => {
    const note = cameraBedFrameNote(calibrated, { ...FRONT_LEFT_400, bedHeightMm: 410 });
    expect(note).toEqual({
      usable: true,
      message:
        'The camera was calibrated on a 400 × 400 mm bed. KerfDesk moves its picture 10 mm to match the machine as it is set up now.',
    });
  });

  it('says when the rings were placed before the bed position was known', () => {
    const homed = { ...FRONT_LEFT_400, nativeToBedOffsetMm: { x: 0, y: 400 } };
    // Engraved unhomed: Absolute coordinates counted from the power-on head.
    expect(cameraBedFrameNote(calibrated, homed)).toEqual({
      usable: true,
      message: UNVERIFIED_FRAME_NOTE,
    });
    expect(cameraBedFrameNote(calibrated, { ...homed, bedHeightMm: 410 })?.message).toBe(
      `The camera was calibrated on a 400 × 400 mm bed. KerfDesk moves its picture 10 mm to match the machine as it is set up now. ${UNVERIFIED_FRAME_NOTE}`,
    );
    // Known then and now, or unknown both times (no homing): nothing to say.
    expect(cameraBedFrameNote({ ...calibrated, bedFrame: homed }, homed)).toBeNull();
    expect(cameraBedFrameNote(calibrated, FRONT_LEFT_400)).toBeNull();
    expect(cameraBedFrameNote(savedCameraModel(), homed)).toBeNull();
  });

  it('counts a native offset only when both frames know it', () => {
    const known = { ...FRONT_LEFT_400, nativeToBedOffsetMm: { x: 400, y: 400 } };
    // $130 corrected: the bed's native zero moved 5 mm along X.
    expect(bedFrameShift(known, { ...known, nativeToBedOffsetMm: { x: 405, y: 400 } })).toEqual({
      x: 5,
      y: 0,
    });
    expect(bedFrameShift(known, FRONT_LEFT_400)).toEqual({ x: 0, y: 0 });
    expect(bedFrameShift(FRONT_LEFT_400, known)).toEqual({ x: 0, y: 0 });
  });

  it('maps scene points between frames through the machine position, origins included', () => {
    const rearRight: CameraBedFrame = { origin: 'rear-right', bedWidthMm: 400, bedHeightMm: 400 };
    // Machine (100, 300) on a front-left bed is scene (100, 100); rear-right, (300, 300).
    expect(sceneInBedFrame({ x: 100, y: 100 }, FRONT_LEFT_400, rearRight)).toEqual({
      x: 300,
      y: 300,
    });
  });

  it('keeps a head camera placed by the head position read in the new frame', () => {
    const onHead: CameraModelRecord = {
      ...calibrated,
      pose: lookAt([160, 187, -70], [160, 187.001, 0]),
      mount: { kind: 'head', headAtCalibrationMm: { x: 200, y: 150 } },
    };
    const now: CameraBedFrame = { ...FRONT_LEFT_400, bedHeightMm: 410 };
    const placed = cameraModelInBedFrame(onHead, now);
    if (placed.kind !== 'ok') throw new Error('expected a usable model');
    // The head reads 10 mm further along scene Y for the same machine position.
    const before = modelAtHead(onHead, { x: 230, y: 120 });
    const after = modelAtHead(placed.model, { x: 230, y: 130 });
    const pixel = { x: 640, y: 360 };
    const seenBefore = bedMapper(before.lens, before.pose)(pixel);
    const seenAfter = bedMapper(after.lens, after.pose)(pixel);
    expect(seenAfter?.x).toBeCloseTo(seenBefore?.x ?? NaN, 6);
    expect(seenAfter?.y).toBeCloseTo((seenBefore?.y ?? NaN) + 10, 6);
  });
});

describe('saving the frame with the calibration', () => {
  it('keeps the frame through a save, loads records without one, and drops a malformed one', () => {
    const withNative = {
      ...calibrated,
      bedFrame: { ...FRONT_LEFT_400, nativeToBedOffsetMm: { x: 400, y: 0 } },
    };
    expect(normalizeCameraModelRecord(JSON.parse(JSON.stringify(withNative)))).toEqual(withNative);
    const older = savedCameraModel();
    expect(normalizeCameraModelRecord(JSON.parse(JSON.stringify(older)))).toEqual(older);
    expect(
      normalizeCameraModelRecord({ ...older, bedFrame: { origin: 'upside-down', bedWidthMm: 1 } }),
    ).toBeUndefined();
  });
});
