import { createGcodeRenderModelBuilder } from '../../core/gcode-view/gcode-render-model-builder';
import type { BuildRenderModelResult } from '../../core/gcode-view';
import type { BlobReadProgress } from '../import/blob-line-reader';
import type { GcodeInspectionContext, GcodeInspectionSource } from './gcode-inspection-source';
import { analyzeGcodeModel } from './gcode-inspector-analysis';
import {
  indexGcodeBlobLines,
  indexGcodeTextLines,
  type GcodeSourceLineIndex,
} from './gcode-source-line-index';
import {
  INSPECTOR_RENDER_PRESSURE_THRESHOLD,
  type GcodeInspectorWorkerResult,
} from './gcode-inspector-worker-protocol';

export function inspectGcodeText(
  text: string,
  context: GcodeInspectionContext = {},
): GcodeInspectorWorkerResult {
  const builder = createGcodeRenderModelBuilder({
    machineKind: context.machineKind,
    laserPowerControl: context.laserPowerControl,
    retainPreciseSegmentLengths: true,
    renderPressureThreshold: INSPECTOR_RENDER_PRESSURE_THRESHOLD,
  });
  const sourceIndex = indexGcodeTextLines(text, (line) => builder.pushLine(line));
  return inspectionResult(builder.finish(), sourceIndex, context);
}

export async function inspectGcodeSource(
  source: GcodeInspectionSource,
  onProgress?: (progress: BlobReadProgress) => void,
): Promise<GcodeInspectorWorkerResult> {
  if (source.kind === 'text') return inspectGcodeText(source.text, source);
  const builder = createGcodeRenderModelBuilder({
    machineKind: source.machineKind,
    laserPowerControl: source.laserPowerControl,
    retainPreciseSegmentLengths: true,
    renderPressureThreshold: INSPECTOR_RENDER_PRESSURE_THRESHOLD,
  });
  const sourceIndex = await indexGcodeBlobLines(
    source.blob,
    (line) => builder.pushLine(line),
    onProgress,
  );
  return inspectionResult(builder.finish(), sourceIndex, source);
}

function inspectionResult(
  parsed: BuildRenderModelResult,
  sourceIndex: GcodeSourceLineIndex,
  context: GcodeInspectionContext,
): GcodeInspectorWorkerResult {
  const base = { sourceIndex, sourceLineCount: sourceIndex.starts.length };
  if (parsed.kind === 'error') return { ...base, parsed, analysis: null };
  return { ...base, parsed, analysis: analyzeGcodeModel(parsed.model, context) };
}
