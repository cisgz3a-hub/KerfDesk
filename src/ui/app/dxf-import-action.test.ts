import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneObject } from '../../core/scene';
import { nestedMinsertDxf } from '../../__fixtures__/nested-minsert';
import { resetImportWorkerForTests } from '../import/import-worker-client';
import type { ImportWorkerRequest } from '../import/import-worker-protocol';
import type { ImportOutcome } from '../state/store';
import { importDxfFiles, isDxfFile } from './dxf-import-action';

function dxfLine(): string {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LINE',
    '10',
    '0',
    '20',
    '0',
    '11',
    '10',
    '21',
    '0',
    '0',
    'ENDSEC',
    '0',
    'EOF',
    '',
  ].join('\n');
}

function textOnlyDxf(): string {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'TEXT',
    '1',
    'hi',
    '0',
    'ENDSEC',
    '0',
    'EOF',
    '',
  ].join('\n');
}

function file(name: string, content: string): { name: string; text: () => Promise<string> } {
  return { name, text: async () => content };
}

describe('isDxfFile', () => {
  it('matches by extension, case-insensitively', () => {
    expect(isDxfFile({ name: 'part.dxf' })).toBe(true);
    expect(isDxfFile({ name: 'PART.DXF' })).toBe(true);
    expect(isDxfFile({ name: 'part.svg' })).toBe(false);
  });
});

describe('importDxfFiles', () => {
  afterEach(() => {
    resetImportWorkerForTests();
    vi.unstubAllGlobals();
  });

  it('keeps a tiny nested MINSERT on the cancellable worker path without reading text on the UI thread', async () => {
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
    const content = nestedMinsertDxf();
    const blob = new Blob([content]);
    const text = vi.fn(async () => content);
    const importObject = vi.fn(() => ({ kind: 'added' as const }));
    const pushToast = vi.fn();
    const pending = importDxfFiles(
      [{ name: 'nested.dxf', size: blob.size, blob: async () => blob, text }],
      { importObject, pushToast },
    );
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(blob.size).toBeLessThan(500);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ kind: 'dxf', blob, source: 'nested.dxf' });
    expect(text).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await pending;
    expect(terminate).toHaveBeenCalledOnce();
    expect(importObject).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith('nested.dxf: import cancelled.', 'warning');
  });

  it('imports through the disclosed main-thread fallback when worker construction fails', async () => {
    vi.stubGlobal('Worker', function WorkerUnavailable(): never {
      throw new Error('workers blocked');
    });
    const blob = { size: dxfLine().length } as unknown as Blob;
    const readFile = vi.fn(async () => dxfLine());
    const importObject = vi.fn(() => ({ kind: 'added' as const }));
    const pushToast = vi.fn();

    await importDxfFiles([{ name: 'fallback.dxf', text: readFile, blob: async () => blob }], {
      importObject,
      pushToast,
    });

    expect(readFile).toHaveBeenCalledOnce();
    expect(importObject).toHaveBeenCalledOnce();
    expect(pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/fallback\.dxf.*main thread.*unresponsive/i),
      'warning',
    );
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('Imported 1 path'), 'success');
  });

  it('imports parsed geometry and toasts the path count', async () => {
    const imported: SceneObject[] = [];
    const pushToast = vi.fn();
    await importDxfFiles([file('part.dxf', dxfLine())], {
      importObject: (obj) => {
        imported.push(obj);
        return { kind: 'added' };
      },
      pushToast,
    });

    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ kind: 'imported-svg', source: 'part.dxf' });
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('1 path'), 'success');
  });

  // IMP-07: when the handle reports its size, gate the oversize confirm BEFORE
  // reading, so a declined huge file is never pulled into memory. (The existing
  // no-size handles above exercise the post-read fallback.)
  // Rule 7 / ADR-228: was "a declined oversize file is never read". Size is a
  // policy judgement, so an oversize DXF now imports and merely warns first.
  it('advises on size before reading, then imports the oversize file anyway', async () => {
    const text = vi.fn(async () => dxfLine());
    const importObject = vi.fn(() => ({ kind: 'added' as const }));
    const pushToast = vi.fn();

    await importDxfFiles([{ name: 'huge.dxf', size: 26 * 1024 * 1024, text }], {
      importObject: importObject as never,
      pushToast,
    });

    expect(text).toHaveBeenCalled();
    expect(importObject).toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/may take a while/i), 'warning');
  });

  it('routes re-imports through the replace toast', async () => {
    const pushToast = vi.fn();
    await importDxfFiles([file('part.dxf', dxfLine())], {
      importObject: () => ({ kind: 'replaced', source: 'part.dxf', kept: 2, added: 1, removed: 0 }),
      pushToast,
    });

    expect(pushToast).toHaveBeenCalledTimes(1);
    const message = pushToast.mock.calls[0]?.[0] as string;
    expect(message).toContain('part.dxf');
  });

  it('warns with the skip summary when no supported geometry exists', async () => {
    const importObject = vi.fn();
    const pushToast = vi.fn();
    await importDxfFiles([file('notes.dxf', textOnlyDxf())], {
      importObject: importObject as never,
      pushToast,
    });

    expect(importObject).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('1 TEXT'), 'warning');
  });

  it('surfaces parser rejections as error toasts', async () => {
    const pushToast = vi.fn();
    await importDxfFiles([file('bad.dxf', 'AutoCAD Binary DXF\r\n')], {
      importObject: () => ({ kind: 'added' }),
      pushToast,
    });

    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('ASCII'), 'error');
  });

  it('continues past a failing file to the next one', async () => {
    const imported: SceneObject[] = [];
    const pushToast = vi.fn();
    await importDxfFiles(
      [
        {
          name: 'boom.dxf',
          text: async () => {
            throw new Error('unreadable');
          },
        },
        file('ok.dxf', dxfLine()),
      ],
      {
        importObject: (obj) => {
          imported.push(obj);
          return { kind: 'added' };
        },
        pushToast,
      },
    );

    expect(imported).toHaveLength(1);
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('unreadable'), 'error');
  });
});

