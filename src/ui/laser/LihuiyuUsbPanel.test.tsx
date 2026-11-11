// The K40 USB panel (ADR-703) through its buttons, against the simulated board
// behind ADR-702's fake USB device: mounted only where the platform has a USB
// link and the profile's driver lists the Lihuiyu link; Start only after Home
// and a Frame; the job it runs burns the project's square.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LihuiyuSimulator } from '../../__fixtures__/controllers/lihuiyu-simulator';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { K40_M2_NANO_PROFILE } from '../../core/devices/lihuiyu-profiles';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import type { UsbLinkAdapter } from '../../platform/usb-link-types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetLihuiyuUsbStoreForTests } from '../state/lihuiyu-usb/lihuiyu-usb-store';
import { LihuiyuUsbPanel } from './LihuiyuUsbPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function squareProject(device = K40_M2_NANO_PROFILE): Project {
  return {
    ...createProject(),
    device,
    scene: {
      layers: [{ ...createLayer({ id: '#000000', color: '#000000', mode: 'line' }), power: 100 }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'square',
          source: 'square.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                    { x: 0, y: 10 },
                    { x: 0, y: 0 },
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

function usbLinkTo(simulator: LihuiyuSimulator): UsbLinkAdapter {
  const device = simulator.fakeDevice();
  return { request: async () => device.session, reopen: async () => null };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  resetLihuiyuUsbStoreForTests();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetLihuiyuUsbStoreForTests();
});

const settle = (): Promise<void> =>
  act(async () => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function render(platform: Partial<PlatformAdapter>): Promise<void> {
  act(() =>
    root.render(
      <PlatformProvider adapter={platform as PlatformAdapter}>
        <LihuiyuUsbPanel />
      </PlatformProvider>,
    ),
  );
  // The panel body loads lazily, out of the boot bundle.
  await act(async () => {
    await import('../lihuiyu-usb/LihuiyuUsbDetails');
  });
  await settle();
}

function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith(name));
  if (found === undefined) throw new Error(`no ${name} button`);
  return found;
}

async function click(name: string): Promise<void> {
  act(() => button(name).click());
  await settle();
}

describe('LihuiyuUsbPanel', () => {
  it('is absent without a USB link and for a controller without the Lihuiyu link', async () => {
    useStore.setState({ project: squareProject() });
    await render({});
    expect(host.textContent).toBe('');
    useStore.setState({ project: squareProject({ ...DEFAULT_DEVICE_PROFILE }) });
    await render({ usbLink: usbLinkTo(new LihuiyuSimulator()) });
    expect(host.textContent).toBe('');
  });

  it('connects, homes, frames with the laser off, then burns the square', async () => {
    useStore.setState({ project: squareProject() });
    const simulator = new LihuiyuSimulator();
    await render({ usbLink: usbLinkTo(simulator) });
    expect(host.textContent).toContain('NOT qualified on hardware');

    await click('Connect K40');
    expect(host.textContent).toContain('Connected to USB2.0-Print (simulated)');
    expect(button('Start').disabled).toBe(true);

    await click('Home');
    await click('Frame');
    expect(host.textContent).toContain('Frame finished');
    simulator.drain();
    expect(simulator.decoder.moves.every((move) => !move.laser)).toBe(true);

    await click('Start');
    simulator.drain();
    expect(host.textContent).toContain('Job finished');
    expect(simulator.decoder.burns()).toHaveLength(4);
  });
});
