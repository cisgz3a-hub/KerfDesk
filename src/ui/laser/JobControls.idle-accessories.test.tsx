import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { startMotionOperation } from '../state/laser-motion-operation';
import { JobControls } from './JobControls';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareConfirm: vi.fn(() => true),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalProject = useStore.getState().project;
const originalSendConsoleCommand = useLaserStore.getState().sendConsoleCommand;
const originalStatusReport = useLaserStore.getState().statusReport;
const allOff = {
  spindleCw: false,
  spindleCcw: false,
  flood: false,
  mist: false,
};

afterEach(() => {
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  useStore.setState({ project: originalProject });
  useLaserStore.setState({
    accessoryCache: null,
    sendConsoleCommand: originalSendConsoleCommand,
    statusReport: originalStatusReport,
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
  });
});

async function renderJobControls(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
  });
  return {
    host,
    unmount: async () => {
      await act(async () => root?.unmount());
      host.remove();
    },
  };
}

describe('idle CNC accessory recovery', () => {
  it('shows reported active accessories and sends one acknowledged M5 M9 block', async () => {
    const sendConsoleCommand = vi.fn(async () => undefined);
    useStore.setState({
      project: { ...originalProject, machine: DEFAULT_CNC_MACHINE_CONFIG },
    });
    useLaserStore.setState({
      accessoryCache: { ...allOff, spindleCw: true, flood: true },
      sendConsoleCommand,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        feed: 0,
        spindle: 0,
        wco: null,
      },
    });
    const view = await renderJobControls();
    try {
      const alert = view.host.querySelector('[aria-label="Active spindle or coolant"]');
      expect(alert?.textContent).toContain('clockwise spindle, flood coolant');
      const button = Array.from(view.host.querySelectorAll('button')).find((candidate) =>
        candidate.textContent?.includes('Stop spindle & coolant'),
      );
      expect(button).toBeDefined();
      await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(jobAwareConfirm).toHaveBeenCalledWith(expect.stringMatching(/cutter is clear/i));
      expect(sendConsoleCommand).toHaveBeenCalledWith('M5 M9');
      expect(sendConsoleCommand).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
    }
  });

  it('does not send M5/M9 when tool-clearance confirmation is declined', async () => {
    const sendConsoleCommand = vi.fn(async () => undefined);
    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    useStore.setState({
      project: { ...originalProject, machine: DEFAULT_CNC_MACHINE_CONFIG },
    });
    useLaserStore.setState({
      accessoryCache: { ...allOff, spindleCw: true },
      sendConsoleCommand,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        feed: 0,
        spindle: 0,
        wco: null,
      },
    });
    const view = await renderJobControls();
    try {
      const button = Array.from(view.host.querySelectorAll('button')).find((candidate) =>
        candidate.textContent?.includes('Stop spindle & coolant'),
      );
      await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(sendConsoleCommand).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });

  it('stays hidden for all-off, unknown, busy, and laser states', async () => {
    useStore.setState({
      project: { ...originalProject, machine: DEFAULT_CNC_MACHINE_CONFIG },
    });
    useLaserStore.setState({
      accessoryCache: allOff,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        feed: 0,
        spindle: 0,
        wco: null,
      },
    });
    const allOffView = await renderJobControls();
    try {
      expect(allOffView.host.querySelector('[aria-label="Active spindle or coolant"]')).toBeNull();
    } finally {
      await allOffView.unmount();
    }

    useLaserStore.setState({
      accessoryCache: { ...allOff, mist: true },
      motionOperation: startMotionOperation('jog'),
    });
    const busyView = await renderJobControls();
    try {
      expect(busyView.host.querySelector('[aria-label="Active spindle or coolant"]')).toBeNull();
    } finally {
      await busyView.unmount();
    }

    useStore.setState({ project: originalProject });
    useLaserStore.setState({ accessoryCache: { ...allOff, mist: true }, motionOperation: null });
    const laserView = await renderJobControls();
    try {
      expect(laserView.host.querySelector('[aria-label="Active spindle or coolant"]')).toBeNull();
    } finally {
      await laserView.unmount();
    }
  });
});
