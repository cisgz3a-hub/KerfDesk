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
//
// A jog's warnings share one toast slot that is rewritten in place, and its
// on-screen text leaves out what changes with every click (the target's
// coordinates) and what the operator cannot act on; the console log keeps each
// full sentence (annoyance audit A5-P2-2, ADR-708). Ten clicks past the bed
// edge are one toast, not ten.

import { firstZoneCrossedBySegment } from '../../core/preflight';
import {
  isRotaryActive,
  machineBoundsForDevice,
  rotaryYLimitMm,
  type DeviceProfile,
} from '../../core/devices';
import { dedicatedRotaryAxisOf } from '../../core/devices/rotary-axis';
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
/** One finding: the full sentence for the log, the short one for the screen. */
type JogWarning = { readonly log: string; readonly toast: string };

/** The one toast slot every jog warning is written to. */
export const JOG_POLICY_TOAST_KEY = 'jog-motion-policy';

/** `start` overrides the reported position for a step queued behind running
 *  steps, which starts where they end (ADR-674); null there means unknown. */
export function warnJogMotionPolicy(
  set: SetFn,
  get: GetFn,
  params: JogParams,
  start?: Point | null,
): void {
  const path = resolveJogXyPath(get, params, start);
  if (path === null) {
    publishJogWarnings(set, get, [unresolvedJogXyPathWarning(params)]);
    return;
  }
  const device = useStore.getState().project.device;
  const bedPath = bedJogPath(get(), device, path);
  if (bedPath === null) return;
  publishJogWarnings(set, get, [
    jogTargetOutsideConfiguredBoundsWarning(device, bedPath.target),
    jogNoGoZoneCrossingWarning(device, bedPath),
  ]);
}

// The path in bed coordinates, or null when no bed comparison is meaningful.
// A verified native frame maps it exactly. A homed controller without one
// reports MPos in its own homed frame (negative space on stock GRBL), which
// has no known relation to the bed, so its jogs are not compared. A machine
// that was never homed keeps the operator-positioned convention the bounds
// and no-go zones were configured under (MPos zero where the head powered up).
function bedJogPath(state: LaserState, device: DeviceProfile, path: JogXyPath): JogXyPath | null {
  const [start, target] = nativePointsOnBed(state, device, [path.start, path.target]) ?? [];
  return start === undefined || target === undefined ? null : { start, target };
}

/** Native machine points in bed coordinates, or null when no bed comparison
 * is meaningful (see bedJogPath). An external run's Frame outline uses it too. */
export function nativePointsOnBed(
  state: LaserState,
  device: DeviceProfile,
  points: ReadonlyArray<Point>,
): ReadonlyArray<Point> | null {
  const frame = resolveNativeBedFrame(device, selectNativeBedEvidence(state));
  if (frame !== null) return points.map((point) => nativePointToBed(point, frame));
  return state.homingState === 'confirmed' ? null : points;
}

/** The configured XY bounds machine motion is compared with. A Frame passes
 *  its framed job's machine kind; a jog uses the open project's. */
export function configuredMotionBounds(
  device: DeviceProfile,
  machineKind = useStore.getState().project.machine?.kind,
): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  const baseBounds = machineBoundsForDevice(device);
  // Rotary is a laser attachment (never applied to CNC output), so a router
  // keeps the bed's own Y range.
  const rotary = machineKind === 'cnc' ? undefined : device.rotary;
  // A rotary on A or Z leaves Y on the bed (ADR-695).
  return isRotaryActive(rotary) && dedicatedRotaryAxisOf(rotary) === null
    ? { ...baseBounds, minY: 0, maxY: rotaryYLimitMm(rotary) }
    : baseBounds;
}

/** Where an XY jog ends in machine coordinates, or null when unknown. */
export function jogXyTarget(get: GetFn, params: JogParams, start?: Point | null): Point | null {
  return resolveJogXyPath(get, params, start)?.target ?? null;
}

