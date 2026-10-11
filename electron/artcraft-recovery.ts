import { copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { workingFile } from './artcraft-operations.js';
import { studioFile, type StoredArtcraftSession } from './artcraft-storage.js';

/** Preserve normal native File > Save changes made after the last Apply. */
export async function prepareRecoveredSession(
  session: StoredArtcraftSession,
  directory: string,
): Promise<StoredArtcraftSession> {
  const working = workingFile(session.editor);
  const exists = await stat(path.join(directory, working)).then(
    () => true,
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    },
  );
  if (exists) {
    await studioFile(directory, working);
    return { ...session, nativeFile: working };
  }
  if (session.nativeFile !== undefined) {
    await copyFile(await studioFile(directory, session.nativeFile), path.join(directory, working));
    return { ...session, nativeFile: working };
  }
  return session;
}
