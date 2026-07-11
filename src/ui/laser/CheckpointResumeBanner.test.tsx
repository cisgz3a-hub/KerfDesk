import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createStreamer, step } from '../../core/controllers/grbl';
import { advanceJobCheckpoint, createJobCheckpoint } from '../../core/recovery';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { useLaserStore } from '../state/laser-store';
import { readJobCheckpoint, writeJobCheckpoint } from '../state/job-checkpoint-storage';
import { CheckpointResumeBanner } from './CheckpointResumeBanner';

vi.mock('./start-job-flow', () => ({
  runCheckpointResumeFlow: vi.fn(async () => undefined),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = '2026-07-07T03:00:00.000Z';
const GCODE = ['; layer', 'G21', 'G90', 'G1 X10 S100', 'M5'].join('\n');

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  const r = createRoot(host);
  act(() => {
    r.render(<CheckpointResumeBanner disabled={false} busy={false} />);
  });
  root = r;
}

function storedCheckpoint(acked: number): void {
  const cp = createJobCheckpoint({
    gcode: GCODE,
    machineKind: 'laser',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: NOW,
  });
  writeJobCheckpoint(advanceJobCheckpoint(cp, acked, NOW));
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  useLaserStore.setState({ streamer: null });
  localStorage.clear();
  vi.clearAllMocks();
});

describe('CheckpointResumeBanner', () => {
  it('renders the interrupted-job offer when a checkpoint with progress exists', () => {
    storedCheckpoint(2);
    render();

    expect(host?.textContent).toContain('Interrupted laser job');
    expect(host?.textContent).toContain('2 of 4 motion lines confirmed');
    expect(host?.querySelector('button')?.textContent).toBe('Resume interrupted job');
  });

  it('renders nothing without a checkpoint or without progress', () => {
    render();
    expect(host?.textContent).toBe('');

    act(() => {
      root?.unmount();
    });
    storedCheckpoint(0);
    render();
    expect(host?.textContent).toBe('');
  });

  it('renders nothing while a job is active', () => {
    storedCheckpoint(2);
    useLaserStore.setState({ streamer: step(createStreamer(GCODE)).state });
    render();

    expect(host?.textContent).toBe('');
  });

  it('dismiss clears the stored checkpoint and hides the banner', () => {
    storedCheckpoint(3);
    render();
    const dismiss = [...(host?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'Dismiss',
    );
    expect(dismiss).toBeDefined();

    act(() => {
      dismiss?.click();
    });

    expect(readJobCheckpoint()).toBeNull();
    expect(host?.textContent).toBe('');
  });

  it('resume hands the checkpoint to runCheckpointResumeFlow', async () => {
    const { runCheckpointResumeFlow } = await import('./start-job-flow');
    storedCheckpoint(2);
    render();

    act(() => {
      host?.querySelector('button')?.click();
    });

    expect(runCheckpointResumeFlow).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runCheckpointResumeFlow).mock.calls[0]?.[0]).toMatchObject({
      ackedLines: 2,
    });
  });
});
