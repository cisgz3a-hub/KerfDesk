import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createStreamer, step } from '../../core/controllers/grbl';
import {
  advanceJobCheckpoint,
  createJobCheckpoint,
  markResumeInFlight,
  withJobInterruption,
} from '../../core/recovery';
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

function storedCheckpoint(acked: number, machineKind: 'laser' | 'cnc' = 'laser'): void {
  const cp = createJobCheckpoint({
    gcode: GCODE,
    machineKind,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: NOW,
  });
  writeJobCheckpoint(advanceJobCheckpoint(cp, acked, NOW));
}

function storedDisconnectedCncCheckpoint(): void {
  const cp = createJobCheckpoint({
    gcode: GCODE,
    machineKind: 'cnc',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: NOW,
  });
  writeJobCheckpoint(
    withJobInterruption(
      advanceJobCheckpoint(cp, 2, NOW),
      { kind: 'disconnect', message: 'USB connection was lost during the router job.' },
      NOW,
    ),
  );
}

function storedInterruptedRecoveryCheckpoint(): void {
  const checkpoint = createJobCheckpoint({
    gcode: GCODE,
    machineKind: 'cnc',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: NOW,
  });
  writeJobCheckpoint(markResumeInFlight(advanceJobCheckpoint(checkpoint, 2, NOW), NOW));
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
    expect(host?.textContent).toContain('2 of 4 G-code lines acknowledged by the controller');
    expect(host?.querySelector('button')?.textContent).toBe('Review safe recovery');
  });

  it('renders nothing without a checkpoint', () => {
    render();
    expect(host?.textContent).toBe('');
  });

  it('retains recovery guidance when interruption happens before the first acknowledgement', () => {
    storedCheckpoint(0, 'cnc');
    render();
    expect(host?.textContent).toContain('Interrupted router job');
    expect(host?.textContent).toContain('0 of 4 G-code lines acknowledged');
    expect(host?.textContent).toContain('Acknowledgements are diagnostic only');
    expect(host?.textContent).toContain('new recovery job');
    expect(host?.querySelector('button')?.textContent).toBe('Review supervised recovery');
  });

  it('does not offer laser replay before any command was acknowledged', () => {
    storedCheckpoint(0, 'laser');
    render();
    expect(host?.textContent).toBe('');
  });

  it('retains CNC evidence and offers the supervised new-job review', () => {
    storedCheckpoint(2, 'cnc');
    render();

    expect(host?.textContent).toContain('Acknowledgements are diagnostic only');
    expect(host?.textContent).toContain('select the first uncertain native contour segment');
    expect([...(host?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'Review supervised recovery',
      'Dismiss',
    ]);
  });

  it('opens the fail-closed supervised CNC recovery wizard', () => {
    storedCheckpoint(2, 'cnc');
    render();

    act(() => {
      [...(host?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent === 'Review supervised recovery')
        ?.click();
    });

    expect(host?.textContent).toContain('Supervised CNC recovery');
    expect(host?.textContent).toContain('Acknowledged lines remain transport diagnostics');
    expect(host?.textContent).not.toContain('Start supervised recovery');
  });

  it('does not reuse the original checkpoint after a recovery attempt was interrupted', () => {
    storedInterruptedRecoveryCheckpoint();
    render();

    expect(host?.textContent).toContain('recovery attempt was itself interrupted');
    expect(host?.textContent).toContain('cannot start another recovery');
    expect(
      [...(host?.querySelectorAll('button') ?? [])].map((button) => button.textContent),
    ).toEqual(['Dismiss']);
  });

  it('shows the persisted interruption cause after reconnect or reload', () => {
    storedDisconnectedCncCheckpoint();
    render();

    expect(host?.textContent).toContain('Recorded cause:');
    expect(host?.textContent).toContain('USB connection was lost during the router job.');
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
