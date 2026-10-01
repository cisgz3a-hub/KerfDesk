import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, opendir, rename, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { manualDownloadUrl } from '../public/desktop-manual-download.mjs';
import type { ManualCandidate, UpdateFetch } from './manual-update-manifest.js';

export type StagedManualUpdate = ManualCandidate & { readonly path: string };

/** Only main derives the destination; no renderer-supplied URL or path is accepted. */
export async function downloadManualInstaller(
  candidate: ManualCandidate,
  userDataPath: string,
  fetch: UpdateFetch,
): Promise<StagedManualUpdate> {
  const folder = join(userDataPath, 'manual-updates');
  await mkdir(folder, { recursive: true });
  await requireOrdinaryDirectory(folder);
  const path = join(folder, `${candidate.release.version}-${randomUUID()}.exe`);
  const temporary = `${path}.partial`;
  try {
    await receive(candidate, temporary, fetch);
    await rename(temporary, path);
    return { ...candidate, path };
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

const OWNED_NAME =
  /^(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.exe(?:\.partial)?$/;

/** Forgotten downloads are never executable authority on the next launch. */
export async function pruneManualInstallerCache(userDataPath: string): Promise<void> {
  const folder = join(userDataPath, 'manual-updates');
  try {
    await requireOrdinaryDirectory(folder);
    const directory = await opendir(folder);
    let examined = 0;
    for await (const entry of directory) {
      if (++examined > 128) break;
      if (entry.isFile() && OWNED_NAME.test(entry.name)) {
        // No recursion or persisted path. A still-running Windows installer
        // may hold its file open; leave that file for a later launch.
        await unlink(join(folder, entry.name)).catch(() => undefined);
      }
    }
  } catch {
    /* Missing/unreadable cache must not block the workspace. */
  }
}

async function requireOrdinaryDirectory(folder: string): Promise<void> {
  const info = await lstat(folder);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Unsafe update cache directory');
}

async function receive(
  candidate: ManualCandidate,
  path: string,
  fetch: UpdateFetch,
): Promise<void> {
  const { name, bytes, sha256 } = candidate.release.artifacts[0];
  const url = manualDownloadUrl(candidate.release.version, name);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10 * 60_000),
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
  });
  const body = installerBody(response, url, bytes);
  const file = await open(path, 'wx', 0o600);
  const reader = body.getReader();
  const hash = createHash('sha256');
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > bytes) throw new Error('Installer exceeds signed size');
      hash.update(chunk.value);
      await writeChunk(file, chunk.value);
    }
    if (total !== bytes || hash.digest('hex') !== sha256)
      throw new Error('Installer checksum mismatch');
    await file.sync();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    await file.close();
  }
}

function installerBody(
  response: Response,
  url: string,
  bytes: number,
): NonNullable<Response['body']> {
  if (
    response.status !== 200 ||
    response.body === null ||
    response.redirected ||
    (response.url !== '' && response.url !== url)
  )
    throw new Error('Installer download failed');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) !== bytes))
    throw new Error('Installer length mismatch');
  return response.body;
}

async function writeChunk(file: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await file.write(chunk, offset, chunk.byteLength - offset, null);
    if (result.bytesWritten === 0) throw new Error('Installer could not be saved');
    offset += result.bytesWritten;
  }
}

/** Reopen the exact staged file at arm time and again immediately before quit. */
export async function verifyStagedInstaller(update: StagedManualUpdate): Promise<void> {
  const artifact = update.release.artifacts[0];
  const file = await open(update.path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== artifact.bytes)
      throw new Error('Staged installer size changed');
    const hash = createHash('sha256');
    let total = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      const bytes = chunk as Buffer;
      total += bytes.byteLength;
      if (total > artifact.bytes) throw new Error('Staged installer changed');
      hash.update(bytes);
    }
    if (total !== artifact.bytes || hash.digest('hex') !== artifact.sha256)
      throw new Error('Staged installer checksum changed');
  } finally {
    await file.close();
  }
}

export async function discardStagedInstaller(update: StagedManualUpdate): Promise<void> {
  // The path belongs to a file created by this process, never a persisted request.
  await unlink(update.path).catch(() => undefined);
}
