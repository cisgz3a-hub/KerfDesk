import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MaterialRecipe } from '../../core/material-library';
import type {
  FileHandle,
  FileSaveRequest,
  PlatformAdapter,
  SaveTarget,
} from '../../platform/types';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  serializeMaterialLibrary,
  type MaterialLibraryDocument,
  type MaterialPreset,
} from '../../io/material-library';
import {
  handleOpenMaterialLibrary,
  handleSaveMaterialLibrary,
} from './material-library-file-actions';

const recipe: MaterialRecipe = {
  mode: 'line',
  minPower: 0,
  power: 35,
  speed: 1400,
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
  ditherAlgorithm: 'threshold',
  linesPerMm: 10,
  negativeImage: false,
  passThrough: false,
  dotWidthCorrectionMm: 0,
};

function preset(patch: Partial<MaterialPreset> = {}): MaterialPreset {
  return {
    id: 'birch-3mm-line',
    materialName: 'Birch plywood',
    thicknessMm: 3,
    description: 'Line cut',
    recipe,
    revision: 'rev-1',
    ...patch,
  };
}

function library(patch: Partial<MaterialLibraryDocument> = {}): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'shop-library',
    name: 'Shop Library',
    entries: [preset()],
    ...patch,
  };
}

function file(name: string, text: string | Promise<string>): FileHandle {
  return { name, text: async () => text };
}

function mockPlatform(
  args: {
    readonly open?: () => Promise<ReadonlyArray<FileHandle>>;
    readonly save?: (req: FileSaveRequest) => Promise<SaveTarget | null>;
  } = {},
): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: args.open ?? (async () => []),
    pickFileForSave: args.save ?? (async () => null),
    serial: {
      isSupported: () => false,
      requestPort: async () => null,
    },
  };
}

function toasts(): {
  readonly pushToast: (message: string, variant?: string) => void;
  readonly messages: ReadonlyArray<{ readonly message: string; readonly variant?: string }>;
} {
  const messages: Array<{ readonly message: string; readonly variant?: string }> = [];
  return {
    pushToast: (message, variant) => {
      messages.push(variant === undefined ? { message } : { message, variant });
    },
    messages,
  };
}

function reject(message: string): Promise<never> {
  return Promise.reject(new Error(message));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('material library file actions', () => {
  it('opens a valid native material library file', async () => {
    const doc = library();
    const setMaterialLibrary = vi.fn();
    const toast = toasts();

    await handleOpenMaterialLibrary({
      platform: mockPlatform({
        open: async () => [file('shop.lfml.json', serializeMaterialLibrary(doc))],
      }),
      setMaterialLibrary,
      pushToast: toast.pushToast,
    });

    expect(setMaterialLibrary).toHaveBeenCalledWith(doc);
    expect(toast.messages).toEqual([
      { message: 'Loaded material library: Shop Library', variant: 'success' },
    ]);
  });

  it('keeps cancelled open and save pickers silent', async () => {
    const toast = toasts();

    await handleOpenMaterialLibrary({
      platform: mockPlatform(),
      setMaterialLibrary: vi.fn(),
      pushToast: toast.pushToast,
    });
    await handleSaveMaterialLibrary({
      platform: mockPlatform(),
      library: library(),
      markMaterialLibrarySaved: vi.fn(),
      pushToast: toast.pushToast,
    });

    expect(toast.messages).toEqual([]);
  });

  it('rejects invalid material library files without replacing the loaded library', async () => {
    const setMaterialLibrary = vi.fn();
    const toast = toasts();

    await handleOpenMaterialLibrary({
      platform: mockPlatform({
        open: async () => [file('bad.lfml.json', JSON.stringify({ format: 'wrong' }))],
      }),
      setMaterialLibrary,
      pushToast: toast.pushToast,
    });

    expect(setMaterialLibrary).not.toHaveBeenCalled();
    expect(toast.messages).toEqual([
      { message: 'Could not open bad.lfml.json: wrong material library format', variant: 'error' },
    ]);
  });

  it('alerts when a material library schema is too new', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const setMaterialLibrary = vi.fn();
    const toast = toasts();
    const tooNew = {
      ...library(),
      librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION + 1,
    };

    await handleOpenMaterialLibrary({
      platform: mockPlatform({
        open: async () => [file('future.lfml.json', JSON.stringify(tooNew))],
      }),
      setMaterialLibrary,
      pushToast: toast.pushToast,
    });

    expect(setMaterialLibrary).not.toHaveBeenCalled();
    expect(toast.messages).toEqual([]);
    expect(alert).toHaveBeenCalledWith(
      'This material library was saved with a newer KerfDesk (schemaVersion 2). Update the app to open it.',
    );
  });

  it('saves a native material library and clears library dirty state after write succeeds', async () => {
    const doc = library();
    const toast = toasts();
    const writes: string[] = [];
    const markMaterialLibrarySaved = vi.fn();
    const saveRequests: FileSaveRequest[] = [];

    await handleSaveMaterialLibrary({
      platform: mockPlatform({
        save: async (req) => {
          saveRequests.push(req);
          return {
            displayName: 'shop.lfml.json',
            write: async (data) => {
              if (typeof data !== 'string') throw new Error('expected text material library');
              writes.push(data);
            },
          };
        },
      }),
      library: doc,
      markMaterialLibrarySaved,
      pushToast: toast.pushToast,
    });

    expect(saveRequests).toEqual([
      { suggestedName: 'Shop Library.lfml.json', extensions: ['.lfml.json'] },
    ]);
    expect(writes).toEqual([serializeMaterialLibrary(doc)]);
    expect(markMaterialLibrarySaved).toHaveBeenCalledTimes(1);
    expect(toast.messages).toEqual([
      { message: 'Saved material library to shop.lfml.json', variant: 'success' },
    ]);
  });

  it('does not clear library dirty state when save write fails', async () => {
    const toast = toasts();
    const markMaterialLibrarySaved = vi.fn();

    await handleSaveMaterialLibrary({
      platform: mockPlatform({
        save: async () => ({
          displayName: 'shop.lfml.json',
          write: () => reject('permission revoked'),
        }),
      }),
      library: library(),
      markMaterialLibrarySaved,
      pushToast: toast.pushToast,
    });

    expect(markMaterialLibrarySaved).not.toHaveBeenCalled();
    expect(toast.messages).toEqual([
      { message: 'Could not save material library: permission revoked', variant: 'error' },
    ]);
  });
});
