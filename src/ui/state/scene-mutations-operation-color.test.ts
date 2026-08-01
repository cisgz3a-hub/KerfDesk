// Operation-color assignment for imported and traced artwork.
//
// Split out of scene-mutations.test.ts, which sits at 387/400 counted code
// lines — this follows the same per-aspect split as the
// use-shortcuts-*-gate.test.tsx files rather than pushing that one past the cap.

import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_RASTER_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { applyRasterizedTraceToExisting } from './rasterized-trace-mutation';
import { applyFreshImport, applyTraceToExisting } from './scene-mutations';

const SOURCE_ID = 'src1';
const TRACE_ID = 'trace1';
// OPERATION_PALETTE[0] — "New artwork starts in black" (core/scene/artwork-operation.ts).
const FIRST_PALETTE_COLOR = '#000000';

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
// operation's color (both black), which is how legacy scenes bound geometry.
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
    // Guard: proves the palette itself is black-first, so a failure in the
    // trace case below localizes to the trace flow rather than the allocator.
    expect(operationColorFor(importedSource(), SOURCE_ID)).toBe(FIRST_PALETTE_COLOR);
  });

  it('gives the traced artwork black rather than the runner-up palette color', () => {
    // The real ADR-026 flow: the operator imports the bitmap, then runs Trace
    // on it. The source is retained as a tinted 'trace-source' backing — a
    // reference object the operator is expected to delete, not output — but its
    // operation already holds OPERATION_PALETTE[0]. The first-unused-wins
    // allocator therefore pushes the trace (the artwork actually being cut)
    // onto the second color, so a fresh trace lands on the canvas blue.
    const result = applyTraceToExisting(
      { project: importedSource(), undoStack: [] },
      SOURCE_ID,
      tracedVector(),
    );
    expect(operationColorFor(result.project, TRACE_ID)).toBe(FIRST_PALETTE_COLOR);
  });

  it('gives the traced artwork black when the source is deleted after tracing', () => {
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

  it('moves the retained backing to the reserved image grey', () => {
    // The freed slot has to go somewhere the allocator will not immediately
    // re-hand-out: the reserved raster grey, distinct from every palette color.
    const result = applyTraceToExisting(
      { project: importedSource(), undoStack: [] },
      SOURCE_ID,
      tracedVector(),
    );
    expect(operationColorFor(result.project, SOURCE_ID)).toBe(DEFAULT_RASTER_LAYER_COLOR);
  });

  it('still gives a second imported artwork its own distinct color', () => {
    // The maintainer's "multiple colors with layers and different images": once
    // the trace holds black, the next fresh artwork must get its own color, not
    // collide onto black. Guards against over-correcting into a mono allocator.
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
  });

  it('leaves a legacy color-bound source binding intact (audit F1)', () => {
    // A schema-v2 style source bound by COLOR (no operationIds). Recoloring its
    // layer alone would silently re-point it at the trace's operation. The guard
    // skips it: the legacy scene keeps today's behavior (trace stays on the
    // runner-up) rather than gaining a corrupted binding.
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
    // the trace. The color assertion alone would pass vacuously (both black in
    // the corrupted case); asserting distinct operations is what catches the
    // silent merge — without the guard the color-bound source re-points onto the
    // trace's freshly-blackened operation.
    expect(sourceOps.length).toBeGreaterThan(0);
    expect(sourceOps).not.toEqual(traceOps);
  });
});

describe('rasterized (raster-output) trace color assignment', () => {
  it('gives a rasterized trace black by reusing the source image operation', () => {
    const result = applyRasterizedTraceToExisting(
      { project: importedSource(), undoStack: [] },
      SOURCE_ID,
      { ...sourceRaster(), id: 'rtrace1' },
    );
    expect(operationColorFor(result.project, 'rtrace1')).toBe(FIRST_PALETTE_COLOR);
  });

  it('gives a rasterized trace black even with no reusable image operation (audit F2)', () => {
    // Force the fresh-operation branch: bind the source to a LINE operation so
    // no Image operation is reusable. The freshly allocated operation must still
    // take black, not the runner-up.
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
    expect(operationColorFor(result.project, 'rtrace1')).toBe(FIRST_PALETTE_COLOR);
  });
});
