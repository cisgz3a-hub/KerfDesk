// CameraPanel — the Camera panel (ADR-107/116, redesigned by ADR-663). The
// everyday view shows what the camera sees with one Start button, then either
// one button into the guided setup (pick the camera, engrave a target, take
// one photo; ADR-441) or, once calibrated, the bed-picture controls: Refresh
// picture, Live, Show on canvas, material height, Trace and the tool folds.
// Choosing another camera, recalibrating, the snapshot and the diagnostics sit
// on its settings page behind the gear. Opened from the top toolbar / Tools
// menu via the `tools.camera` command; it renders nothing until opened, and its
// own × button closes it. Closing the panel keeps a running camera on while the
// canvas shows it.

import { TutorialButton } from '../../tutorials/TutorialButton';
import { useEffect, useState, type CSSProperties } from 'react';
import { usePlatform } from '../../app';
import { Icon } from '../../kit/icons';
import { loadCameraPanelWide, saveCameraPanelWide } from '../../state/camera-preference-storage';
import { useCameraStore } from '../../state/camera-store';
import { CameraCalibrationWizard } from '../calibrate/CameraCalibrationWizard';
import { activeCameraModelNow } from '../active-camera-model';
import { OverlayControls } from '../OverlayControls';
import { JobWatchSection } from '../job-watch/JobWatchSection';
import { jobWatchWantsCamera, useJobWatchStore } from '../job-watch/job-watch-store';
import { startRememberedCamera } from '../helpers/auto-start';
import { CameraFold } from './CameraFold';
import { CameraMovedNotice } from './CameraMovedNotice';
import { CameraPreviewCard } from './CameraPreviewCard';
import { CameraSettingsView } from './CameraSettingsView';
import { CameraSetupCallout } from './CameraSetupCallout';
import { localCameraBridgeAvailable } from './camera-platform-capability';

type PanelView = 'main' | 'settings';

export function CameraPanel(): JSX.Element | null {
  const open = useCameraStore((s) => s.panelOpen);
  return open ? <CameraPanelOpen /> : null;
}

function CameraPanelOpen(): JSX.Element {
  const { bridge, bridgeAvailable, camera, close } = useCameraPanelOpenState();
  const [view, setView] = useState<PanelView>('main');
  const [wide, setWide] = useState(() => loadCameraPanelWide());
  // A ticked choice stays in sight instead of hiding in a closed fold.
  const watching = useJobWatchStore((s) => s.settings.timelapse || s.settings.burnCheck);
  const toggleWide = (): void => {
    setWide((current) => {
      saveCameraPanelWide(!current);
      return !current;
    });
  };

  return (
    <div
      role="dialog"
      aria-label="Camera preview"
      style={{ ...panelStyle, width: wide ? WIDE_PANEL_WIDTH_PX : PANEL_WIDTH_PX }}
    >
      <PanelHeader view={view} onView={setView} onClose={close} />
      {view === 'main' ? (
        <>
          <CameraPreviewCard onChooseCamera={() => setView('settings')} />
          <CameraMovedNotice />
          <CameraSetupCallout />
          <OverlayControls />
          <CameraFold title="Watch the job" hint="timelapse and burn check" defaultOpen={watching}>
            <JobWatchSection />
          </CameraFold>
        </>
      ) : (
        <CameraSettingsView
          camera={camera}
          bridge={bridge}
          bridgeAvailable={bridgeAvailable}
          wide={wide}
          onToggleWide={toggleWide}
        />
      )}
      <CameraCalibrationWizard />
    </div>
  );
}

function PanelHeader(props: {
  readonly view: PanelView;
  readonly onView: (view: PanelView) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const settings = props.view === 'settings';
  return (
    <div style={headerStyle}>
      {settings ? (
        <button
          type="button"
          className="lf-btn"
          onClick={() => props.onView('main')}
          aria-label="Back to the camera"
          title="Back to the camera picture and its controls."
        >
          <Icon name="chevron-left" size={16} />
        </button>
      ) : null}
      <strong style={titleStyle}>{settings ? 'Camera settings' : 'Camera'}</strong>
      <TutorialButton tutorialId="camera" compact label="Camera" />
      {settings ? null : (
        <button
          type="button"
          className="lf-btn"
          onClick={() => props.onView('settings')}
          aria-label="Camera settings"
          title="Choose another camera, recalibrate or check it, save a snapshot, and diagnostics."
        >
          <Icon name="sliders" size={16} />
        </button>
      )}
      <button
        type="button"
        className="lf-btn"
        onClick={props.onClose}
        aria-label="Close camera panel"
        title="Close the camera panel."
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

function useCameraPanelOpenState() {
  const close = useCameraStore((s) => s.closePanel);
  const platform = usePlatform();
  const camera = platform.camera;
  const bridge = platform.cameraBridge;
  const bridgeAvailable = localCameraBridgeAvailable(platform.id, window.location.hostname);
  const detectSupport = useCameraStore((s) => s.detectSupport);
  const refreshCameras = useCameraStore((s) => s.refreshCameras);
  const stopSource = useCameraStore((s) => s.stopSource);
  const machineCamera = useCameraStore((s) => s.machineCamera);
  const detectMachineCamera = useCameraStore((s) => s.detectMachineCamera);

  useEffect(() => {
    detectSupport(camera);
    void refreshCameras(camera);
    const stopWatchingDevices = camera?.onDeviceChange?.(() => {
      void refreshCameras(camera);
    });
    // Probe the machine-integrated camera once on open; the button re-probes.
    if (bridgeAvailable && machineCamera.kind === 'idle') void detectMachineCamera(bridge);
    // Then start the camera used last, so it is there without a click (ADR-663 Amendment 1).
    void startRememberedCamera({ camera, bridge, bridgeAvailable });
    return () => {
      stopWatchingDevices?.();
      if (!cameraShownOnCanvas() && !jobWatchWantsCamera()) stopSource();
    };
    // machineCamera is deliberately NOT a dependency: the probe fires once per
    // panel open, not on every probe-state transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    camera,
    bridge,
    bridgeAvailable,
    detectSupport,
    refreshCameras,
    detectMachineCamera,
    stopSource,
  ]);

  return { bridge, bridgeAvailable, camera, close };
}

// The canvas overlay draws the live camera, so the source outlives the panel
// while the overlay is on and there is a calibration to draw it with. Watching
// jobs (ADR-490) keeps it too, so the camera is there when a job starts.
function cameraShownOnCanvas(): boolean {
  return useCameraStore.getState().overlayVisible && activeCameraModelNow() !== undefined;
}

// Compact fits beside the layers panel; wide is the F-CAM8 monitoring view.
const PANEL_WIDTH_PX = 320;
const WIDE_PANEL_WIDTH_PX = 560;

const panelStyle: CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: 12,
  zIndex: 5,
  maxHeight: 'calc(100% - 24px)',
  overflowY: 'auto',
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: 'var(--lf-bg-0)',
  color: 'var(--lf-text)',
  border: '1px solid var(--lf-border)',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
};
const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const titleStyle: CSSProperties = { flex: 1 };
