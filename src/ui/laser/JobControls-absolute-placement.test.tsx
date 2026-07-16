import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { ABSOLUTE_HOME_REQUIRED_MESSAGE } from './absolute-placement-safety';
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

describe('JobControls Absolute Coordinates safety', () => {
  it('keeps Home explicit and blocks Frame motion/Start until homing is confirmed', async () => {
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
      expect(buttonByText('Start job').disabled).toBe(true);
      expect(buttonByText('Start job').title).toBe(ABSOLUTE_HOME_REQUIRED_MESSAGE);

      await act(async () => {
        buttonByText('Frame').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(useLaserStore.getState().frame).not.toHaveBeenCalled();
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        message: ABSOLUTE_HOME_REQUIRED_MESSAGE,
        variant: 'error',
      });

      await act(async () => {
        useLaserStore.setState({ homingState: 'confirmed' });
      });

      expect(buttonByText('Start job').disabled).toBe(false);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});
