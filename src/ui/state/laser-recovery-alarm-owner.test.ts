import { describe, expect, it } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { parseStatusReport } from '../../core/controllers/grbl';
import { controllerRecoveryActions } from './laser-controller-recovery-actions';
import { initialLaserState } from './laser-store-helpers';
import { useLaserStore, type LaserState } from './laser-store';

async function flush(): Promise<void> {
  for (let index = 0; index < 24; index++) await Promise.resolve();
}

function fixture() {
  let state: LaserState = {
    ...useLaserStore.getState(),
    ...initialLaserState(),
    connection: { kind: 'connected' },
  };
  const set: Parameters<typeof controllerRecoveryActions>[0] = (partial) => {
    state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
  };
  const refs = {
    connection: {},
    controllerCommand: null,
    controllerIdleWait: null,
    writeEpoch: 0,
  } as Parameters<typeof controllerRecoveryActions>[2];
  let replacementState: LaserState | null = null;
  const reportAlarm = (): void => {
    const report = parseStatusReport('<Alarm|MPos:0,0,0|FS:0,0>');
    if (report === null) throw new Error('Alarm fixture invalid.');
    state = { ...state, statusReport: report, statusSequence: state.statusSequence + 1 };
  };
  const replace = (): void => {
    state = {
      ...state,
      controllerOperation: { kind: 'recovery', phase: 'awaiting-idle', idleReports: 0 },
      controllerSessionEpoch: state.controllerSessionEpoch + 1,
      log: [...state.log, 'Replacement recovery owns this controller.'],
    };
    replacementState = state;
  };
  return { set, refs, get: () => state, reportAlarm, replace, replacement: () => replacementState };
}

describe('Wake Alarm completion cannot clear a replacement owner', () => {
  it.each(['reset', 'idle-wait'] as const)(
    'checks ownership after the %s Alarm cleanup await',
    async (phase) => {
      const f = fixture();
      const actions = controllerRecoveryActions(
        f.set,
        f.get,
        f.refs,
        async () => {
          if (phase === 'reset') {
            f.reportAlarm();
            queueMicrotask(() => queueMicrotask(() => queueMicrotask(f.replace)));
          }
        },
        () => grblDriver,
      );
      const wake = actions.wakeController().catch((error: unknown) => error);
      if (phase === 'idle-wait') {
        await flush();
        const wait = f.refs.controllerIdleWait;
        if (wait === null) throw new Error('Owned recovery Idle wait missing.');
        clearTimeout(wait.timer);
        f.refs.controllerIdleWait = null;
        f.reportAlarm();
        wait.reject(new Error('Controller entered Alarm.'));
        queueMicrotask(f.replace);
      }
      const result = await wake;
      expect(String(result)).toContain('superseded');
      const replacement = f.replacement();
      expect(replacement).not.toBeNull();
      expect(f.get().controllerOperation).toBe(replacement!.controllerOperation);
      expect(f.get().log).toEqual(replacement!.log);
      expect(f.get().lastWriteError).toBe(replacement!.lastWriteError);
    },
  );
});
