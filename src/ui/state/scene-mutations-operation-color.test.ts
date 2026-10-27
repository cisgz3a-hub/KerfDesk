// Operation-color assignment for imported and traced artwork.
//
// Split out of scene-mutations.test.ts, which sits at 387/400 counted code
// lines — this follows the same per-aspect split as the
// use-shortcuts-*-gate.test.tsx files rather than pushing that one past the cap.

import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  nextOperationColor,
  operationIdsForObject,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { applyRasterizedTraceToExisting } from './rasterized-trace-mutation';
import { applyFreshImport, applyTraceToExisting } from './scene-mutations';

const SOURCE_ID = 'src1';
const TRACE_ID = 'trace1';
// OPERATION_PALETTE[0], what the allocator hands out first (blue since ADR-620).
const FIRST_PALETTE_COLOR = nextOperationColor([]);
// OPERATION_PALETTE[1], what it hands out once the first colour is taken.
const SECOND_PALETTE_COLOR = nextOperationColor([{ color: FIRST_PALETTE_COLOR }]);

function operationColorFor(project: Project, objectId: string): string | undefined {
  const object = project.scene.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) return undefined;
  const [operationId] = operationIdsForObject(object, project.scene.layers);
  return project.scene.layers.find((operation) => operation.id === operationId)?.color;
}

function sourceRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: SOURCE_ID,
    source: 'portrait.png',
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

// Line-art trace ink is black (trace presets pin a [white, black] palette),
// so this is a single-color trace: one operation, not a per-color split.
function tracedVector(): TracedImage {
  return {
    kind: 'traced-image',
    id: TRACE_ID,
    source: 'portrait.png',
    bounds: { minX: 40, minY: 20, maxX: 160, maxY: 80 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [] }],
  };
}

function importedSource(): Project {
  return applyFreshImport({ project: createProject(), undoStack: [] }, sourceRaster(), 0).project;
}

// A schema-v2 style scene: the source raster carries no operationIds and is
// resolved to its operation by COLOR match alone. Its color equals its
// operation's color (both the first palette color), which is how legacy scenes bound geometry.
function legacyColorBoundProject(): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: [{ ...sourceRaster(), color: FIRST_PALETTE_COLOR }],
      layers: [createLayer({ id: 'legacy-op', color: FIRST_PALETTE_COLOR, mode: 'image' })],
    },
  };
}

describe('operation color assignment', () => {
  it('gives the first artwork in an empty scene the first palette color', () => {
    // Guard: proves the import takes the first palette color, so a failure in the
    // trace case below localizes to the trace flow rather than the allocator.
    expect(operationColorFor(importedSource(), SOURCE_ID)).toBe(FIRST_PALETTE_COLOR);
  });

  it('keeps a kept photo on its colour and gives the trace the next one', () => {
    // ADR-673: the photo the operator keeps engraves, so it is artwork like the
    // trace and keeps its operation and colour, as a LightBurn image keeps its
    // layer. The trace takes the next free colour, like any second artwork.
    // This used to recolour the photo to the image grey so the trace could
    // take the first colour, when the photo was a no-output backing.
    const result = applyTraceToExisting(
      { project: importedSource(), undoStack: [] },
      SOURCE_ID,
      tracedVector(),
    );
    expect(operationColorFor(result.project, SOURCE_ID)).toBe(FIRST_PALETTE_COLOR);
    expect(operationColorFor(result.project, TRACE_ID)).toBe(SECOND_PALETTE_COLOR);
  });

  it('gives the traced artwork the first palette color when the source is deleted', () => {
    // Delete Image After Trace drops the source object up front, but its now
    // orphaned operation is only pruned at the end — after the trace has
    // already allocated against it.
    const result = applyTraceToExisting(
      { project: importedSource(), undoStack: [] },
      SOURCE_ID,
      tracedVector(),
      { deleteSourceAfterTrace: true },
    );
    expect(operationColorFor(result.project, TRACE_ID)).toBe(FIRST_PALETTE_COLOR);
  });

  it('still gives a second imported artwork its own distinct color', () => {
    // The maintainer's "multiple colors with layers and different images": once
    // the photo and its trace hold two colours, the next fresh artwork must get
    // its own color, not collide onto either. Guards against a mono allocator.
    const traced = applyTraceToExisting(
      { project: importedSource(), undoStack: [] },
      SOURCE_ID,
      tracedVector(),
    );
    const second = applyFreshImport(
      { project: traced.project, undoStack: [] },
      { ...sourceRaster(), id: 'src2' },
      0,
    );
    const secondColor = operationColorFor(second.project, 'src2');
    expect(secondColor).toBeDefined();
    expect(secondColor).not.toBe(FIRST_PALETTE_COLOR);
    expect(secondColor).not.toBe(SECOND_PALETTE_COLOR);
  });

  it('leaves a legacy color-bound source binding intact (audit F1)', () => {
    // A schema-v2 style source bound by COLOR (no operationIds). Recoloring its
    // layer alone would silently re-point it at the trace's operation. Trace
    // recolours no kept source (ADR-673), so the source keeps its own operation
    // and the trace lands on the runner-up.
    const legacy = legacyColorBoundProject();
    const result = applyTraceToExisting(
      { project: legacy, undoStack: [] },
      SOURCE_ID,
      tracedVector(),
    );
    const source = result.project.scene.objects.find((o) => o.id === SOURCE_ID);
    const trace = result.project.scene.objects.find((o) => o.id === TRACE_ID);
    if (source === undefined || trace === undefined) {
      throw new Error('expected both the source and the trace in the scene');
    }
    const sourceOps = operationIdsForObject(source, result.project.scene.layers);
    const traceOps = operationIdsForObject(trace, result.project.scene.layers);
    // The source still resolves to an operation, and it is a DIFFERENT one than
    // the trace. The color assertion alone would pass vacuously (both one color in
    // the corrupted case); asserting distinct operations is what catches the
    // silent merge — without the guard the color-bound source re-points onto the
    // trace's freshly recolored operation.
    expect(sourceOps.length).toBeGreaterThan(0);
    expect(sourceOps).not.toEqual(traceOps);
  });
});

