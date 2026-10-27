/** @vitest-environment jsdom */
// Rolling audit v4 H6-P1-1 (ADR-663 Amendment 4). A calibrated camera starts
// by itself and draws the bed on the canvas without the Camera panel being
// opened (ADR-663 Amendment 1), but camera placement latched only from the
// panel, Refresh, Alt+C and Trace. On the Falcon A1 Pro profile (homing off,
// so Start from is User Origin) Job Review then gave no camera word, and
// artwork placed on the picture at X200-220 Y98-118 burned at the origin. The
// overlay now latches placement whenever it draws a camera picture.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedCameraModel } from '../../core/camera/model/model-fixtures';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { createProject, type Project } from '../../core/scene';
import type { CameraBridgeAdapter } from '../../platform/types';
import { demotedPolicyWarnings } from '../laser/start-job-readiness-policy';
import { machineSnapshot } from '../laser/start-machine-snapshot';
import { useStore } from '../state';
import { saveLastCameraSource } from '../state/camera-preference-storage';
import { useCameraStore, type BedPicture } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import type * as FrameSource from './frame-source';
import { useCameraHelpersStore } from './helpers/camera-helpers-store';
import { installCameraHelpers } from './helpers/install-camera-helpers';
import { WorkspaceCameraOverlay } from './WorkspaceCameraOverlay';

vi.mock('./frame-source', async (original) => ({
  ...(await original<typeof FrameSource>()),
  captureSourceFrame: vi.fn(async () => null),
}));
// jsdom has no WebGL2 and the live camera is never fetched here.
vi.mock('./overlay/bed-overlay-renderer', () => ({ createBedOverlayRenderer: () => null }));
vi.mock('./CameraSourceView', () => ({ CameraSourceView: () => null }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const FALCON = FALCON_A1_PRO_GRBLHAL_PROFILE;
// Calibrated on this machine's own bed, so it is drawn as it was fitted.
const CALIBRATION = {
  ...savedCameraModel(),
  bedFrame: { origin: FALCON.origin, bedWidthMm: FALCON.bedWidth, bedHeightMm: FALCON.bedHeight },
};
const initialCamera = useCameraStore.getState();
const initialLaser = useLaserStore.getState();

const falconCamera: CameraBridgeAdapter = {
  isSupported: () => true,
  probeRtspCamera: async () => ({ kind: 'unavailable', reason: 'none' }),
  rtspStreamStatus: async () => ({ kind: 'live' }),
  discoverMachineCamera: async () => ({
    kind: 'found',
    cameraUrl: 'http://192.168.10.1:8080/media/getCapturePhoto',
    proxyFrameUrl: 'http://bridge.invalid/frame',
  }),
  registerFrameSource: async () => ({ kind: 'ok', frameUrl: 'http://bridge.invalid/frame' }),
  health: async () => ({ kind: 'ok', ffmpegAvailable: true, frameProxy: true }),
};

let container: HTMLDivElement;
let root: Root;
let stopHelpers: () => void = () => undefined;

function openProject(project: Project): void {
  useStore.setState({ project, jobPlacement: project.jobSetup.placement });
}

async function mountOverlay(): Promise<void> {
  await act(async () => root.render(<WorkspaceCameraOverlay />));
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  useCameraStore.setState(initialCamera);
  useLaserStore.setState(initialLaser);
  useCameraHelpersStore.setState({ settings: { autoStart: true, refreshAfterJob: true } });
  openProject(createProject({ ...FALCON, cameraModel: CALIBRATION }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stopHelpers();
  useCameraStore.getState().stopSource();
  useCameraStore.setState(initialCamera);
  useLaserStore.setState(initialLaser);
});

describe('camera placement follows the picture on the canvas', () => {
  it('latches when the calibrated camera starts by itself, with the Camera panel never opened', async () => {
    const { project, jobPlacement } = useStore.getState();
    // The Falcon A1 Pro profile ships with homing off, so a new project starts at User Origin.
    expect(jobPlacement.startFrom).toBe('user-origin');
    saveLastCameraSource('machine');
    stopHelpers = installCameraHelpers({
      camera: undefined,
      bridge: falconCamera,
      bridgeAvailable: true,
    });
    await vi.waitFor(() => expect(useCameraStore.getState().sourceState.kind).toBe('live'));
    expect(useCameraStore.getState()).toMatchObject({ panelOpen: false, overlayVisible: true });

    await mountOverlay();

    const camera = useCameraStore.getState();
    expect(camera.placementActive).toBe(true);
    const snapshot = machineSnapshot(project, useLaserStore.getState(), camera);
    expect(snapshot.cameraPlacementActive).toBe(true);
    const jobOrigin = { startFrom: 'user-origin' as const, anchor: jobPlacement.anchor };
    expect(demotedPolicyWarnings(project, snapshot, jobOrigin)).toContainEqual(
      expect.stringContaining('Camera placement is on, but Start from is User Origin.'),
    );
  });

  it('stays off after Exit camera placement, which hides the picture', async () => {
    useCameraStore.setState({
      sourceState: {
        kind: 'live',
        source: { kind: 'machine-jpeg', cameraUrl: 'http://cam', frameUrl: 'http://frame' },
      },
    });
    await mountOverlay();
    expect(useCameraStore.getState().placementActive).toBe(true);
    await act(async () => useCameraStore.getState().deactivatePlacement());
    expect(useCameraStore.getState()).toMatchObject({
      placementActive: false,
      overlayVisible: false,
    });
  });

  it('latches nothing while the picture is hidden, or with no calibration to draw it through', async () => {
    const live = {
      kind: 'live' as const,
      source: { kind: 'machine-jpeg' as const, cameraUrl: 'http://cam', frameUrl: 'http://frame' },
    };
    useCameraStore.setState({ sourceState: live, overlayVisible: false });
    await mountOverlay();
    expect(useCameraStore.getState().placementActive).toBe(false);
    openProject(createProject(FALCON));
    await act(async () => useCameraStore.setState({ overlayVisible: true }));
    expect(useCameraStore.getState().placementActive).toBe(false);
  });

  it("latches for a head camera's bed picture, which is drawn with no model", async () => {
    openProject(createProject(FALCON));
    const picture: BedPicture = {
      image: { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 },
      region: { x: 100, y: 100, width: 50, height: 50 },
      surfaceHeightMm: 0,
      heightAreas: [],
      taken: {
        bedFrame: {
          origin: FALCON.origin,
          bedWidthMm: FALCON.bedWidth,
          bedHeightMm: FALCON.bedHeight,
        },
        machine: FALCON.profileId ?? FALCON.name,
      },
    };
    useCameraStore.getState().setBedPicture(picture);
    await mountOverlay();
    expect(useCameraStore.getState().placementActive).toBe(true);
  });
});
