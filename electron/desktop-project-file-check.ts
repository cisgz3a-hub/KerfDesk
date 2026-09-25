// The check main runs before it reads a project file the operating system
// handed over (ADR-378), repeated on every read so a path that has since
// become a folder, a device or a link to some other file type is refused.

import { realpath as realpathCallback } from 'node:fs';
import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { hasProjectExtension, isCanonicalPath, type PathApi } from './desktop-project-paths.js';

export type DesktopProjectFile = {
  readonly kind: 'file';
  /** The path as the operating system named it; the renderer shows this one. */
  readonly path: string;
  /** Links resolved: the file actually read. */
  readonly realPath: string;
  readonly name: string;
  readonly size: number;
  readonly modifiedMs: number;
};

export type DesktopProjectFileCheck =
  | DesktopProjectFile
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unreadable' };

export type DesktopProjectFileSystem = {
  readonly realpath: (file: string) => Promise<string>;
  readonly stat: (
    file: string,
  ) => Promise<{ isFile(): boolean; readonly size: number; readonly mtimeMs: number }>;
};

// The callback realpath walks links with lstat. The native one fails outright
// on some virtual and RAM drives that Explorer opens files from.
export const NODE_PROJECT_FILE_SYSTEM: DesktopProjectFileSystem = {
  realpath: promisify(realpathCallback),
  stat,
};

export async function checkDesktopProjectPath(
  candidate: string,
  fileSystem: DesktopProjectFileSystem = NODE_PROJECT_FILE_SYSTEM,
  pathApi: PathApi = path,
): Promise<DesktopProjectFileCheck> {
  if (!isCanonicalPath(candidate, pathApi) || !hasProjectExtension(candidate, pathApi)) {
    return { kind: 'invalid' };
  }
  try {
    const realPath = await fileSystem.realpath(candidate);
    if (!hasProjectExtension(realPath, pathApi)) return { kind: 'invalid' };
    const info = await fileSystem.stat(realPath);
    if (!info.isFile()) return { kind: 'invalid' };
    return {
      kind: 'file',
      path: candidate,
      realPath,
      name: pathApi.basename(candidate),
      size: info.size,
      modifiedMs: info.mtimeMs,
    };
  } catch (error) {
    return { kind: failureKind(error) };
  }
}

function failureKind(error: unknown): 'missing' | 'invalid' | 'unreadable' {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing';
  if (code === 'ELOOP' || code === 'EISDIR') return 'invalid';
  return 'unreadable';
}
