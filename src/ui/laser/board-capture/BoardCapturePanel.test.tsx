import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findRegistrationBoxes } from '../../../core/scene';
import type { StatusReport } from '../../../core/controllers/grbl';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { useUiStore } from '../../state/ui-store';
import { BoardCapturePanel } from './BoardCapturePanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalSetOriginHere = useLaserStore.getState().setOriginHere;

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

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | null {
  return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;
}

async function setMachinePosition(x: number, y: number): Promise<void> {
  await act(async () => {
    useLaserStore.setState({ statusReport: idleAt(x, y) });
  });
}

async function render(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  useUiStore.setState({ boardCapturePanelOpen: true });
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<BoardCapturePanel />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  useLaserStore.setState({
    setOriginHere: originalSetOriginHere,
    connection: { kind: 'disconnected' },
    statusReport: null,
    wcoCache: null,
  });
  useUiStore.setState({ boardCapturePanelOpen: false });
  useStore.getState().newProject();
});

describe('BoardCapturePanel', () => {
  it('renders nothing until the toolbar opens it', async () => {
    useUiStore.setState({ boardCapturePanelOpen: false });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(<BoardCapturePanel />);
    });
    expect(host.textContent).toBe('');
    await act(async () => root?.unmount());
    host.remove();
  });

  it('disables capture and hints to connect when disconnected', async () => {
    useLaserStore.setState({ connection: { kind: 'disconnected' } });
    const { host, unmount } = await render();
    expect(host.textContent).toContain('Connect the machine to capture a board');
    expect(buttonByText(host, 'Capture corner')?.disabled).toBe(true);
    await unmount();
  });

  it('captures four corners, sets the origin once, and creates the measured board', async () => {
    const setOriginHere = vi.fn(async () => undefined);
    useLaserStore.setState({ setOriginHere, connection: { kind: 'connected' }, wcoCache: null });
    const { host, unmount } = await render();

    // A 100 × 60 board: bottom-left, bottom-right, top-right, top-left.
    const corners: ReadonlyArray<readonly [number, number]> = [
      [10, 10],
      [110, 10],
      [110, 70],
      [10, 70],
    ];
    for (const [x, y] of corners) {
      await setMachinePosition(x, y);
      const capture = buttonByText(host, 'Capture corner');
      if (capture === null) throw new Error('capture button missing');
      await act(async () => {
        capture.click();
      });
    }

    // Origin was set exactly once — at the bottom-left corner.
    expect(setOriginHere).toHaveBeenCalledTimes(1);

    const create = buttonByText(host, 'Create board outline');
    if (create === null) throw new Error('create button missing after 4 corners');
    await act(async () => {
      create.click();
    });

    const box = findRegistrationBoxes(useStore.getState().project.scene)[0];
    expect(box?.spec).toMatchObject({ kind: 'rect', widthMm: 100, heightMm: 60 });
    expect(useStore.getState().jobPlacement).toEqual({
      startFrom: 'user-origin',
      anchor: 'front-left',
    });
    // Placement controls appear once committed, showing the measured size.
    expect(host.textContent).toContain('Measured: 100.0 × 60.0 mm');

    await unmount();
  });

  it('undoes the last captured corner', async () => {
    useLaserStore.setState({
      setOriginHere: vi.fn(async () => undefined),
      connection: { kind: 'connected' },
      wcoCache: null,
    });
    const { host, unmount } = await render();

    await setMachinePosition(10, 10);
    await act(async () => buttonByText(host, 'Capture corner')?.click());
    expect(host.textContent).toContain('Corner 2 of 4');

    await act(async () => buttonByText(host, 'Undo last')?.click());
    expect(host.textContent).toContain('Corner 1 of 4');

    await unmount();
  });

  it('ignores a rapid double-click on the first corner (one origin write, one corner)', async () => {
    let resolveOrigin: () => void = () => undefined;
    const setOriginHere = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOrigin = resolve;
        }),
    );
    useLaserStore.setState({ setOriginHere, connection: { kind: 'connected' }, wcoCache: null });
    const { host, unmount } = await render();
    await setMachinePosition(10, 10);

    // Both clicks land before the async origin write resolves.
    await act(async () => {
      const btn = buttonByText(host, 'Capture corner');
      btn?.click();
      btn?.click();
    });
    await act(async () => {
      resolveOrigin();
    });

    expect(setOriginHere).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Corner 2 of 4'); // exactly one corner recorded
    await unmount();
  });

  it('blocks committing a board that is too small to be real', async () => {
    useLaserStore.setState({
      setOriginHere: vi.fn(async () => undefined),
      connection: { kind: 'connected' },
      wcoCache: null,
    });
    const { host, unmount } = await render();

    // Distinct corners (not deduped) but only a 2 × 2 mm extent.
    const corners: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ];
    for (const [x, y] of corners) {
      await setMachinePosition(x, y);
      await act(async () => buttonByText(host, 'Capture corner')?.click());
    }

    expect(host.textContent).toContain('too small to be a board');
    expect(buttonByText(host, 'Create board outline')?.disabled).toBe(true);
    await unmount();
  });
});