describe('importDxfFiles parser notes', () => {
  function dxfTags(...pairs: ReadonlyArray<readonly [number, string | number]>): string {
    return pairs.map(([code, value]) => `${code}\n${value}`).join('\n');
  }

  // A LINE plus one INSERT per named block; none of the blocks exist.
  function dxfWithUnknownBlocks(names: ReadonlyArray<string>, header = ''): string {
    return [
      header,
      dxfTags([0, 'SECTION'], [2, 'ENTITIES']),
      dxfTags([0, 'LINE'], [10, 0], [20, 0], [11, 10], [21, 0]),
      ...names.map((name) => dxfTags([0, 'INSERT'], [2, name], [10, 0], [20, 0])),
      dxfTags([0, 'ENDSEC'], [0, 'EOF']),
    ]
      .filter((part) => part !== '')
      .join('\n');
  }

  const MICROINCH_HEADER = dxfTags(
    [0, 'SECTION'],
    [2, 'HEADER'],
    [9, '$INSUNITS'],
    [70, 8],
    [0, 'ENDSEC'],
  );

  async function toastsFor(
    content: string,
    outcome: ImportOutcome = { kind: 'added' },
  ): Promise<ReadonlyArray<readonly [string, string | undefined]>> {
    const toasts: [string, string | undefined][] = [];
    await importDxfFiles([file('part.dxf', content)], {
      importObject: () => outcome,
      pushToast: (message, variant) => toasts.push([message, variant]),
    });
    return toasts;
  }

  it('warns with each note after the summary and keeps the bed-fit notice last', async () => {
    const toasts = await toastsFor(dxfWithUnknownBlocks(['HOLES'], MICROINCH_HEADER), {
      kind: 'added',
      bedFit: { scale: 0.5, widthMm: 800, heightMm: 10, bedWidthMm: 400, bedHeightMm: 400 },
    });
    expect(toasts).toEqual([
      ['Imported 1 path from part.dxf — skipped 1 INSERT.', 'success'],
      ['part.dxf: Unrecognized $INSUNITS 8 — assuming millimeters.', 'warning'],
      ['part.dxf: INSERT references unknown block "HOLES"', 'warning'],
      [expect.stringContaining('scaled to 50%'), 'warning'],
    ]);
  });

  it('warns with the notes after a re-import too', async () => {
    const toasts = await toastsFor(dxfWithUnknownBlocks(['HOLES']), {
      kind: 'replaced',
      source: 'part.dxf',
      kept: 1,
      added: 0,
      removed: 0,
    });
    expect(toasts.map(([message]) => message)).toEqual([
      expect.stringContaining('Re-imported part.dxf'),
      'part.dxf: INSERT references unknown block "HOLES"',
    ]);
  });

  it('explains an empty import with its notes', async () => {
    const content = [
      dxfTags([0, 'SECTION'], [2, 'ENTITIES']),
      dxfTags([0, 'INSERT'], [2, 'HOLES'], [10, 0], [20, 0]),
      dxfTags([0, 'ENDSEC'], [0, 'EOF']),
    ].join('\n');
    expect(await toastsFor(content)).toEqual([
      ['part.dxf: no supported geometry — skipped 1 INSERT.', 'warning'],
      ['part.dxf: INSERT references unknown block "HOLES"', 'warning'],
    ]);
  });

  it('caps the note toasts and counts the rest', async () => {
    const toasts = await toastsFor(dxfWithUnknownBlocks(['A', 'B', 'C', 'D', 'E']));
    expect(toasts.map(([message]) => message)).toEqual([
      'Imported 1 path from part.dxf — skipped 5 INSERT.',
      'part.dxf: INSERT references unknown block "A"',
      'part.dxf: INSERT references unknown block "B"',
      'part.dxf: 3 more import warnings.',
    ]);
  });
});
