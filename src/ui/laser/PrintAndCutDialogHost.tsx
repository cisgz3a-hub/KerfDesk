import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useToastStore } from '../state/toast-store';
import { capturedMachinePointToScene } from './print-cut-capture-frame';
import { PrintAndCutDialog } from './PrintAndCutDialog';
import { nativeBedCaptureFrameKey, resolveNativeBedFrame } from '../state/native-bed-frame';

export function PrintAndCutDialogHost(props: { readonly onClose: () => void }): JSX.Element {
  const project = useStore((state) => state.project);
  const setTargets = useStore((state) => state.setPrintAndCutTargets);
  const laser = useLaserStore();
  const session = usePrintCutSessionStore();
  const pushToast = useToastStore((state) => state.pushToast);
  const epoch = laser.trustedPositionEpoch ?? 0;
  const nativeFrame = resolveNativeBedFrame(project.device, laser);
  const coordinateFrameKey = nativeBedCaptureFrameKey(project.device, laser);
  const captureEnabled =
    laser.connection.kind === 'connected' &&
    laser.statusReport?.state === 'Idle' &&
    laser.statusReport.mPos !== null;
  const capture = (which: 'first' | 'second'): void => {
    const point = laser.statusReport?.mPos;
    if (!captureEnabled || point === null || point === undefined) return;
    const scenePoint = capturedMachinePointToScene(
      point,
      project.device,
      laser.controllerSettings?.reportInches === true,
      nativeFrame,
    );
    if (scenePoint === null) return;
    session.capture(which, scenePoint, epoch, coordinateFrameKey);
  };
  return (
    <PrintAndCutDialog
      initialTargets={
        project.printAndCutTargets ?? {
          first: { x: 10, y: 10 },
          second: { x: Math.max(20, project.workspace.width - 10), y: 10 },
        }
      }
      firstMachinePoint={capturedPointForFrame(session.first, epoch, coordinateFrameKey)}
      secondMachinePoint={capturedPointForFrame(session.second, epoch, coordinateFrameKey)}
      captureEnabled={captureEnabled}
      captureFrameNotice={
        nativeFrame === null
          ? 'Registration uses controller-relative positions. Physical bed location is unverified; keep the same origin and check the Frame.'
          : null
      }
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

function capturedPointForFrame(
  capture: ReturnType<typeof usePrintCutSessionStore.getState>['first'],
  epoch: number,
  key: string,
) {
  return capture?.epoch === epoch && capture.coordinateFrameKey === key ? capture.point : null;
}
