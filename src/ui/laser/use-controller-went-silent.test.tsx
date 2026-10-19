import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useControllerWentSilent } from './use-controller-went-silent';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function Probe(props: { readonly connected: boolean }): JSX.Element {
  return <span>{useControllerWentSilent(props.connected) ? 'silent' : 'answering'}</span>;
}

async function render(connected: boolean): Promise<HTMLDivElement> {
  host ??= document.body.appendChild(document.createElement('div'));
  root ??= createRoot(host);
  await act(async () => root?.render(<Probe connected={connected} />));
  return host;
}

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState({
    ...initialLaserState(),
    capabilities: grblDriver.capabilities,
    connection: { kind: 'connected' },
    controllerSessionEpoch: 2,
    statusObservation: { sessionEpoch: 2, positionEpoch: 0, sequence: 1, observedAt: Date.now() },
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  useLaserStore.setState(initialLaserState());
});

describe('useControllerWentSilent', () => {
  it('turns silent on its own timer when nothing writes to the store (ADR-611 A1)', async () => {
    const view = await render(true);
    expect(view.textContent).toBe('answering');
    // A wedged status write: no poll reaches the store, only time passes.
    await act(async () => vi.advanceTimersByTime(7_000));
    expect(view.textContent).toBe('answering');
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(view.textContent).toBe('silent');
  });

  it('clears with the next reply and stays quiet while disconnected', async () => {
    const view = await render(true);
    await act(async () => vi.advanceTimersByTime(9_000));
    expect(view.textContent).toBe('silent');
    await act(async () =>
      useLaserStore.setState({
        statusObservation: {
          sessionEpoch: 2,
          positionEpoch: 0,
          sequence: 2,
          observedAt: Date.now(),
        },
      }),
    );
    expect(view.textContent).toBe('answering');
    await render(false);
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(view.textContent).toBe('answering');
  });
});
