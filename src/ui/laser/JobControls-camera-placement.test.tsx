import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { CAMERA_HOME_REQUIRED_MESSAGE } from '../camera/camera-placement-safety';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { createFramedRunPermit, type FramedRunCandidate } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { completeFramedRunCandidateForTest } from './framed-run-testing';
import { installAutoJobReview } from './job-review';
import { JobControls } from './JobControls';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { captureStartExternalEnvironment } from './start-job-external-environment';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function installProject(): void {
  const base = createProject();
  useStore.setState({
    project: {
      ...base,
      device: {
        ...base.device,
        homing: { ...base.device.homing, enabled: true },
        cameraAlignment: {
          homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          frameWidth: 640,
          frameHeight: 480,
          basis: 'raw',
          alignedAt: 1,
          planeHeightMm: 0,
        },
      },
      scene: {
        ...EMPTY_SCENE,
        layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
        objects: [
          {
            kind: 'imported-svg',
            id: 'O1',
            source: 'camera.svg',
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: false,
                    points: [
                      { x: 0, y: 0 },
                      { x: 10, y: 10 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
  });
}

afterEach(() => {
  useStore.getState().newProject();
  useCameraStore.setState({ placementActive: false, confirmedPositionEpoch: null });
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    streamer: null,
    statusReport: null,
    workOriginActive: false,
    wcoCache: null,
    homingState: 'unknown',
    activeWcs: null,
    framedRun: null,
  });
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

describe('JobControls camera placement', () => {
  it('locks camera-owned placement controls while allowing a watched tool-off Frame', async () => {
    installProject();
    const originalFrame = useLaserStore.getState().frame;
    const frame = vi.fn(async (_bounds, _feed, candidate?: FramedRunCandidate) => {
      if (candidate === undefined) throw new Error('Frame candidate was not supplied');
      completeFramedRunCandidateForTest(candidate);
    });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      frame,
      homingState: 'unknown',
      trustedPositionEpoch: 3,
      activeWcs: 'G54',
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
    });
    useCameraStore.setState({ placementActive: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const uninstallAutoReview = installAutoJobReview('confirm');
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
      });
      const startFrom = host.querySelector<HTMLSelectElement>('select[aria-label="Start from"]');
      expect(startFrom?.value).toBe('absolute');
      expect(startFrom?.disabled).toBe(true);

      const frameButton = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Frame job',
      );
      if (frameButton === undefined) throw new Error('Frame job button not rendered');
      await act(async () => frameButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      await vi.waitFor(() => expect(frame).toHaveBeenCalledTimes(1));
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).not.toContain(
        CAMERA_HOME_REQUIRED_MESSAGE,
      );
    } finally {
      uninstallAutoReview();
      if (root !== null) await act(async () => root?.unmount());
      useLaserStore.setState({ frame: originalFrame });
      host.remove();
    }
  });

  it('expires a ready framed job when the camera setup changes afterward', async () => {
    installProject();
    useLaserStore.setState({
      connection: { kind: 'connected' },
      homingState: 'unknown',
      trustedPositionEpoch: 3,
      activeWcs: 'G54',
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
    });
    useCameraStore.setState({
      placementActive: true,
      confirmedPositionEpoch: null,
      surfaceHeightMm: 0,
    });
    const camera = useCameraStore.getState();
    const candidate = {
      executionSignature: currentReplayExecutionSignature(),
      externalEnvironment: captureStartExternalEnvironment(useStore.getState().project, camera),
    } as FramedRunCandidate;
    useLaserStore.setState((laser) => ({
      framedRun: createFramedRunPermit(candidate, laser),
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
      });
      expect(host.textContent).toContain('Start framed job');
      expect(host.textContent).toContain('Ready to start');

      await act(async () => useCameraStore.setState({ surfaceHeightMm: 2 }));

      expect(host.textContent).toContain('Set up & Frame');
      expect(host.textContent).toContain('Not framed');
      expect(useLaserStore.getState().framedRun).toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});
