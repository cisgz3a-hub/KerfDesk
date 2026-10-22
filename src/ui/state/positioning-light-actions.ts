import { rotaryAppliesTo } from '../../core/job';
import { normalizeReportedMPosToMm } from '../../core/controllers/grbl/machine-envelope';
import {
  POSITIONING_LIGHT_UNSUPPORTED_MESSAGE,
  devicePositioningLightIssue,
  isLaserDotLight,
  positioningLightSupported,
} from '../../core/devices/positioning-light';
import type { PositioningLight } from '../../core/devices/positioning-light';
import type { DeviceProfile } from '../../core/devices/device-profile';
import { inferCurrentMachinePosition } from './infer-machine-position';
import { positioningLightEditGuard } from './positioning-light-edit-guard';
import { currentFrameSpatialSignature } from '../laser/frame-spatial-identity';
import {
  controllerOperationOwner,
  interactiveControllerOperation,
} from './laser-controller-operation';
import { pushLog } from './laser-store-helpers';
import { frameProofReset } from './laser-session-reset';
import { rebasedLightMoveFramePatch, type StashedFrameProof } from './completed-frame-run';
import { warnJogMotionPolicy } from './laser-jog-warnings';
import type { LaserState, LiveRefs } from './laser-store';
import type { SafeWrite } from './laser-safe-write';
import { useStore } from './store';
import { assertLaserDotAllowed, lightOffPatch, sendLightOn } from './positioning-light-on';
import {
  assertPositioningLightAdmission as assertAdmission,
  grblRefusalCode,
  positioningLightBatch,
  positioningLightCommand,
  positioningLightFence,
  positioningLightStatus,
  settlePositioningLightMove,
  switchLight,
  type PositioningLightTransaction,
} from './positioning-light-transaction';

type SetFn = (patch: Partial<LaserState> | ((state: LaserState) => Partial<LaserState>)) => void;
type LightSnapshot = {
  readonly mapping: PositioningLight;
  readonly session: () => boolean;
  readonly connection: LiveRefs['connection'];
};
const lightSnapshots = new WeakMap<LiveRefs, LightSnapshot>();

export function positioningLightActions(
  set: SetFn,
  get: () => LaserState,
  refs: LiveRefs,
  write: SafeWrite,
): Pick<
  LaserState,
  'centrePositioningLight' | 'switchPositioningLightOn' | 'switchPositioningLightOff'
> {
  return {
    centrePositioningLight: (x, y, feed, assertTargetCurrent, coordinateFrame = 'machine') =>
      runPositioningLight(set, get, refs, write, true, {
        x,
        y,
        feed,
        assertTargetCurrent,
        coordinateFrame,
      }),
    switchPositioningLightOn: () => runPositioningLight(set, get, refs, write, true),
    switchPositioningLightOff: () => runPositioningLight(set, get, refs, write, false),
  };
}

/** The captured off command while the light may still be on over this same
 * connection, for Disconnect's best-effort cleanup; null otherwise. The laser
 * dot holds the Fire latch, whose own M5 Disconnect already sends. */
export function positioningLightDisconnectOff(state: LaserState, refs: LiveRefs): string | null {
  const lit = litMapping(state, refs);
  return lit === null || isLaserDotLight(lit) ? null : lit.offCommand;
}

function sessionLight(refs: LiveRefs): PositioningLight | undefined {
  return lightSnapshots.get(refs)?.mapping;
}

function litMapping(state: LaserState, refs: LiveRefs): PositioningLight | null {
  const snapshot = lightSnapshots.get(refs);
  const dialect = useStore.getState().project.device.gcodeDialect?.dialectId;
  return positioningLightSupported(dialect) &&
    state.positioningLightEnabled &&
    snapshot !== undefined &&
    refs.connection !== null &&
    snapshot.connection === refs.connection
    ? snapshot.mapping
    : null;
}

type Target = {
  readonly x: number;
  readonly y: number;
  readonly feed: number;
  readonly assertTargetCurrent: (() => void) | undefined;
  readonly coordinateFrame: 'machine' | 'work';
};

