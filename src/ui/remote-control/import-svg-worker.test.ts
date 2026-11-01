import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ciBudgetMs } from '../../__fixtures__/ci-budget';
import { svgUseCopies } from '../../__fixtures__/svg-use-copies';
import type { DocumentImportWorkerRequest } from '../import/document-import-worker-protocol';
import {
  installImportWorkers,
  resetImportWorkers,
  svgWorkerRequests,
} from '../import/import-workers.test-support';
import { useStore } from '../state/store';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

const LINE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 40 20">' +
  '<path d="M0 0 L40 20" fill="none" stroke="#000000"/></svg>';
const svgFile = (svg: string) => ({
  fileName: 'part.svg',
  mimeType: 'image/svg+xml',
  dataBase64: btoa(svg),
});
type Route = 'add_svg' | 'import_file' | 'apply_edits';
const routes: Record<Route, (svg: string) => readonly [Route, Record<string, unknown>]> = {
  add_svg: (svg) => ['add_svg', { svg }],
  import_file: (svg) => ['import_file', svgFile(svg)],
  apply_edits: (svg) => ['apply_edits', { edits: [{ command: 'add_svg', args: { svg } }] }],
};

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

const run = (route: Route, svg: string, signal?: AbortSignal) => {
  const [command, args] = routes[route](svg);
  return adapter.execute(command, writeArgs(adapter, args), signal === undefined ? {} : { signal });
};

describe('remote SVG import uses the document import worker, as File > Import does', () => {
  it.each(Object.keys(routes) as Route[])(
    '%s parses the SVG in the document import worker',
    async (route) => {
      expect(resultCode(await run(route, LINE_SVG))).toBe('ok');
      expect(svgWorkerRequests).toHaveLength(1);
      expect(svgWorkerRequests[0]).toMatchObject({ kind: 'svg' });
      const objects = useStore.getState().project.scene.objects;
      expect(objects).toHaveLength(1);
      expect(objects[0]).toMatchObject({ kind: 'imported-svg' });
    },
  );

  it.each(Object.keys(routes) as Route[])(
    '%s cancels the worker parse with the request',
    async (route) => {
      const posted: DocumentImportWorkerRequest[] = [];
      const terminate = vi.fn();
      vi.stubGlobal(
        'Worker',
        class {
          postMessage(request: DocumentImportWorkerRequest): void {
            posted.push(request);
          }
          terminate = terminate;
        },
      );
      const controller = new AbortController();
      const pending = run(route, LINE_SVG, controller.signal);
      await vi.waitFor(() => expect(posted).toHaveLength(1));
      controller.abort();
      expect(resultCode(await pending)).toBe('cancelled');
      expect(terminate).toHaveBeenCalledOnce();
      expect(useStore.getState().project.scene.objects).toEqual([]);
      expect(useStore.getState().undoStack).toEqual([]);
    },
  );

  it('answers unavailable, without a parse on this thread, when the worker cannot start', async () => {
    vi.stubGlobal('Worker', undefined);
    expect(resultCode(await run('add_svg', LINE_SVG))).toBe('unavailable');
    expect(useStore.getState().project.scene.objects).toEqual([]);
  });

  it(
    'refuses <use> copies past the point budget, and changes nothing',
    async () => {
      const before = useStore.getState();
      expect(resultCode(await run('add_svg', svgUseCopies(1_000, 501)))).not.toBe('ok');
      expect(svgWorkerRequests).toHaveLength(1);
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toEqual(before.undoStack);
    },
    ciBudgetMs(20_000, 60_000),
  );
});
