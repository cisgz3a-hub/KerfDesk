// laser-jog-warnings — warn-only checks on a requested jog. By mandate (rule 7
// / ADR-232) configured bounds and no-go zones are operator guidance: the move
// is still sent, and the controller's soft limits remain the bounds authority.
//
// A jog path is in the controller's native machine coordinates (MPos), while
// configured bounds and no-go zones are bed coordinates. After homing, stock
// GRBL puts machine space into negative numbers, so comparing raw MPos with
// the bed raised an "outside configured machine bounds" warning on every jog
// of a homed GRBL router; a homed path is compared only through a verified
// native-to-bed frame (audit jog-home-origin-3).

import { firstZoneCrossedBySegment } from '../../core/preflight';
import {
  isRotaryActive,
  machineBoundsForDevice,
  rotaryYLimitMm,
  type DeviceProfile,
} from '../../core/devices';
import { nativePointToBed } from '../../core/devices/native-bed-frame';
import { inferCurrentMachinePosition } from './infer-machine-position';
import { resolveNativeBedFrame, selectNativeBedEvidence } from './native-bed-frame';
import { pushLog } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import { useStore } from './store';
import { useToastStore } from './toast-store';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type JogParams = Parameters<LaserState['jog']>[0];
type Point = { readonly x: number; readonly y: number };
type JogXyPath = { readonly start: Point; readonly target: Point };

export function warnJogMotionPolicy(set: SetFn, get: GetFn, params: JogParams): void {
  const path = resolveJogXyPath(get, params);
  if (path === null) {
    warnUnresolvedJogXyPath(set, get, params);
    return;
  }
  const device = useStore.getState().project.device;
  const bedPath = bedJogPath(get(), device, path);
  if (bedPath === null) return;
  warnJogTargetOutsideConfiguredBounds(set, get, device, bedPath.target);
  warnJogNoGoZoneCrossing(set, get, device, bedPath);
}

// The path in bed coordinates, or null when no bed comparison is meaningful.
// A verified native frame maps it exactly. A homed controller without one
// reports MPos in its own homed frame (negative space on stock GRBL), which
// has no known relation to the bed, so its jogs are not compared. A machine
// that was never homed keeps the operator-positioned convention the bounds
// and no-go zones were configured under (MPos zero where the head powered up).
function bedJogPath(state: LaserState, device: DeviceProfile, path: JogXyPath): JogXyPath | null {
  const frame = resolveNativeBedFrame(device, selectNativeBedEvidence(state));
  if (frame !== null) {
    return {
      start: nativePointToBed(path.start, frame),
      target: nativePointToBed(path.target, frame),
    };
  }
  return state.homingState === 'confirmed' ? null : path;
}

function resolveJogXyPath(get: GetFn, params: JogParams): JogXyPath | null {
  const hasX = params.dx !== undefined;
  const hasY = params.dy !== undefined;
  if (!hasX && !hasY) return null;
  const start = inferCurrentMachinePosition(
    get().statusReport,
    get().wcoCache,
    get().controllerSettings?.reportInches === true,
  );
  if (start === null) return null;
  const relative = params.relative !== false;
  const target = relative
    ? { x: start.x + (params.dx ?? 0), y: start.y + (params.dy ?? 0) }
    : { x: params.dx ?? start.x, y: params.dy ?? start.y };
  return { start, target };
}

function warnJogTargetOutsideConfiguredBounds(
  set: SetFn,
  get: GetFn,
  device: DeviceProfile,
  target: Point,
): void {
  const baseBounds = machineBoundsForDevice(device);
  const bounds = isRotaryActive(device.rotary)
    ? { ...baseBounds, minY: 0, maxY: rotaryYLimitMm(device.rotary) }
    : baseBounds;
  if (
    target.x >= bounds.minX &&
    target.x <= bounds.maxX &&
    target.y >= bounds.minY &&
    target.y <= bounds.maxY
  ) {
    return;
  }
  const message =
    `Jog target X${target.x.toFixed(3)} Y${target.y.toFixed(3)} is outside the ` +
    `configured machine bounds X${bounds.minX.toFixed(3)}..${bounds.maxX.toFixed(3)}, ` +
    `Y${bounds.minY.toFixed(3)}..${bounds.maxY.toFixed(3)}. Controller limits still apply.`;
  publishJogPolicyWarning(set, get, message);
}

function warnUnresolvedJogXyPath(set: SetFn, get: GetFn, params: JogParams): void {
  if (params.dx === undefined && params.dy === undefined) return;
  publishJogPolicyWarning(
    set,
    get,
    'The current machine XY position is unresolved, so KerfDesk cannot compare this jog path with configured bounds or no-go zones. The requested controller jog will be sent unchanged; monitor the move and use Cancel Jog or the physical E-stop if needed.',
  );
}

// DEV-04 / ADR-232: configured no-go zones are operator guidance. Frame is the
// sole ordinary policy guard, so a direct jog crossing produces the same
// prominent warning as other configured-envelope findings and never rewrites
// or refuses the requested controller command.
function warnJogNoGoZoneCrossing(
  set: SetFn,
  get: GetFn,
  device: DeviceProfile,
  path: JogXyPath,
): void {
  if (path.start.x === path.target.x && path.start.y === path.target.y) return;
  const zones = device.noGoZones;
  if (zones === undefined || zones.length === 0) return;
  const zone = firstZoneCrossedBySegment(path.start, path.target, zones);
  if (zone === null) return;
  publishJogPolicyWarning(
    set,
    get,
    `This jog path crosses the configured no-go zone "${zone.name}". The requested controller jog will be sent unchanged; monitor the move and use Cancel Jog or the physical E-stop if needed.`,
  );
}

function publishJogPolicyWarning(set: SetFn, get: GetFn, message: string): void {
  useToastStore.getState().pushToast(message, 'warning');
  set({ log: pushLog(get(), `[lf2] ${message}`) });
}
