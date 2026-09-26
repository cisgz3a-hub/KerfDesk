import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { capturedBasisError, usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useToastStore } from '../state/toast-store';
import { targetsFromSelection } from './print-cut-camera';
import { capturedMachinePointToScene } from './print-cut-capture-frame';
import { PrintAndCutDialog } from './PrintAndCutDialog';
import { usePrintCutCamera } from './use-print-cut-camera';
import { nativeBedCaptureFrameKey, resolveNativeBedFrame } from '../state/native-bed-frame';

export function PrintAndCutDialogHost(props: { readonly onClose: () => void }): JSX.Element {
  const project = useStore((state) => state.project);
  const setTargets = useStore((state) => state.setPrintAndCutTargets);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const additionalSelectedIds = useStore((state) => state.additionalSelectedIds);
  const camera = usePrintCutCamera();
  const laser = useLaserStore();
  const session = usePrintCutSessionStore();
  const pushToast = useToastStore((state) => state.pushToast);
  const epoch = laser.trustedPositionEpoch ?? 0;
  const nativeFrame = resolveNativeBedFrame(project.device, laser);
  const coordinateFrameKey = nativeBedCaptureFrameKey(project.device, laser);
  const basisError = capturedBasisError(session.first, session.second);
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
    session.capture(
      which,
      scenePoint,
      epoch,
      coordinateFrameKey,
      'head',
      nativeFrame === null ? 'controller-relative' : 'bed',
    );
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
      firstSource={session.first?.source ?? null}
      secondSource={session.second?.source ?? null}
      captureEnabled={captureEnabled}
      captureBasisError={basisError}
      onTargetsChanged={camera.invalidate}
      selectionTargets={targetsFromSelection(project, selectedObjectId, additionalSelectedIds)}
      camera={{
        offered: camera.offered,
        available: camera.available,
        finding: camera.finding,
        message: camera.message,
        onFind: (targets) => void camera.find(targets),
      }}
      captureFrameNotice={captureFrameNotice(nativeFrame !== null, session, basisError)}
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

function captureFrameNotice(
  hasNativeFrame: boolean,
  session: Pick<ReturnType<typeof usePrintCutSessionStore.getState>, 'first' | 'second'>,
  basisError: string | null,
): string | null {
  if (basisError !== null) return null;
  if (session.first?.source === 'camera' && session.second?.source === 'camera')
    return 'Camera registration uses calibrated bed coordinates. Check the placement with Frame.';
  return hasNativeFrame
    ? null
    : 'Head captures use controller-relative positions until the controller-to-bed mapping is known. Camera captures use calibrated bed coordinates.';
}

function capturedPointForFrame(
  capture: ReturnType<typeof usePrintCutSessionStore.getState>['first'],
  epoch: number,
  key: string,
) {
  return capture?.epoch === epoch && capture.coordinateFrameKey === key ? capture.point : null;
}
