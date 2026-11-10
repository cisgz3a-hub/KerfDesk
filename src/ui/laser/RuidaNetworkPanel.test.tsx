// The Ruida network panel (ADR-697) through its buttons, against the scripted
// simulator: mounted only on the desktop for a driver with a datagram link,
// Start only after a Frame, and the job it sends is the project's .rd bytes.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { decodeRdStream } from '../../__fixtures__/controllers/ruida-decoder';
import {
  RuidaUdpSimulator,
  simulatedRuidaNetwork,
} from '../../__fixtures__/controllers/ruida-udp-simulator';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { prepareRuidaNetworkJob } from '../state/ruida-network/ruida-network-job';
import { resetRuidaNetworkStoreForTests } from '../state/ruida-network/ruida-network-store';
import { RuidaNetworkPanel } from './RuidaNetworkPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function ruidaProject(controllerKind: 'ruida' | 'grbl-v1.1' = 'ruida'): Project {
  return {
    ...createProject(),
    device: { ...DEFAULT_DEVICE_PROFILE, controllerKind },
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line-1',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as Project;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  resetRuidaNetworkStoreForTests();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetRuidaNetworkStoreForTests();
  vi.useRealTimers();
});

async function render(platform: Partial<PlatformAdapter>): Promise<void> {
  act(() =>
    root.render(
      <PlatformProvider adapter={platform as PlatformAdapter}>
        <RuidaNetworkPanel />
      </PlatformProvider>,
    ),
  );
  // The panel body loads lazily, out of the boot bundle.
  await act(async () => {
    await import('../ruida-network/RuidaNetworkDetails');
    await vi.advanceTimersByTimeAsync(0);
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith(name));
  if (found === undefined) throw new Error(`no ${name} button`);
  return found;
}

async function click(name: string, ms = 0): Promise<void> {
  await act(async () => {
    button(name).click();
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('RuidaNetworkPanel', () => {
  it('is absent in the browser and for a serial controller', async () => {
    useStore.setState({ project: ruidaProject() });
    await render({});
    expect(host.textContent).toBe('');
    useStore.setState({ project: ruidaProject('grbl-v1.1') });
    await render({ ruidaNetwork: simulatedRuidaNetwork(new RuidaUdpSimulator()) });
    expect(host.textContent).toBe('');
  });

  it('frames first, then starts the project’s own .rd bytes', async () => {
    const project = ruidaProject();
    useStore.setState({ project });
    const sim = new RuidaUdpSimulator();
    await render({ ruidaNetwork: simulatedRuidaNetwork(sim) });
    expect(host.textContent).toContain('not been qualified on a real controller');

    const input = host.querySelector('input');
    if (input === null) throw new Error('no address input');
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, '192.168.1.100');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('Connect Ruida', 10);
    expect(host.textContent).toContain('Connected to the Ruida controller at 192.168.1.100');
    expect(button('Start').disabled).toBe(true);

    await click('Frame', 10);
    await act(() => vi.advanceTimersByTimeAsync(400 * 8));
    expect(host.textContent).toContain('Frame finished');
    expect(button('Start').disabled).toBe(false);

    await click('Start', 10);
    // The bytes Save .rd would write for the same placement.
    const expected = await prepareRuidaNetworkJob(project, useStore.getState().jobPlacement);
    if (!expected.ok) throw new Error('no .rd');
    expect(sim.files[1]).toEqual(decodeRdStream(expected.job.bytes));
    expect(sim.files[1]?.filter((event) => event.kind === 'cut')).toHaveLength(1);
    expect(button('Abort').disabled).toBe(false);
  });
});
