import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { FileOpenRequest, FileSaveRequest, PlatformAdapter } from '../../platform/types';
import { serializeMachineProfileDocument, MACHINE_PROFILE_FORMAT, MACHINE_PROFILE_SCHEMA_VERSION } from '../../io/machine-profile';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { MachineSetupDialog } from './MachineSetupDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function platformWithFiles(files: ReadonlyArray<{ readonly name: string; readonly text: string }>): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: vi.fn(async (_request: FileOpenRequest) =>
      files.map((file) => ({ name: file.name, text: async () => file.text })),
    ),
    pickFileForSave: vi.fn(async (_request: FileSaveRequest) => ({
      displayName: 'active.lfmachine.json',
      write: vi.fn(async () => undefined),
    })),
    serial: { isSupported: () => true, requestPort: async () => null },
  };
}

async function renderDialog(platform: PlatformAdapter = platformWithFiles([])): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={platform}>
        <MachineSetupDialog onClose={() => undefined} />
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

afterEach(() => {
  resetStore();
});

describe('MachineSetupDialog', () => {
  it('presents Machine Setup tabs and applies a built-in catalog profile', async () => {
    const { host, unmount } = await renderDialog();
    try {
      for (const label of [
        'Overview',
        'Profile Catalog',
        'Controller Settings',
        'Firmware Writes',
        'Safety Zones',
        'Import / Export',
      ]) {
        expect(button(host, label)).toBeInstanceOf(HTMLButtonElement);
      }

      await act(async () => button(host, 'Profile Catalog').click());
      await act(async () => button(host, 'Use Creality Falcon A1 Pro').click());

      expect(useStore.getState().project.device.profileId).toBe('creality-falcon-a1-pro-compatible');
      expect(useStore.getState().dirty).toBe(true);
    } finally {
      await unmount();
    }
  });

  it('imports a LaserForge machine profile through a review step', async () => {
    const text = serializeMachineProfileDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: { ...DEFAULT_DEVICE_PROFILE, name: 'Imported bench profile', bedWidth: 500 },
      source: { kind: 'custom', label: 'Fixture' },
      reviewNotes: ['Fixture import.'],
    });
    const { host, unmount } = await renderDialog(platformWithFiles([{ name: 'bench.lfmachine.json', text }]));
    try {
      await act(async () => button(host, 'Import / Export').click());
      await act(async () => button(host, 'Import LaserForge profile').click());

      expect(host.textContent).toContain('Imported bench profile');
      expect(host.textContent).toContain('Fixture import.');

      await act(async () => button(host, 'Apply imported profile').click());

      expect(useStore.getState().project.device.name).toBe('Imported bench profile');
      expect(useStore.getState().project.workspace.width).toBe(500);
    } finally {
      await unmount();
    }
  });

  it('imports LightBurn lbdev files as review-first profiles', async () => {
    const lbdev =
      '<LightBurnDevice><Name>LB 4040</Name><Controller>GRBL</Controller><Width>410</Width><Height>390</Height><SMax>1000</SMax></LightBurnDevice>';
    const { host, unmount } = await renderDialog(platformWithFiles([{ name: 'lb.lbdev', text: lbdev }]));
    try {
      await act(async () => button(host, 'Import / Export').click());
      await act(async () => button(host, 'Import LightBurn .lbdev').click());

      expect(host.textContent).toContain('LightBurn review');
      expect(host.textContent).toContain('LB 4040');

      await act(async () => button(host, 'Apply LightBurn profile').click());

      expect(useStore.getState().project.device.profileSource).toBe('lightburn');
      expect(useStore.getState().project.device.bedWidth).toBe(410);
    } finally {
      await unmount();
    }
  });
});

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
