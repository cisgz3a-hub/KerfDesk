import { createGcodeProgramLineParser } from '../../io/gcode';
import { readBlobLines, type BlobReadProgress } from './blob-line-reader';
import type { GcodeInspectionContext } from '../gcode-inspector/gcode-inspection-source';
import {
  createTimedGcodePreviewParser,
  type GcodePreviewParseResult,
} from './gcode-preview-timing';

export async function parseGcodeBlob(
  blob: Blob,
  onProgress?: (progress: BlobReadProgress) => void,
  timingContext?: GcodeInspectionContext,
): Promise<GcodePreviewParseResult> {
  const parser =
    timingContext === undefined
      ? createGcodeProgramLineParser()
      : createTimedGcodePreviewParser(timingContext);
  await readBlobLines(blob, parser.pushLine, onProgress);
  return parser.finish();
}
