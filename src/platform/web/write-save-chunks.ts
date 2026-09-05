/** Before close, failures and cancellation discard staged bytes. Once the
 * irrevocable close starts, late cancellation cannot promise rollback. */
export async function writeSaveChunks(
  writable: FileSystemWritableFileStream,
  chunks: AsyncIterable<string>,
  signal?: AbortSignal,
  onFinalizing?: () => void,
): Promise<void> {
  const abort = async (): Promise<void> => {
    try {
      await writable.abort();
    } catch {
      /* best-effort after a write/close failure */
    }
  };
  const onAbort = (): void => {
    void abort();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    for await (const chunk of chunks) {
      signal?.throwIfAborted();
      await writable.write(chunk);
    }
    signal?.throwIfAborted();
    signal?.removeEventListener('abort', onAbort);
    onFinalizing?.();
    await writable.close();
  } catch (error) {
    await abort();
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
