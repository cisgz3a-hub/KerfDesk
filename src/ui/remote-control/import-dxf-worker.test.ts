import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nestedGridsPastBudgetDxf } from '../../__fixtures__/nested-minsert';
import {
  dxfWorkerRequests,
  installImportWorkers,
  resetImportWorkers,
} from '../import/import-workers.test-support';
import type { ImportWorkerRequest } from '../import/import-worker-protocol';
import { useStore } from '../state/store';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

const LINE_DXF = `0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n40\n21\n0\n0\nENDSEC\n0\nEOF\n`;
const dxfFile = (text: string) => ({
  fileName: 'part.dxf',
  mimeType: 'application/dxf',
  dataBase64: btoa(text),
});

let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  installImportWorkers();
  adapter = testAdapter();
});
afterEach(() => {
  adapter.dispose();
  resetImportWorkers();
});

describe('remote DXF import uses the import worker, as File > Import does', () => {
  it('parses the file in the import worker', async () => {
    const result = await adapter.execute('import_file', writeArgs(adapter, dxfFile(LINE_DXF)));
    expect(resultCode(result)).toBe('ok');
    expect(dxfWorkerRequests).toHaveLength(1);
    expect(dxfWorkerRequests[0]).toMatchObject({ kind: 'dxf', source: 'part.dxf' });
    const objects = useStore.getState().project.scene.objects;
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({ kind: 'imported-svg', source: 'part.dxf' });
  });

  it('cancels the worker parse with the request', async () => {
    const posted: ImportWorkerRequest[] = [];
    const terminate = vi.fn();
    vi.stubGlobal(
      'Worker',
      class {
        postMessage(request: ImportWorkerRequest): void {
          posted.push(request);
        }
        terminate = terminate;
      },
    );
    const controller = new AbortController();
    const pending = adapter.execute('import_file', writeArgs(adapter, dxfFile(LINE_DXF)), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    controller.abort();
    expect(resultCode(await pending)).toBe('cancelled');
    expect(terminate).toHaveBeenCalledOnce();
    expect(useStore.getState().project.scene.objects).toEqual([]);
    expect(useStore.getState().undoStack).toEqual([]);
  });

  it('answers unavailable, without a parse on this thread, when the worker cannot start', async () => {
    vi.stubGlobal('Worker', undefined);
    const result = await adapter.execute('import_file', writeArgs(adapter, dxfFile(LINE_DXF)));
    expect(resultCode(result)).toBe('unavailable');
    expect(useStore.getState().project.scene.objects).toEqual([]);
  });

  it('refuses a drawing whose blocks expand past the budget, and changes nothing', async () => {
    const before = useStore.getState();
    const result = await adapter.execute(
      'import_file',
      writeArgs(adapter, dxfFile(nestedGridsPastBudgetDxf())),
    );
    expect(resultCode(result)).toBe('invalid_arguments');
    expect(dxfWorkerRequests).toHaveLength(1);
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toEqual(before.undoStack);
  });
});
