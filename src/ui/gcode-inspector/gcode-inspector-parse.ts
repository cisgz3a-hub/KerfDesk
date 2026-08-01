import { createGcodeRenderModelBuilder } from '../../core/gcode-view/gcode-render-model-builder';
import type { BlobReadProgress } from '../import/blob-line-reader';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import { indexGcodeBlobLines, indexGcodeTextLines } from './gcode-source-line-index';
import {
  INSPECTOR_RENDER_PRESSURE_THRESHOLD,
  type GcodeInspectorWorkerResult,
} from './gcode-inspector-worker-protocol';

export function inspectGcodeText(text: string): GcodeInspectorWorkerResult {
  const builder = createGcodeRenderModelBuilder({
    renderPressureThreshold: INSPECTOR_RENDER_PRESSURE_THRESHOLD,
  });
  const sourceIndex = indexGcodeTextLines(text, (line) => builder.pushLine(line));
  return {
    parsed: builder.finish(),
    sourceIndex,
    sourceLineCount: sourceIndex.starts.length,
  };
}

export async function inspectGcodeSource(
  source: GcodeInspectionSource,
  onProgress?: (progress: BlobReadProgress) => void,
): Promise<GcodeInspectorWorkerResult> {
  if (source.kind === 'text') return inspectGcodeText(source.text);
  const builder = createGcodeRenderModelBuilder({
    renderPressureThreshold: INSPECTOR_RENDER_PRESSURE_THRESHOLD,
  });
  const sourceIndex = await indexGcodeBlobLines(
    source.blob,
    (line) => builder.pushLine(line),
    onProgress,
  );
  return {
    parsed: builder.finish(),
    sourceIndex,
    sourceLineCount: sourceIndex.starts.length,
  };
}
