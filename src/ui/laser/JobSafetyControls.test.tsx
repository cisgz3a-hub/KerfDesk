import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, pause, step } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { JobSafetyControls } from './JobSafetyControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const realActions = {
  pauseJob: useLaserStore.getState().pauseJob,
  resumeJob: useLaserStore.getState().resumeJob,
  stopJob: useLaserStore.getState().stopJob,
};

function streamingStreamer(): NonNullable<ReturnType<typeof useLaserStore.getState>['streamer']> {
  return step(createStreamer('G1 X1 S100\nG1 X2 S100\nG1 X3 S100')).state;
}

async function renderControls(): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<JobSafetyControls />));
  return { host, root };
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((b) => b.textContent === text);
}

afterEach(() => {
  useLaserStore.setState({ streamer: null, activeJobMachineKind: null, ...realActions });
  document.body.innerHTML = '';
});

describe('JobSafetyControls', () => {
  it('shows Pause + E-STOP while streaming and wires the store actions', async () => {
    const pauseJob = vi.fn(async () => undefined);
    const stopJob = vi.fn(async () => undefined);
    useLaserStore.setState({ streamer: streamingStreamer(), pauseJob, stopJob });
    const { host, root } = await renderControls();
    try {
      expect(buttonByText(host, 'Resume')).toBeUndefined();
      await act(async () => buttonByText(host, 'Pause')?.click());
      expect(pauseJob).toHaveBeenCalledOnce();
      await act(async () => buttonByText(host, 'E-STOP')?.click());
      expect(stopJob).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('shows Resume (not Pause) while paused and resumes the job', async () => {
    const resumeJob = vi.fn(async () => undefined);
    useLaserStore.setState({ streamer: pause(streamingStreamer()), resumeJob });
    const { host, root } = await renderControls();
    try {
      expect(buttonByText(host, 'Pause')).toBeUndefined();
      const resume = buttonByText(host, 'Resume');
      expect(resume?.disabled).toBe(false);
      await act(async () => resume?.click());
      expect(resumeJob).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('disables Resume for a paused CNC job (manual recovery only)', async () => {
    useLaserStore.setState({
      streamer: pause(streamingStreamer()),
      activeJobMachineKind: 'cnc',
    });
    const { host, root } = await renderControls();
    try {
      // E-STOP stays reachable even when Resume is gated.
      expect(buttonByText(host, 'E-STOP')).toBeDefined();
      expect(buttonByText(host, 'Resume')?.disabled).toBe(true);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('renders nothing when no job is active', async () => {
    useLaserStore.setState({ streamer: null });
    const { host, root } = await renderControls();
    try {
      expect(host.querySelector('button')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
