// Browser-only acceptance surface. Production does not import this module.
// All machine commands below terminate in memory; there is no transport.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/ui/theme/tokens.css';
import { createProject, findRegistrationBoxes } from '../../src/core/scene';
import { wideLens, overheadPose } from '../../src/core/camera/model/model-fixtures';
import {
  CAMERA_AUDIT_WIDTH,
  cameraAuditHeldOutErrorMm,
} from '../../src/__fixtures__/camera-audit-target';
import { bedTargetLayout } from '../../src/core/camera/target/bed-target';
import { renderTargetScene } from '../../src/core/camera/target/target-render-fixtures';
import { CameraCalibrationWizard } from '../../src/ui/camera/calibrate/CameraCalibrationWizard';
import {
  DEFAULT_CALIBRATION_SETTINGS,
  useCameraCalibrationStore,
} from '../../src/ui/camera/calibrate/camera-calibration-store';
import { BoardCapturePanel } from '../../src/ui/laser/board-capture/BoardCapturePanel';
import { PrintAndCutDialogHost } from '../../src/ui/laser/PrintAndCutDialogHost';
import { currentPrintCutOutputRegistration } from '../../src/ui/laser/print-cut-output';
import { useStore } from '../../src/ui/state/store';
import { useLaserStore } from '../../src/ui/state/laser-store';
import { useCameraStore } from '../../src/ui/state/camera-store';
import { useUiStore } from '../../src/ui/state/ui-store';
import { usePrintCutSessionStore } from '../../src/ui/state/print-cut-session-store';
import { useExperimentalLaserFeatures } from '../../src/ui/state/experimental-laser-features';

const commands: string[] = [];
let ownedFrameUrl: string | null = null;
function position(x: number, y: number): void {
  useLaserStore.setState((state) => ({
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x, y, z: 0 },
      wPos: null,
      wco: null,
      feed: null,
      spindle: null,
    },
    statusSequence: state.statusSequence + 1,
    motionOperation: null,
  }));
}
function reset(): void {
  if (ownedFrameUrl !== null) URL.revokeObjectURL(ownedFrameUrl);
  ownedFrameUrl = null;
  useStore.getState().setProject(createProject());
  usePrintCutSessionStore.getState().clear();
  useCameraStore.setState({ sourceState: { kind: 'idle' }, overlayVisible: false });
  useCameraCalibrationStore.getState().closeWizard();
  useUiStore.setState({ boardCapturePanelOpen: false });
  useLaserStore.setState({
    connection: { kind: 'connected' },
    streamer: null,
    controllerOperation: null,
    pendingTransportWrites: 0,
    pendingUntrackedAcks: 0,
    setOriginHere: async () => {
      commands.push('simulated set work origin');
      useLaserStore.setState((state) => ({
        workOriginVersion: (state.workOriginVersion ?? 0) + 1,
      }));
    },
    jogToMachinePosition: async (x, y) => {
      commands.push(`simulated beam-off move ${x},${y}`);
      position(x, y);
    },
    jog: async (vector) => {
      const p = useLaserStore.getState().statusReport?.mPos;
      position((p?.x ?? 0) + (vector.dx ?? 0), (p?.y ?? 0) + (vector.dy ?? 0));
      commands.push('simulated fine jog');
    },
  });
  position(10, 20);
}
reset();
useExperimentalLaserFeatures.setState({ features: { lowPowerFire: false, printAndCut: true } });

async function camera(): Promise<void> {
  reset();
  useLaserStore.setState({ connection: { kind: 'disconnected' } });
  const area = { x: 5, y: 5, width: 390, height: 390 };
  const gray = renderTargetScene({
    lens: wideLens(CAMERA_AUDIT_WIDTH),
    pose: overheadPose(),
    layout: bedTargetLayout({ area }),
    sheet: area,
    sheetThicknessMm: 3,
    noise: 4,
  });
  const canvas = document.createElement('canvas');
  canvas.width = gray.width;
  canvas.height = gray.height;
  const pixels = new ImageData(gray.width, gray.height);
  for (let i = 0; i < gray.data.length; i += 1) {
    pixels.data.set([gray.data[i] ?? 0, gray.data[i] ?? 0, gray.data[i] ?? 0, 255], i * 4);
  }
  canvas.getContext('2d')?.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) =>
      value === null ? reject(new Error('PNG encode failed')) : resolve(value),
    ),
  );
  const frameUrl = URL.createObjectURL(blob);
  ownedFrameUrl = frameUrl;
  useCameraStore.setState((state) => ({
    sourceEpoch: state.sourceEpoch + 1,
    sourceState: {
      kind: 'live',
      source: {
        kind: 'machine-rtsp',
        frameUrl,
        previewUrl: frameUrl,
        sourceId: 'synthetic://audit-ring-target',
        liveness: { kind: 'unmonitored', advisory: 'Synthetic test image; no physical camera.' },
      },
    },
  }));
  useCameraCalibrationStore.getState().openWizard();
  useCameraCalibrationStore.setState({ settings: { ...DEFAULT_CALIBRATION_SETTINGS } });
}

