import { createGcodeRenderModelBuilder } from '../../core/gcode-view/gcode-render-model-builder';
import { createSegmentBuilder } from '../../core/gcode-view/segment-builder';
import type {
  AxisBounds,
  BuildRenderModelOptions,
  BuildRenderModelResult,
} from '../../core/gcode-view';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import { buildMoveDetail } from '../viewer3d/move-detail';
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
import { createPreviewEmitter, type PreviewChunk } from './inspection-preview';
import { inspectorRenderModel } from './inspector-model';
import { programToolCollector, type ProgramToolMark } from './program-tools';

/** What the worker reports while it inspects (ADR-485). */
export type InspectionObserver = {
  /** The moves read since the last chunk, a few times a second. */
  readonly onPreview?: (chunk: PreviewChunk) => void;
  /** The whole source is read; timing the moves comes next. */
  readonly onTiming?: () => void;
};

export function inspectGcodeText(
  text: string,
  context: GcodeInspectionContext = {},
  observer: InspectionObserver = {},
): GcodeInspectorWorkerResult {
  const reader = createInspectionReader(context, observer);
  let consumed = 0;
  const fraction = (): number => consumed / Math.max(1, text.length);
  const sourceIndex = indexGcodeTextLines(text, (line) => {
    consumed += line.length + 1;
    reader.line(line, fraction);
  });
  return reader.finish(sourceIndex);
}

export async function inspectGcodeSource(
  source: GcodeInspectionSource,
  onProgress?: (progress: BlobReadProgress) => void,
  observer: InspectionObserver = {},
): Promise<GcodeInspectorWorkerResult> {
  if (source.kind === 'text') return inspectGcodeText(source.text, source, observer);
  const reader = createInspectionReader(source, observer);
  let read = 0;
  const fraction = (): number => read;
  const sourceIndex = await indexGcodeBlobLines(
    source.blob,
    (line) => reader.line(line, fraction),
    (progress) => {
      read = progress.bytesRead / Math.max(1, progress.totalBytes);
      onProgress?.(progress);
    },
  );
  return reader.finish(sourceIndex);
}

// Parses line by line, sending the preview as it goes, then times and
// analyses the finished program.
function createInspectionReader(context: GcodeInspectionContext, observer: InspectionObserver) {
  const options: BuildRenderModelOptions = {
    machineKind: context.machineKind,
    laserPowerControl: context.laserPowerControl,
    retainPreciseSegmentLengths: true,
    renderPressureThreshold: INSPECTOR_RENDER_PRESSURE_THRESHOLD,
  };
  const segments = createSegmentBuilder(options.retainPreciseSegmentLengths);
  const builder = createGcodeRenderModelBuilder(options, segments);
  const tools = programToolCollector();
  const preview =
    observer.onPreview === undefined ? null : createPreviewEmitter(segments, observer.onPreview);
  return {
    line: (line: string, fraction: () => number): void => {
      tools.observe(line);
      builder.pushLine(line);
      preview?.line(fraction);
    },
    finish: (sourceIndex: GcodeSourceLineIndex): GcodeInspectorWorkerResult => {
      preview?.flush();
      observer.onTiming?.();
      return inspectionResult(builder.finish(), sourceIndex, context, tools.marks);
    },
  };
}

function inspectionResult(
  parsed: BuildRenderModelResult,
  sourceIndex: GcodeSourceLineIndex,
  context: GcodeInspectionContext,
  toolMarks: ReadonlyArray<ProgramToolMark>,
): GcodeInspectorWorkerResult {
  const base = { sourceIndex, sourceLineCount: sourceIndex.starts.length };
  if (parsed.kind === 'error') return { ...base, parsed, analysis: null };
  const analysis = analyzeGcodeModel(parsed.model, context, toolMarks);
  const detail = buildMoveDetail({
    ...parsed.model,
    feedLimited: analysis.time.segFeedLimited,
    toolLines: toolMarks.map((mark) => mark.line),
    diagonalMm: diagonalOf(parsed.model.stats.motionBounds),
  });
  return {
    ...base,
    parsed: { kind: 'ok', model: inspectorRenderModel(parsed.model, detail) },
    analysis,
  };
}

function diagonalOf(bounds: AxisBounds | null): number {
  if (bounds === null) return 0;
  return Math.hypot(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
  );
}
