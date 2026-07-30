import { buildGcodeRenderModel } from '../../core/gcode-view';
import { createGcodeRenderModelBuilder } from '../../core/gcode-view/gcode-render-model-builder';
import { iterateLines } from '../../core/util';
import { readBlobLines, type BlobReadProgress } from '../import/blob-line-reader';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import {
  INSPECTOR_RENDER_SEGMENT_LIMIT,
  INSPECTOR_SOURCE_LINE_LIMIT,
  type GcodeInspectorWorkerResult,
} from './gcode-inspector-worker-protocol';

export function inspectGcodeText(text: string): GcodeInspectorWorkerResult {
  const lines: string[] = [];
  let sourceLineCount = 0;
  for (const line of iterateLines(text)) {
    if (lines.length < INSPECTOR_SOURCE_LINE_LIMIT) lines.push(line);
    sourceLineCount += 1;
  }
  return {
    parsed: buildGcodeRenderModel(text, {
      renderSegmentLimit: INSPECTOR_RENDER_SEGMENT_LIMIT,
    }),
    lines,
    sourceLineCount,
  };
}

export async function inspectGcodeSource(
  source: GcodeInspectionSource,
  onProgress?: (progress: BlobReadProgress) => void,
): Promise<GcodeInspectorWorkerResult> {
  if (source.kind === 'text') return inspectGcodeText(source.text);
  const builder = createGcodeRenderModelBuilder({
    renderSegmentLimit: INSPECTOR_RENDER_SEGMENT_LIMIT,
  });
  const lines: string[] = [];
  let sourceLineCount = 0;
  const pushLine = (line: string): void => {
    builder.pushLine(line);
    if (lines.length < INSPECTOR_SOURCE_LINE_LIMIT) lines.push(line);
    sourceLineCount += 1;
  };
  await readBlobLines(source.blob, pushLine, onProgress);
  return { parsed: builder.finish(), lines, sourceLineCount };
}
