import { startControllerCommand, waitForFreshIdle } from './laser-interactive-command';
import type { HandlerRefs } from './laser-line-shared';
import { controllerErrorNotice, type LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

const STABLE_IDLE_REPORTS = 2;
const SETTLE_MARKER_ACTIVITY_TIMEOUT_MS = 30_000;

export function beginPostJobSettle(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
): void {
  const state = get();
  if (state.streamer?.status !== 'done') return;
  if (state.controllerOperation !== null) return;
  if (refs.controllerCommand !== null || refs.controllerIdleWait !== null) return;
  set({
    controllerOperation: { kind: 'post-job-settle', phase: 'dwell', idleReports: 0 },
    log: pushLog(state, '[lf2] Job lines acknowledged. Settling controller before ready.'),
  });
  void runPostJobSettle(set, refs, safeWrite);
}

async function runPostJobSettle(
  set: SetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  try {
    // Use the active driver's settle marker (ADR-095), not a hardcoded GRBL
    // dwell: on Marlin the marker is M400 (acks only when buffered motion has
    // drained); G4 P is milliseconds there and acks immediately, so the settle
    // would clear the streamer mid-motion (CTL-02). GRBL's is 'G4 P0.01', so
    // its bytes are unchanged. The home action does the same at its call site.
    await startControllerCommand(refs, safeWrite, {
      kind: 'post-job-settle',
      label: 'post-job settle marker',
      command: `${refs.driver.commands.settleDwell}\n`,
      action: 'console',
      source: 'system',
      timeoutMs: SETTLE_MARKER_ACTIVITY_TIMEOUT_MS,
      timeoutMode: 'non-idle-status-activity',
    });
    set((state) =>
      state.controllerOperation?.kind === 'post-job-settle'
        ? {
            controllerOperation: {
              kind: 'post-job-settle',
              phase: 'awaiting-idle',
              idleReports: 0,
            },
          }
        : {},
    );
    await waitForFreshIdle(refs, {
      kind: 'post-job-settle',
      requiredReports: STABLE_IDLE_REPORTS,
    });
    set((state) =>
      state.controllerOperation?.kind === 'post-job-settle'
        ? {
            controllerOperation: null,
            streamer: null,
            log: pushLog(state, '[lf2] Controller settled after job.'),
          }
        : {},
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The failure is terminal for the operation — clear it rather than park it
    // in a blocking phase. Every command (including Disconnect) gates on
    // controllerOperation being null, so a sticky failure would wedge the
    // whole panel until a cable yank. The 'done' streamer stays; the line
    // handler releases it at the next Idle report.
    set((state) =>
      state.controllerOperation?.kind === 'post-job-settle'
        ? {
            controllerOperation: null,
            lastWriteError: message,
            safetyNotice: state.safetyNotice ?? controllerErrorNotice(null, 'command', message),
            log: pushLog(state, `[lf2] Post-job controller settle failed: ${message}`),
          }
        : {},
    );
  }
}
