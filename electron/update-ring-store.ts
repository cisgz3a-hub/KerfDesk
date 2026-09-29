import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { record } from './licensing-verification.js';

/**
 * Which commercial update catalogue this device reads (ADR-541). Every device
 * reads the stable ring unless its owner asked for new versions early.
 */
export type UpdateRing = 'stable' | 'beta';
export type UpdateRingStore = {
  /** The saved ring, or stable when nothing valid is saved or it cannot be read. */
  readonly read: () => Promise<UpdateRing>;
  readonly write: (ring: UpdateRing) => Promise<void>;
};

/** What Help > Licence shows and changes: whether this device takes the beta ring. */
export type EarlyUpdateState = { readonly available: boolean; readonly enabled: boolean };
export type EarlyUpdates = {
  readonly read: () => Promise<EarlyUpdateState>;
  readonly write: (enabled: boolean) => Promise<EarlyUpdateState>;
};

export const UPDATE_RING_FILE = 'commercial-update-ring.json';
const LIMIT = 1024;

/** Only a build that takes commercial updates offers the beta ring. */
export function earlyUpdateSetting(commercial: boolean, rings: UpdateRingStore): EarlyUpdates {
  const read = async (): Promise<EarlyUpdateState> => ({
    available: commercial,
    enabled: commercial && (await rings.read()) === 'beta',
  });
  return {
    read,
    write: async (enabled) => {
      if (!commercial) throw new Error('Early updates are unavailable in this build.');
      await rings.write(enabled ? 'beta' : 'stable');
      return read();
    },
  };
}

/** Only an exact, current-format choice of the beta ring reads as beta. */
export function parseUpdateRing(text: string): UpdateRing {
  try {
    const value: unknown = JSON.parse(text);
    if (
      record(value) &&
      Object.keys(value).sort().join(',') === 'ring,schemaVersion' &&
      value.schemaVersion === 1 &&
      value.ring === 'beta'
    )
      return 'beta';
  } catch {
    // A damaged file is the same as no choice.
  }
  return 'stable';
}

/** A small file under userData, written only by the main process. */
export function createUpdateRingStore(userDataPath: string): UpdateRingStore {
  const file = join(userDataPath, UPDATE_RING_FILE);
  return {
    read: async () => {
      try {
        return parseUpdateRing(await readBounded(file));
      } catch {
        return 'stable';
      }
    },
    write: async (ring) => {
      if (ring !== 'stable' && ring !== 'beta') throw new Error('Unknown update ring.');
      await mkdir(userDataPath, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, ring })}\n`, {
          flag: 'wx',
          mode: 0o600,
        });
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    },
  };
}

async function readBounded(file: string): Promise<string> {
  const handle = await open(file, 'r');
  const buffer = Buffer.alloc(LIMIT + 1);
  let length = 0;
  try {
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
  } finally {
    await handle.close();
  }
  if (length > LIMIT) throw new Error('Update ring file is too large.');
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
}
