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
const mountedPanels = new Set<() => Promise<void>>();

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

async function clickButton(host: HTMLElement, text: string): Promise<void> {
  const button = buttonByText(host, text);
  if (button === null) throw new Error(`button "${text}" missing`);
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// Set a controlled <input> value the way React's onChange listens for it.
function setNumberInput(host: HTMLElement, label: string, value: string): void {
  const el = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (el === null) throw new Error(`input "${label}" missing`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
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
  let mounted = true;
  const unmount = async (): Promise<void> => {
    if (!mounted) return;
    mounted = false;
    if (root !== null) await act(async () => root?.unmount());
    host.remove();
    mountedPanels.delete(unmount);
  };
  mountedPanels.add(unmount);
  return {
    host,
    unmount,
  };
}

afterEach(async () => {
  for (const unmount of [...mountedPanels]) await unmount();
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
    expect(buttonByText(host, 'Circle')?.disabled).toBe(true);
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

  it('draws the board from the first corner + typed size (manual path)', async () => {
    useLaserStore.setState({
      setOriginHere: vi.fn(async () => undefined),
      connection: { kind: 'connected' },
      wcoCache: null,
    });
    const { host, unmount } = await render();

    // Capture only the bottom-left corner (sets the origin).
    await setMachinePosition(50, 30);
    await act(async () => buttonByText(host, 'Capture corner')?.click());

    // The Draw button is gated until both dimensions are valid.
    expect(buttonByText(host, 'Draw board at this size')?.disabled).toBe(true);
    await act(async () => {
      setNumberInput(host, 'Board width in mm', '120');
      setNumberInput(host, 'Board height in mm', '80');
    });
    const draw = buttonByText(host, 'Draw board at this size');
    expect(draw?.disabled).toBe(false);
    await act(async () => draw?.click());

    const box = findRegistrationBoxes(useStore.getState().project.scene)[0];
    expect(box?.spec).toMatchObject({ kind: 'rect', widthMm: 120, heightMm: 80 });
    expect(useStore.getState().jobPlacement).toEqual({
      startFrom: 'user-origin',
      anchor: 'front-left',
    });
    // Committed phase, with the typed size echoed for a ruler check.
    expect(host.textContent).toContain('Measured: 120.0 × 80.0 mm');
    await unmount();
  });

  it('captures a circle from the centre + typed diameter, centre-anchored', async () => {
    const setOriginHere = vi.fn(async () => undefined);
    useLaserStore.setState({ setOriginHere, connection: { kind: 'connected' }, wcoCache: null });
    const { host, unmount } = await render();

    await act(async () => buttonByText(host, 'Circle')?.click());
    await clickButton(host, 'Center already marked');
    await setMachinePosition(100, 100); // the centre
    await clickButton(host, 'Capture center');
    expect(setOriginHere).toHaveBeenCalledTimes(1);

    await act(async () => setNumberInput(host, 'Circle diameter in mm', '90'));
    const create = buttonByText(host, 'Create board outline');
    expect(create?.disabled).toBe(false);
    await act(async () => create?.click());

    const box = findRegistrationBoxes(useStore.getState().project.scene)[0];
    expect(box?.spec).toMatchObject({ kind: 'ellipse', widthMm: 90, heightMm: 90 });
    expect(box?.locked).toBe(true);
    expect(useStore.getState().jobPlacement).toEqual({
      startFrom: 'user-origin',
      anchor: 'center',
    });
    expect(host.textContent).toContain('Measured: ⌀ 90.0 mm');
    await unmount();
  });

  it('measures a circle diameter by jogging to a rim point', async () => {
    useLaserStore.setState({
      setOriginHere: vi.fn(async () => undefined),
      connection: { kind: 'connected' },
      wcoCache: null,
    });
    const { host, unmount } = await render();

    await act(async () => buttonByText(host, 'Circle')?.click());
    await clickButton(host, 'Center already marked');
    await setMachinePosition(100, 100); // centre
    await clickButton(host, 'Capture center');
    await setMachinePosition(145, 100); // rim: 45 mm out -> diameter 90
    await act(async () => buttonByText(host, 'Capture edge')?.click());

    const create = buttonByText(host, 'Create board outline');
    expect(create?.disabled).toBe(false); // measured diameter pre-fills the field
    await act(async () => create?.click());

    const box = findRegistrationBoxes(useStore.getState().project.scene)[0];
    expect(box?.spec).toMatchObject({ kind: 'ellipse', widthMm: 90, heightMm: 90 });
    await unmount();
  });

  it('lets a fresh rim measurement override a diameter that was typed first', async () => {
    useLaserStore.setState({
      setOriginHere: vi.fn(async () => undefined),
      connection: { kind: 'connected' },
      wcoCache: null,
    });
    const { host, unmount } = await render();

    await act(async () => buttonByText(host, 'Circle')?.click());
    await clickButton(host, 'Center already marked');
    await setMachinePosition(100, 100);
    await clickButton(host, 'Capture center');
    // Type a rough diameter FIRST...
    await act(async () => setNumberInput(host, 'Circle diameter in mm', '90'));
    // ...then measure a precise one (60 mm out -> diameter 120). It must win.
    await setMachinePosition(160, 100);
    await act(async () => buttonByText(host, 'Capture edge')?.click());

    await act(async () => buttonByText(host, 'Create board outline')?.click());
    const box = findRegistrationBoxes(useStore.getState().project.scene)[0];
    expect(box?.spec).toMatchObject({ kind: 'ellipse', widthMm: 120, heightMm: 120 });
    await unmount();
  });

  it('removes a placed rectangle board and returns to the capture phase', async () => {
    useLaserStore.setState({
      setOriginHere: vi.fn(async () => undefined),
      connection: { kind: 'connected' },
      wcoCache: null,
    });
    const { host, unmount } = await render();

    // Place a board via the manual path (capture bottom-left + type the size).
    await setMachinePosition(50, 30);
    await act(async () => buttonByText(host, 'Capture corner')?.click());
    await act(async () => {
      setNumberInput(host, 'Board width in mm', '120');
      setNumberInput(host, 'Board height in mm', '80');
    });
    await act(async () => buttonByText(host, 'Draw board at this size')?.click());
    expect(findRegistrationBoxes(useStore.getState().project.scene)).toHaveLength(1);

    await act(async () => buttonByText(host, 'Remove board')?.click());
    expect(findRegistrationBoxes(useStore.getState().project.scene)).toHaveLength(0);
    expect(host.textContent).toContain('Corner 1 of 4'); // back to the capture phase
    await unmount();
  });

  it('removes a placed circle board', async () => {
    useLaserStore.setState({
      setOriginHere: vi.fn(async () => undefined),
      connection: { kind: 'connected' },
      wcoCache: null,
    });
    const { host, unmount } = await render();

    await act(async () => buttonByText(host, 'Circle')?.click());
    await clickButton(host, 'Center already marked');
    await setMachinePosition(100, 100);
    await clickButton(host, 'Capture center');
    await act(async () => setNumberInput(host, 'Circle diameter in mm', '90'));
    await act(async () => buttonByText(host, 'Create board outline')?.click());
    expect(findRegistrationBoxes(useStore.getState().project.scene)).toHaveLength(1);

    await act(async () => buttonByText(host, 'Remove board')?.click());
    expect(findRegistrationBoxes(useStore.getState().project.scene)).toHaveLength(0);
    await unmount();
  });
});
