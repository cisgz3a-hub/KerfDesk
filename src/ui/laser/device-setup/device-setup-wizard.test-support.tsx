import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import type { FileOpenRequest, FileSaveRequest, PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { DeviceSetupWizard } from './DeviceSetupWizard';

export function mockPlatform(serialSupported = true): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: vi.fn(async (_request: FileOpenRequest) => []),
    pickFileForSave: vi.fn(async (_request: FileSaveRequest) => null),
    serial: { isSupported: () => serialSupported, requestPort: async () => null },
  };
}

export async function renderWizard(
  onClose: () => void = () => undefined,
  adapter: PlatformAdapter = mockPlatform(),
): Promise<{ readonly host: HTMLDivElement; readonly unmount: () => Promise<void> }> {
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
    },
  };
}
