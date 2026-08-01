import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneObject } from '../../core/scene';
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
  afterEach(() => vi.unstubAllGlobals());

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
