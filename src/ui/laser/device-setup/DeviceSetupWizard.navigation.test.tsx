import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileOpenRequest, FileSaveRequest, PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { DeviceSetupWizard } from './DeviceSetupWizard';
import { openSetupDisclosure } from './device-setup-test-helpers';
import type { DeviceSetupStep } from './device-setup-flow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    detectedSettings: null,
    detectedControllerKind: null,
    lastSettingsReadAt: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('DeviceSetupWizard step navigation', () => {
  it.each<[DeviceSetupStep, string, number]>([
    ['connect', 'Connection options', 1],
    ['options', 'Accessories and calibration', 2],
    ['cnc-setup', 'CNC job setup', 2],
  ])(
    'opens the legacy %s target in its stage with its disclosure expanded',
    async (initialStep, title, stage) => {
      if (initialStep === 'cnc-setup') useStore.getState().setMachineKind('cnc');
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      await act(async () => {
        root.render(
          <PlatformProvider adapter={mockPlatform()}>
            <DeviceSetupWizard onClose={vi.fn()} initialStep={initialStep} />
          </PlatformProvider>,
        );
      });
      try {
        expect(host.textContent).toContain(`Step ${stage} of 3`);
        const summary = [...host.querySelectorAll('summary')].find((item) =>
          item.textContent?.startsWith(title),
        );
        expect(summary?.parentElement).toBeInstanceOf(HTMLDetailsElement);
        expect((summary?.parentElement as HTMLDetailsElement).open).toBe(true);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );

  it('opens any setup section directly and preserves unsaved draft edits', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <PlatformProvider adapter={mockPlatform()}>
          <DeviceSetupWizard onClose={vi.fn()} />
        </PlatformProvider>,
      );
    });

    try {
      await openSetupDisclosure(host, 'Connection options');
      await changeSelect(host, 'Controller firmware', 'marlin');
      await act(async () => stepButton(host, 3, 'Review & save').click());
      expect(host.textContent).toContain('Step 3 of 3');
      expect(stepButton(host, 3, 'Review & save').getAttribute('aria-current')).toBe('step');

      await act(async () => stepButton(host, 1, 'Machine').click());
      expect(host.textContent).toContain('Step 1 of 3');
      expect(select(host, 'Controller firmware').value).toBe('marlin');
    } finally {
      await act(async () => root.unmount());
      host.remove();
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

async function changeSelect(host: HTMLElement, ariaLabel: string, value: string): Promise<void> {
  const field = select(host, ariaLabel);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}

function select(host: HTMLElement, ariaLabel: string): HTMLSelectElement {
  const field = host.querySelector(`select[aria-label="${ariaLabel}"]`);
  if (!(field instanceof HTMLSelectElement)) throw new Error(`Select missing: ${ariaLabel}`);
  return field;
}

function stepButton(host: HTMLElement, step: number, label: string): HTMLButtonElement {
  const match = host.querySelector(`button[aria-label="Go to step ${step}: ${label}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Step button not rendered: ${label}`);
  return match;
}
