import {
  createDxfEntityCollector,
  createDxfMetadataCollector,
  type DxfTagCollector,
} from '../../io/dxf/dxf-document-stream';
import { createDxfTagLineParser } from '../../io/dxf/dxf-tag-line-parser';
import type { ParseDxfResult } from '../../io/dxf';
import { readBlobLines, type BlobReadProgress } from './blob-line-reader';

export async function parseDxfBlob(
  blob: Blob,
  args: { readonly id: string; readonly source: string },
  onProgress?: (progress: BlobReadProgress) => void,
): Promise<ParseDxfResult> {
  const totalBytes = blob.size * 2;
  const metadataCollector = createDxfMetadataCollector();
  const metadataError = await runPass(blob, metadataCollector, 0, totalBytes, onProgress);
  if (metadataError !== null) return metadataError;
  const entityCollector = createDxfEntityCollector(metadataCollector.finish(), args);
  const entityError = await runPass(blob, entityCollector, blob.size, totalBytes, onProgress);
  return entityError ?? entityCollector.finish();
}

async function runPass(
  blob: Blob,
  collector: DxfTagCollector<unknown>,
  completedBytes: number,
  totalBytes: number,
  onProgress?: (progress: BlobReadProgress) => void,
): Promise<Extract<ParseDxfResult, { kind: 'error' }> | null> {
  const parser = createDxfTagLineParser(collector.pushTag);
  await readBlobLines(blob, parser.pushLine, ({ bytesRead }) => {
    onProgress?.({ bytesRead: completedBytes + bytesRead, totalBytes });
  });
  const result = parser.finish();
  return result.kind === 'error' ? result : null;
}
