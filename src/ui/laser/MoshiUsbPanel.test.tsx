// The Moshiboard USB panel (ADR-705) through its buttons, over the fake USB
// device and the scripted board: mounted only where the platform has the USB
// link and for the Moshi driver, Start only after a Frame, and the job it runs
// is the project's own programs.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoshiSimulator } from '../../__fixtures__/controllers/moshi-simulator';
import { createMoshiUsbSimulator } from '../../__fixtures__/controllers/moshi-usb-simulator';
import { DEFAULT_DEVICE_PROFILE, type ControllerKind } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import type { UsbLinkAdapter } from '../../platform/usb-link-types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetMoshiUsbStoreForTests } from '../state/moshi-usb/moshi-usb-store';
import { MoshiUsbPanel } from './MoshiUsbPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function moshiProject(controllerKind: ControllerKind = 'moshi'): Project {
  return {
    ...createProject(),
    // A Moshiboard homes rear-left, and its route refuses any other origin.
    device: { ...DEFAULT_DEVICE_PROFILE, controllerKind, origin: 'rear-left' },
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

function usbLinkFor(board: MoshiSimulator): UsbLinkAdapter {
  const usb = createMoshiUsbSimulator(board);
  return { request: async () => usb.session, reopen: async () => usb.session };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  resetMoshiUsbStoreForTests();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetMoshiUsbStoreForTests();
  vi.useRealTimers();
});

async function render(platform: Partial<PlatformAdapter>): Promise<void> {
  act(() =>
    root.render(
      <PlatformProvider adapter={platform as PlatformAdapter}>
        <MoshiUsbPanel />
      </PlatformProvider>,
    ),
  );
  // The panel body loads lazily, out of the boot bundle.
  await act(async () => {
    await import('../moshi-usb/MoshiUsbDetails');
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

describe('MoshiUsbPanel', () => {
  it('is absent without the USB link and for other controllers', async () => {
    useStore.setState({ project: moshiProject() });
    await render({});
    expect(host.textContent).toBe('');
    for (const kind of ['grbl-v1.1', 'ruida'] as const) {
      useStore.setState({ project: moshiProject(kind) });
      await render({ usbLink: usbLinkFor(new MoshiSimulator()) });
      expect(host.textContent).toBe('');
    }
  });

  it('frames first, then runs the project’s own programs', async () => {
    useStore.setState({
      project: moshiProject(),
      jobPlacement: { ...useStore.getState().jobPlacement, startFrom: 'absolute' },
    });
    const board = new MoshiSimulator();
    await render({ usbLink: usbLinkFor(board) });
    expect(host.textContent).toContain('not qualified on hardware');

    await click('Connect Moshiboard', 10);
    expect(host.textContent).toContain('Connected to the Moshiboard (CH341 chip version 48)');
    expect(button('Start').disabled).toBe(true);

    await click('Frame', 10);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(host.textContent).toContain('Frame finished');
    expect(board.runs[0]?.program.steps.every((step) => !step.cut)).toBe(true);

    await click('Start', 10);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(host.textContent).toContain('Job finished');
    expect(board.cuts()).toHaveLength(1);
  });
});
