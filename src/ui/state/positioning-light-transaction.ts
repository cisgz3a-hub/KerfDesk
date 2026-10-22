import type { StatusReport } from '../../core/controllers/grbl';
import { isLaserDotLight, type PositioningLight } from '../../core/devices/positioning-light';
import { laserDotOnLine } from './laser-dot-light';
import type { LaserSafetyAction } from './laser-safety-notice';
import { firePowerOverrideReset } from './laser-start-override-reset';
import {
  cancelFreshControllerStatusWait,
  waitForFreshControllerStatus,
} from './laser-controller-status-wait';
import {
  cancelControllerLifecycleRefs,
  ControllerCommandRefusedError,
  startControllerCommand,
} from './laser-interactive-command';
import { pendingTransportWriteCount } from './laser-start-queue-fence';
import { recordStatusPollTick } from './laser-status-poll-schedule';
import { jogFrameCommandBlockMessage } from './laser-store-helpers';
import type { LaserState, LiveRefs } from './laser-store';
import type { SafeWrite } from './laser-safe-write';

export type PositioningLightTransaction = {
  readonly get: () => LaserState;
  readonly refs: LiveRefs;
  readonly write: SafeWrite;
  readonly assertCurrent: () => void;
};

/** Whether a light transaction may start now; checked before it takes the controller. */
export function assertPositioningLightAdmission(state: LaserState, refs: LiveRefs): void {
  if (state.connection.kind !== 'connected' || refs.connection === null)
    throw new Error('Connect a controller before using the positioning light.');
  if (refs.driver.capabilities.transport === 'file-only')
    throw new Error('This controller supports file export only, not a live positioning light.');
  const blocked = jogFrameCommandBlockMessage(state);
  if (blocked !== null) throw new Error(blocked);
  if (
    state.autofocusBusy ||
    state.probeBusy ||
    refs.controllerStatusWait != null ||
    state.pendingUntrackedAcks > 0 ||
    pendingTransportWriteCount(state) > 0
  )
    throw new Error('Wait for the current controller command to settle.');
}

/** Each physical step owns its exact terminal reply. Driver shell responses
 * (Smoothie's `fire off`) are classified by the existing driver as an ACK. */
export async function positioningLightCommand(
  context: PositioningLightTransaction,
  command: string,
  action: LaserSafetyAction = 'jog',
): Promise<void> {
  context.assertCurrent();
  await startControllerCommand(context.refs, context.write, {
    kind: 'interactive-command',
    label: 'Positioning light',
    command: `${command.trim()}\n`,
    action,
    source: 'motion',
    timeoutMode: 'non-idle-status-activity',
  });
  context.assertCurrent();
}

/** One light state inside the owned transaction: the mapping's G-code line, or
 * for the laser dot the capped beam-on line or M5 (ADR-664). The caller holds
 * the Fire latch before the dot's on, and has flushed override flags. */
export async function switchLight(
  context: PositioningLightTransaction,
  mapping: PositioningLight,
  on: boolean,
): Promise<void> {
  if (!isLaserDotLight(mapping))
    return positioningLightCommand(context, on ? mapping.onCommand : mapping.offCommand);
  if (!on) return positioningLightCommand(context, 'M5', 'fire');
  return positioningLightCommand(context, laserDotOnLine(context.get(), mapping), 'fire');
}

/**
 * Put the power override back to 100% before the dot goes on: the controller
 * scales S by it, so one a job left at 200% would double the capped power, as
 * for Fire. The fence's owned ACK first flushes older override flags; the
 * caller already holds the Fire latch, which refuses new ones. The reset is a
 * realtime byte on its own and owes no acknowledgement (ADR-361).
 */
export async function resetLaserDotPowerOverride(
  context: PositioningLightTransaction,
): Promise<void> {
  const state = context.get();
  const reset = firePowerOverrideReset(state.capabilities.overrides, state.ovCache);
  if (reset === '') return;
  await positioningLightFence(context);
  context.assertCurrent();
  await context.write(reset, 'fire', 'system');
  context.assertCurrent();
}

/** The GRBL-family error code that refused a light exchange, or null. */
export function grblRefusalCode(error: unknown, { kind }: LiveRefs['driver']): number | null {
  if (!(error instanceof ControllerCommandRefusedError)) return null;
  return ['grbl-v1.1', 'grblhal', 'fluidnc'].includes(kind) ? error.controllerErrorCode : null;
}

