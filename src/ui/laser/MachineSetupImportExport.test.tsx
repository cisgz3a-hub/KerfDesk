import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  serializeMachineProfileDocument,
} from '../../io/machine-profile';
import type {
  FileOpenRequest,
  FileSaveRequest,
  PlatformAdapter,
  SaveTarget,
} from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { ImportExportPanel } from './MachineSetupImportExport';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type RenderedPanel = {
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
};

function platformAdapter(args: {
  readonly open?: PlatformAdapter['pickFilesForOpen'];
  readonly save?: PlatformAdapter['pickFileForSave'];
}): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: args.open ?? vi.fn(async () => []),
    pickFileForSave: args.save ?? vi.fn(async () => null),
    serial: { isSupported: () => true, requestPort: async () => null },
  };
}

async function renderPanel(platform: PlatformAdapter): Promise<RenderedPanel> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={platform}>
        <ImportExportPanel />
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
  useToastStore.setState({ toasts: [] });
});

describe('Machine Setup import/export panel', () => {
  it('exports the active LaserForge machine profile as deterministic JSON', async () => {
    let written = '';
    const save = vi.fn(
      async (_request: FileSaveRequest): Promise<SaveTarget> => ({
        displayName: 'default-400x400.lfmachine.json',
        write: vi.fn(async (data) => {
          written = data;
        }),
      }),
    );
    const { host, unmount } = await renderPanel(platformAdapter({ save }));
    try {
      await act(async () => button(host, 'Export active profile').click());

      expect(save).toHaveBeenCalledWith({
        suggestedName: 'default-400-400.lfmachine.json',
        extensions: ['.lfmachine.json'],
      });
      const parsed = JSON.parse(written) as unknown;
      expect(parsed).toMatchObject({
        format: MACHINE_PROFILE_FORMAT,
        schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
        profile: { name: DEFAULT_DEVICE_PROFILE.name },
      });
      expect(written).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
      expect(useToastStore.getState().toasts).toContainEqual(
        expect.objectContaining({ message: 'Machine profile exported.', variant: 'success' }),
      );
    } finally {
      await unmount();
    }
  });

  it('does not show a success toast when export is cancelled', async () => {
    const { host, unmount } = await renderPanel(platformAdapter({ save: vi.fn(async () => null) }));
    try {
      await act(async () => button(host, 'Export active profile').click());

      expect(useToastStore.getState().toasts).toEqual([]);
    } finally {
      await unmount();
    }
  });

  it('shows a success toast after applying a LaserForge profile import', async () => {
    const text = serializeMachineProfileDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: { ...DEFAULT_DEVICE_PROFILE, name: 'Imported bench profile', bedWidth: 500 },
      source: { kind: 'custom', label: 'Fixture' },
      reviewNotes: ['Fixture import.'],
    });
    const open = vi.fn(async (_request: FileOpenRequest) => [
      { name: 'bench.lfmachine.json', text: async () => text },
    ]);
    const { host, unmount } = await renderPanel(platformAdapter({ open }));
    try {
      await act(async () => button(host, 'Import LaserForge profile').click());
      await act(async () => button(host, 'Apply imported profile').click());

      expect(useStore.getState().project.device.name).toBe('Imported bench profile');
      expect(useToastStore.getState().toasts).toContainEqual(
        expect.objectContaining({ message: 'Machine profile applied.', variant: 'success' }),
      );
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
