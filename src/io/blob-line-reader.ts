export type BlobReadProgress = {
  readonly bytesRead: number;
  readonly totalBytes: number;
};

// Handed to every line so a consumer can abandon the rest of the source. The
// DXF metadata pass needs only the sections that precede ENTITIES, so it stops
// there rather than tokenizing the entity list it will read again anyway.
// Consumers that always read to the end simply ignore the second argument.
export type LineScanControl = { readonly stop: () => void };

export type LineScanCompletion = 'complete' | 'stopped';

export type BlobLineReadStats = {
  readonly bytesRead: number;
  readonly lineCount: number;
  readonly maxBufferedChars: number;
  readonly completion: LineScanCompletion;
};

type LineConsumer = (line: string, control: LineScanControl) => void;

type ByteProgress = (bytesRead: number) => void;

export async function readBlobLines(
  blob: Blob,
  onLine: LineConsumer,
  onProgress?: (progress: BlobReadProgress) => void,
): Promise<BlobLineReadStats> {
  return readUtf8ChunkLines(blobChunks(blob), onLine, (bytesRead) => {
    onProgress?.({ bytesRead, totalBytes: blob.size });
  });
}

export async function readUtf8ChunkLines(
  chunks: AsyncIterable<Uint8Array>,
  onLine: LineConsumer,
  onProgress?: ByteProgress,
): Promise<BlobLineReadStats> {
  const decoder = new TextDecoder();
  let tail = '';
  let shouldSkipLeadingLf = false;
  let bytesRead = 0;
  let lineCount = 0;
  let maxBufferedChars = 0;
  let completion: LineScanCompletion = 'complete';
  let isStopRequested = false;
  const control: LineScanControl = {
    stop: () => {
      isStopRequested = true;
    },
  };

  const consumeText = (decoded: string): LineScanCompletion => {
    if (decoded.length === 0) return 'complete';
    let text = decoded;
    if (shouldSkipLeadingLf) {
      if (text.startsWith('\n')) text = text.slice(1);
      shouldSkipLeadingLf = false;
    }
    const combined = tail + text;
    maxBufferedChars = Math.max(maxBufferedChars, combined.length);
    let lineStart = 0;
    let index = 0;
    while (index < combined.length) {
      const char = combined[index];
      if (char !== '\n' && char !== '\r') {
        index += 1;
        continue;
      }
      onLine(combined.slice(lineStart, index), control);
      lineCount += 1;
      if (char === '\r' && combined[index + 1] === '\n') index += 1;
      else if (char === '\r' && index + 1 === combined.length) shouldSkipLeadingLf = true;
      index += 1;
      lineStart = index;
      if (isStopRequested) return 'stopped';
    }
    tail = combined.slice(lineStart);
    return 'complete';
  };

  for await (const chunk of chunks) {
    bytesRead += chunk.byteLength;
    completion = consumeText(decoder.decode(chunk, { stream: true }));
    if (completion === 'stopped') break;
    onProgress?.(bytesRead);
  }
  // The flush can stop too: the consumer may cut off on the source's last line.
  if (completion === 'complete') completion = consumeText(decoder.decode());
  // The unterminated tail is a line only when the source was read to the end.
  if (completion === 'complete') {
    onLine(tail, control);
    lineCount += 1;
  }
  return { bytesRead, lineCount, maxBufferedChars, completion };
}

async function* blobChunks(blob: Blob): AsyncGenerator<Uint8Array> {
  const reader = blob.stream().getReader();
  let isDrained = false;
  try {
    for (;;) {
      const entry = await reader.read();
      if (entry.done) {
        isDrained = true;
        return;
      }
      yield entry.value;
    }
  } finally {
    // An early stop abandons this generator mid-stream. Cancelling releases the
    // blob's remaining source instead of leaving it queued behind a locked
    // reader; a drained stream needs nothing.
    if (!isDrained) await reader.cancel();
    reader.releaseLock();
  }
}
