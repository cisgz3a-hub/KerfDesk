import { useLaserStore } from '../../state/laser-store';
import { isActiveJob } from '../../state/laser-store-helpers';

/** Archiving can outlast Start acceptance, so a live job needs an accessible
 * Abort even while the workbench is still waiting to close. */
export function SecondPassAbortButton(): JSX.Element | null {
  const activeJob = useLaserStore(
    (state) => isActiveJob(state.streamer) || state.controllerOperation?.kind === 'post-job-settle',
  );
  const activeMotion = useLaserStore((state) => state.motionOperation !== null);
  if (!activeJob && !activeMotion) return null;
  return (
    <button
      className="lf-btn lf-btn--danger"
      title="Stop the current job or Frame motion and turn the laser off."
      onClick={() => void useLaserStore.getState().stopJob()}
    >
      {activeJob ? 'Abort job' : 'Abort motion'}
    </button>
  );
}
