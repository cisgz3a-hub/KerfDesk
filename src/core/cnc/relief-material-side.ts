// Which side of travel relief material lies on, in heightmap numbers
// (ADR-423, ADR-424). Split from compile-cnc-relief.ts (ADR-015 size cap).

import { toMachineCoords, type DeviceProfile } from '../devices';
import {
  applyTransform,
  DEFAULT_CNC_LAYER_SETTINGS,
  type CncLayerSettings,
  type Transform,
  type Vec2,
} from '../scene';
import { machineFrameHandedness } from './machine-frame-handedness';

// ADR-423, ADR-424: which side of travel the material should be on, in
// heightmap numbers, for the layer's cut direction: the wall a waterline pass
// follows, or the stock a roughing ring cuts. Climb keeps the material right
// of travel on the physical bed (motion-polish.ts); the placement and the
// machine frame may each mirror that.
export function materialOnRightInMap(
  residualTransform: Transform,
  device: DeviceProfile,
  settings: CncLayerSettings,
): boolean {
  const place = (x: number, y: number): Vec2 =>
    toMachineCoords(applyTransform({ x, y }, residualTransform), device);
  const origin = place(0, 0);
  const alongX = place(1, 0);
  const alongY = place(0, 1);
  const determinant =
    (alongX.x - origin.x) * (alongY.y - origin.y) - (alongX.y - origin.y) * (alongY.x - origin.x);
  const keepsSides = determinant * machineFrameHandedness(device.origin) > 0;
  const climb =
    (settings.cutDirection ?? DEFAULT_CNC_LAYER_SETTINGS.cutDirection ?? 'climb') === 'climb';
  return keepsSides === climb;
}
