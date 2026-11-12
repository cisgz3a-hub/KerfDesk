import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import {
  installChromiumSavePicker,
  lapseUserActivation,
} from '../../platform/web/chromium-save-picker.test-support';
import { webAdapter } from '../../platform/web/web-adapter';
import { useSaveReadyDialogStore } from '../state/save-ready-dialog-store';
import type * as RdModule from '../../io/rd';
import type * as OutputWorkerModule from '../laser/output-preparation-worker-client';
import type * as JobAwareDialogsModule from '../state/job-aware-dialogs';
import type { SaveGcodeCtx } from './file-actions';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  pushToast: vi.fn(),
  direct: vi.fn(),
  prepareBackground: vi.fn(),
  shouldRunOffThread: vi.fn(),
}));

// The direct path compiles on this thread and encodes with emitPreparedRdFile.
vi.mock('../../io/rd', async (importOriginal) => ({
  ...(await importOriginal<typeof RdModule>()),
  emitPreparedRdFile: mocks.direct,
}));
vi.mock('../laser/output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputWorkerModule>()),
  outputPreparationShouldRunOffThread: mocks.shouldRunOffThread,
  prepareRdOutputOffThread: mocks.prepareBackground,
}));
vi.mock('../state/job-aware-dialogs', async (importOriginal) => ({
  ...(await importOriginal<typeof JobAwareDialogsModule>()),
  jobAwareAlert: mocks.alert,
}));

import { handleSaveRd } from './save-rd-action';

beforeEach(() => {
  mocks.alert.mockReset();
  mocks.pushToast.mockReset();
  mocks.direct.mockReset();
  mocks.prepareBackground.mockReset();
  mocks.shouldRunOffThread.mockReset().mockReturnValue(true);
});

describe('costly Ruida Save routing', () => {
  it.each(['unavailable', 'crashed'] as const)(
    'never retries synchronously when the output worker is %s',
    async (failure) => {
      const order: string[] = [];
      const writes: Array<string | Blob> = [];
      mocks.prepareBackground.mockImplementation(() => {
        order.push('worker');
        return failure === 'unavailable' ? null : Promise.reject(new Error('worker crashed'));
      });

      await handleSaveRd(context(order, writes), { ok: true });

      // The picker empties an existing file as it returns (ADR-656), so a
      // failed compile never opens it.
      expect(order).toEqual(['worker']);
      expect(mocks.direct).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
      // One error toast, never a native alert (ADR-656 Amendment 4).
      expect(mocks.alert).not.toHaveBeenCalled();
      expect(mocks.pushToast).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(
          failure === 'unavailable'
            ? /^Cannot save \.rd file: .*Background compilation is unavailable/
            : /^Cannot save \.rd file: .*worker crashed/,
        ),
        'error',
        expect.objectContaining({ key: 'export-refused' }),
      );
    },
  );

  it('writes the worker-produced bytes without invoking direct compilation', async () => {
    const order: string[] = [];
    const writes: Array<string | Blob> = [];
    mocks.prepareBackground.mockImplementation(() => {
      order.push('worker');
      return Promise.resolve({ ok: true, bytes: new Uint8Array([1, 2, 3]), advisories: [] });
    });

    await handleSaveRd(context(order, writes), { ok: true });

    expect(order).toEqual(['worker', 'picker', 'write']);
    expect(mocks.direct).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBeInstanceOf(Blob);
  });

  it('leaves an existing .rd file intact when the worker fails (audit 19-P2-1)', async () => {
    const disk = new Map([['job.rd', 'previous rd']]);
    const picker = installChromiumSavePicker(disk);
    mocks.prepareBackground.mockImplementation(() => Promise.reject(new Error('worker crashed')));
    try {
      await handleSaveRd(
        {
          platform: webAdapter,
          project: createProject(),
          savedName: null,
          pushToast: mocks.pushToast,
        },
        { ok: true },
      );
    } finally {
      picker.restore();
    }
    expect(picker.picks()).toBe(0);
    expect(disk.get('job.rd')).toBe('previous rd');
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.pushToast).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('worker crashed'),
      'error',
      expect.objectContaining({ key: 'export-refused' }),
    );
  });

  it('asks for a fresh Choose file click when compiling outlasts the click', async () => {
    const order: string[] = [];
    const writes: Array<string | Blob> = [];
    mocks.prepareBackground.mockImplementation(() => {
      order.push('worker');
      return Promise.resolve({ ok: true, bytes: new Uint8Array([1]), advisories: [] });
    });
    const restoreActivation = lapseUserActivation();
    try {
      const saving = handleSaveRd(context(order, writes), { ok: true });
      await vi.waitFor(() =>
        expect(useSaveReadyDialogStore.getState().request?.title).toBe('Save .rd file'),
      );
      expect(order).toEqual(['worker']);
      useSaveReadyDialogStore.getState().request?.choose();
      await saving;
    } finally {
      restoreActivation();
    }
    expect(order).toEqual(['worker', 'picker', 'write']);
  });

  it('keeps cheap jobs on the direct path before opening the picker', async () => {
    const order: string[] = [];
    const writes: Array<string | Blob> = [];
    mocks.shouldRunOffThread.mockReturnValue(false);
    mocks.direct.mockImplementation(() => {
      order.push('direct');
      return { ok: true, bytes: new Uint8Array([4]), advisories: [] };
    });

    await handleSaveRd(context(order, writes), { ok: true });

    expect(order).toEqual(['direct', 'picker', 'write']);
    expect(mocks.prepareBackground).not.toHaveBeenCalled();
  });
});

function context(order: string[], writes: Array<string | Blob>): SaveGcodeCtx {
  const target: SaveTarget = {
    displayName: 'heavy.rd',
    write: async (data) => {
      order.push('write');
      writes.push(data);
    },
  };
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => {
      order.push('picker');
      return target;
    },
    serial: { isSupported: () => false, requestPort: async () => null },
  };
  return {
    platform,
    project: createProject(),
    savedName: null,
    pushToast: mocks.pushToast,
  };
}