async function runPositioningLight(
  set: SetFn,
  get: () => LaserState,
  refs: LiveRefs,
  write: SafeWrite,
  enabled: boolean,
  target?: Target,
): Promise<void> {
  assertAdmission(withoutOwnDotLatch(get(), refs), refs);
  assertTarget(target);
  const mapping = resolveMapping(get(), refs, enabled);
  const dotOff = laserDotInvolved(mapping, refs);
  const { context, owns, session, dispose } = createTransaction(
    set,
    get,
    refs,
    write,
    enabled,
    target,
  );
  const driver = refs.driver;
  let mayHaveMoved = false;
  let settled = false;
  try {
    const report = await positioningLightStatus(context);
    if (report.state !== 'Idle')
      throw new Error('Positioning light needs a fresh Idle controller.');
    if (enabled) {
      await turnOffPreviousLight(context);
      for (const line of lightToolOffLines(driver.commands.frameToolOffLines, target !== undefined))
        await positioningLightCommand(context, line);
      await switchLight(context, mapping, false);
      set(lightOffPatch(dotOff));
      lightSnapshots.delete(refs);
      await positioningLightFence(context);
      const ready = await positioningLightStatus(context);
      if (ready.state !== 'Idle') throw new Error('The controller left Idle before positioning.');
      if (target !== undefined)
        await moveToLightTarget(context, set, target, () => {
          mayHaveMoved = true;
        });
      settled = true;
      const snapshot = { mapping: { ...mapping }, session, connection: refs.connection };
      lightSnapshots.set(refs, snapshot);
      await sendLightOn(context, set, mapping, owns, {
        forget: () => lightSnapshots.delete(refs),
        isCurrent: () => lightSnapshots.get(refs) === snapshot && session(),
        off: () => runPositioningLight(set, get, refs, write, false),
      });
    } else {
      await switchLight(context, mapping, false);
      set(lightOffPatch(dotOff));
      lightSnapshots.delete(refs);
    }
    context.assertCurrent();
    set({ controllerOperation: null, lastWriteError: null });
  } catch (error) {
    if (owns()) {
      const message = error instanceof Error ? error.message : String(error);
      set({ lastWriteError: message, log: pushLog(get(), `[lf2] Positioning light: ${message}`) });
      // An unresolved move keeps the ordinary Abort lifecycle as its owner.
      // Never send recovery commands to a replacement connection.
      if (mayHaveMoved && !settled) await containUnsettledMove(set, get, refs, owns);
      else set({ controllerOperation: null });
    }
    throw error;
  } finally {
    dispose();
  }
}

async function containUnsettledMove(
  set: SetFn,
  get: () => LaserState,
  refs: LiveRefs,
  owns: () => boolean,
): Promise<void> {
  // A native jog the controller reports as Jog is stopped like any other jog:
  // once released, Abort's unowned-motion path sends the jog cancel (0x85)
  // and keeps position instead of a soft reset that forgets the work origin.
  if (refs.driver.realtime.jogCancel !== null && get().statusReport?.state === 'Jog')
    set({ controllerOperation: null });
  await get()
    .stopJob()
    .then(() => {
      // No-reset controllers quick-stop without replacing an interactive
      // owner. Retire ours only after Abort finishes; a newer operation
      // or controller session must keep its own lifecycle untouched.
      if (owns()) set({ controllerOperation: null });
    })
    .catch(() => undefined);
}

/** The dot's Fire latch is dropped once an acknowledged M5 put it out. */
function laserDotInvolved(mapping: PositioningLight, refs: LiveRefs): boolean {
  return isLaserDotLight(mapping) || isLaserDotLight(sessionLight(refs));
}

/** The dot's own Fire latch does not refuse its LED off, or a new LED on or
 * centre that puts it out first (ADR-664). A held momentary Fire still does. */
function withoutOwnDotLatch(state: LaserState, refs: LiveRefs): LaserState {
  const lit = lightSnapshots.get(refs);
  return lit?.session() === true && isLaserDotLight(lit.mapping) && state.positioningLightEnabled
    ? { ...state, fireActive: false }
    : state;
}

async function turnOffPreviousLight(context: PositioningLightTransaction): Promise<void> {
  const previous = lightSnapshots.get(context.refs);
  if (previous?.session() === true && context.get().positioningLightEnabled)
    await switchLight(context, previous.mapping, false);
}

