// The Place Board panel is always mounted beside the canvas. Closed, it must
// cost nothing while a job streams; its capture session must still survive a
// close, and a busy session must never be torn down by one.

import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { useUiStore } from '../../state/ui-store';
import { BoardCapturePanel } from './BoardCapturePanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalLaserState = useLaserStore.getState();
let host: HTMLDivElement | null = null;
let root: Root | null = null;
let commits = 0;

function idleAt(x: number, y: number): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x, y, z: 0 },
    wPos: null,
    feed: null,
    spindle: null,
    wco: null,
  };
}

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    [...(host?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === text) ??
    null
  );
}

async function renderPanel(open: boolean): Promise<void> {
  useUiStore.setState({ boardCapturePanelOpen: open });
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(
      <Profiler id="board" onRender={() => (commits += 1)}>
        <BoardCapturePanel />
      </Profiler>,
    );
  });
}

async function setPanelOpen(open: boolean): Promise<void> {
  await act(async () => {
    useUiStore.setState({ boardCapturePanelOpen: open });
    await Promise.resolve();
  });
}

async function pollStatus(count: number): Promise<void> {
  for (let sequence = 1; sequence <= count; sequence += 1) {
    await act(async () =>
      useLaserStore.setState({
        statusReport: idleAt(sequence, 0),
        statusSequence: sequence,
        pendingTransportWrites: sequence % 2,
      }),
    );
  }
}

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  commits = 0;
  useLaserStore.setState(originalLaserState, true);
  useUiStore.setState({ boardCapturePanelOpen: false });
  useStore.getState().newProject();
});

describe('BoardCapturePanel open gate', () => {
  it('does not render for controller traffic while closed', async () => {
    useLaserStore.setState({ connection: { kind: 'connected' } });
    await renderPanel(false);
    commits = 0;

    await pollStatus(6);

    expect(commits).toBe(0);
    expect(host?.textContent).toBe('');
  });

  it('stops rendering for controller traffic once closed', async () => {
    useLaserStore.setState({ connection: { kind: 'connected' } });
    await renderPanel(true);
    await setPanelOpen(false);
    commits = 0;

    await pollStatus(6);

    expect(commits).toBe(0);
  });

  it('resumes the capture session after a close and reopen', async () => {
    useLaserStore.setState({
      setOriginHere: vi.fn(async () => undefined),
      connection: { kind: 'connected' },
      wcoCache: null,
      statusReport: idleAt(10, 10),
    });
    await renderPanel(true);
    await act(async () => buttonByText('Capture corner')?.click());
    expect(host?.textContent).toContain('Corner 2 of 4');

    await setPanelOpen(false);
    expect(host?.textContent).toBe('');
    await setPanelOpen(true);

    expect(host?.textContent).toContain('Corner 2 of 4');
  });

  it('keeps a busy capture mounted through an external close', async () => {
    let resolveOrigin: () => void = () => undefined;
    const setOriginHere = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOrigin = resolve;
        }),
    );
    useLaserStore.setState({
      setOriginHere,
      connection: { kind: 'connected' },
      wcoCache: null,
      statusReport: idleAt(10, 10),
    });
    await renderPanel(true);
    await act(async () => buttonByText('Capture corner')?.click());
    expect(buttonByText('Circle')?.disabled).toBe(true);

    await setPanelOpen(false);

    expect(useUiStore.getState().boardCapturePanelOpen).toBe(true);
    // Still the same busy body, not a fresh one that would accept a second capture.
    expect(buttonByText('Circle')?.disabled).toBe(true);
    await act(async () => resolveOrigin());
    expect(setOriginHere).toHaveBeenCalledTimes(1);
    expect(host?.textContent).toContain('Corner 2 of 4');
  });
});
