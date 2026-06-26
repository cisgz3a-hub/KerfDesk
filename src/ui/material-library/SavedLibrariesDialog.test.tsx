import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialRecipe } from '../../core/material-library';
import {
  deserializeMaterialLibrary,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  serializeMaterialLibrary,
  type MaterialLibraryDocument,
  type MaterialPreset,
} from '../../io/material-library';
import type { FileHandle, PlatformAdapter, SaveTarget } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { SavedLibrariesDialog } from './SavedLibrariesDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function mockPlatform(
  args: {
    readonly open?: () => Promise<ReadonlyArray<FileHandle>>;
    readonly save?: () => Promise<SaveTarget | null>;
  } = {},
): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: args.open ?? (async () => []),
    pickFileForSave: args.save ?? (async () => null),
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

function file(name: string, text: string): FileHandle {
  return { name, text: async () => text };
}

const recipe: MaterialRecipe = {
  mode: 'line',
  minPower: 0,
  power: 30,
  speed: 1500,
  passes: 1,
  airAssist: false,
  kerfOffsetMm: 0,
  tabsEnabled: false,
  tabSizeMm: 0.5,
  tabsPerShape: 4,
  tabSkipInnerShapes: true,
  hatchAngleDeg: 0,
  hatchSpacingMm: 0.1,
  fillOverscanMm: 5,
  fillStyle: 'scanline',
  fillBidirectional: true,
  fillCrossHatch: false,
  ditherAlgorithm: 'floyd-steinberg',
  linesPerMm: 10,
  negativeImage: false,
  passThrough: false,
  dotWidthCorrectionMm: 0,
};

function presetFixture(): MaterialPreset {
  return {
    id: 'birch-3mm',
    materialName: 'Birch',
    thicknessMm: 3,
    description: 'Cut',
    recipe,
    revision: 'r1',
  };
}

function libraryDoc(
  name: string,
  entries: ReadonlyArray<MaterialPreset> = [],
): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: `lib-${name.toLowerCase()}`,
    name,
    entries,
  };
}

let mounted: { readonly root: Root; readonly host: HTMLDivElement } | null = null;

afterEach(async () => {
  if (mounted !== null) {
    const current = mounted;
    await act(async () => current.root.unmount());
    current.host.remove();
    mounted = null;
  }
  resetStore();
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

async function renderDialog(
  onClose: () => void = vi.fn(),
  platform: PlatformAdapter = mockPlatform(),
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={platform}>
        <SavedLibrariesDialog onClose={onClose} />
      </PlatformProvider>,
    );
  });
  if (root === null) throw new Error('root missing');
  mounted = { root, host };
  return { host, root };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const element = host.querySelector(`button[aria-label="${label}"]`);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`missing button: ${label}`);
  return element;
}

function libraryNames(): ReadonlyArray<string> {
  return useStore
    .getState()
    .listSavedLibraries()
    .map((summary) => summary.name);
}

async function click(host: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    Simulate.click(button(host, label));
  });
}

describe('SavedLibrariesDialog', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().createLibrary('Alpha');
    useStore.getState().createLibrary('Beta'); // Beta is now the active library.
  });

  it('lists every saved library', async () => {
    const { host } = await renderDialog();
    const text = host.textContent ?? '';
    expect(text).toContain('Alpha');
    expect(text).toContain('Beta');
  });

  it('opens an inactive library and closes the page', async () => {
    const onClose = vi.fn();
    const { host } = await renderDialog(onClose);

    await click(host, 'Open Alpha');

    expect(useStore.getState().materialLibrary?.name).toBe('Alpha');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renames a library inline', async () => {
    const { host } = await renderDialog();

    await click(host, 'Rename Alpha');
    const input = host.querySelector('input[aria-label="Rename Alpha"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('missing rename input');
    await act(async () => {
      input.value = 'Alpha v2';
      Simulate.change(input);
    });
    await click(host, 'Save name for Alpha');

    expect(libraryNames()).toContain('Alpha v2');
    expect(libraryNames()).not.toContain('Alpha');
  });

  it('duplicates a library into the list', async () => {
    const { host } = await renderDialog();

    await click(host, 'Duplicate Alpha');

    expect(libraryNames()).toContain('Alpha copy');
    expect(useStore.getState().materialLibrary?.name).toBe('Beta'); // active unchanged
  });

  it('deletes a library after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { host } = await renderDialog();

    await click(host, 'Delete Alpha');

    expect(libraryNames()).not.toContain('Alpha');
    expect(libraryNames()).toContain('Beta');
  });

  it('keeps a library when delete is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { host } = await renderDialog();

    await click(host, 'Delete Alpha');

    expect(libraryNames()).toContain('Alpha');
  });

  it('imports a library from a file', async () => {
    const doc = libraryDoc('Imported', [presetFixture()]);
    const { host } = await renderDialog(
      vi.fn(),
      mockPlatform({
        open: async () => [file('imported.lfml.json', serializeMaterialLibrary(doc))],
      }),
    );

    await act(async () => {
      Simulate.click(button(host, 'Import library'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useStore.getState().materialLibrary).toEqual(doc);
  });

  it('exports the active library to a file', async () => {
    const writes: string[] = [];
    const { host } = await renderDialog(
      vi.fn(),
      mockPlatform({
        save: async () => ({
          displayName: 'beta.lfml.json',
          write: async (data) => {
            if (typeof data !== 'string') throw new Error('expected text material library');
            writes.push(data);
          },
        }),
      }),
    );

    await act(async () => {
      Simulate.click(button(host, 'Export Beta'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writes).toHaveLength(1);
    const parsed = deserializeMaterialLibrary(writes[0] ?? '');
    expect(parsed.kind).toBe('ok');
    if (parsed.kind === 'ok') expect(parsed.library.name).toBe('Beta');
  });
});
