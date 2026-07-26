import { formatDuration } from '../../core/job';
import { assertNever } from '../../core/scene';
import { estimateStyle } from './JobControls.styles';

export type JobTimeBadgeState =
  | { readonly kind: 'estimating'; readonly remainingSeconds: number }
  | { readonly kind: 'running'; readonly remainingSeconds: number }
  | { readonly kind: 'paused'; readonly remainingSeconds: number }
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'finishing' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'unavailable'; readonly reason: string };

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
      return `Estimating · ~${formatDuration(state.remainingSeconds)} remaining`;
    case 'running':
      return `~${formatDuration(state.remainingSeconds)} remaining`;
    case 'paused':
      return `Paused · ~${formatDuration(state.remainingSeconds)} remaining`;
    case 'disconnected':
      return 'Time remaining unavailable · disconnected';
    case 'finishing':
      return 'Machine finishing · waiting for controller';
    case 'complete':
      return 'Complete';
    case 'unavailable':
      return `Time remaining unavailable · ${state.reason}`;
    default:
      return assertNever(state);
  }
}
