import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useToastStore } from '../state/toast-store';
import { PrintAndCutDialog } from './PrintAndCutDialog';

export function PrintAndCutDialogHost(props: { readonly onClose: () => void }): JSX.Element {
  const project = useStore((state) => state.project);
  const setTargets = useStore((state) => state.setPrintAndCutTargets);
  const laser = useLaserStore();
  const session = usePrintCutSessionStore();
  const pushToast = useToastStore((state) => state.pushToast);
  const epoch = laser.trustedPositionEpoch ?? 0;
  const captureEnabled =
    laser.connection.kind === 'connected' &&
    laser.statusReport?.state === 'Idle' &&
    laser.statusReport.mPos !== null;
  const capture = (which: 'first' | 'second'): void => {
    const point = laser.statusReport?.mPos;
    if (!captureEnabled || point === null || point === undefined) return;
    session.capture(which, { x: point.x, y: point.y }, epoch);
  };
  return (
    <PrintAndCutDialog
      initialTargets={
        project.printAndCutTargets ?? {
          first: { x: 10, y: 10 },
          second: { x: Math.max(20, project.workspace.width - 10), y: 10 },
        }
      }
      firstMachinePoint={session.first?.epoch === epoch ? session.first.point : null}
      secondMachinePoint={session.second?.epoch === epoch ? session.second.point : null}
      captureEnabled={captureEnabled}
      onCapture={capture}
      onCancel={props.onClose}
      onApply={(targets) => {
        setTargets(targets);
        props.onClose();
        pushToast('Print-and-Cut registration targets updated.', 'success');
      }}
      onDisable={() => {
        setTargets(null);
        session.clear();
        props.onClose();
      }}
    />
  );
}