function Harness(): JSX.Element {
  const [printCut, setPrintCut] = useState(false);
  const [busy, setBusy] = useState(false);
  const project = useStore((state) => state.project);
  usePrintCutSessionStore();
  const laser = useLaserStore();
  const boxes = findRegistrationBoxes(project.scene);
  const transform = currentPrintCutOutputRegistration(project);
  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Registration tools — simulated inputs</h1>
      <p>
        No hardware or provider connection. Real panels and algorithms; synthetic camera pixels and
        in-memory machine positions.
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void camera().finally(() => setBusy(false));
          }}
        >
          Camera calibration workflow
        </button>
        <button
          onClick={() => {
            reset();
            useUiStore.setState({ boardCapturePanelOpen: true });
          }}
        >
          Place Board workflow
        </button>
        <button
          onClick={() => {
            reset();
            setPrintCut(true);
          }}
        >
          Print and Cut workflow
        </button>
        <button onClick={() => setPrintCut(true)}>Reopen Print and Cut</button>
      </div>
      <fieldset
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: 180,
          display: 'grid',
          background: 'white',
          zIndex: 2147483640,
        }}
      >
        <legend>Simulated machine input (no motion)</legend>
        <button onClick={() => position(10, 20)}>Position 10,20</button>{' '}
        <button onClick={() => position(110, 20)}>Position 110,20</button>{' '}
        <button onClick={() => position(110, 80)}>Position 110,80</button>{' '}
        <button onClick={() => position(10, 80)}>Position 10,80</button>{' '}
        <button onClick={() => position(111, 80)}>Corrected position 111,80</button>{' '}
        <button onClick={() => position(390, 20)}>Second print mark 390,20</button>{' '}
        <button
          onClick={() =>
            useLaserStore.setState((state) => ({
              trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
            }))
          }
        >
          Invalidate position epoch
        </button>
      </fieldset>
      <section aria-label="Audit observations" style={{ marginLeft: 320, marginTop: 24 }}>
        <p data-testid="camera-held-out">
          Independent maximum error over 50 held-out bed points at 0 and 12 mm height:{' '}
          {project.device.cameraModel === undefined
            ? 'not measured'
            : `${cameraAuditHeldOutErrorMm(project.device.cameraModel).toFixed(3)} mm`}
        </p>
        <p>
          Current simulated position: {laser.statusReport?.mPos?.x}, {laser.statusReport?.mPos?.y}
        </p>
        <p data-testid="camera-saved">
          Saved camera:{' '}
          {project.device.cameraModel === undefined
            ? 'none'
            : `${project.device.cameraModel.accuracy.foundMarks} marks; RMS ${project.device.cameraModel.accuracy.rmsErrorMm.toFixed(3)} mm`}
        </p>
        <pre data-testid="board-result">{JSON.stringify(boxes, null, 2)}</pre>
        <pre data-testid="print-result">{JSON.stringify(transform ?? null, null, 2)}</pre>
        <pre>{commands.join('\n')}</pre>
      </section>
      <div style={{ position: 'absolute', top: 200, left: 12, width: 320, height: 800 }}>
        <BoardCapturePanel />
      </div>
      <CameraCalibrationWizard />
      {printCut && <PrintAndCutDialogHost onClose={() => setPrintCut(false)} />}
    </main>
  );
}
const host = document.getElementById('root');
if (host === null) throw new Error('Registration audit root missing');
createRoot(host).render(<Harness />);
