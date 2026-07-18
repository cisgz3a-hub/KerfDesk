import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { installAutoJobReview } from './job-review';
import { JobControls } from './JobControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('JobControls unhomed custom-origin Frame action', () => {
  afterEach(() => {
    useStore.getState().newProject();
    useLaserStore.setState({
      frame: originalFrame,
      connection: { kind: 'disconnected' },
      streamer: null,
      statusReport: null,
      activeWcs: null,
      workOriginActive: false,
      wcoCache: null,
      motionOperation: null,
    });
    useToastStore.setState({ toasts: [] });
    vi.restoreAllMocks();
  });

  const originalFrame = useLaserStore.getState().frame;

  it('does not block User Origin frame from a negative WCO when homing is disabled', async () => {
    const frame = vi.fn(async () => undefined);
    useStore.setState({
      project: centeredSmallProject(),
      jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' },
    });
    useLaserStore.setState({
      frame,
      connection: { kind: 'connected' },
      streamer: null,
      activeWcs: 'G54',
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: -90, z: 0 },
        wPos: { x: 0, y: 0, z: 0 },
        wco: { x: 0, y: -90, z: 0 },
        feed: 0,
        spindle: 0,
      },
      workOriginActive: true,
      wcoCache: { x: 0, y: -90, z: 0 },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const uninstallAutoReview = installAutoJobReview('confirm');
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
      });
      const frameButton = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Frame job',
      );
      if (frameButton === undefined) throw new Error('Frame job button not rendered');

      await act(async () => {
        frameButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await vi.waitFor(() => expect(frame).toHaveBeenCalledTimes(1));
      expect(useToastStore.getState().toasts.at(-1)?.message ?? '').not.toMatch(/overhangs/);
    } finally {
      uninstallAutoReview();
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('does not block User Origin frame when unhomed overscan extends left of the relative origin', async () => {
    const frame = vi.fn(async () => undefined);
    useStore.setState({
      project: fillOverscanProject(),
      jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' },
    });
    useLaserStore.setState({
      frame,
      connection: { kind: 'connected' },
      streamer: null,
      activeWcs: 'G54',
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: -90, z: 0 },
        wPos: { x: 0, y: 0, z: 0 },
        wco: { x: 0, y: -90, z: 0 },
        feed: 0,
        spindle: 0,
      },
      workOriginActive: true,
      wcoCache: { x: 0, y: -90, z: 0 },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const uninstallAutoReview = installAutoJobReview('confirm');
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
      });
      const frameButton = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Frame job',
      );
      if (frameButton === undefined) throw new Error('Frame job button not rendered');

      await act(async () => {
        frameButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await vi.waitFor(() => expect(frame).toHaveBeenCalledTimes(1));
      expect(useToastStore.getState().toasts.at(-1)?.message ?? '').not.toMatch(/overhangs/);
    } finally {
      uninstallAutoReview();
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });
});

function centeredSmallProject(): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      layers: [createLayer({ id: 'L1', color: '#ff0000' })],
      objects: [
        {
          kind: 'traced-image',
          id: 'centered-logo',
          source: 'logo.png',
          bounds: { minX: 0, minY: 0, maxX: 63, maxY: 34 },
          transform: { ...IDENTITY_TRANSFORM, x: 168, y: 183 },
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 0, y: 0 },
                    { x: 63, y: 0 },
                    { x: 63, y: 34 },
                    { x: 0, y: 34 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function fillOverscanProject(): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      layers: [
        {
          ...createLayer({ id: 'L-fill', color: '#ff0000', mode: 'fill' }),
          fillOverscanMm: 5,
          hatchSpacingMm: 2,
        },
      ],
      objects: [
        {
          kind: 'imported-svg',
          id: 'fill-logo',
          source: 'logo.svg',
          bounds: { minX: 0, minY: 0, maxX: 87, maxY: 50 },
          transform: { ...IDENTITY_TRANSFORM, x: 150, y: 150 },
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 0, y: 0 },
                    { x: 87, y: 0 },
                    { x: 87, y: 50 },
                    { x: 0, y: 50 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}
