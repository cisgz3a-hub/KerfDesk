import { rotaryAppliesTo } from '../../core/job';
import { positioningLightIssue } from '../../core/devices/positioning-light';
import type { PositioningLight } from '../../core/devices/positioning-light';
import { inferCurrentMachinePosition } from './infer-machine-position';
import {
  controllerOperationOwner,
  interactiveControllerOperation,
} from './laser-controller-operation';
import { jogFrameCommandBlockMessage, pushLog } from './laser-store-helpers';
import { pendingTransportWriteCount } from './laser-start-queue-fence';
import { frameProofReset } from './laser-session-reset';
import { warnJogMotionPolicy } from './laser-jog-warnings';
import type { LaserState, LiveRefs } from './laser-store';
import type { SafeWrite } from './laser-safe-write';
import { useStore } from './store';
import {
  positioningLightCommand,
  positioningLightFence,
  positioningLightStatus,
  settlePositioningLightMove,
  type PositioningLightTransaction,
} from './positioning-light-transaction';

type SetFn = (patch: Partial<LaserState> | ((state: LaserState) => Partial<LaserState>)) => void;
type LightSnapshot = { readonly mapping: PositioningLight; readonly session: () => boolean };
const lightSnapshots = new WeakMap<LiveRefs, LightSnapshot>();

export function positioningLightActions(
  set: SetFn,
  get: () => LaserState,
  refs: LiveRefs,
  write: SafeWrite,
): Pick<LaserState, 'centrePositioningLight' | 'setPositioningLightEnabled'> {
  return {
    centrePositioningLight: (x, y, feed) =>
      runPositioningLight(set, get, refs, write, { x, y, feed }),
    setPositioningLightEnabled: () => runPositioningLight(set, get, refs, write),
  };
}

function assertAdmission(state: LaserState, refs: LiveRefs): void {
  if (state.connection.kind !== 'connected' || refs.connection === null)
    throw new Error('Connect a controller before using the positioning light.');
  if (refs.driver.capabilities.transport === 'file-only')
    throw new Error('This controller supports file export only, not a live positioning light.');
  const blocked = jogFrameCommandBlockMessage(state);
  if (blocked !== null) throw new Error(blocked);
  if (
    state.autofocusBusy ||
    state.probeBusy ||
    state.pendingUntrackedAcks > 0 ||
    pendingTransportWriteCount(state) > 0
  )
    throw new Error('Wait for the current controller command to settle.');
}

type Target = { readonly x: number; readonly y: number; readonly feed: number };

async function runPositioningLight(
  set: SetFn,
  get: () => LaserState,
  refs: LiveRefs,
  write: SafeWrite,
  target?: Target,
): Promise<void> {
  assertAdmission(get(), refs);
  assertTarget(target);
  const mapping = resolveMapping(get(), refs, target);
  const { context, owns, session } = createTransaction(set, get, refs, write, target);
  const driver = refs.driver;
  let mayHaveMoved = false;
  let settled = false;
  try {
    const report = await positioningLightStatus(context);
    if (report.state !== 'Idle')
      throw new Error('Positioning light needs a fresh Idle controller.');
    if (target !== undefined) {
      await turnOffPreviousLight(context);
      for (const line of driver.commands.frameToolOffLines)
        await positioningLightCommand(context, line);
      await positioningLightCommand(context, mapping.offCommand);
      set({ positioningLightEnabled: false });
      await positioningLightFence(context);
      const ready = await positioningLightStatus(context);
      if (ready.state !== 'Idle') throw new Error('The controller left Idle before positioning.');
      await moveToLightTarget(context, set, target, () => {
        mayHaveMoved = true;
      });
      settled = true;
      lightSnapshots.set(refs, { mapping: { ...mapping }, session });
      // May have reached hardware even if its acknowledgement is subsequently
      // lost. Keep Off available until a positively acknowledged off or reset.
      set({ positioningLightEnabled: true });
      await positioningLightCommand(context, mapping.onCommand);
    } else {
      await positioningLightCommand(context, mapping.offCommand);
      set({ positioningLightEnabled: false });
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
      if (mayHaveMoved && !settled)
        await get()
          .stopJob()
          .catch(() => undefined);
      else set({ controllerOperation: null });
    }
    throw error;
  }
}

async function turnOffPreviousLight(context: PositioningLightTransaction): Promise<void> {
  const previous = lightSnapshots.get(context.refs);
  if (previous?.session() === true && context.get().positioningLightEnabled)
    await positioningLightCommand(context, previous.mapping.offCommand);
}

function assertTarget(target: Target | undefined): void {
  if (target === undefined) return;
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

function resolveMapping(
  state: LaserState,
  refs: LiveRefs,
  target: Target | undefined,
): PositioningLight {
  const previous = lightSnapshots.get(refs);
  if (target === undefined && previous?.session() === true) return previous.mapping;
  assertProfileDriver(refs);
  const mapping = useStore.getState().project.device.positioningLight;
  const issue = positioningLightIssue(mapping, refs.driver.kind);
  if (mapping === undefined || issue !== null)
    throw new Error(issue ?? 'Configure the separate positioning light in Device Profile first.');
  if (target === undefined && state.positioningLightEnabled && previous?.session() !== true)
    throw new Error(
      'The positioning light belongs to an earlier connection; check it at the machine.',
    );
  return mapping;
}

function createTransaction(
  set: SetFn,
  get: () => LaserState,
  refs: LiveRefs,
  write: SafeWrite,
  target: Target | undefined,
) {
  const initial = get();
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
      target === undefined ? 'Switching positioning light off' : 'Centring positioning light',
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
    if (target !== undefined && useStore.getState().project.device !== device)
      throw new Error('Device settings changed during positioning.');
  };
  const context: PositioningLightTransaction = {
    get,
    refs,
    assertCurrent,
    write: (line, action, source) => write(line, action, source, assertCurrent),
  };
  set({ controllerOperation: operation, lastWriteError: null });
  return { context, owns, session };
}

async function moveToLightTarget(
  context: PositioningLightTransaction,
  set: SetFn,
  target: Target,
  onMotion: () => void,
): Promise<void> {
  const current = inferCurrentMachinePosition(
    context.get().statusReport,
    context.get().wcoCache,
    context.get().controllerSettings?.reportInches === true,
  );
  if (current === null) throw new Error('Positioning light needs a live machine position.');
  const params = { dx: target.x - current.x, dy: target.y - current.y, feed: target.feed };
  const moving = Math.abs(params.dx) >= 0.001 || Math.abs(params.dy) >= 0.001;
  if (moving) {
    warnJogMotionPolicy(set, context.get, params);
    set(frameProofReset());
    const commands = context.refs.driver.commands
      .buildJog(params)
      .split('\n')
      .filter((line) => line.trim() !== '');
    onMotion();
    for (const line of commands) await positioningLightCommand(context, line);
    await settlePositioningLightMove(context);
  }
  assertLightTargetReached(context, target);
}

function assertLightTargetReached(context: PositioningLightTransaction, target: Target): void {
  const final = inferCurrentMachinePosition(
    context.get().statusReport,
    context.get().wcoCache,
    context.get().controllerSettings?.reportInches === true,
  );
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
