import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { CAMERA_HOME_REQUIRED_MESSAGE } from '../camera/camera-placement-safety';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { JobControls } from './JobControls';

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
    streamer: null,
    statusReport: null,
    workOriginActive: false,
    wcoCache: null,
    homingState: 'unknown',
  });
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

describe('JobControls camera placement', () => {
  it('locks origin selection and blocks Frame until Home is confirmed', async () => {
    installProject();
    const originalFrame = useLaserStore.getState().frame;
    const frame = vi.fn(async () => undefined);
    useLaserStore.setState({
      frame,
      homingState: 'unknown',
      trustedPositionEpoch: 3,
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
        (button) => button.textContent === 'Frame',
      );
      if (frameButton === undefined) throw new Error('Frame button not rendered');
      await act(async () => frameButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      expect(frame).not.toHaveBeenCalled();
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        message: CAMERA_HOME_REQUIRED_MESSAGE,
        variant: 'error',
      });
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      useLaserStore.setState({ frame: originalFrame });
      host.remove();
    }
  });
});
