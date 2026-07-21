// Catalog-facing wizard behavior: the six-step shell, the always-visible
// searchable profile catalog, and verbatim profile application (ADR-239).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { FileOpenRequest, FileSaveRequest, PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { DeviceSetupWizard } from './DeviceSetupWizard';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    detectedSettings: null,
    detectedControllerKind: null,
    activeControllerKind: 'grbl-v1.1',
    statusReport: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('DeviceSetupWizard catalog', () => {
  it('opens with the machine-type choice and shows one six-step setup sequence', async () => {
    const view = await renderWizard();
    try {
      expect(view.host.textContent).toContain('Step 1 of 6 — Machine type');
      expect(view.host.textContent).toContain('What kind of machine is this?');
      expect(view.host.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
      expect(
        view.host.querySelectorAll('nav[aria-label="Machine Setup steps"] button'),
      ).toHaveLength(6);
      await act(async () => button(view.host, 'Next').click());
      expect(view.host.textContent).toContain('Step 2 of 6 — Choose your machine');
      // The catalog is always visible — no collapsed section hides it (ADR-239).
      expect(view.host.textContent).toContain('Use Creality Falcon A1 Pro (grblHAL)');
      expect(view.host.querySelector('input[aria-label="Search machine profiles"]')).toBeInstanceOf(
        HTMLInputElement,
      );
      expect(view.host.textContent).not.toContain('ready to cut');
    } finally {
      await view.unmount();
    }
  });

  it('filters the profile catalog by search text', async () => {
    const view = await renderWizard();
    try {
      await act(async () => button(view.host, 'Next').click()); // choose your machine
      const search = input(view.host, 'Search machine profiles');
      await act(async () => {
        search.value = 'sculpfun';
        Simulate.change(search);
      });
      expect(view.host.textContent).toContain('Use Sculpfun S30');
      expect(view.host.textContent).not.toContain('Use Ortur Laser Master 3');
      await act(async () => {
        search.value = 'no such machine';
        Simulate.change(search);
      });
      expect(view.host.textContent).toContain('No profile matches');
    } finally {
      await view.unmount();
    }
  });

  it('keeps a selected catalog profile exact instead of overlaying controller observations', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      detectedControllerKind: 'grblhal',
      detectedSettings: { bedWidth: 363, bedHeight: 273 },
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const view = await renderWizard();
    try {
      await act(async () => button(view.host, 'Next').click()); // choose your machine
      await act(async () => button(view.host, 'Use Creality Falcon A1 Pro').click());
      expect(select(view.host, 'Controller firmware').value).toBe('grblhal');
      await act(async () => button(view.host, 'Next').click()); // connect & detect
      await act(async () => button(view.host, 'Next').click()); // confirm settings
      expect(input(view.host, 'Bed width (mm)').value).toBe('400');
      expect(useStore.getState().project.device).toEqual(DEFAULT_DEVICE_PROFILE);
    } finally {
      await view.unmount();
    }
  });
});

function mockPlatform(): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: vi.fn(async (_request: FileOpenRequest) => []),
    pickFileForSave: vi.fn(async (_request: FileSaveRequest) => null),
    serial: { isSupported: () => true, requestPort: async () => null },
  };
}

async function renderWizard(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={mockPlatform()}>
        <DeviceSetupWizard onClose={() => undefined} />
      </PlatformProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function select(host: HTMLElement, ariaLabel: string): HTMLSelectElement {
  const field = host.querySelector(`select[aria-label="${ariaLabel}"]`);
  if (!(field instanceof HTMLSelectElement)) throw new Error(`Select missing: ${ariaLabel}`);
  return field;
}

function input(host: HTMLElement, ariaLabel: string): HTMLInputElement {
  const field = host.querySelector(`input[aria-label="${ariaLabel}"]`);
  if (!(field instanceof HTMLInputElement)) throw new Error(`Input missing: ${ariaLabel}`);
  return field;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