// Standalone LED switching keeps unrelated coolant/fan accessories unchanged.
function lightToolOffLines(lines: ReadonlyArray<string>, moves: boolean): ReadonlyArray<string> {
  return moves ? lines : lines.filter((line) => line !== 'M9' && line !== 'M107');
}

function assertTarget(target: Target | undefined): void {
  if (target === undefined) return;
  target.assertTargetCurrent?.();
  const project = useStore.getState().project;
  if (project.machine?.kind === 'cnc' || rotaryAppliesTo(project.device, project.machine))
    throw new Error('Centre and light needs a Cartesian laser placement.');
  if (![target.x, target.y, target.feed].every(Number.isFinite) || target.feed <= 0)
    throw new Error('Centre and light needs finite coordinates and a positive feed.');
}

function assertProfileDriver(refs: LiveRefs): void {
  if ((useStore.getState().project.device.controllerKind ?? 'grbl-v1.1') !== refs.driver.kind)
    throw new Error('The selected device profile does not match the connected controller.');
}

// Nothing at all is sent on a Marlin fan-mosfet profile, not even an off
// command captured before the profile changed: its laser is the fan output.
function assertLightSupported(): DeviceProfile {
  const device = useStore.getState().project.device;
  if (!positioningLightSupported(device.gcodeDialect?.dialectId))
    throw new Error(POSITIONING_LIGHT_UNSUPPORTED_MESSAGE);
  return device;
}

function resolveMapping(state: LaserState, refs: LiveRefs, enabled: boolean): PositioningLight {
  const device = assertLightSupported();
  const previous = lightSnapshots.get(refs);
  if (!enabled && previous?.session() === true) return previous.mapping;
  assertProfileDriver(refs);
  const mapping = device.positioningLight;
  const issue = devicePositioningLightIssue({ ...device, controllerKind: refs.driver.kind });
  if (mapping === undefined || issue !== null)
    throw new Error(issue ?? 'Configure the separate positioning light in Device Profile first.');
  if (state.positioningLightEnabled && previous?.session() !== true)
    throw new Error(
      'The positioning light belongs to an earlier connection; check it at the machine.',
    );
  assertLaserDotAllowed(state, device, mapping, enabled);
  return mapping;
}

function createTransaction(
  set: SetFn,
  get: () => LaserState,
  refs: LiveRefs,
  write: SafeWrite,
  enabled: boolean,
  target: Target | undefined,
) {
  const initial = get();
  const editGuard = positioningLightEditGuard(target !== undefined);
  const device = useStore.getState().project.device;
  const connection = refs.connection;
  const driver = refs.driver;
  const writeEpoch = refs.writeEpoch;
  const session = (): boolean =>
    get().connection.kind === 'connected' &&
    get().controllerSessionEpoch === initial.controllerSessionEpoch &&
    refs.connection === connection &&
    refs.driver === driver &&
    refs.writeEpoch === writeEpoch;
  const operation = {
    ...interactiveControllerOperation(
      target !== undefined
        ? 'Centring positioning light'
        : enabled
          ? 'Switching positioning light on'
          : 'Switching positioning light off',
      'terminal-exchange',
    ),
    ...(target === undefined ? {} : { mayMove: true as const }),
  };
  const owns = (): boolean => {
    const current = get().controllerOperation;
    return session() && current !== null && controllerOperationOwner(current) === operation;
  };
  const assertCurrent = (): void => {
    if (
      !owns() ||
      get().manualMotionCancelEpoch !== initial.manualMotionCancelEpoch ||
      get().mpgActive
    )
      throw new Error('Positioning light was cancelled or its controller session changed.');
    assertLightSupported();
    target?.assertTargetCurrent?.();
    if (enabled && useStore.getState().project.device !== device)
      throw new Error('Device settings changed during positioning.');
    editGuard.assertUnchanged();
  };
  const context: PositioningLightTransaction = {
    get,
    refs,
    assertCurrent,
    write: (line, action, source) => write(line, action, source, assertCurrent),
  };
  set({ controllerOperation: operation, lastWriteError: null });
  return { context, owns, session, dispose: editGuard.dispose };
}

