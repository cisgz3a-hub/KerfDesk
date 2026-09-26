// Line + fill (hybrid) trace commit binding (ADR-454): the stroke colour binds
// to a LINE operation, the outline colour to a FILL operation, on a fresh
// import and when a trace lands over its source bitmap. Other trace modes
// keep their single object-level mode.

import { describe, expect, it } from 'vitest';
import {
  createArtworkOperations,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { HYBRID_FILL_COLOR, HYBRID_STROKE_COLOR } from '../../core/trace/hybrid/hybrid-paths';
import { applyFreshImport, applyTraceToExisting } from './scene-mutations';

const SOURCE_ID = 'src1';
const TRACE_ID = 'trace1';

function sourceRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: SOURCE_ID,
    source: 'logo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 200,
    pixelHeight: 100,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

function traced(traceMode: TracedImage['traceMode']): TracedImage {
  const line = {
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    closed: false,
  };
  const square = {
    points: [
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 20, y: 10 },
    ],
    closed: true,
  };
  return {
    kind: 'traced-image',
    id: TRACE_ID,
    source: 'logo.png',
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    ...(traceMode === undefined ? {} : { traceMode }),
    paths: [
      { color: HYBRID_FILL_COLOR, polylines: [square] },
      { color: HYBRID_STROKE_COLOR, polylines: [line], strokeWidthMm: 2 },
    ],
  };
}

function modeByPathColor(project: Project): Record<string, string | undefined> {
  const object = project.scene.objects.find((candidate) => candidate.id === TRACE_ID);
  if (object === undefined || !('paths' in object)) return {};
  const modes: Record<string, string | undefined> = {};
  for (const path of object.paths) {
    const operationId = path.operationIds?.[0];
    modes[path.color] = project.scene.layers.find((layer) => layer.id === operationId)?.mode;
  }
  return modes;
}

describe('Line + fill trace commit', () => {
  it('binds strokes to a line operation and outlines to a fill operation on import', () => {
    const result = applyFreshImport(
      { project: createProject(), undoStack: [] },
      traced('hybrid'),
      0,
    );
    expect(modeByPathColor(result.project)).toEqual({
      [HYBRID_FILL_COLOR]: 'fill',
      [HYBRID_STROKE_COLOR]: 'line',
    });
  });

  it('binds the same way when the trace lands over its source bitmap', () => {
    const imported = applyFreshImport(
      { project: createProject(), undoStack: [] },
      sourceRaster(),
      0,
    );
    const result = applyTraceToExisting(
      { project: imported.project, undoStack: [] },
      SOURCE_ID,
      traced('hybrid'),
    );
    expect(modeByPathColor(result.project)).toEqual({
      [HYBRID_FILL_COLOR]: 'fill',
      [HYBRID_STROKE_COLOR]: 'line',
    });
  });

  it('keeps the stroke width on the committed stroke path', () => {
    const result = applyFreshImport(
      { project: createProject(), undoStack: [] },
      traced('hybrid'),
      0,
    );
    const object = result.project.scene.objects.find((candidate) => candidate.id === TRACE_ID);
    const stroke =
      object !== undefined && 'paths' in object
        ? object.paths.find((path) => path.color === HYBRID_STROKE_COLOR)
        : undefined;
    expect(stroke?.strokeWidthMm).toBe(2);
  });

  it('leaves a contour trace with the same colours on one mode', () => {
    const result = applyFreshImport(
      { project: createProject(), undoStack: [] },
      traced(undefined),
      0,
    );
    expect(modeByPathColor(result.project)).toEqual({
      [HYBRID_FILL_COLOR]: 'fill',
      [HYBRID_STROKE_COLOR]: 'fill',
    });
  });
});

describe('createArtworkOperations modeForColor', () => {
  it('picks a mode per colour and falls back to the object mode', () => {
    const { operations, object } = createArtworkOperations(
      createProject().scene,
      traced('hybrid'),
      {
        mode: 'fill',
        modeForColor: (color) => (color === HYBRID_STROKE_COLOR ? 'line' : undefined),
        nameForColor: (color) => (color === HYBRID_STROKE_COLOR ? 'lines' : 'fills'),
      },
    );
    expect(operations.map((operation) => operation.mode)).toEqual(['fill', 'line']);
    expect(operations.map((operation) => operation.name.split(' ').at(-1))).toEqual([
      'fills',
      'lines',
    ]);
    expect('paths' in object && object.paths.every((path) => path.operationIds?.length === 1)).toBe(
      true,
    );
  });
});
