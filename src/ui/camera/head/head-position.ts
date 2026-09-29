// Where the laser head is on the bed right now (ADR-449), for a camera that
// rides on it: the controller's machine position mapped onto the bed the same
// way Print and Cut's head capture maps it. It is known only with a verified
// controller-to-bed mapping (homed), like Move laser here; otherwise null.
//
// GRBL reports MPos or WPos as $10 selects, never both, and MPos = WPos + WCO,
// where WCO comes in only some reports. Reading only MPos left a controller
// set to report WPos with no head position, as Print and Cut's Capture head
// was (controller audit R-5, ADR-375), so this takes the position the status
// panel shows: MPos, or WPos plus this report's or the last reported WCO.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L522-L527
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L548-L552

import type { DeviceProfile } from '../../../core/devices';
import type { Vec2 } from '../../../core/scene';
import { capturedMachinePointToScene } from '../../laser/print-cut-capture-frame';
import { useStore } from '../../state';
import { inferCurrentMachinePosition } from '../../state/infer-machine-position';
import { useLaserStore, type LaserState } from '../../state/laser-store';
import { resolveNativeBedFrame } from '../../state/native-bed-frame';

export function headPositionOnBed(device: DeviceProfile, laser: LaserState): Vec2 | null {
  if (laser.connection.kind !== 'connected') return null;
  const machineMm = inferCurrentMachinePosition(
    laser.statusReport,
    laser.wcoCache,
    laser.controllerSettings?.reportInches === true,
  );
  if (machineMm === null) return null;
  const frame = resolveNativeBedFrame(device, laser);
  if (frame === null) return null;
  // Already millimetres: an inch report was converted once above.
  return capturedMachinePointToScene(machineMm, device, false, frame);
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
