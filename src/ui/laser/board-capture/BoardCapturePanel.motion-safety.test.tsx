import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { findRegistrationBoxes } from '../../../core/scene';
import { useStore } from '../../state';
import { startMotionOperation } from '../../state/laser-motion-operation';
import { useLaserStore } from '../../state/laser-store';
import { useUiStore } from '../../state/ui-store';
import { BoardCapturePanel } from './BoardCapturePanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalLaserState = useLaserStore.getState();
const mountedPanels = new Set<() => Promise<void>>();

describe('BoardCapturePanel motion safety', () => {
  it('rejects an external close while a center move is still in flight', async () => {
    const cancelJog = vi.fn(async () => useLaserStore.setState({ motionOperation: null }));
    prepareCenterMove(cancelJog);
    const { host, unmount } = await renderPanel();

    await captureRimCircle(host);
    await clickButton(host, 'Move to calculated center');
    expect(buttonByText(host, 'Start over')?.disabled).toBe(true);
    expect(closeButton(host)?.disabled).toBe(true);

    await act(async () => {
      useUiStore.setState({ boardCapturePanelOpen: false });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useUiStore.getState().boardCapturePanelOpen).toBe(true);
    expect(cancelJog).not.toHaveBeenCalled();
    await unmount();
  });

  it('offers a causal center-move cancel when the controller supports it', async () => {
    const cancelJog = vi.fn(async () => useLaserStore.setState({ motionOperation: null }));
    prepareCenterMove(cancelJog);
    const { host, unmount } = await renderPanel();

    await captureRimCircle(host);
    await clickButton(host, 'Move to calculated center');
    await clickButton(host, 'Cancel center move');

    expect(cancelJog).toHaveBeenCalledOnce();
    expect(buttonByText(host, 'Move to calculated center')).not.toBeNull();
    await unmount();
  });

  it('keeps a non-cancellable center move visible until the controller reaches Idle', async () => {
    const cancelJog = vi.fn(async () => undefined);
    prepareCenterMove(cancelJog, false);
    const { host, unmount } = await renderPanel();

    await captureRimCircle(host);
    await clickButton(host, 'Move to calculated center');
    expect(buttonByText(host, 'Cancel center move')).toBeNull();
    expect(host.textContent).toContain('cannot stop a dispatched point move');

    await act(async () => {
      useUiStore.setState({ boardCapturePanelOpen: false });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useUiStore.getState().boardCapturePanelOpen).toBe(true);
    expect(cancelJog).not.toHaveBeenCalled();
    await unmount();
  });

  it('cannot dismiss an origin-writing board correction while it is saving', async () => {
    const correctionOrigin = deferred<undefined>();
    let originCalls = 0;
    const setOriginHere = vi.fn(() => {
      originCalls += 1;
      return originCalls === 1 ? Promise.resolve() : correctionOrigin.promise;
    });
    useLaserStore.setState({
      setOriginHere,
      jogToMachinePosition: vi.fn(async () => undefined),
      connection: { kind: 'connected' },
      wcoCache: null,
    });
    const { host, unmount } = await renderPanel();

    await setMachinePosition(50, 30);
    await clickButton(host, 'Capture corner');
    await setManualSize(host, 120, 80);
    await clickButton(host, 'Draw board at this size');
    await clickVerificationButton(host, 'Btm-left');
    await advanceIdlePosition(52, 32);
    await clickButton(host, 'No, adjust it');
    await clickButton(host, 'Use current head position & update board');

    expect(host.textContent).toContain('Saving the corrected bottom-left corner');
    expect(buttonByText(host, 'Cancel check')).toBeNull();
    expect(closeButton(host)?.disabled).toBe(true);
    await act(async () => {
      useUiStore.setState({ boardCapturePanelOpen: false });
      await Promise.resolve();
    });
    expect(useUiStore.getState().boardCapturePanelOpen).toBe(true);

    await act(async () => {
      correctionOrigin.resolve(undefined);
      await correctionOrigin.promise;
      await Promise.resolve();
    });
    expect(setOriginHere).toHaveBeenCalledTimes(2);
    expect(findRegistrationBoxes(useStore.getState().project.scene)[0]?.spec).toMatchObject({
      kind: 'rect',
      widthMm: 120,
      heightMm: 80,
    });
    await unmount();
  });

  it('shows a locked saving state while the circle work origin is written', async () => {
    const circleOrigin = deferred<undefined>();
    useLaserStore.setState({
      setOriginHere: vi.fn(() => circleOrigin.promise),
      jogToMachinePosition: vi.fn(async () => undefined),
      connection: { kind: 'connected' },
      wcoCache: null,
    });
    const { host, unmount } = await renderPanel();

    await captureRimCircle(host);
    await clickButton(host, 'Move to calculated center');
    await advanceIdlePosition(100, 100);
    await clickButton(host, 'Use current head position as center');

    expect(host.textContent).toContain('Saving circle center and work origin');
    expect(buttonByText(host, 'Cancel center move')).toBeNull();
    expect(closeButton(host)?.disabled).toBe(true);
    await act(async () => {
      useUiStore.setState({ boardCapturePanelOpen: false });
      await Promise.resolve();
    });
    expect(useUiStore.getState().boardCapturePanelOpen).toBe(true);

    await act(async () => {
      circleOrigin.resolve(undefined);
      await circleOrigin.promise;
      await Promise.resolve();
    });
    expect(findRegistrationBoxes(useStore.getState().project.scene)[0]?.spec.kind).toBe('ellipse');
    await unmount();
  });
});

afterEach(async () => {
  for (const unmount of [...mountedPanels]) await unmount();
  useLaserStore.setState(originalLaserState, true);
  useUiStore.setState({ boardCapturePanelOpen: false });
  useStore.getState().newProject();
  vi.restoreAllMocks();
});

function prepareCenterMove(cancelJog: () => Promise<void>, canCancel = true): void {
  useLaserStore.setState((state) => ({
    setOriginHere: vi.fn(async () => undefined),
    jogToMachinePosition: vi.fn(() => {
      useLaserStore.setState({ motionOperation: startMotionOperation('jog') });
      return new Promise<void>(() => undefined);
    }),
    cancelJog,
    capabilities: { ...state.capabilities, jogCancel: canCancel },
    connection: { kind: 'connected' },
    wcoCache: null,
  }));
}

async function captureRimCircle(host: HTMLElement): Promise<void> {
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
}

async function setManualSize(host: HTMLElement, width: number, height: number): Promise<void> {
  await act(async () => {
    setNumberInput(host, 'Board width in mm', String(width));
    setNumberInput(host, 'Board height in mm', String(height));
  });
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === text) ??
    null
  );
}

function closeButton(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector('[aria-label="Close board capture panel"]');
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
  const section = host.querySelector<HTMLElement>('section[aria-label="Physically check board"]');
  const button = section === null ? null : buttonByText(section, text);
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
  await act(async () => useLaserStore.setState({ statusReport: idleAt(x, y) }));
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
  const unmount = async (): Promise<void> => {
    if (root === null) return;
    await act(async () => root?.unmount());
    root = null;
    host.remove();
    mountedPanels.delete(unmount);
  };
  mountedPanels.add(unmount);
  return { host, unmount };
}

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

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
