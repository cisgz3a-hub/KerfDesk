import type { SaveTarget } from '../../platform/types';

// A prior browser close may already be committing and cannot be rolled back.
// Serialize surfacing writers even across panel remounts; the destination picker
// and off-thread preflight can proceed while that final atomic commit settles.
let previousWrite: Promise<void> = Promise.resolve();

export async function writeSurfacingFile(
  target: SaveTarget,
  chunks: AsyncIterable<string>,
  options: {
    readonly signal: AbortSignal;
    readonly onWriting: () => void;
    readonly onFinalizing: () => void;
  },
): Promise<void> {
  const prior = previousWrite;
  let release: () => void = () => undefined;
  previousWrite = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await prior;
    options.signal.throwIfAborted();
    if (target.writeChunks === undefined)
      throw new Error('This file destination does not support streamed writes.');
    options.onWriting();
    await target.writeChunks(chunks, options.signal, options.onFinalizing);
  } finally {
    release();
  }
}
