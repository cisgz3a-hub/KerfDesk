import { Blob as NodeBlob } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneObject } from '../../core/scene';
import {
  installImportWorkers,
  postscriptWorkerRequests,
  resetImportWorkers,
} from '../import/import-workers.test-support';
import { mainThreadImportFallbackAdvisory } from './import-size-advisory';
import {
  importPostscriptFile,
  isPostscriptIllustratorFile,
  POSTSCRIPT_HANG_GUARD_MS,
} from './postscript-import-action';

const golden = (name: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(new URL('../../io/vector-formats/__golden__/' + name, import.meta.url)),
    ),
  );

function context() {
  const imported: SceneObject[] = [];
  return {
    imported,
    importObject: vi.fn((object: SceneObject) => {
      imported.push(object);
      return { kind: 'added' as const };
    }),
    pushToast: vi.fn(),
  };
}

describe('EPS / Illustrator import action', () => {
  it('imports an EPS file as editable artwork named after the file', async () => {
    const ctx = context();
    await importPostscriptFile(new File([golden('sample-artwork.eps')], 'sample.eps'), ctx);
    expect(ctx.imported).toHaveLength(1);
    const object = ctx.imported[0];
    if (object?.kind !== 'imported-svg') throw new Error('expected imported artwork');
    expect(object.source).toBe('sample.eps');
    expect(object.paths.map((p) => p.color).sort()).toEqual(['#1a2b3c', '#ff0000']);
    expect(ctx.pushToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  it('reports a file it cannot read and imports nothing', async () => {
    const ctx = context();
    const bad = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n0 0 moveto frobnicate\n';
    await importPostscriptFile(new File([bad], 'bad.eps'), ctx);
    expect(ctx.importObject).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/^bad\.eps: .*"frobnicate"/),
      'error',
    );
  });

  it('tells PostScript Illustrator files from PDF-based ones', async () => {
    expect(await isPostscriptIllustratorFile(new File(['%!PS-Adobe-2.0\n'], 'a.ai'))).toBe(true);
    expect(await isPostscriptIllustratorFile(new File(['%PDF-1.6\n'], 'b.ai'))).toBe(false);
    const dos = new Uint8Array([0xc5, 0xd0, 0xd3, 0xc6, 0, 0]);
    expect(await isPostscriptIllustratorFile(new File([dos], 'c.ai'))).toBe(true);
  });
});

describe('EPS / Illustrator import in the import worker (ADR-700 Amd 3)', () => {
  const EPS_TEXT = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 72 72\n0 0 72 72 rectfill\n';
  const epsFile = (name: string): File =>
    Object.assign(new NodeBlob([EPS_TEXT]), { name }) as unknown as File;

  afterEach(() => {
    vi.useRealTimers();
    resetImportWorkers();
  });

  it('converts in the worker and imports the artwork, with no main-thread fallback', async () => {
    installImportWorkers();
    const ctx = context();
    await importPostscriptFile(epsFile('square.eps'), ctx);
    expect(postscriptWorkerRequests).toHaveLength(1);
    expect(ctx.imported).toHaveLength(1);
    expect(ctx.pushToast).not.toHaveBeenCalledWith(
      mainThreadImportFallbackAdvisory('square.eps'),
      'warning',
    );
  });

  it('gives up on a worker that never answers and retires it', async () => {
    vi.useFakeTimers();
    const terminated = vi.fn();
    class SilentWorker {
      onmessage: unknown = null;
      onerror: unknown = null;
      postMessage(): void {
        // Never answers: the conversion it was sent never finishes.
      }
      terminate(): void {
        terminated();
      }
    }
    vi.stubGlobal('Worker', SilentWorker);
    const ctx = context();
    const done = importPostscriptFile(epsFile('stuck.eps'), ctx);
    await vi.advanceTimersByTimeAsync(POSTSCRIPT_HANG_GUARD_MS);
    await done;
    expect(ctx.importObject).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith(
      `stuck.eps: the file was still being read after ${POSTSCRIPT_HANG_GUARD_MS / 1000} s, so the import stopped.`,
      'error',
    );
    expect(terminated).toHaveBeenCalled();
  });

  it('says so when it has to read on the window thread', async () => {
    const ctx = context();
    await importPostscriptFile(new File([EPS_TEXT], 'here.eps'), ctx);
    expect(ctx.pushToast).toHaveBeenCalledWith(
      mainThreadImportFallbackAdvisory('here.eps'),
      'warning',
    );
    expect(ctx.imported).toHaveLength(1);
  });
});
