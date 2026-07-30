import { createGcodeProgramLineParser, type ParseGcodeProgramResult } from '../../io/gcode';
import { readBlobLines, type BlobReadProgress } from './blob-line-reader';

export async function parseGcodeBlob(
  blob: Blob,
  onProgress?: (progress: BlobReadProgress) => void,
): Promise<ParseGcodeProgramResult> {
  const parser = createGcodeProgramLineParser();
  await readBlobLines(blob, parser.pushLine, onProgress);
  return parser.finish();
}
