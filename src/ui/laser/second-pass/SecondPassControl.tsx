import { recoveryRepository, type RecoveryRepository } from '../../state/recovery';
import { useLaserSecondPassUiStore } from '../../state/laser-second-pass-ui-store';
import { useJustFinishedSecondPassRun } from './second-pass-offer';

/** The Machine-panel way back to the completion offer. It opens the job that
 * just finished and nothing older: there is no history picker (ADR-341
 * Amendment 4), and a job too large for the archive counts (Amendment 7). */
export function SecondPassControl(props: {
  busy: boolean;
  machineKind: 'laser' | 'cnc';
  repository?: RecoveryRepository;
}): JSX.Element | null {
  const repository = props.repository ?? recoveryRepository;
  const finished = useJustFinishedSecondPassRun(repository);
  const openEditor = useLaserSecondPassUiStore((s) => s.openEditor);
  if (props.machineKind !== 'laser' || finished === null) return null;
  return (
    <button
      className="lf-btn lf-btn--sm"
      title="Open the job that just finished to paint or erase areas for another pass."
      disabled={props.busy}
      onClick={() => openEditor(finished.runId)}
    >
      Paint a second pass…
    </button>
  );
}
