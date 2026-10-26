// The bed frame a camera calibration was fitted in (rolling audit 12-P2-2):
// the origin corner, the bed size and, when the controller proved it, the
// offset from native machine positions to bed millimetres — the facts Print
// and Cut keys its head captures on (`nativeBedCaptureFrameKey`). A
// calibration maps camera pixels to scene millimetres, and the engraved
// target's scene positions became places on the bed through exactly these
// facts, so it holds only while they do. With the same origin corner, a later
// bed-size or native-offset change moves every scene point by one constant,
// which the pose takes up exactly. Another origin corner mirrors the bed,
// which no camera pose can, so it needs a new calibration. A calibration saved
// before frames were recorded is not trusted until the operator confirms the
// bed it was made on, or calibrates again (meta audit M2-P3-3, ADR-440
// Amendment 4). Pure core.

import type { DeviceProfile, Origin } from '../../devices/device-profile';
import { toMachineCoords, toSceneCoords } from '../../devices/origin-transform';
import type { CameraModelRecord } from './camera-model-record';
import type { Vec2 } from './camera-model';
import { movedModel } from './head-camera';

export type CameraBedFrame = {
  readonly origin: Origin;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  /** Native machine position to bed mm, when the controller proved it; absent when unknown. */
  readonly nativeToBedOffsetMm?: Vec2;
};

export type ModelInBedFrame =
  | { readonly kind: 'ok'; readonly model: CameraModelRecord }
  | { readonly kind: 'issue'; readonly message: string };

// Below this a re-expression would only move the model by rounding.
const SAME_MM = 1e-6;

/**
 * `record` expressed in the bed frame `now`. A record fitted in this frame is
 * returned as it is; one fitted on another bed size or native offset is moved
 * to match; one fitted with another origin corner, or saved without a frame,
 * cannot be used.
 */
export function cameraModelInBedFrame(
  record: CameraModelRecord,
  now: CameraBedFrame,
): ModelInBedFrame {
  const fitted = record.bedFrame;
  // Its rings were placed in a frame nobody recorded. Reading it in today's
  // frame is right only while Machine Setup has not changed since, and a check
  // would label its target in today's frame too, so it would report no drift
  // (meta audit M2-P3-3).
  if (fitted === undefined) return { kind: 'issue', message: unrecordedFrameMessage(now) };
  if (fitted.origin !== now.origin) {
    return {
      kind: 'issue',
      message: `The camera was calibrated with the origin ${originWords(fitted.origin)}, and Machine Setup now has it ${originWords(now.origin)}, so the camera picture would not line up with the burn. Calibrate the camera again, or set the origin back.`,
    };
  }
  const shift = bedFrameShift(fitted, now);
  if (Math.abs(shift.x) < SAME_MM && Math.abs(shift.y) < SAME_MM) {
    return { kind: 'ok', model: record };
  }
  const moved = movedModel(record, shift);
  const mount = record.mount;
  return {
    kind: 'ok',
    model: {
      ...moved,
      ...(mount === undefined
        ? {}
        : {
            mount: {
              ...mount,
              headAtCalibrationMm: {
                x: mount.headAtCalibrationMm.x + shift.x,
                y: mount.headAtCalibrationMm.y + shift.y,
              },
            },
          }),
      bedFrame: {
        ...now,
        ...(now.nativeToBedOffsetMm === undefined && fitted.nativeToBedOffsetMm !== undefined
          ? { nativeToBedOffsetMm: fitted.nativeToBedOffsetMm }
          : {}),
      },
    },
  };
}

export type CameraBedFrameNote = {
  /** False when the calibration cannot be used in this frame at all. */
  readonly usable: boolean;
  readonly message: string;
  /** No frame was saved with it, so the operator may confirm today's ({@link withConfirmedBedFrame}). */
  readonly frameUnrecorded?: true;
};

/**
 * What the Camera panel says about `record` in the bed frame `now`: why it
 * cannot be used, how far it was moved to fit, that its rings were placed
 * before the bed position was known, or null when it fits as saved.
 */
export function cameraBedFrameNote(
  record: CameraModelRecord,
  now: CameraBedFrame,
): CameraBedFrameNote | null {
  const placed = cameraModelInBedFrame(record, now);
  const fitted = record.bedFrame;
  if (placed.kind === 'issue') {
    return fitted === undefined
      ? { usable: false, message: placed.message, frameUnrecorded: true }
      : { usable: false, message: placed.message };
  }
  if (fitted === undefined) return null;
  const notes = [
    ...(placed.model === record ? [] : [movedNote(fitted, now)]),
    ...(placedBeforeBedWasKnown(fitted, now) ? [UNVERIFIED_FRAME_NOTE] : []),
  ];
  return notes.length === 0 ? null : { usable: true, message: notes.join(' ') };
}

// ADR-441 Amendment 5: rings engraved while the native offset was unknown
// (not homed, or settings unread) sit wherever Absolute coordinates were that
// session. Once the offset is known, nothing tells how far that was off.
export const UNVERIFIED_FRAME_NOTE =
  'The camera was calibrated before KerfDesk knew where the machine coordinates sit on the bed (the machine was not homed, or its settings were not read). If the picture does not line up with a burn, home the machine and calibrate the camera again.';