/** Several lines written together as one owned exchange; every line must
 * acknowledge before it completes (the controller queues them as one move). */
export async function positioningLightBatch(
  context: PositioningLightTransaction,
  commands: ReadonlyArray<string>,
): Promise<void> {
  if (commands.length === 1) return positioningLightCommand(context, commands[0] as string);
  context.assertCurrent();
  await startControllerCommand(context.refs, context.write, {
    kind: 'interactive-command',
    label: 'Positioning light',
    command: commands.map((line) => `${line.trim()}\n`).join(''),
    action: 'jog',
    source: 'motion',
    timeoutMode: 'non-idle-status-activity',
    terminalAckCount: commands.length,
  });
  context.assertCurrent();
}

/** Register before dispatch: even an adapter's synchronous response belongs
 * to this query. Queued M114 also needs its own terminal ACK on Marlin. */
export async function positioningLightStatus(
  context: PositioningLightTransaction,
): Promise<StatusReport> {
  context.assertCurrent();
  // A rejected registration owns no waiter and must not cancel another action's
  // pending readiness proof or dispatch a query into its exchange.
  if (context.refs.controllerStatusWait != null)
    throw new Error('A controller status confirmation is already active.');
  const state = context.get();
  const driver = context.refs.driver;
  const query = driver.realtime.statusQuery ?? driver.commands.queuedStatusQuery;
  if (query === null) throw new Error('This controller cannot report its current position.');
  const confirmation = waitForFreshControllerStatus(context.refs, {
    after: { sessionEpoch: state.controllerSessionEpoch, sequence: state.statusSequence },
    accept: () => true,
    timeoutMs: 3_000,
    timeoutMessage: 'Positioning light could not confirm a fresh controller position.',
  });
  const ownedWait = context.refs.controllerStatusWait;
  let ownedCommand: LiveRefs['controllerCommand'] = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const dispatch =
      driver.realtime.statusQuery === null
        ? positioningLightCommand(context, query)
        : context.write(query, 'jog', 'poll', context.assertCurrent);
    ownedCommand = context.refs.controllerCommand;
    const [, report] = await Promise.race([
      Promise.all([dispatch, confirmation]),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Positioning light status handoff timed out.')),
          3_000,
        );
      }),
    ]);
    context.assertCurrent();
    return report;
  } finally {
    clearTimeout(timeout);
    if (context.refs.controllerStatusWait === ownedWait)
      cancelFreshControllerStatusWait(context.refs);
    if (ownedCommand !== null && context.refs.controllerCommand === ownedCommand)
      cancelControllerLifecycleRefs(context.refs, 'Positioning light status was interrupted.');
  }
}

/** GRBL rejects G4 while Jog. Wait until the native jog leaves Jog before
 * the planner fence; RepRap drivers need the same fence after ordinary G0. */
export async function settlePositioningLightMove(
  context: PositioningLightTransaction,
): Promise<void> {
  while (context.refs.driver.capabilities.jog === 'native-jog') {
    const report = await positioningLightStatus(context);
    if (report.state === 'Idle') break;
    if (report.state !== 'Run' && report.state !== 'Jog')
      throw new Error(`Positioning light motion interrupted by ${report.state}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    context.assertCurrent();
  }
  await positioningLightFence(context);
  const settled = await positioningLightStatus(context);
  if (settled.state !== 'Idle') throw new Error('Positioning light motion has not settled.');
}

export async function positioningLightFence(context: PositioningLightTransaction): Promise<void> {
  const pending = positioningLightCommand(context, context.refs.driver.commands.settleDwell);
  const ownedCommand = context.refs.controllerCommand;
  const query = context.refs.driver.realtime.statusQuery;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const polling = new Promise<never>((_resolve, reject) => {
    const tick = async (): Promise<void> => {
      if (stopped) return;
      recordStatusPollTick(context.refs, Date.now());
      try {
        context.assertCurrent();
        if (query !== null) await context.write(query, 'jog', 'poll', context.assertCurrent);
        if (!stopped)
          timer = setTimeout(() => {
            void tick();
          }, 250);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    timer = setTimeout(() => {
      void tick();
    }, 250);
  });
  try {
    await Promise.race([pending, polling]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    if (context.refs.controllerCommand === ownedCommand && ownedCommand !== null)
      cancelControllerLifecycleRefs(context.refs, 'Positioning light settlement was interrupted.');
  }
}
