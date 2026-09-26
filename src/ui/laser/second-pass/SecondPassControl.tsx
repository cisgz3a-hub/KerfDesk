import { recoveryRepository, type RecoveryRepository } from '../../state/recovery';
import { useLaserSecondPassUiStore } from '../../state/laser-second-pass-ui-store';
import { useRecoveryRepositorySelection } from '../../state/use-recovery-repository';
import { secondPassOfferable, selectLastCompletedReceipt } from './second-pass-offer';

/** The Machine-panel way back to the completion offer. It opens the job that
 * just finished and nothing older: there is no history picker (ADR-341
 * Amendment 4). */
export function SecondPassControl(props: {
  busy: boolean;
  machineKind: 'laser' | 'cnc';
  repository?: RecoveryRepository;
}): JSX.Element | null {
  const repository = props.repository ?? recoveryRepository;
  const receipt = useRecoveryRepositorySelection(selectLastCompletedReceipt, repository);
  const openEditor = useLaserSecondPassUiStore((s) => s.openEditor);
  if (props.machineKind !== 'laser' || receipt === null || !secondPassOfferable(receipt.artifact))
    return null;
  return (
    <button
      className="lf-btn lf-btn--sm"
      title="Open the job that just finished to paint or erase areas for another pass."
      disabled={props.busy}
      onClick={() => openEditor(receipt.runId)}
    >
      Paint a second pass…
    </button>
  );
}
