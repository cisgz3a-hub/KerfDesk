import type { StatusReport } from '../../core/controllers/grbl';
import {
  cancelFreshControllerStatusWait,
  waitForFreshControllerStatus,
} from './laser-controller-status-wait';
import { cancelControllerLifecycleRefs, startControllerCommand } from './laser-interactive-command';
import { recordStatusPollTick } from './laser-status-poll-schedule';
import type { LaserState, LiveRefs } from './laser-store';
import type { SafeWrite } from './laser-safe-write';

export type PositioningLightTransaction = {
  readonly get: () => LaserState;
  readonly refs: LiveRefs;
  readonly write: SafeWrite;
  readonly assertCurrent: () => void;
};

/** Each physical step owns its exact terminal reply. Driver shell responses
 * (Smoothie's `fire off`) are classified by the existing driver as an ACK. */
export async function positioningLightCommand(
  context: PositioningLightTransaction,
  command: string,
): Promise<void> {
  context.assertCurrent();
  await startControllerCommand(context.refs, context.write, {
    kind: 'interactive-command',
    label: 'Positioning light',
    command: `${command.trim()}\n`,
    action: 'jog',
    source: 'motion',
    timeoutMode: 'non-idle-status-activity',
  });
  context.assertCurrent();
}

/** Register before dispatch: even an adapter's synchronous response belongs
 * to this query. Queued M114 also needs its own terminal ACK on Marlin. */
export async function positioningLightStatus(
  context: PositioningLightTransaction,
): Promise<StatusReport> {
  context.assertCurrent();
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
