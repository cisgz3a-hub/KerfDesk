import { mkdir, readFile, readdir, rename, writeFile, realpath, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { record, type ArtcraftEditor } from './artcraft-types.js';

export type StoredArtcraftSession = {
  id: string;
  editor: ArtcraftEditor;
  title: string;
  sourceFile?: string;
  nativeFile?: string;
  widthMm?: number;
  heightMm?: number;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function studioDirectory(root: string, id: string): string {
  if (!UUID.test(id)) throw new Error('Invalid studio session');
  return path.join(root, id);
}
export async function saveStudioSession(
  root: string,
  session: StoredArtcraftSession,
): Promise<void> {
  const directory = studioDirectory(root, session.id);
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, 'session.json');
  const temporary = path.join(directory, `session-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(session), { flag: 'wx' });
  await rename(temporary, destination);
}
export async function loadStudioSessions(root: string): Promise<StoredArtcraftSession[]> {
  await mkdir(root, { recursive: true });
  const result: StoredArtcraftSession[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
    try {
      const candidate = await loadSession(root, entry.name);
      if (candidate === null) continue;
      result.push(candidate);
    } catch {
      /* An incomplete or invalid session never authorises an external path. */
    }
  }
  return result;
}
export async function studioFile(directory: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative)) throw new Error('Invalid studio file');
  const root = await realpath(directory);
  const file = await realpath(path.join(root, relative));
  const inside = path.relative(root, file);
  if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('Invalid studio file');
  if (!(await stat(file)).isFile()) throw new Error('Studio source is not a file');
  return file;
}
export async function boundedStudioRead(file: string): Promise<Buffer> {
  if ((await stat(file)).size > 32 * 1024 * 1024) {
    throw new Error('Artwork exceeds the 32 MB prototype transfer limit.');
  }
  const bytes = await readFile(file);
  if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('Artwork transfer exceeded its limit.');
  return bytes;
}

async function loadSession(root: string, id: string): Promise<StoredArtcraftSession | null> {
  const value = record(JSON.parse(await readFile(path.join(root, id, 'session.json'), 'utf8')));
  if (
    value['id'] !== id ||
    !['photo', 'vector'].includes(String(value['editor'])) ||
    typeof value['title'] !== 'string'
  )
    return null;
  const candidate: StoredArtcraftSession = {
    id: id,
    editor: value['editor'] as ArtcraftEditor,
    title: value['title'].slice(0, 240),
  };
  await recoverSessionFiles(root, id, value, candidate);
  for (const key of ['widthMm', 'heightMm'] as const) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] > 0) {
      candidate[key] = value[key];
    }
  }
  return candidate;
}

async function recoverSessionFiles(
  root: string,
  id: string,
  value: Record<string, unknown>,
  candidate: StoredArtcraftSession,
): Promise<void> {
  const directory = studioDirectory(root, id);
  const working = candidate.editor === 'photo' ? 'working.pcraft' : 'working.vectorcraft';
  const existingWorking = await studioFile(directory, working).then(
    () => true,
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    },
  );
  for (const key of ['nativeFile', 'sourceFile'] as const) {
    if (typeof value[key] !== 'string') continue;
    try {
      await studioFile(directory, value[key]);
      candidate[key] = value[key];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !existingWorking) throw error;
      // A saved working document is recoverable even after an older input/revision was removed.
      candidate.nativeFile = working;
    }
  }
}
