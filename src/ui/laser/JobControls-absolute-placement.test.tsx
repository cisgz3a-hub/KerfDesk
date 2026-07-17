import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { JobControls } from './JobControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalFrame = useLaserStore.getState().frame;

beforeEach(() => {
  resetStore();
  useLaserStore.setState({
    ...initialLaserState(),
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
    frame: vi.fn(async () => undefined),
  });
  useToastStore.setState({ toasts: [] });
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: {
        ...EMPTY_SCENE,
        layers: [createLayer({ id: 'L1', color: '#ff0000' })],
        objects: [
          {
            kind: 'imported-svg',
            id: 'O1',
            source: 'a.svg',
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: true,
                    points: [
                      { x: 0, y: 0 },
                      { x: 10, y: 0 },
                      { x: 10, y: 10 },
                      { x: 0, y: 10 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      device: {
        ...state.project.device,
        homing: { ...state.project.device.homing, enabled: true },
      },
    },
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
  }));
});

afterEach(() => {
  resetStore();
  useLaserStore.setState({ ...initialLaserState(), frame: originalFrame });
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

// Frame-first (2026-07-17): no placement-policy gate pre-disables Start or
// Frame. An unhomed Absolute machine frames freely — the watched trace IS the
// placement proof — and Start's only policy gate is the completed Frame.
describe('JobControls Absolute Coordinates frame-first', () => {
  it('keeps Start and Frame clickable before homing and dispatches the frame trace', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    const buttonByText = (text: string): HTMLButtonElement => {
      const button = [...host.querySelectorAll('button')].find((item) => item.textContent === text);
      if (button === undefined) throw new Error(`${text} button not rendered`);
      return button;
    };
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
      });

      expect(buttonByText('Home').disabled).toBe(false);
      expect(buttonByText('Frame').disabled).toBe(false);
      expect(buttonByText('Start job').disabled).toBe(false);

      await act(async () => {
        buttonByText('Frame').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(useLaserStore.getState().frame).toHaveBeenCalledTimes(1);
      // The dispatched trace records the frame verification Start requires.
      expect(useLaserStore.getState().frameVerification).not.toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});
