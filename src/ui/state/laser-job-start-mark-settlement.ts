import { startControllerCommand } from './laser-interactive-command';
import { recordStatusPollTick } from './laser-status-poll-schedule';
import {
  assertJobStartMarkCurrent,
  type MarkTransaction,
} from './laser-job-start-mark-transaction';

/** GRBL G4 first drains the planner. Valid low-feed moves can take minutes;
 * measure controller silence while this exact owned drain waits for its ACK.
 * Activity does not replace that ACK or the subsequent fresh Idle/XYZ check. */
export async function settleJobStartMarkMotion(
  context: MarkTransaction,
  label: string,
): Promise<void> {
  assertJobStartMarkCurrent(context);
  const command = startControllerCommand(context.refs, context.write, {
    kind: 'job-start-mark',
    label,
    command: `${context.driver.commands.settleDwell}\n`,
    action: 'fire',
    source: 'motion',
    timeoutMs: 3_000,
    timeoutMode: 'non-idle-status-activity',
  });
  const ownedCommand = context.refs.controllerCommand;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const polling = new Promise<never>((_resolve, reject) => {
    const tick = async (): Promise<void> => {
      recordStatusPollTick(context.refs, Date.now());
      if (stopped || context.refs.controllerCommand !== ownedCommand) return;
      try {
        assertJobStartMarkCurrent(context);
        const query = context.driver.realtime.statusQuery;
        if (query === null) throw new Error('The start mark needs realtime position reports.');
        await context.write(query, 'fire', 'system');
        if (!stopped)
          timer = setTimeout(() => {
            void tick();
          }, 250);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    // Do not race a status write ahead of the already-dispatched queued line.
    timer = setTimeout(() => {
      void tick();
    }, 250);
  });
  try {
    await Promise.race([command, polling]);
    assertJobStartMarkCurrent(context);
  } finally {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  }
}
