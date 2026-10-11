// @vitest-environment node
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  initialiseEditor,
  inspectEditor,
  saveEditorRevision,
  assertManagedDocument,
} from './artcraft-operations';
import type { ArtcraftProcess } from './artcraft-process';
import type { StoredArtcraftSession } from './artcraft-storage';

const directory = path.resolve('studio-test-session');
function mockProcess() {
  const request = vi.fn<ArtcraftProcess['request']>().mockResolvedValue(null);
  const process: ArtcraftProcess = { child: {} as ChildProcess, request, running: () => true };
  return { process, request };
}
function session(editor: 'photo' | 'vector'): StoredArtcraftSession {
  return { id: 'session', editor, title: 'Measured design', widthMm: 120, heightMm: 80 };
}

describe('full-editor document handoff', () => {
  it('creates a photo with pixels and DPI that preserve the requested millimetres', async () => {
    const { process, request } = mockProcess();
    await initialiseEditor(process, session('photo'), directory);
    expect(request).toHaveBeenNthCalledWith(1, 'engine.execute', {
      command: 'file.new',
      params: {
        width: 1200,
        height: 800,
        resolution: 254,
        name: 'Measured design',
        background: 'transparent',
        mode: 'rgb',
        depth: 8,
      },
    });
    expect(request).toHaveBeenLastCalledWith('ui.focus', {});
    request
      .mockResolvedValueOnce({
        active: 0,
        documents: [{ index: 0, revision: 4, path: 'working.pcraft' }],
      })
      .mockResolvedValueOnce({ revision: 4, resolution: 254, width: 1200, height: 800 });
    expect(await inspectEditor(process, 'photo')).toEqual({
      active: 0,
      revision: 4,
      documentPath: 'working.pcraft',
      widthMm: 120,
      heightMm: 80,
    });
  });

  it('creates vectors with explicit unit strings and disables background writes first', async () => {
    const { process, request } = mockProcess();
    await initialiseEditor(process, session('vector'), directory);
    expect(request).toHaveBeenNthCalledWith(1, 'engine.execute', {
      command: 'prefs.set',
      params: { values: { backgroundSave: false, backgroundExport: false } },
    });
    expect(request).toHaveBeenNthCalledWith(2, 'engine.execute', {
      command: 'file.new',
      params: { width: '120 mm', height: '80 mm', units: 'mm', title: 'Measured design' },
    });
  });

  it.each(['photo', 'vector'] as const)(
    'reopens the editable %s native source before the import source',
    async (editor) => {
      const { process, request } = mockProcess();
      await initialiseEditor(
        process,
        { ...session(editor), nativeFile: 'revisions/one/source.native', sourceFile: 'input.png' },
        directory,
      );
      expect(request).toHaveBeenCalledWith('app.open', {
        path:
          editor === 'photo'
            ? 'revisions/one/source.native'
            : path.join(directory, 'revisions/one/source.native'),
      });
      expect(
        request.mock.calls.some(
          ([method, params]) => method === 'engine.execute' && params?.['command'] === 'file.new',
        ),
      ).toBe(false);
    },
  );

  it('waits for the native photo save before exporting a flattened handoff', async () => {
    const { process, request } = mockProcess();
    let completeSave!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeSave = resolve;
        }),
    );
    const pending = saveEditorRevision(process, 'photo', directory, 'revisions/one');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('app.save', {});
    completeSave({ warnings: [] });
    await expect(pending).resolves.toEqual({
      native: 'working.pcraft',
      output: 'revisions/one/artwork.png',
    });
    expect(request).toHaveBeenNthCalledWith(2, 'app.save', { path: 'revisions/one/artwork.png' });
  });

  it('does not export after a native save fails', async () => {
    const { process, request } = mockProcess();
    request.mockRejectedValueOnce(new Error('disk full'));
    await expect(saveEditorRevision(process, 'vector', directory, 'revisions/one')).rejects.toThrow(
      'disk full',
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('uses root-contained absolute paths for vector native save and SVG export', async () => {
    const { process, request } = mockProcess();
    await saveEditorRevision(process, 'vector', directory, 'revisions/one');
    expect(request).toHaveBeenNthCalledWith(1, 'app.save', {});
    expect(request).toHaveBeenNthCalledWith(
      2,
      'app.export',
      expect.objectContaining({
        path: path.join(directory, 'revisions/one/artwork.svg'),
        format: 'svg',
      }),
    );
  });

  it('rejects a photo exceeding the transfer pixel budget before creating its document', async () => {
    const { process, request } = mockProcess();
    await expect(
      initialiseEditor(process, { ...session('photo'), widthMm: 1000, heightMm: 1000 }, directory),
    ).rejects.toThrow('pixel budget');
    expect(request).not.toHaveBeenCalled();
  });
});

it('rejects another tab or a Save As path before snapshot', () => {
  expect(() =>
    assertManagedDocument(
      { active: 1, revision: 4, documentPath: 'other.pcraft' },
      'photo',
      directory,
    ),
  ).toThrow('managed working document');
  expect(() =>
    assertManagedDocument(
      { active: 0, revision: 4, documentPath: 'working.pcraft' },
      'photo',
      directory,
    ),
  ).not.toThrow();
});
it('requires one VectorCraft artboard so no additional page is silently discarded', async () => {
  const { process, request } = mockProcess();
  request
    .mockResolvedValueOnce({ activeDocument: 0 })
    .mockResolvedValueOnce({ revision: 1, path: 'working.vectorcraft', artboards: [{}, {}] });
  await expect(inspectEditor(process, 'vector')).rejects.toThrow('exactly one');
});
it('converts VectorCraft points to millimetres independently of display units', async () => {
  const { process, request } = mockProcess();
  request.mockResolvedValueOnce({ activeDocument: 0 }).mockResolvedValueOnce({
    revision: 1,
    path: 'working.vectorcraft',
    units: 'mm',
    artboards: [{ width: 720, height: 360 }],
  });
  expect(await inspectEditor(process, 'vector')).toEqual({
    active: 0,
    revision: 1,
    documentPath: 'working.vectorcraft',
    widthMm: 254,
    heightMm: 127,
  });
});
