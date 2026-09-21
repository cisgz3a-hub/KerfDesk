import type { LaserSecondPassSelection } from '../../../core/laser-second-pass';
import { useLaserStore } from '../../state/laser-store';
import type { ExecutionArtifactV1 } from '../../state/recovery';
import { frameLaserSecondPass, startLaserSecondPass } from '../second-pass-execution';
import { sourceInitialPosition } from './second-pass-preview';
import type { SecondPassWorkbenchState } from './use-second-pass-workbench';

export const SECOND_PASS_BUSY = {
  open: 'Opening saved engraving…',
  compile: 'Preparing painted areas…',
  frame: 'Framing second pass…',
  review: 'Reviewing second pass…',
} as const;

export function secondPassExecutionActions(
  source: ExecutionArtifactV1,
  state: SecondPassWorkbenchState,
  revoke: () => void,
  onClose: () => void,
) {
  const selection = (): LaserSecondPassSelection => {
    const initialPosition = sourceInitialPosition(source);
    return {
      version: 1,
      maxPowerS: source.prepared.project.device.maxPowerS,
      strokes: state.strokes,
      ...(initialPosition === undefined ? {} : { initialPosition }),
    };
  };
  return {
    compile: () =>
      void runSecondPassAction(state, SECOND_PASS_BUSY.compile, async () => {
        if (!state.worker.current) return;
        revoke();
        const value = await state.worker.current.compile(selection());
        if (state.alive.current) {
          state.setPreview(value);
          state.setShowPreview(true);
        }
      }),
    frame: () =>
      void runSecondPassAction(state, SECOND_PASS_BUSY.frame, async () => {
        if (!state.preview) return;
        const permit = await frameLaserSecondPass(source, state.preview.prepared, selection());
        if (state.alive.current) {
          state.permitRef.current = permit;
          if (!permit)
            state.setError(
              'Frame did not complete. Check the controller, then Frame the selected pass again.',
            );
        } else if (permit && useLaserStore.getState().framedRun === permit)
          useLaserStore.setState({ framedRun: null, frameVerification: null });
      }),
    start: () =>
      void runSecondPassAction(state, SECOND_PASS_BUSY.review, async () => {
        const permit = state.permitRef.current;
        if (!permit) return;
        if (await startLaserSecondPass(permit)) {
          state.permitRef.current = null;
          onClose();
        }
      }),
    close: () => {
      if (!state.working.current || state.busy === SECOND_PASS_BUSY.compile) onClose();
    },
  };
}

async function runSecondPassAction(
  state: SecondPassWorkbenchState,
  label: string,
  action: () => Promise<void>,
): Promise<void> {
  if (state.working.current) return;
  state.working.current = true;
  state.setBusy(label);
  state.setError('');
  try {
    await action();
  } catch (reason) {
    if (state.alive.current)
      state.setError(reason instanceof Error ? reason.message : String(reason));
  } finally {
    state.working.current = false;
    if (state.alive.current) state.setBusy('');
  }
}