function resolveJogXyPath(
  get: GetFn,
  params: JogParams,
  startOverride?: Point | null,
): JogXyPath | null {
  const hasX = params.dx !== undefined;
  const hasY = params.dy !== undefined;
  if (!hasX && !hasY) return null;
  const start =
    startOverride !== undefined
      ? startOverride
      : inferCurrentMachinePosition(
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

function jogTargetOutsideConfiguredBoundsWarning(
  device: DeviceProfile,
  target: Point,
): JogWarning | null {
  const bounds = configuredMotionBounds(device);
  if (
    target.x >= bounds.minX &&
    target.x <= bounds.maxX &&
    target.y >= bounds.minY &&
    target.y <= bounds.maxY
  ) {
    return null;
  }
  const outside =
    `is outside the configured machine bounds X${bounds.minX.toFixed(3)}..${bounds.maxX.toFixed(3)}, ` +
    `Y${bounds.minY.toFixed(3)}..${bounds.maxY.toFixed(3)}. Controller limits still apply.`;
  return {
    log: `Jog target X${target.x.toFixed(3)} Y${target.y.toFixed(3)} ${outside}`,
    // No target coordinates: they change with every click, and the position
    // readout already shows them.
    toast: `Jog target ${outside}`,
  };
}

function unresolvedJogXyPathWarning(params: JogParams): JogWarning | null {
  if (params.dx === undefined && params.dy === undefined) return null;
  return {
    log: 'The current machine XY position is unresolved, so KerfDesk cannot compare this jog path with configured bounds or no-go zones. The requested controller jog will be sent unchanged; monitor the move and use Cancel Jog or the physical E-stop if needed.',
    toast:
      'The machine XY position is unresolved, so this jog is not checked against the configured bounds or no-go zones. It is sent unchanged.',
  };
}

// DEV-04 / ADR-232: configured no-go zones are operator guidance. Frame is the
// sole ordinary policy guard, so a direct jog crossing produces the same
// prominent warning as other configured-envelope findings and never rewrites
// or refuses the requested controller command.
function jogNoGoZoneCrossingWarning(device: DeviceProfile, path: JogXyPath): JogWarning | null {
  if (path.start.x === path.target.x && path.start.y === path.target.y) return null;
  const zones = device.noGoZones;
  if (zones === undefined || zones.length === 0) return null;
  const zone = firstZoneCrossedBySegment(path.start, path.target, zones);
  if (zone === null) return null;
  const crosses = `This jog path crosses the configured no-go zone "${zone.name}".`;
  return {
    log: `${crosses} The requested controller jog will be sent unchanged; monitor the move and use Cancel Jog or the physical E-stop if needed.`,
    toast: `${crosses} It is sent unchanged; use Cancel Jog to stop it.`,
  };
}

// Warn-only (ADR-232): the jog is never refused or changed here. Each finding
// is logged in full; the screen gets one slot holding this jog's findings, so
// a second finding cannot overwrite the first and a repeat rewrites in place.
function publishJogWarnings(set: SetFn, get: GetFn, found: ReadonlyArray<JogWarning | null>): void {
  const warnings = found.filter((warning): warning is JogWarning => warning !== null);
  if (warnings.length === 0) return;
  useToastStore
    .getState()
    .pushToast(warnings.map((warning) => warning.toast).join(' '), 'warning', {
      key: JOG_POLICY_TOAST_KEY,
    });
  for (const warning of warnings) set({ log: pushLog(get(), `[lf2] ${warning.log}`) });
}

/** Warn-only motion guidance: a toast plus the console log (ADR-232). A Frame's
 *  route warnings use it; a jog's go through one rewritten slot instead. */
export function publishMotionPolicyWarning(set: SetFn, get: GetFn, message: string): void {
  useToastStore.getState().pushToast(message, 'warning');
  set({ log: pushLog(get(), `[lf2] ${message}`) });
}
