import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import type * as RdModule from '../../io/rd';
import type * as OutputWorkerModule from '../laser/output-preparation-worker-client';
import type * as JobAwareDialogsModule from '../state/job-aware-dialogs';
import type { SaveGcodeCtx } from './file-actions';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  direct: vi.fn(),
  prepareBackground: vi.fn(),
  shouldRunOffThread: vi.fn(),
}));

vi.mock('../../io/rd', async (importOriginal) => ({
  ...(await importOriginal<typeof RdModule>()),
  emitRdFile: mocks.direct,
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

      expect(order).toEqual(['picker', 'worker']);
      expect(mocks.direct).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
      expect(mocks.alert).toHaveBeenCalledWith(
        expect.stringContaining('Background compilation is unavailable'),
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

    expect(order).toEqual(['picker', 'worker', 'write']);
    expect(mocks.direct).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBeInstanceOf(Blob);
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
    pushToast: () => undefined,
  };
}
