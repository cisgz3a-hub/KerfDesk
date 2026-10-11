import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  readEditorProcessIdentity,
  sameExecutable,
  validEditorProcessIdentity,
} from './artcraft-process-identity.js';

/** A disconnected native editor must never share a working file with a new one. */
export async function checkEditorLease(directory: string): Promise<void> {
  const text = await readFile(path.join(directory, 'editor-process.json'), 'utf8').catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    },
  );
  if (text === null) return;
  const lease: unknown = JSON.parse(text);
  const pid = leasePid(lease);
  const current = await readEditorProcessIdentity(pid).catch(() => {
    throw new Error('Cannot verify whether the previous editor has closed.');
  });
  if (current === null) return;
  if (!validEditorProcessIdentity(lease)) {
    throw new Error(
      'This older editor record cannot identify the running process. Close the earlier editor before reopening; if it is already closed, the process record needs recovery.',
    );
  }
  if (
    current.startTime !== lease.startTime ||
    !sameExecutable(current.executable, lease.executable)
  )
    return;
  throw new Error(
    'The previous editor for this session is still running. Close its window before reopening the session.',
  );
}
export async function saveEditorLease(
  directory: string,
  pid: number | undefined,
  expectedExecutable?: string,
): Promise<void> {
  if (pid === undefined) throw new Error('Native editor did not start.');
  const identity = await readEditorProcessIdentity(pid);
  if (identity === null) throw new Error('Native editor exited before its identity was recorded.');
  if (
    expectedExecutable !== undefined &&
    !sameExecutable(identity.executable, expectedExecutable)
  ) {
    throw new Error('Native editor process does not match the launched executable.');
  }
  const temporary = path.join(directory, `editor-process-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(identity), { flag: 'wx' });
  await rename(temporary, path.join(directory, 'editor-process.json'));
}
function leasePid(lease: unknown): number {
  if (
    !lease ||
    typeof lease !== 'object' ||
    !('pid' in lease) ||
    !Number.isInteger(lease.pid) ||
    Number(lease.pid) <= 0
  ) {
    throw new Error('Editor process record is invalid.');
  }
  return Number(lease.pid);
}
