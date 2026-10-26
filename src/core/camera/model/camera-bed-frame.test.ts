// Rolling audit 12-P2-2: a calibration is tied to the bed frame its engraved
// target was placed in. The audit's repro calibrated a front-left 400 × 400
// bed, then set the bed to 400 × 410: the same model kept drawing what the
// camera saw at machine Y200 at scene Y200, which now burns at machine Y210.
// Meta audit M2-P3-3: a calibration saved before the frame was kept had the
// same gap, so it is not used until its frame is confirmed (ADR-440 Amd 4).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords, type DeviceProfile } from '../../devices';
import {
  bedFrameShift,
  cameraBedFrameNote,
  cameraModelInBedFrame,
  sceneInBedFrame,
  UNVERIFIED_FRAME_NOTE,
  withConfirmedBedFrame,
  type CameraBedFrame,
} from './camera-bed-frame';
import { bedMapper, bedPoint, projectWorldPoint, type Vec2 } from './camera-model';
import { normalizeCameraModelRecord, type CameraModelRecord } from './camera-model-record';
import { lookAt, savedCameraModel, unframedCameraModel } from './model-fixtures';
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

  it('gives the same record back when nothing changed', () => {
    expect(cameraModelInBedFrame(calibrated, FRONT_LEFT_400)).toEqual({
      kind: 'ok',
      model: calibrated,
    });
    expect(cameraBedFrameNote(calibrated, FRONT_LEFT_400)).toBeNull();
  });

  it('does not use an older record without a frame, whatever the bed is now', () => {
    // Calibrated on 400 × 400 by 1.0.21, then the bed was corrected to 410:
    // drawn as saved, machine Y200 would show at scene Y200 and burn at Y210.
    const older = unframedCameraModel();
    const now: CameraBedFrame = { ...FRONT_LEFT_400, bedHeightMm: 410 };
    const placed = cameraModelInBedFrame(older, now);
    expect(placed).toEqual({
      kind: 'issue',
      message: expect.stringContaining('before KerfDesk recorded the bed it was calibrated on'),
    });
    expect(cameraModelInBedFrame(older, FRONT_LEFT_400).kind).toBe('issue');
    expect(cameraBedFrameNote(older, now)).toEqual({
      usable: false,
      frameUnrecorded: true,
      message: expect.stringContaining(
        'If Machine Setup still has the origin at the front left and the bed at 400 × 410 mm, as when the camera was calibrated, choose Confirm bed and origin',
      ),
    });
    // An origin change on a framed record cannot be confirmed away.
    expect(
      cameraBedFrameNote(calibrated, { ...FRONT_LEFT_400, origin: 'rear-left' }),
    ).not.toHaveProperty('frameUnrecorded');
  });

  it('uses an older record once its frame is confirmed, and follows a later bed change exactly', () => {
    const older = unframedCameraModel();
    const known = { ...FRONT_LEFT_400, nativeToBedOffsetMm: { x: 400, y: 0 } };
    const confirmed = withConfirmedBedFrame(older, known);
    // The origin and bed size the operator confirmed; the native offset then stays unknown.
    expect(confirmed.bedFrame).toEqual(FRONT_LEFT_400);
    expect(cameraModelInBedFrame(confirmed, known)).toEqual({ kind: 'ok', model: confirmed });
    const placed = cameraModelInBedFrame(confirmed, { ...FRONT_LEFT_400, bedHeightMm: 410 });
    if (placed.kind !== 'ok') throw new Error('expected a usable model');
    expect(drawnAt(placed.model, { x: 200, y: 200 })?.y).toBeCloseTo(210, 6);
    // A record that has its frame is never re-stamped.
    expect(withConfirmedBedFrame(calibrated, { ...FRONT_LEFT_400, bedHeightMm: 410 })).toBe(
      calibrated,
    );
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
    // No frame at all is not "nothing to say": it waits for one (ADR-440 Amd 4).
    expect(cameraBedFrameNote(unframedCameraModel(), homed)).toMatchObject({
      usable: false,
      frameUnrecorded: true,
    });
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
    const older = unframedCameraModel();
    expect(normalizeCameraModelRecord(JSON.parse(JSON.stringify(older)))).toEqual(older);
    expect(
      normalizeCameraModelRecord({ ...older, bedFrame: { origin: 'upside-down', bedWidthMm: 1 } }),
    ).toBeUndefined();
  });
});
