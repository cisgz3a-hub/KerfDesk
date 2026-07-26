import { formatDuration } from '../../core/job';
import { assertNever } from '../../core/scene';
import { estimateStyle } from './JobControls.styles';

const TIME_MESSAGES = {
  estimating: (duration: string): string => `Estimating · ~${duration} remaining`,
  running: (duration: string): string => `~${duration} remaining`,
  paused: (duration: string): string => `Paused · ~${duration} remaining`,
  disconnected: 'Time remaining unavailable · disconnected',
  finishing: 'Machine finishing · waiting for controller',
  complete: 'Complete',
  unavailable: (reason: string): string => `Time remaining unavailable · ${reason}`,
};

/** Display-only states for the exact-program job countdown badge. */
export type JobTimeBadgeState =
  | { readonly kind: 'estimating'; readonly remainingSeconds: number }
  | { readonly kind: 'running'; readonly remainingSeconds: number }
  | { readonly kind: 'paused'; readonly remainingSeconds: number }
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'finishing' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Renders the truthful label for one exact-program countdown state. */
export function JobTimeBadge({ state }: { readonly state: JobTimeBadgeState }): JSX.Element {
  return (
    <span role="timer" style={estimateStyle} data-time-state={state.kind}>
      {jobTimeText(state)}
    </span>
  );
}

function jobTimeText(state: JobTimeBadgeState): string {
  switch (state.kind) {
    case 'estimating':
      return TIME_MESSAGES.estimating(formatDuration(state.remainingSeconds));
    case 'running':
      return TIME_MESSAGES.running(formatDuration(state.remainingSeconds));
    case 'paused':
      return TIME_MESSAGES.paused(formatDuration(state.remainingSeconds));
    case 'disconnected':
      return TIME_MESSAGES.disconnected;
    case 'finishing':
      return TIME_MESSAGES.finishing;
    case 'complete':
      return TIME_MESSAGES.complete;
    case 'unavailable':
      return TIME_MESSAGES.unavailable(state.reason);
    default:
      return assertNever(state);
  }
}
