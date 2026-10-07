import type { LaserState } from './laser-store';
import { mpgCommandBlockMessage } from './laser-store-helpers';
import { overrideActions } from './override-actions';

export function controllerOverrideActions(
  write: (line: string) => Promise<void>,
  get: () => LaserState,
): Pick<LaserState, 'sendRealtimeOverride'> {
  return overrideActions(
    write,
    () => get().capabilities.overrides,
    () => realtimeOverrideBlockMessage(get()),
  );
}

/** User adjustments must not join the realtime reset batch that establishes
 * the reviewed Start/Fire baseline. Internal owned resets bypass this UI
 * action guard and still travel through safeWrite. */
export function realtimeOverrideBlockMessage(state: LaserState): string | null {
  const mpg = mpgCommandBlockMessage(state);
  if (mpg !== null) return mpg;
  if (state.controllerOperation?.kind === 'start-arming') {
    return 'Wait for Start to finish establishing the override baseline.';
  }
  if (state.controllerOperation?.kind === 'job-start-mark') {
    return 'Wait for the timed start mark to finish before changing overrides.';
  }
  if (state.fireActive) return 'Release momentary Fire before changing overrides.';
  return state.controllerOperation?.kind === 'probe'
    ? 'Realtime overrides are locked during a probe transaction.'
    : null;
}
