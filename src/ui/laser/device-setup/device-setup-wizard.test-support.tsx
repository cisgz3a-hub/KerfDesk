import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import type { FileOpenRequest, FileSaveRequest, PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { DEVICE_SETUP_CONFIGURED_STORAGE_KEY } from '../../state/device-setup-configured-persistence';
import { deviceProfileSignature } from './device-setup-nudge';
import { DeviceSetupWizard } from './DeviceSetupWizard';

export function mockPlatform(serialSupported = true): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: vi.fn(async (_request: FileOpenRequest) => []),
    pickFileForSave: vi.fn(async (_request: FileSaveRequest) => null),
    serial: { isSupported: () => serialSupported, requestPort: async () => null },
  };
}

/**
 * Setup fills a machine that has not been through setup from its controller by
 * itself (ADR-420). Most tests pin the explicit path of a machine already set
 * up, so that is the default; `newMachine: true` renders the automatic one.
 */
export async function renderWizard(
  onClose: () => void = () => undefined,
  adapter: PlatformAdapter = mockPlatform(),
  options: { readonly newMachine?: boolean } = {},
): Promise<{ readonly host: HTMLDivElement; readonly unmount: () => Promise<void> }> {
  if (options.newMachine === true) localStorage.removeItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY);
  else {
    const signature = deviceProfileSignature(useStore.getState().project.device);
    localStorage.setItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY, JSON.stringify([signature]));
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={adapter}>
        <DeviceSetupWizard onClose={onClose} />
      </PlatformProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
      localStorage.removeItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY);
    },
  };
}
