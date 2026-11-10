import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { SceneObject } from '../../core/scene';
import { importPostscriptFile, isPostscriptIllustratorFile } from './postscript-import-action';

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
