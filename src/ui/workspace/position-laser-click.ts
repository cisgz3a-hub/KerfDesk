// position-laser-click — the "Move laser here" tool's click handler (ADR-116
// follow-up). A canvas click becomes an absolute, beam-off jog to that bed
// point: scene mm → clamp inside the bed → the SAME origin transform G-code
// emission uses (origin honesty, non-negotiable #2) → $J=G90 through the
// laser store's fully-gated jog path. With the camera overlay visible this is
// "click the object in the camera image, the head moves to it".

import { toMachineCoords } from '../../core/devices';
import type { DeviceProfile } from '../../core/devices';
import type { Vec2 } from '../../core/scene';
import { useLaserStore } from '../state/laser-store';
import { jogFrameCommandBlockMessage } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';

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
  const target = positionLaserTarget(scenePoint, device);
  void laser
    .jog({
      dx: target.x,
      dy: target.y,
      feed: positionLaserFeed(device.maxFeed),
      relative: false,
    })
    .catch(() => {
      // The jog path surfaces write failures through the transcript/safety
      // notice; the click itself must never throw into React.
    });
}
