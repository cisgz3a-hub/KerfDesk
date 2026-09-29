import { useStore } from '../state';
import { inferCurrentMachinePosition } from '../state/infer-machine-position';
import { useLaserStore, type LaserState } from '../state/laser-store';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import { capturedBasisError, usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useToastStore } from '../state/toast-store';
import { targetsFromSelection } from './print-cut-camera';
import { capturedMachinePointToScene } from './print-cut-capture-frame';
import { PrintAndCutDialog } from './PrintAndCutDialog';
import { usePrintCutCamera } from './use-print-cut-camera';
import { controllerReportsWorkOffset } from './work-offset-assumption';
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
  const head = headCapture(laser);
  const capture = (which: 'first' | 'second'): void => {
    if (head.machineMm === null) return;
    // Already millimetres: headCapture converted an inch report once.
    const scenePoint = capturedMachinePointToScene(
      head.machineMm,
      project.device,
      false,
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
      captureEnabled={head.machineMm !== null}
      captureUnavailableReason={head.unavailableReason}
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

// GRBL reports the machine position (MPos) or the work position (WPos), as $10
// selects, never both, and MPos = WPos + WCO. Capture head read only MPos, so a
// controller set to report WPos could not capture, and the button said nothing
// (controller audit R-5, ADR-375). It takes the position the status panel
// shows: MPos, or WPos plus this report's or the last reported WCO, in
// millimetres. A position KerfDesk withholds (laser-status-position.ts) is
// never captured; the dialog says what is missing instead.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L522-L527
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L548-L552
function headCapture(laser: LaserState): {
  readonly machineMm: WorkCoordinateOffset | null;
  readonly unavailableReason: string | null;
} {
  if (laser.connection.kind !== 'connected' || laser.statusReport?.state !== 'Idle') {
    return { machineMm: null, unavailableReason: null };
  }
  const machineMm = inferCurrentMachinePosition(
    laser.statusReport,
    laser.wcoCache,
    laser.controllerSettings?.reportInches === true,
  );
  return { machineMm, unavailableReason: machineMm === null ? headUnavailableReason(laser) : null };
}

function headUnavailableReason(laser: LaserState): string {
  if (laser.positionEvidenceSuppressed === true) {
    return 'Capture head is waiting for a trusted head position. KerfDesk hides the reported position after Unlock, Release motors or a Home that did not finish, until Home or "Set origin here" re-establishes it.';
  }
  if (laser.reportUnitsUnconfirmed === true) {
    return 'Capture head is waiting for the report units: after a $13 write KerfDesk shows no machine position until it reads the controller settings ($$) again.';
  }
  if (laser.statusReport?.wPos != null && controllerReportsWorkOffset(laser.capabilities)) {
    return 'Capture head is waiting for the work offset (WCO). This controller is set to report its work position (WPos, $10), and the machine position is WPos plus WCO, which the controller sends only in some status reports.';
  }
  return 'Capture head needs the machine position, which the controller has not reported.';
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
