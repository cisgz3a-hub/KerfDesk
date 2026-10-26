// position-laser-click — the "Move laser here" tool's click handler (ADR-116
// follow-up). A canvas click becomes an absolute, beam-off jog to that bed
// point: scene mm → clamp inside the bed → the SAME origin transform G-code
// emission uses (origin honesty, non-negotiable #2) → the manual-motion
// limits (ADR-375) → the laser store's machine-position jog path, including
// work-offset conversion and CNC safe Z.
// With the camera overlay visible this is
// "click the object in the camera image, the head moves to it". The head
// camera's capture stops (ADR-449) use the same target and limits.

import { toMachineCoords, toSceneCoords } from '../../core/devices';
import type { DeviceProfile } from '../../core/devices';
import type { Vec2 } from '../../core/scene';
import { useLaserStore } from '../state/laser-store';
import { jogFrameCommandBlockMessage } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';
import { resolveManualMotionLimits } from '../state/manual-motion-limits';
import { resolveNativeBedFrame, type NativeBedEvidence } from '../state/native-bed-frame';
import {
  bedPointToNative,
  nativePointToBed,
  type NativeBedFrame,
  type NativeXyBounds,
} from '../../core/devices/native-bed-frame';

// Same positioning feed policy as the JogPad: fast, capped by the device.
const POSITION_FEED_CAP_MM_PER_MIN = 3000;

export function positionLaserFeed(maxFeed: number): number {
  return Math.min(maxFeed, POSITION_FEED_CAP_MM_PER_MIN);
}

/** Clamp a scene point inside the bed so a click near the edge never asks the
 *  head to leave the work area (bounds check, non-negotiable #1). */
export function clampToBed(point: Vec2, bedWidth: number, bedHeight: number): Vec2 {
  return {
    x: Math.min(Math.max(point.x, 0), bedWidth),
    y: Math.min(Math.max(point.y, 0), bedHeight),
  };
}

/** The machine-coordinate destination for a scene click (clamped, origin-mapped). */
export function positionLaserTarget(scenePoint: Vec2, device: DeviceProfile): Vec2 {
  return toMachineCoords(clampToBed(scenePoint, device.bedWidth, device.bedHeight), device);
}

/**
 * Jog the head to the clicked scene point. When the machine is not ready
 * (disconnected, running, alarmed) the block reason surfaces as a toast and
 * nothing is sent — the same gate the JogPad honors.
 */
export function dispatchPositionLaser(scenePoint: Vec2, device: DeviceProfile): void {
  const laser = useLaserStore.getState();
  const blocked = laser.connection.kind === 'connected' ? jogFrameCommandBlockMessage(laser) : null;
  if (laser.connection.kind !== 'connected') {
    useToastStore.getState().pushToast('Connect the machine to move the laser head.', 'error');
    return;
  }
  if (blocked !== null) {
    useToastStore.getState().pushToast(blocked, 'error');
    return;
  }
  const frame = resolveNativeBedFrame(device, laser);
  if (frame === null) {
    useToastStore
      .getState()
      .pushToast(
        'The controller-to-bed mapping is unverified. Home with a supported coordinate mapping before moving to a canvas point.',
        'error',
      );
    return;
  }
  const target = positionLaserNativeTarget(scenePoint, device, frame, laser);
  void laser
    .jogToMachinePosition(target.x, target.y, positionLaserFeed(device.maxFeed))
    .catch(() => {
      // The jog path surfaces write failures through the transcript/safety
      // notice; the click itself must never throw into React.
    });
}

/**
 * The native jog target for a scene point: inside the bed, through the origin
 * transform, and inside the manual-motion limits. On stock GRBL the bed edge on
 * the homing side is where the homing switch trips; the limits keep the head
 * the pull-off clear of it (ADR-375).
 */
export function positionLaserNativeTarget(
  scenePoint: Vec2,
  device: DeviceProfile,
  frame: NativeBedFrame,
  evidence: NativeBedEvidence,
): Vec2 {
  return clampToNative(
    bedPointToNative(positionLaserTarget(scenePoint, device), frame),
    manualMotionBox(frame, evidence),
  );
}

/** A box on the bed, scene mm. */
export type BedBox = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** Where on the bed {@link positionLaserNativeTarget} can take the head. */
export function positionLaserReach(
  device: DeviceProfile,
  frame: NativeBedFrame,
  evidence: NativeBedEvidence,
): BedBox {
  const box = manualMotionBox(frame, evidence);
  const a = toSceneCoords(nativePointToBed({ x: box.minX, y: box.minY }, frame), device);
  const b = toSceneCoords(nativePointToBed({ x: box.maxX, y: box.maxY }, frame), device);
  const bed = { minX: 0, minY: 0, maxX: device.bedWidth, maxY: device.bedHeight };
  return {
    minX: Math.max(bed.minX, Math.min(a.x, b.x)),
    minY: Math.max(bed.minY, Math.min(a.y, b.y)),
    maxX: Math.min(bed.maxX, Math.max(a.x, b.x)),
    maxY: Math.min(bed.maxY, Math.max(a.y, b.y)),
  };
}

function manualMotionBox(frame: NativeBedFrame, evidence: NativeBedEvidence): NativeXyBounds {
  return resolveManualMotionLimits(frame, evidence) ?? frame.nativeBounds;
}

function clampToNative(point: Vec2, bounds: NativeXyBounds): Vec2 {
  return {
    x: Math.min(Math.max(point.x, bounds.minX), bounds.maxX),
    y: Math.min(Math.max(point.y, bounds.minY), bounds.maxY),
  };
}
