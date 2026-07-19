import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { findRegistrationBoxes } from '../../../core/scene';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { useUiStore } from '../../state/ui-store';
import { BoardCapturePanel } from './BoardCapturePanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalSetOriginHere = useLaserStore.getState().setOriginHere;
const originalJogToMachinePosition = useLaserStore.getState().jogToMachinePosition;
const originalControllerSessionEpoch = useLaserStore.getState().controllerSessionEpoch;
const originalTrustedPositionEpoch = useLaserStore.getState().trustedPositionEpoch ?? 0;
const originalStatusSequence = useLaserStore.getState().statusSequence;
const originalWorkOriginVersion = useLaserStore.getState().workOriginVersion ?? 0;
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
  return (
    [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === text) ??
    null
  );
}

function verificationButton(host: HTMLElement, text: string): HTMLButtonElement | null {
  const section = host.querySelector<HTMLElement>('section[aria-label="Physically check board"]');
  return section === null ? null : buttonByText(section, text);
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

async function clickVerificationButton(host: HTMLElement, text: string): Promise<void> {
  const button = verificationButton(host, text);
  if (button === null) throw new Error(`verification button "${text}" missing`);
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setNumberInput(host: HTMLElement, label: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (input === null) throw new Error(`input "${label}" missing`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function setMachinePosition(x: number, y: number): Promise<void> {
  await act(async () => {
    useLaserStore.setState({ statusReport: idleAt(x, y) });
  });
}

async function advanceIdlePosition(x: number, y: number): Promise<void> {
  await act(async () => {
    useLaserStore.setState((state) => ({
      statusReport: idleAt(x, y),
      statusSequence: state.statusSequence + 1,
      motionOperation: null,
      controllerOperation: null,
    }));
    await Promise.resolve();
  });
}

async function renderPanel(): Promise<{
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
  return { host, unmount };
}

afterEach(async () => {
  for (const unmount of [...mountedPanels]) await unmount();
  useLaserStore.setState({
    setOriginHere: originalSetOriginHere,
    jogToMachinePosition: originalJogToMachinePosition,
    connection: { kind: 'disconnected' },
    statusReport: null,
    statusSequence: originalStatusSequence,
    controllerSessionEpoch: originalControllerSessionEpoch,
    trustedPositionEpoch: originalTrustedPositionEpoch,
    workOriginVersion: originalWorkOriginVersion,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    autofocusBusy: false,
    probeBusy: false,
    fireActive: false,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    mpgActive: null,
    wcoCache: null,
  });
  useUiStore.setState({ boardCapturePanelOpen: false });
  useStore.getState().newProject();
});

describe('BoardCapturePanel physical verification', () => {
  it('finds a circle center from four rim points before writing the origin', async () => {
    const setOriginHere = vi.fn(async () => undefined);
    const jogToMachinePosition = vi.fn(async () => undefined);
    useLaserStore.setState({
      setOriginHere,
      jogToMachinePosition,
      connection: { kind: 'connected' },
      wcoCache: null,
    });
    const { host, unmount } = await renderPanel();

    await clickButton(host, 'Circle');
    const rimPoints: ReadonlyArray<readonly [number, number]> = [
      [100, 50],
      [150, 100],
      [100, 150],
      [50, 100],
    ];
    for (const [x, y] of rimPoints) {
      await setMachinePosition(x, y);
      await clickButton(host, 'Capture rim point');
    }

    expect(setOriginHere).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Calculated:');
    await clickButton(host, 'Move to calculated center');
    expect(jogToMachinePosition).toHaveBeenCalledWith(100, 100, expect.any(Number));

    await advanceIdlePosition(100, 100);
    await clickButton(host, 'Use current head position as center');

    const box = findRegistrationBoxes(useStore.getState().project.scene)[0];
    expect(box?.spec).toMatchObject({ kind: 'ellipse', widthMm: 100, heightMm: 100 });
    expect(setOriginHere).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('rejects a fitted circle that is too small before moving or changing origin', async () => {
    const setOriginHere = vi.fn(async () => undefined);
    const jogToMachinePosition = vi.fn(async () => undefined);
    useLaserStore.setState({
      setOriginHere,
      jogToMachinePosition,
      connection: { kind: 'connected' },
      wcoCache: null,
    });
    const { host, unmount } = await renderPanel();

    await clickButton(host, 'Circle');
    for (const [x, y] of [
      [100, 99],
      [101, 100],
      [100, 101],
      [99, 100],
    ] as const) {
      await setMachinePosition(x, y);
      await clickButton(host, 'Capture rim point');
    }

    expect(host.textContent).toContain('circle is too small');
    expect(buttonByText(host, 'Move to calculated center')?.disabled).toBe(true);
    expect(jogToMachinePosition).not.toHaveBeenCalled();
    expect(setOriginHere).not.toHaveBeenCalled();
    await unmount();
  });

  it('blocks a calculated-center move after the captured coordinate epoch changes', async () => {
    const jogToMachinePosition = vi.fn(async () => undefined);
    useLaserStore.setState({
      setOriginHere: vi.fn(async () => undefined),
      jogToMachinePosition,
      connection: { kind: 'connected' },
      wcoCache: null,
    });
    const { host, unmount } = await renderPanel();

    await clickButton(host, 'Circle');
    for (const [x, y] of [
      [100, 50],
      [150, 100],
      [100, 150],
      [50, 100],
    ] as const) {
      await setMachinePosition(x, y);
      await clickButton(host, 'Capture rim point');
    }
    await act(async () => {
      useLaserStore.setState((state) => ({
        workOriginVersion: (state.workOriginVersion ?? 0) + 1,
      }));
    });
    await clickButton(host, 'Move to calculated center');

    expect(jogToMachinePosition).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Machine coordinates changed during circle capture');
    await unmount();
  });

  it('updates a rectangle from a confirmed top-right corner without rewriting origin', async () => {
    const setOriginHere = vi.fn(async () => undefined);
    const jogToMachinePosition = vi.fn(async () => undefined);
    useLaserStore.setState({
      setOriginHere,
      jogToMachinePosition,
      connection: { kind: 'connected' },
      wcoCache: null,
    });
    const { host, unmount } = await renderPanel();

    await setMachinePosition(50, 30);
    await clickButton(host, 'Capture corner');
    await act(async () => {
      setNumberInput(host, 'Board width in mm', '120');
      setNumberInput(host, 'Board height in mm', '80');
    });
    await clickButton(host, 'Draw board at this size');
    expect(setOriginHere).toHaveBeenCalledTimes(1);

    await clickVerificationButton(host, 'Top-right');
    expect(jogToMachinePosition).toHaveBeenCalledWith(170, 110, expect.any(Number));
    await advanceIdlePosition(175, 115);
    await clickButton(host, 'No, adjust it');
    await clickButton(host, 'Use current head position & update board');

    const box = findRegistrationBoxes(useStore.getState().project.scene)[0];
    expect(box?.spec).toMatchObject({ kind: 'rect', widthMm: 125, heightMm: 85 });
    expect(setOriginHere).toHaveBeenCalledTimes(1);

    await act(async () => useStore.getState().undo());
    expect(findRegistrationBoxes(useStore.getState().project.scene)[0]?.spec).toMatchObject({
      kind: 'rect',
      widthMm: 120,
      heightMm: 80,
    });
    expect(host.textContent).toContain('board outline or machine coordinates changed');
    expect(verificationButton(host, 'Top-right')?.disabled).toBe(true);
    await unmount();
  });

  it('updates a circle diameter from a confirmed right rim without rewriting origin', async () => {
    const setOriginHere = vi.fn(async () => undefined);
    const jogToMachinePosition = vi.fn(async () => undefined);
    useLaserStore.setState({
      setOriginHere,
      jogToMachinePosition,
      connection: { kind: 'connected' },
      wcoCache: null,
    });
    const { host, unmount } = await renderPanel();

    await clickButton(host, 'Circle');
    await clickButton(host, 'Center already marked');
    await setMachinePosition(100, 100);
    await clickButton(host, 'Capture center');
    await act(async () => setNumberInput(host, 'Circle diameter in mm', '100'));
    await clickButton(host, 'Create board outline');
    expect(setOriginHere).toHaveBeenCalledTimes(1);

    await clickVerificationButton(host, 'Right rim');
    expect(jogToMachinePosition).toHaveBeenCalledWith(150, 100, expect.any(Number));
    await advanceIdlePosition(160, 100);
    await clickButton(host, 'No, adjust it');
    await clickButton(host, 'Use current head position & update board');

    const box = findRegistrationBoxes(useStore.getState().project.scene)[0];
    expect(box?.spec).toMatchObject({ kind: 'ellipse', widthMm: 120, heightMm: 120 });
    expect(setOriginHere).toHaveBeenCalledTimes(1);
    await unmount();
  });
});
