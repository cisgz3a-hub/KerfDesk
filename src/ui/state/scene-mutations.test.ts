// F.2.c: targeted tests for the raster-image branches added to
// scene-mutations. The broader mutation flows are covered through
// store.test.ts and duplicate.test.ts.

import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type Scene,
  type TracedImage,
} from '../../core/scene';
import {
  applyTracedWithSource,
  ensureRasterImageLayer,
  pruneOrphanLayers,
} from './scene-mutations';

function blankScene(): Scene {
  return { objects: [], layers: [] };
}

function rasterImage(color: string): RasterImage {
  return {
    kind: 'raster-image',
    id: 'r1',
    source: 'test.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

describe('ensureRasterImageLayer', () => {
  it('creates an image-mode layer when the color is new', () => {
    const out = ensureRasterImageLayer(blankScene(), '#808080');
    expect(out.layers).toHaveLength(1);
    expect(out.layers[0]?.color).toBe('#808080');
    expect(out.layers[0]?.mode).toBe('image');
  });

  it('leaves existing layers untouched when the color is already present', () => {
    const seeded: Scene = {
      objects: [],
      layers: [
        {
          id: '#808080',
          color: '#808080',
          mode: 'line',
          power: 50,
          speed: 1200,
          passes: 1,
          visible: true,
          output: true,
          hatchAngleDeg: 0,
          hatchSpacingMm: 0.2,
          ditherAlgorithm: 'floyd-steinberg',
          linesPerMm: 10,
        },
      ],
    };
    const out = ensureRasterImageLayer(seeded, '#808080');
    // Same object reference — no-op
    expect(out).toBe(seeded);
    expect(out.layers[0]?.mode).toBe('line'); // not flipped to 'image'
  });
});

describe('pruneOrphanLayers — raster image branch', () => {
  it('keeps the layer that a raster image references', () => {
    const seeded: Scene = {
      objects: [rasterImage('#808080')],
      layers: [
        {
          id: '#808080',
          color: '#808080',
          mode: 'image',
          power: 60,
          speed: 1500,
          passes: 1,
          visible: true,
          output: true,
          hatchAngleDeg: 0,
          hatchSpacingMm: 0.2,
          ditherAlgorithm: 'floyd-steinberg',
          linesPerMm: 10,
        },
        {
          id: '#ff0000',
          color: '#ff0000',
          mode: 'line',
          power: 50,
          speed: 1500,
          passes: 1,
          visible: true,
          output: true,
          hatchAngleDeg: 0,
          hatchSpacingMm: 0.2,
          ditherAlgorithm: 'floyd-steinberg',
          linesPerMm: 10,
        },
      ],
    };
    const pruned = pruneOrphanLayers(seeded);
    // Image layer kept (referenced by the raster); red layer dropped
    // (no remaining consumer).
    expect(pruned.layers.map((l) => l.color)).toEqual(['#808080']);
  });
});

// ADR-026 — the source bitmap stays on the canvas with the vector trace,
// the two sharing one transform so they overlay pixel-for-pixel.
function sourceRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'src1',
    source: 'art.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 200,
    pixelHeight: 100,
    // Full-image frame in pixel space — the same coordinate space the
    // trace's content bounds live in.
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

function tracedVector(): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace1',
    source: 'art.png',
    // Content bbox is a sub-rect of the 200×100 frame.
    bounds: { minX: 40, minY: 20, maxX: 160, maxY: 80 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [] }],
  };
}

describe('applyTracedWithSource (ADR-026)', () => {
  it('inserts both the source raster and the trace, sharing one transform', () => {
    const project = createProject();
    const before = project.scene.objects.length;
    const result = applyTracedWithSource(
      { project, undoStack: [] },
      tracedVector(),
      sourceRaster(),
    );
    const objects = result.project.scene.objects;
    expect(objects).toHaveLength(before + 2);
    const raster = objects.find((o) => o.kind === 'raster-image');
    const trace = objects.find((o) => o.kind === 'traced-image');
    expect(raster).toBeDefined();
    expect(trace).toBeDefined();
    // Shared transform is the whole point — it's what makes them overlap.
    expect(trace?.transform).toEqual(raster?.transform);
  });

  it('draws the trace on top (last in the array) and selects it', () => {
    const project = createProject();
    const result = applyTracedWithSource(
      { project, undoStack: [] },
      tracedVector(),
      sourceRaster(),
    );
    const objects = result.project.scene.objects;
    expect(objects[objects.length - 1]?.kind).toBe('traced-image');
    expect(result.selectedObjectId).toBe('trace1');
  });

  it('ensures an image-mode layer for the source and a line layer for the trace', () => {
    const project = createProject();
    const result = applyTracedWithSource(
      { project, undoStack: [] },
      tracedVector(),
      sourceRaster(),
    );
    const layers = result.project.scene.layers;
    expect(layers.find((l) => l.color === '#808080')?.mode).toBe('image');
    expect(layers.find((l) => l.color === '#000000')?.mode).toBe('line');
  });

  it('records a single undo entry covering the pair', () => {
    const project = createProject();
    const result = applyTracedWithSource(
      { project, undoStack: [] },
      tracedVector(),
      sourceRaster(),
    );
    expect(result.undoStack).toHaveLength(1);
    expect(result.undoStack[0]).toBe(project);
  });

  it("tags the source raster 'trace-source' so the canvas tints the deletable backing", () => {
    const project = createProject();
    const result = applyTracedWithSource(
      { project, undoStack: [] },
      tracedVector(),
      sourceRaster(),
    );
    const raster = result.project.scene.objects.find((o) => o.kind === 'raster-image');
    expect(raster?.kind).toBe('raster-image');
    // role is only present on the raster variant; narrow before reading it.
    if (raster?.kind === 'raster-image') {
      expect(raster.role).toBe('trace-source');
    }
  });
});
