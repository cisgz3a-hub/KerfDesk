// laser-jog-actions — the manual-motion action surface (home, auto-focus,
// alarm unlock, jog, jog-cancel, frame). Sibling module to
// laser-job-actions.ts / laser-origin-actions.ts, extracted from
// laser-store.ts (tidy-first: the store file sat at the ESLint hard cap).
//
// `safeWrite` is the laser-store's bottleneck for serial writes; this module
// receives it as a parameter so the actions stay pure functions of their
// inputs and trivially testable with a mock.

import {
  CMD_UNLOCK,
  RT_JOG_CANCEL,
  buildJogCommand,
} from '../../core/controllers/grbl';
import type { SerialConnection } from '../../platform/types';
import { runAutofocus } from './autofocus-action';
import { runHomeAction } from './laser-home-action';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { TranscriptSource } from './laser-transcript';
import {
  buildFrameJogLines,
  markMotionOperationDispatched,
  startMotionOperation,
} from './laser-motion-operation';
import { useStore } from './store';
import {
  activeJobCommandBlockMessage,
  assertAutofocusIdle,
  jogFrameCommandBlockMessage,
  motionOperationCommandBlockMessage,
  pushLog,
} from './laser-store-helpers';
import type { LaserState } from './laser-store';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;
type JogRefs = ControllerLifecycleRefs & { readonly connection: SerialConnection | null };

export function jogActions(
  set: SetFn,
  get: GetFn,
  refs: JogRefs,
  safeWrite: SafeWriteFn,
): Pick<LaserState, 'home' | 'autofocus' | 'unlockAlarm' | 'jog' | 'cancelJog' | 'frame'> {
  return {
    home: async () => {
      await runHomeAction(set, get, refs, safeWrite);
    },
    autofocus: async (command) => {
      const activeJobBlock = activeJobCommandBlockMessage(get());
      if (activeJobBlock !== null) return { kind: 'preflight-failed', reason: activeJobBlock };
      const motionOperationBlock = motionOperationCommandBlockMessage(get());
      if (motionOperationBlock !== null) {
        return { kind: 'preflight-failed', reason: motionOperationBlock };
      }
      if (get().autofocusBusy) {
        return { kind: 'preflight-failed', reason: 'Auto-focus is already running.' };
      }
      set({ autofocusBusy: true });
      try {
        return await runAutofocus({
          connection: refs.connection,
          statusReport: get().statusReport,
          command,
        });
      } finally {
        set({ autofocusBusy: false });
      }
    },
    unlockAlarm: async () => {
      assertMotionReady(set, get, motionOperationCommandBlockMessage);
      await safeWrite(`${CMD_UNLOCK}\n`, 'unlock');
      set({ alarmCode: null, homingState: 'unknown' });
    },
    jog: async (params) => {
      assertAutofocusIdle(get());
      assertMotionReady(set, get, jogFrameCommandBlockMessage);
      set({ motionOperation: startMotionOperation('jog') });
      try {
        await safeWrite(`${buildJogCommand(params)}\n`, 'jog');
        set((s) => ({
          motionOperation: markMotionOperationDispatched(s.motionOperation, 'jog'),
        }));
      } catch (err) {
        set({ motionOperation: null });
        throw err;
      }
    },
    cancelJog: () =>
      safeWrite(RT_JOG_CANCEL, 'jog').finally(() =>
        set({ motionOperation: null, frameVerification: null }),
      ),
    frame: async (bounds, feed) => {
      assertAutofocusIdle(get());
      assertMotionReady(set, get, jogFrameCommandBlockMessage);
      // CNC projects retract to the configured safe height before the XY
      // perimeter trace; the laser path stays Z-silent.
      const machine = useStore.getState().project.machine;
      const safeZMm = machine?.kind === 'cnc' ? machine.params.safeZMm : undefined;
      const [firstLine, ...pendingLines] = buildFrameJogLines(bounds, feed, safeZMm);
      if (firstLine === undefined) return;
      set({ motionOperation: startMotionOperation('frame', pendingLines) });
      try {
        await safeWrite(firstLine, 'frame');
        set((s) => ({
          motionOperation: markMotionOperationDispatched(s.motionOperation, 'frame'),
        }));
      } catch (err) {
        set({ motionOperation: null });
        throw err;
      }
    },
  };
}

// Shared guard body for the two motion-readiness checks (jog/frame vs any
// motion operation) — same block-message plumbing, different predicate.
function assertMotionReady(
  set: SetFn,
  get: GetFn,
  block: (state: LaserState) => string | null,
): void {
  const blockedMessage = block(get());
  if (blockedMessage === null) return;
  set({
    lastWriteError: blockedMessage,
    log: pushLog(get(), `[lf2] Motion command blocked: ${blockedMessage}`),
  });
  throw new Error(blockedMessage);
}