describe('rasterized (raster-output) trace color assignment', () => {
  it('gives a rasterized trace the next colour on its copy of a kept source operation', () => {
    // ADR-673: the kept photo engraves on its own operation; the result burns
    // on a copy of it, which takes the next free colour.
    const result = applyRasterizedTraceToExisting(
      { project: importedSource(), undoStack: [] },
      SOURCE_ID,
      { ...sourceRaster(), id: 'rtrace1' },
    );
    expect(operationColorFor(result.project, SOURCE_ID)).toBe(FIRST_PALETTE_COLOR);
    expect(operationColorFor(result.project, 'rtrace1')).toBe(SECOND_PALETTE_COLOR);
  });

  it('gives a rasterized trace the first palette color by reusing a deleted source operation', () => {
    const result = applyRasterizedTraceToExisting(
      { project: importedSource(), undoStack: [] },
      SOURCE_ID,
      { ...sourceRaster(), id: 'rtrace1' },
      { deleteSourceAfterTrace: true },
    );
    expect(operationColorFor(result.project, 'rtrace1')).toBe(FIRST_PALETTE_COLOR);
  });

  it('gives a rasterized trace its own colour with no reusable image operation (audit F2)', () => {
    // Force the fresh-operation branch: bind the source to a LINE operation so
    // no Image operation is reusable. The kept source keeps the first colour
    // (ADR-673), so the freshly allocated operation takes the next one rather
    // than sharing or stealing the source's.
    const base = createProject();
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [{ ...sourceRaster(), operationIds: ['op-line'] }],
        layers: [createLayer({ id: 'op-line', color: FIRST_PALETTE_COLOR, mode: 'line' })],
      },
    };
    const result = applyRasterizedTraceToExisting({ project, undoStack: [] }, SOURCE_ID, {
      ...sourceRaster(),
      id: 'rtrace1',
    });
    expect(operationColorFor(result.project, SOURCE_ID)).toBe(FIRST_PALETTE_COLOR);
    expect(operationColorFor(result.project, 'rtrace1')).toBe(SECOND_PALETTE_COLOR);
  });

  it('gives a rasterized trace the first colour when the source is deleted', () => {
    const base = createProject();
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [{ ...sourceRaster(), operationIds: ['op-line'] }],
        layers: [createLayer({ id: 'op-line', color: FIRST_PALETTE_COLOR, mode: 'line' })],
      },
    };
    const result = applyRasterizedTraceToExisting(
      { project, undoStack: [] },
      SOURCE_ID,
      { ...sourceRaster(), id: 'rtrace1' },
      { deleteSourceAfterTrace: true },
    );
    expect(operationColorFor(result.project, 'rtrace1')).toBe(FIRST_PALETTE_COLOR);
  });
});
