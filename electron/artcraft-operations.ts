import path from 'node:path';
import type { ArtcraftProcess } from './artcraft-process.js';
import { record, type ArtcraftEditor } from './artcraft-types.js';
import type { StoredArtcraftSession } from './artcraft-storage.js';

export function workingFile(editor: ArtcraftEditor): string {
  return editor === 'photo' ? 'working.pcraft' : 'working.vectorcraft';
}
export async function initialiseEditor(
  process: ArtcraftProcess,
  session: StoredArtcraftSession,
  directory: string,
): Promise<void> {
  if (session.editor === 'vector') {
    await execute(process, 'prefs.set', {
      values: { backgroundSave: false, backgroundExport: false },
    });
  }
  const source = session.nativeFile ?? session.sourceFile;
  if (source !== undefined) {
    await process.request('app.open', { path: editorPath(session.editor, directory, source) });
  } else if (session.editor === 'photo') {
    const width = Math.round((session.widthMm ?? 100) * 10);
    const height = Math.round((session.heightMm ?? 100) * 10);
    if (width * height > 16_000_000)
      throw new Error('New photo exceeds the prototype pixel budget.');
    await execute(process, 'file.new', {
      width,
      height,
      resolution: 254,
      name: session.title,
      background: 'transparent',
      mode: 'rgb',
      depth: 8,
    });
  } else {
    await execute(process, 'file.new', {
      width: `${session.widthMm ?? 100} mm`,
      height: `${session.heightMm ?? 100} mm`,
      units: 'mm',
      title: session.title,
    });
  }
  await process.request('app.save', {
    path: editorPath(session.editor, directory, workingFile(session.editor)),
  });
  await process.request('ui.focus', {});
}
export type EditorRevision = {
  active: unknown;
  revision: unknown;
  documentPath: string;
  widthMm?: number;
  heightMm?: number;
};
export async function inspectEditor(
  process: ArtcraftProcess,
  editor: ArtcraftEditor,
): Promise<EditorRevision> {
  if (editor === 'photo') return inspectPhoto(process);
  const ui = record(await process.request('ui.inspect', {}));
  const doc = record(await process.request('document.inspect', { depth: 0 }));
  const artboards = doc['artboards'];
  if (!Array.isArray(artboards) || artboards.length !== 1) {
    throw new Error('Apply currently requires exactly one VectorCraft artboard.');
  }
  const board = record(artboards[0]);
  return {
    ...identity(ui['activeDocument'], doc),
    widthMm: (Number(board['width']) * 25.4) / 72,
    heightMm: (Number(board['height']) * 25.4) / 72,
  };
}
async function inspectPhoto(process: ArtcraftProcess): Promise<EditorRevision> {
  const session = record(await execute(process, 'session.inspect', {}));
  const documents = session['documents'];
  if (!Array.isArray(documents)) throw new Error('Editor has no active document.');
  const document = documents.map(record).find((doc) => doc['index'] === session['active']);
  if (document === undefined) throw new Error('Editor has no active document.');
  const doc = record(await execute(process, 'document.inspect', { document: session['active'] }));
  const resolution = Number(doc['resolution']);
  if (!Number.isFinite(resolution) || resolution <= 0)
    throw new Error('Photo resolution is invalid.');
  return {
    ...identity(session['active'], document),
    widthMm: (Number(doc['width']) * 25.4) / resolution,
    heightMm: (Number(doc['height']) * 25.4) / resolution,
  };
}
function identity(active: unknown, doc: Record<string, unknown>): EditorRevision {
  if (
    !Number.isInteger(active) ||
    Number(active) < 0 ||
    doc['revision'] === undefined ||
    typeof doc['path'] !== 'string'
  ) {
    throw new Error('Editor has no managed active document.');
  }
  return { active, revision: doc['revision'], documentPath: doc['path'] };
}
export function assertManagedDocument(
  revision: EditorRevision,
  editor: ArtcraftEditor,
  directory: string,
): void {
  if (
    path.resolve(directory, revision.documentPath) !== path.resolve(directory, workingFile(editor))
  ) {
    throw new Error(
      'Select the managed working document before Apply. Other tabs and Save As documents are not linked.',
    );
  }
}
export async function saveEditorRevision(
  process: ArtcraftProcess,
  editor: ArtcraftEditor,
  directory: string,
  relative: string,
): Promise<{ native: string; output: string }> {
  const native = workingFile(editor);
  const output = `${relative}/artwork.${editor === 'photo' ? 'png' : 'svg'}`;
  // Save to the active document's OWN path: a tab switch must never overwrite the managed file with another tab.
  await process.request('app.save', {});
  if (editor === 'photo') {
    await process.request('app.save', { path: output });
  } else {
    const result = await process.request('app.export', {
      path: path.join(directory, output),
      format: 'svg',
      artboard: 0,
      svg: {
        outlineText: true,
        images: 'embed',
        responsive: false,
        preserveEditing: false,
        decimals: 6,
      },
    });
    // Do not silently accept an upstream lossy-export warning.
    if (result !== null && typeof result === 'object' && 'warnings' in result) {
      const warnings = result.warnings;
      if (Array.isArray(warnings) && warnings.length > 0)
        throw new Error(
          'VectorCraft reported export warnings. Simplify the artwork before Apply: ' +
            warnings.map(String).join('; '),
        );
    }
  }
  return { native, output };
}
function execute(
  process: ArtcraftProcess,
  command: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return process.request('engine.execute', { command, params });
}
function editorPath(editor: ArtcraftEditor, directory: string, relative: string): string {
  return editor === 'photo' ? relative : path.join(directory, relative);
}
