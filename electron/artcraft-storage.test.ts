// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadStudioSessions,
  saveStudioSession,
  studioDirectory,
  studioFile,
} from './artcraft-storage';

const temporary: string[] = [];
const id = '11111111-2222-3333-4444-555555555555';
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kerfdesk-studio-test-'));
  temporary.push(root);
  const directory = studioDirectory(root, id);
  await mkdir(directory);
  await writeFile(path.join(directory, 'working.pcraft'), 'native');
  await writeFile(path.join(root, 'outside.pcraft'), 'outside');
  return { root, directory };
}
afterEach(async () => {
  for (const root of temporary.splice(0)) {
    if (
      path.dirname(root) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith('kerfdesk-studio-test-')
    )
      throw new Error('Unexpected test cleanup path');
    await rm(root, { recursive: true, force: true });
  }
});

describe('studio session file confinement', () => {
  it('loads valid editable session files and preserves measured dimensions', async () => {
    const { root, directory } = await fixture();
    const session = {
      id,
      editor: 'photo' as const,
      title: 'Design',
      nativeFile: 'working.pcraft',
      widthMm: 100,
      heightMm: 80,
    };
    await saveStudioSession(root, session);
    expect(await loadStudioSessions(root)).toEqual([session]);
    expect(await studioFile(directory, 'working.pcraft')).toBe(
      path.join(directory, 'working.pcraft'),
    );
  });
  it('rejects absolute paths, parent traversal and folders as sources', async () => {
    const { root, directory } = await fixture();
    await expect(studioFile(directory, path.join(root, 'outside.pcraft'))).rejects.toThrow(
      'Invalid studio file',
    );
    await expect(studioFile(directory, '../outside.pcraft')).rejects.toThrow('Invalid studio file');
    await expect(studioFile(directory, '.')).rejects.toThrow('not a file');
    expect(() => studioDirectory(root, '../elsewhere')).toThrow('Invalid studio session');
  });
  it('follows junctions before deciding whether a source stays inside the session', async () => {
    const { root, directory } = await fixture();
    await symlink(root, path.join(directory, 'outside-link'), 'junction');
    await expect(studioFile(directory, 'outside-link/outside.pcraft')).rejects.toThrow(
      'Invalid studio file',
    );
  });
  it('does not restore a session that refers to a file outside its workspace', async () => {
    const { root } = await fixture();
    await saveStudioSession(root, {
      id,
      editor: 'photo',
      title: 'Design',
      nativeFile: '../outside.pcraft',
    });
    expect(await loadStudioSessions(root)).toEqual([]);
  });
});

it('restores a saved working file after the older applied revision was removed', async () => {
  const { root } = await fixture();
  await saveStudioSession(root, {
    id,
    editor: 'photo',
    title: 'Recovered',
    nativeFile: 'revisions/missing/source.pcraft',
  });
  expect(await loadStudioSessions(root)).toEqual([
    { id, editor: 'photo', title: 'Recovered', nativeFile: 'working.pcraft' },
  ]);
});
it('does not recover through a working-file junction that escapes the session', async () => {
  const { root, directory } = await fixture();
  await rm(path.join(directory, 'working.pcraft'));
  await symlink(root, path.join(directory, 'working.pcraft'), 'junction');
  await saveStudioSession(root, {
    id,
    editor: 'photo',
    title: 'Invalid',
    nativeFile: 'revisions/missing/source.pcraft',
  });
  expect(await loadStudioSessions(root)).toEqual([]);
});