async function moveToLightTarget(
  context: PositioningLightTransaction,
  set: SetFn,
  target: Target,
  onMotion: () => void,
): Promise<void> {
  const current = lightTargetPosition(context, target);
  if (current === null)
    throw new Error('Positioning light needs a live position in its captured coordinate frame.');
  const params = { dx: target.x - current.x, dy: target.y - current.y, feed: target.feed };
  const moving = Math.abs(params.dx) >= 0.001 || Math.abs(params.dy) >= 0.001;
  if (!moving) {
    assertLightTargetReached(context, target);
    return;
  }
  warnJogMotionPolicy(set, context.get, params);
  const proof = stashFrameProof(context.get());
  set(frameProofReset());
  const commands = context.refs.driver.commands
    .buildJog(params)
    .split('\n')
    .filter((line) => line.trim() !== '');
  try {
    // One owned write, like an ordinary jog: Marlin's G91/G0/G90 is queued
    // together, so an Abort cannot land between the lines and leave G91 modal.
    await positioningLightBatch(context, commands);
  } catch (error) {
    // Only a qualified parser/travel rejection with no reported motion proves
    // the native jog never started. Ambiguous faults retain Abort containment.
    if (!refusedNativeJogBeforeMotion(context, commands, error)) onMotion();
    throw error;
  }
  onMotion();
  await settlePositioningLightMove(context);
  assertLightTargetReached(context, target);
  restoreFrameProof(context, set, proof);
}

function refusedNativeJogBeforeMotion(
  context: PositioningLightTransaction,
  commands: ReadonlyArray<string>,
  error: unknown,
): boolean {
  if (commands.length !== 1 || !commands[0]?.trim().startsWith('$J=')) return false;
  const driver = context.refs.driver;
  const code = grblRefusalCode(error, driver);
  return (
    driver.capabilities.jog === 'native-jog' &&
    (code === 15 || code === 20) &&
    context.get().statusReport?.state === 'Idle'
  );
}

type LightMoveFrameProof = StashedFrameProof & {
  readonly spatialSignature: string;
  readonly projectDocumentEpoch: number;
};

function stashFrameProof(state: LaserState): LightMoveFrameProof {
  const app = useStore.getState();
  return {
    framedRun: state.framedRun,
    completedFrame: state.completedFrame ?? null,
    frameVerification: state.frameVerification,
    spatialSignature: currentFrameSpatialSignature(app),
    projectDocumentEpoch: app.projectDocumentEpoch,
  };
}

// The ordinary drift subscription cannot watch a temporarily absent proof.
// assertCurrent checks the one-way transaction observer, including undone edits.
function restoreFrameProof(
  context: PositioningLightTransaction,
  set: SetFn,
  proof: LightMoveFrameProof,
): void {
  const app = useStore.getState();
  if (
    currentFrameSpatialSignature(app) !== proof.spatialSignature ||
    app.projectDocumentEpoch !== proof.projectDocumentEpoch
  )
    return;
  context.assertCurrent();
  set((state) => rebasedLightMoveFramePatch(proof, state));
}

function assertLightTargetReached(context: PositioningLightTransaction, target: Target): void {
  const final = lightTargetPosition(context, target);
  const settings = context.get().controllerSettings;
  const reportTick =
    context.refs.driver.kind === 'marlin'
      ? 0.01
      : settings?.reportInches === true
        ? 0.00254
        : 0.001;
  const axisTolerance = (steps: number | undefined): number =>
    reportTick +
    0.001 +
    (steps !== undefined && Number.isFinite(steps) && steps > 0 ? 0.5 / steps : 0.05);
  if (
    final === null ||
    Math.abs(final.x - target.x) > axisTolerance(settings?.stepsPerMmX) ||
    Math.abs(final.y - target.y) > axisTolerance(settings?.stepsPerMmY)
  )
    throw new Error(
      'The head did not reach the selected trace centre; the positioning light stays off.',
    );
}

function lightTargetPosition(context: PositioningLightTransaction, target: Target) {
  const state = context.get();
  const inches = state.controllerSettings?.reportInches === true;
  if (target.coordinateFrame === 'machine')
    return inferCurrentMachinePosition(state.statusReport, state.wcoCache, inches);
  // Verified Origin can know only WPos. Never invent MPos or a zero WCO.
  const work = state.statusReport?.wPos;
  if (work == null) return null;
  const [x, y] = normalizeReportedMPosToMm([work.x, work.y, work.z], inches);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
