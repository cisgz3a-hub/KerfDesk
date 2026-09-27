import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import type { BatchTraceFile } from '../../core/trace/batch-trace';
import { DEFAULT_EXPORT_PRECISION_MM } from '../../core/vector-export/decimal-grid';
import {
  saveDirectoryUnsupportedError,
  type PlatformAdapter,
  type SaveDirectoryTarget,
  type SaveTarget,
} from '../../platform/types';
import { runChosenMultiFileTrace, type MultiFileTraceSettings } from './MultiFileTraceDialog';
import type * as multiFileTraceAction from './multi-file-trace-action';
import {
  DEFAULT_MULTI_FILE_TRACE_PRESET,
  runMultiFileTrace,
  traceFileWriterForDirectory,
} from './multi-file-trace-action';
import { beginMultiFileTraceProgress } from './MultiFileTraceProgress';
import { DEFAULT_TRACE_PAGE_SETTINGS } from './TracePageFields';
import { DEFAULT_TRACE_SIZE_SETTINGS } from './TraceSizeFields';

vi.mock('./multi-file-trace-action', async (importOriginal) => ({
  ...(await importOriginal<typeof multiFileTraceAction>()),
  runMultiFileTrace: vi.fn(async () => undefined),
}));

afterEach(() => {
  vi.mocked(runMultiFileTrace).mockClear();
});

const SETTINGS: MultiFileTraceSettings = {
  settingsSource: 'preset',
  presetName: DEFAULT_MULTI_FILE_TRACE_PRESET,
  format: 'svg',
  groupContours: false,
  precisionMm: DEFAULT_EXPORT_PRECISION_MM,
  ...DEFAULT_TRACE_PAGE_SETTINGS,
  ...DEFAULT_TRACE_SIZE_SETTINGS,
};

const TRACED: BatchTraceFile = {
  filename: 'a-trace.svg',
  format: 'svg',
  text: '<svg/>',
  pathCount: 1,
  sourceIndex: 0,
};

function saveTarget(): SaveTarget & { readonly write: ReturnType<typeof vi.fn> } {
  return {
    displayName: 'a-trace.svg',
    destinationIdentity: 'a-trace.svg',
    isSameDestination: () => false,
    write: vi.fn(async () => undefined),
  } as unknown as SaveTarget & { readonly write: ReturnType<typeof vi.fn> };
}

// Runs the batch with the given platform and writes one traced file through
// the writer the dialog chose, as the real batch does after each trace.
async function writeOneFile(platform: PlatformAdapter): Promise<boolean | undefined> {
  const image = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
  await runChosenMultiFileTrace(platform, vi.fn(), SETTINGS, [image]);
  const deps = vi.mocked(runMultiFileTrace).mock.calls[0]?.[2];
  return deps?.write?.(TRACED);
}

describe('Multi-File Trace without a folder picker (web fallback)', () => {
  it.each([
    ['has no folder picker', undefined],
    [
      'says it has no folder picker',
      vi.fn(async () => {
        throw saveDirectoryUnsupportedError(
          'File System Access directory picker is required to save files safely.',
        );
      }),
    ],
  ])('offers each file its own save dialog when the platform %s', async (_name, reserve) => {
    const target = saveTarget();
    const pickFileForSave = vi.fn(async () => target);
    const platform = {
      ...mockPlatform(),
      pickFileForSave,
      reserveSaveDirectory: reserve,
    } as unknown as PlatformAdapter;

    await expect(writeOneFile(platform)).resolves.toBe(true);

    expect(pickFileForSave).toHaveBeenCalledWith({
      suggestedName: 'a-trace.svg',
      extensions: ['.svg'],
    });
    expect(target.write).toHaveBeenCalledWith('<svg/>');
  });

  it('does not start the batch when the folder picker is cancelled', async () => {
    const platform = {
      ...mockPlatform(),
      reserveSaveDirectory: vi.fn(async () => null),
    } as unknown as PlatformAdapter;
    const image = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });

    await runChosenMultiFileTrace(platform, vi.fn(), SETTINGS, [image]);

    expect(runMultiFileTrace).not.toHaveBeenCalled();
  });

  it('reports any other folder-picker failure and starts nothing', async () => {
    const denied = new Error('The request is not allowed.');
    denied.name = 'NotAllowedError';
    const pickFileForSave = vi.fn();
    const platform = {
      ...mockPlatform(),
      pickFileForSave,
      reserveSaveDirectory: vi.fn(async () => {
        throw denied;
      }),
    } as unknown as PlatformAdapter;
    const pushToast = vi.fn();
    const image = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });

    await runChosenMultiFileTrace(platform, pushToast, SETTINGS, [image]);

    expect(pushToast).toHaveBeenCalledWith(
      'Could not trace images: The request is not allowed.',
      'error',
    );
    expect(runMultiFileTrace).not.toHaveBeenCalled();
    expect(pickFileForSave).not.toHaveBeenCalled();
  });

  it('refuses a second batch while one is running', async () => {
    const reserveSaveDirectory = vi.fn(async () => null);
    const platform = { ...mockPlatform(), reserveSaveDirectory } as unknown as PlatformAdapter;
    const pushToast = vi.fn();
    const running = beginMultiFileTraceProgress(3, vi.fn());
    try {
      await runChosenMultiFileTrace(platform, pushToast, SETTINGS, [new File([], 'a.png')]);
    } finally {
      running.end();
    }
    expect(pushToast).toHaveBeenCalledWith(
      'A Multi-File Trace is already running. Cancel it or let it finish first.',
      'info',
    );
    expect(reserveSaveDirectory).not.toHaveBeenCalled();
  });
});

describe('Multi-File Trace into a reserved folder', () => {
  it('never replaces an existing file: it takes the next free name', async () => {
    const existing = new Set(['a-trace.svg', 'a-trace-2.svg']);
    const written: string[] = [];
    const directory: SaveDirectoryTarget = {
      file: (displayName) =>
        ({
          write: async () => {
            written.push(displayName);
            existing.add(displayName);
          },
        }) as unknown as SaveTarget,
      exists: async (displayName) => existing.has(displayName),
    };
    const write = traceFileWriterForDirectory(directory);
    await write(TRACED);
    await write({ ...TRACED, filename: 'b-trace.svg' });
    expect(written).toEqual(['a-trace-3.svg', 'b-trace.svg']);
  });
});
