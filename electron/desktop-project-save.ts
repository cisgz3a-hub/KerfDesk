// Saving over a KerfDesk project the operating system opened (ADR-550). The
// bytes go to a new file beside the project, which then replaces it in one
// rename, so a failed or cut-off save leaves the old project whole.

import { randomBytes } from 'node:crypto';
import { open, rename, rm, type FileHandle } from 'node:fs/promises';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Far above any real project; stops a runaway request from filling the disk. */
export const MAX_DESKTOP_PROJECT_SAVE_BYTES = 1024 ** 3;

export type DesktopProjectSaveResult = 'saved' | 'too-large' | 'failed';

export type DesktopProjectSaveOptions = {
  readonly maxBytes?: number;
  readonly rename?: (from: string, to: string) => Promise<void>;
};

// Windows refuses the rename while another program, such as a virus scanner
// or a sync client, briefly holds the file. They let go within moments.
const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_MS = 100;

class ProjectTooLarge extends Error {}

export async function saveDesktopProjectFile(
  realPath: string,
  body: ReadableStream<Uint8Array> | null,
  options: DesktopProjectSaveOptions = {},
): Promise<DesktopProjectSaveResult> {
  if (body === null) return 'failed';
  const temporary = path.join(
    path.dirname(realPath),
    `${path.basename(realPath)}.${randomBytes(6).toString('hex')}.kerfdesk-save`,
  );
  try {
    await writeTemporary(temporary, body, options.maxBytes ?? MAX_DESKTOP_PROJECT_SAVE_BYTES);
    await replace(temporary, realPath, options.rename ?? rename);
    return 'saved';
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (error instanceof ProjectTooLarge) return 'too-large';
    console.warn('Could not save the project:', error);
    return 'failed';
  }
}

async function writeTemporary(
  file: string,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<void> {
  // 'wx' never opens an existing file, so nothing else is ever overwritten.
  const handle = await open(file, 'wx');
  const reader = body.getReader();
  try {
    let total = 0;
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      total += next.value.byteLength;
      if (total > maxBytes) throw new ProjectTooLarge();
      await writeAll(handle, next.value);
    }
    await handle.sync();
  } finally {
    await reader.cancel().catch(() => undefined);
    await handle.close();
  }
}

async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  for (let offset = 0; offset < chunk.byteLength; ) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
    offset += bytesWritten;
  }
}

async function replace(
  from: string,
  to: string,
  renameFile: (from: string, to: string) => Promise<void>,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await renameFile(from, to);
      return;
    } catch (error) {
      if (attempt >= RENAME_ATTEMPTS || !isHeldByAnotherProgram(error)) throw error;
      await delay(RENAME_RETRY_MS * attempt);
    }
  }
}

function isHeldByAnotherProgram(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}
