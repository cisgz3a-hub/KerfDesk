export type BlobReadProgress = {
  readonly bytesRead: number;
  readonly totalBytes: number;
};

export type BlobLineReadStats = {
  readonly bytesRead: number;
  readonly lineCount: number;
  readonly maxBufferedChars: number;
};

type ByteProgress = (bytesRead: number) => void;

export async function readBlobLines(
  blob: Blob,
  onLine: (line: string) => void,
  onProgress?: (progress: BlobReadProgress) => void,
): Promise<BlobLineReadStats> {
  return readUtf8ChunkLines(blobChunks(blob), onLine, (bytesRead) => {
    onProgress?.({ bytesRead, totalBytes: blob.size });
  });
}

export async function readUtf8ChunkLines(
  chunks: AsyncIterable<Uint8Array>,
  onLine: (line: string) => void,
  onProgress?: ByteProgress,
): Promise<BlobLineReadStats> {
  const decoder = new TextDecoder();
  let tail = '';
  let shouldSkipLeadingLf = false;
  let bytesRead = 0;
  let lineCount = 0;
  let maxBufferedChars = 0;

  const consumeText = (decoded: string): void => {
    if (decoded.length === 0) return;
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
      onLine(combined.slice(lineStart, index));
      lineCount += 1;
      if (char === '\r' && combined[index + 1] === '\n') index += 1;
      else if (char === '\r' && index + 1 === combined.length) shouldSkipLeadingLf = true;
      index += 1;
      lineStart = index;
    }
    tail = combined.slice(lineStart);
  };

  for await (const chunk of chunks) {
    bytesRead += chunk.byteLength;
    consumeText(decoder.decode(chunk, { stream: true }));
    onProgress?.(bytesRead);
  }
  consumeText(decoder.decode());
  onLine(tail);
  lineCount += 1;
  return { bytesRead, lineCount, maxBufferedChars };
}

async function* blobChunks(blob: Blob): AsyncGenerator<Uint8Array> {
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const entry = await reader.read();
      if (entry.done) return;
      yield entry.value;
    }
  } finally {
    reader.releaseLock();
  }
}
