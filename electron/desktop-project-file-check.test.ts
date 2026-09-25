// @vitest-environment node
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkDesktopProjectPath,
  type DesktopProjectFileSystem,
} from './desktop-project-file-check.js';

let root = '';
// Creating links needs extra rights on Windows runners.
const linkTest = it.skipIf(process.platform === 'win32');

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'kerfdesk-project-check-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('checkDesktopProjectPath', () => {
  it('accepts a regular project file and reports what the renderer may show', async () => {
    const file = path.join(root, 'Coasters.lf2');
    await writeFile(file, '{"schemaVersion":7}');

    const checked = await checkDesktopProjectPath(file);

    expect(checked).toMatchObject({ kind: 'file', path: file, name: 'Coasters.lf2', size: 19 });
  });

  it('reports a file that is gone as missing', async () => {
    await expect(checkDesktopProjectPath(path.join(root, 'gone.lf2'))).resolves.toEqual({
      kind: 'missing',
    });
  });

  it('refuses a folder that carries a project extension', async () => {
    const folder = path.join(root, 'folder.lf2');
    await mkdir(folder);

    await expect(checkDesktopProjectPath(folder)).resolves.toEqual({ kind: 'invalid' });
  });

  linkTest('refuses a project-named link to a file of another type', async () => {
    const secret = path.join(root, 'secret.txt');
    const link = path.join(root, 'innocent.lf2');
    await writeFile(secret, 'not a project');
    await symlink(secret, link);

    await expect(checkDesktopProjectPath(link)).resolves.toEqual({ kind: 'invalid' });
  });

  linkTest('follows a link to another project file and reads the target', async () => {
    const target = path.join(root, 'real.lf2');
    const link = path.join(root, 'alias.lf2');
    await writeFile(target, '{}');
    await symlink(target, link);

    await expect(checkDesktopProjectPath(link)).resolves.toMatchObject({
      kind: 'file',
      path: link,
      realPath: await realpath(target),
      name: 'alias.lf2',
    });
  });

  it('never touches the disk for a relative, dotted or non-project path', async () => {
    const fileSystem: DesktopProjectFileSystem = {
      realpath: vi.fn(async (file: string) => file),
      stat: vi.fn(async () => ({ isFile: () => true, size: 1, mtimeMs: 1 })),
    };

    for (const candidate of ['sign.lf2', `${root}/../x.lf2`, path.join(root, 'notes.txt')]) {
      await expect(checkDesktopProjectPath(candidate, fileSystem)).resolves.toEqual({
        kind: 'invalid',
      });
    }
    expect(fileSystem.realpath).not.toHaveBeenCalled();
  });

  it('reports a permission failure as unreadable', async () => {
    const denied = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    const fileSystem: DesktopProjectFileSystem = {
      realpath: async () => {
        throw denied;
      },
      stat: async () => ({ isFile: () => true, size: 1, mtimeMs: 1 }),
    };

    await expect(
      checkDesktopProjectPath(path.join(root, 'locked.lf2'), fileSystem),
    ).resolves.toEqual({ kind: 'unreadable' });
  });
});
