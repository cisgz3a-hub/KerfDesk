import type { SaveTarget } from '../../platform/types';

// Generated text is flushed into Blob parts, so the page's own heap holds at
// most one batch of lines however long the program is.
const STAGE_BATCH_CHARS = 1 << 20;

/** Collect the whole program before a destination is chosen: the save picker
 * empties an existing file as it returns (ADR-656), so generation may not fail
 * or be cancelled after it. */
export async function stageSurfacingProgram(
  chunks: AsyncIterable<string>,
  signal: AbortSignal,
): Promise<Blob> {
  const parts: Blob[] = [];
  let batch: string[] = [];
  let batchChars = 0;
  for await (const chunk of chunks) {
    signal.throwIfAborted();
    batch.push(chunk);
    batchChars += chunk.length;
    if (batchChars >= STAGE_BATCH_CHARS) {
      parts.push(new Blob(batch));
      batch = [];
      batchChars = 0;
    }
  }
  signal.throwIfAborted();
  parts.push(new Blob(batch));
  return new Blob(parts, { type: 'text/plain' });
}

// A prior browser close may already be committing and cannot be rolled back.
// Serialize surfacing writers even across panel remounts; preparation and the
// destination picker can proceed while that final atomic commit settles.
let previousWrite: Promise<void> = Promise.resolve();

export async function writeSurfacingFile(target: SaveTarget, program: Blob): Promise<void> {
  const prior = previousWrite;
  let release: () => void = () => undefined;
  previousWrite = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await prior;
    await target.write(program);
  } finally {
    release();
  }
}
