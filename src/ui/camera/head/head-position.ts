// Where the laser head is on the bed right now (ADR-449), for a camera that
// rides on it: the controller's machine position mapped onto the bed the same
// way Print and Cut's head capture maps it. It is known only with a verified
// controller-to-bed mapping (homed), like Move laser here; otherwise null.

import type { DeviceProfile } from '../../../core/devices';
import type { Vec2 } from '../../../core/scene';
import { capturedMachinePointToScene } from '../../laser/print-cut-capture-frame';
import { useStore } from '../../state';
import { useLaserStore, type LaserState } from '../../state/laser-store';
import { resolveNativeBedFrame } from '../../state/native-bed-frame';

export function headPositionOnBed(device: DeviceProfile, laser: LaserState): Vec2 | null {
  const reported = laser.statusReport?.mPos;
  if (laser.connection.kind !== 'connected' || reported === null || reported === undefined) {
    return null;
  }
  const frame = resolveNativeBedFrame(device, laser);
  if (frame === null) return null;
  return capturedMachinePointToScene(
    reported,
    device,
    laser.controllerSettings?.reportInches === true,
    frame,
  );
}

export function headPositionNow(): Vec2 | null {
  return headPositionOnBed(useStore.getState().project.device, useLaserStore.getState());
}

/** The head's bed position, as one object for as long as it stays put. */
export function useHeadPositionOnBed(): Vec2 | null {
  const device = useStore((s) => s.project.device);
  // A text key keeps status reports that do not move the head from re-rendering.
  const key = useLaserStore((laser) => {
    const head = headPositionOnBed(device, laser);
    return head === null ? null : `${head.x},${head.y}`;
  });
  return headFromKey(key);
}

let lastKey: string | null = null;
let lastHead: Vec2 | null = null;

function headFromKey(key: string | null): Vec2 | null {
  if (key === lastKey) return lastHead;
  const [x, y] = key === null ? [] : key.split(',').map(Number);
  lastKey = key;
  lastHead = x === undefined || y === undefined ? null : { x, y };
  return lastHead;
}
