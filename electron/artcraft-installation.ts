import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { record, type ArtcraftEditor } from './artcraft-types.js';

export const ARTCRAFT_VERSIONS = { photo: '0.7.0', vector: '0.9.0' } as const;
export const ARTCRAFT_EXECUTABLE_SHA256 = {
  photo: 'dca47bc19136e8d4849e03525f53accd23413a6727704f3b0ba8bd044af2b6da',
  vector: '6358fce5057af01e12d18f148b7a7237c97013892197aa8cb18af1b921b0b7a5',
} as const;
export type ArtcraftInstallation = { executable: string; version: string };

export async function readArtcraftInstallation(
  root: string | undefined,
  editor: ArtcraftEditor,
  verifyBinary = false,
): Promise<ArtcraftInstallation | null> {
  if (root === undefined || process.platform !== 'win32') return null;
  try {
    const canonicalRoot = await realpath(root);
    const manifest = record(
      JSON.parse(await readFile(path.join(canonicalRoot, 'manifest.json'), 'utf8')),
    );
    const candidate = editorCandidate(manifest, editor);
    if (candidate === null) return null;
    const relative = candidate['executable'];
    if (typeof relative !== 'string' || path.isAbsolute(relative)) return null;
    const executable = await realpath(path.join(canonicalRoot, relative));
    const inside = path.relative(canonicalRoot, executable);
    if (!safeExecutable(inside, executable)) return null;
    if (verifyBinary && (await binaryHash(executable)) !== ARTCRAFT_EXECUTABLE_SHA256[editor]) {
      throw new Error(
        'Editor executable changed. Run the editor setup again from verified archives.',
      );
    }
    return { executable, version: ARTCRAFT_VERSIONS[editor] };
  } catch {
    return null;
  }
}

async function binaryHash(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Uint8Array);
  return hash.digest('hex');
}

function editorCandidate(
  manifest: Record<string, unknown>,
  editor: ArtcraftEditor,
): Record<string, unknown> | null {
  if (manifest['schema'] !== 1 || !Array.isArray(manifest['editors'])) return null;
  const entries: unknown[] = manifest['editors'];
  const candidate = entries.map(record).find((item) => item['id'] === editor);
  return candidate?.['version'] === ARTCRAFT_VERSIONS[editor] &&
    candidate['executableSha256'] === ARTCRAFT_EXECUTABLE_SHA256[editor]
    ? candidate
    : null;
}

function safeExecutable(relative: string, executable: string): boolean {
  return !relative.startsWith('..') && !path.isAbsolute(relative) && executable.endsWith('.exe');
}