function placedBeforeBedWasKnown(fitted: CameraBedFrame, now: CameraBedFrame): boolean {
  return fitted.nativeToBedOffsetMm === undefined && now.nativeToBedOffsetMm !== undefined;
}

function movedNote(fitted: CameraBedFrame, now: CameraBedFrame): string {
  const shift = bedFrameShift(fitted, now);
  const sameBed = fitted.bedWidthMm === now.bedWidthMm && fitted.bedHeightMm === now.bedHeightMm;
  const when = sameBed
    ? 'with other machine travel settings'
    : `on a ${mm(fitted.bedWidthMm)} × ${mm(fitted.bedHeightMm)} mm bed`;
  return `The camera was calibrated ${when}. KerfDesk moves its picture ${mm(Math.hypot(shift.x, shift.y))} mm to match the machine as it is set up now.`;
}

/**
 * `record` with the frame the operator confirmed it was calibrated in: the
 * origin corner and bed size Machine Setup has now. The native offset stays
 * unknown, so no later offset moves it. A record that already has a frame
 * keeps it (ADR-440 Amendment 4).
 */
export function withConfirmedBedFrame(
  record: CameraModelRecord,
  now: CameraBedFrame,
): CameraModelRecord {
  if (record.bedFrame !== undefined) return record;
  return {
    ...record,
    bedFrame: { origin: now.origin, bedWidthMm: now.bedWidthMm, bedHeightMm: now.bedHeightMm },
  };
}

function unrecordedFrameMessage(now: CameraBedFrame): string {
  return `This camera was calibrated before KerfDesk recorded the bed it was calibrated on, so KerfDesk cannot tell whether its picture still lines up with the burn. If Machine Setup still has the origin ${originWords(now.origin)} and the bed at ${mm(now.bedWidthMm)} × ${mm(now.bedHeightMm)} mm, as when the camera was calibrated, choose Confirm bed and origin in the Camera panel. If either has changed since, calibrate the camera again.`;
}

function mm(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Where scene point `point` of frame `from` lies in frame `to`: the same
 * native machine position, through each frame's origin, bed size and native
 * offset. A native offset counts only when both frames know it: an unknown
 * one is not evidence that it changed.
 */
export function sceneInBedFrame(point: Vec2, from: CameraBedFrame, to: CameraBedFrame): Vec2 {
  const machine = toMachineCoords(point, geometry(from));
  const a = from.nativeToBedOffsetMm;
  const b = to.nativeToBedOffsetMm;
  // native = machine − offset (bedPointToNative), so only the difference counts.
  const offset =
    a === undefined || b === undefined ? { x: 0, y: 0 } : { x: b.x - a.x, y: b.y - a.y };
  return toSceneCoords({ x: machine.x + offset.x, y: machine.y + offset.y }, geometry(to));
}

/**
 * How far every place on the bed moves in scene mm from frame `from` to
 * frame `to`. With one origin corner the two frames differ by a translation
 * alone, so one point gives it.
 */
export function bedFrameShift(from: CameraBedFrame, to: CameraBedFrame): Vec2 {
  return sceneInBedFrame({ x: 0, y: 0 }, from, to);
}

function geometry(frame: CameraBedFrame): Pick<DeviceProfile, 'origin' | 'bedWidth' | 'bedHeight'> {
  return { origin: frame.origin, bedWidth: frame.bedWidthMm, bedHeight: frame.bedHeightMm };
}

function originWords(origin: Origin): string {
  switch (origin) {
    case 'front-left':
      return 'at the front left';
    case 'front-right':
      return 'at the front right';
    case 'rear-left':
      return 'at the rear left';
    case 'rear-right':
      return 'at the rear right';
    case 'center':
      return 'in the centre of the bed';
  }
}

export function normalizeCameraBedFrame(value: unknown): CameraBedFrame | undefined {
  if (!isRecord(value)) return undefined;
  const origin = value['origin'];
  const bedWidthMm = positive(value['bedWidthMm']);
  const bedHeightMm = positive(value['bedHeightMm']);
  if (!isOrigin(origin) || bedWidthMm === undefined || bedHeightMm === undefined) {
    return undefined;
  }
  const offset = value['nativeToBedOffsetMm'];
  if (offset === undefined) return { origin, bedWidthMm, bedHeightMm };
  if (!isRecord(offset)) return undefined;
  const x = finite(offset['x']);
  const y = finite(offset['y']);
  if (x === undefined || y === undefined) return undefined;
  return { origin, bedWidthMm, bedHeightMm, nativeToBedOffsetMm: { x, y } };
}

const ORIGINS: ReadonlySet<string> = new Set([
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
  'center',
]);

function isOrigin(value: unknown): value is Origin {
  return typeof value === 'string' && ORIGINS.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positive(value: unknown): number | undefined {
  const n = finite(value);
  return n !== undefined && n > 0 ? n : undefined;
}
