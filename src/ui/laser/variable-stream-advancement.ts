import type { StreamerState } from '../../core/controllers/grbl';
import { DEFAULT_PROJECT_VARIABLE_DATA, type Project } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';

let cancelObserver: (() => void) | null = null;

export function armVariableStreamAdvancement(project: Project): void {
  cancelVariableStreamAdvancement();
  const variables = project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
  if (variables.advancement !== 'after-successful-stream') return;

  let previous = useLaserStore.getState().streamer;
  cancelObserver = useLaserStore.subscribe((state) => {
    const current = state.streamer;
    if (current === previous) return;
    const outcome = variableStreamOutcome(previous, current);
    previous = current;
    if (outcome === 'pending') return;
    cancelVariableStreamAdvancement();
    if (outcome === 'successful') {
      useStore.getState().advanceVariablesAfter(project, 'successful-stream');
    }
  });
}

export function cancelVariableStreamAdvancement(): void {
  cancelObserver?.();
  cancelObserver = null;
}

export function variableStreamOutcome(
  previous: StreamerState | null,
  current: StreamerState | null,
): 'pending' | 'successful' | 'failed' {
  if (current !== null && current.status === 'errored') return 'failed';
  if (current !== null) return 'pending';
  if (previous?.status === 'done') return 'successful';
  return 'failed';
}
