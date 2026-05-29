// F.2.c: targeted tests for the raster-image branches added to
// scene-mutations. The broader mutation flows are covered through
// store.test.ts and duplicate.test.ts.

import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type Scene,
  type TracedImage,
} from '../../core/scene';
import {
  applyTraceToExisting,
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

// ADR-026 — Trace runs on a bitmap the operator ALREADY imported: the
// source raster is already in the scene, and the trace overlays it.
// Trace polylines come back in source-PIXEL units, but the bitmap was
// imported in mm (96-DPI sizing), so the overlay transform must inherit
// the bitmap's translate/rotation/mirror while folding its mm-per-pixel
// into the scale. The fixture below makes bounds (mm) deliberately differ
// from the pixel grid — and uses distinct, binary-clean per-axis ratios
// (100mm/200px = 0.5 X, 25mm/100px = 0.25 Y) — so a transform that merely
// copied the source's scale, or swapped the axes, would fail. The rotation
// and translate prove they pass through untouched.
const SOURCE_TRANSFORM = {
  ...IDENTITY_TRANSFORM,
  x: 33,
  y: 77,
  scaleX: 2,
  scaleY: 3,
  rotationDeg: 15,
};
const SOURCE_MM_PER_PX_X = 0.5; // bounds 100mm / 200px
const SOURCE_MM_PER_PX_Y = 0.25; // bounds 25mm / 100px

function sourceRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'src1',
    source: 'art.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 200,
    pixelHeight: 100,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 25 },
    transform: SOURCE_TRANSFORM,
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
    // Placeholder identity transform, as the dialog builds it —
    // applyTraceToExisting overwrites it with the source's transform.
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [] }],
  };
}

// A project whose scene already contains the source bitmap — the state
// the Trace tool runs against.
function projectWithSource(): Project {
  const base = createProject();
  return {
    ...base,
    scene: { ...base.scene, objects: [...base.scene.objects, sourceRaster()] },
  };
}

describe('applyTraceToExisting (ADR-026)', () => {
  it('adds only the trace, keeping the existing source bitmap (no duplicate)', () => {
    const project = projectWithSource();
    const before = project.scene.objects.length;
    const result = applyTraceToExisting({ project, undoStack: [] }, 'src1', tracedVector());
    const objects = result.project.scene.objects;
    expect(objects).toHaveLength(before + 1);
    expect(objects.filter((o) => o.kind === 'raster-image')).toHaveLength(1);
    expect(objects.filter((o) => o.kind === 'traced-image')).toHaveLength(1);
  });

  it('registers the trace on the bitmap by folding mm-per-pixel into its scale', () => {
    const project = projectWithSource();
    const result = applyTraceToExisting({ project, undoStack: [] }, 'src1', tracedVector());
    const trace = result.project.scene.objects.find((o) => o.kind === 'traced-image');
    // Pixel-space polylines map onto the bitmap's mm extent: scale is the
    // source scale times mm-per-pixel (per axis); translate/rotation/mirror
    // pass through unchanged so the trace lands over the features it came
    // from. Without this, pixel-unit vectors over an mm-unit bitmap render
    // ~3.78x too large (the 96/25.4 mismatch).
    expect(trace?.transform).toEqual({
      ...SOURCE_TRANSFORM,
      scaleX: SOURCE_TRANSFORM.scaleX * SOURCE_MM_PER_PX_X,
      scaleY: SOURCE_TRANSFORM.scaleY * SOURCE_MM_PER_PX_Y,
    });
  });

  it('places the trace pixel-frame on the bitmap world rect (corners coincide)', () => {
    const project = projectWithSource();
    const result = applyTraceToExisting({ project, undoStack: [] }, 'src1', tracedVector());
    const trace = result.project.scene.objects.find((o) => o.kind === 'traced-image');
    if (trace === undefined) throw new Error('expected a traced-image in the scene');
    const src = sourceRaster();
    // The geometric consequence of the overlay transform, asserted directly
    // (not via the transform fields): the trace's pixel-space frame corners,
    // mapped through its transform, must land exactly where the bitmap's mm
    // bounds corners land through the bitmap transform — same world region,
    // i.e. pixel-for-pixel registration, and it holds under rotation.
    expect(applyTransform({ x: 0, y: 0 }, trace.transform)).toEqual(
      applyTransform({ x: src.bounds.minX, y: src.bounds.minY }, src.transform),
    );
    expect(applyTransform({ x: src.pixelWidth, y: src.pixelHeight }, trace.transform)).toEqual(
      applyTransform({ x: src.bounds.maxX, y: src.bounds.maxY }, src.transform),
    );
  });

  it('draws the trace on top (last in the array) and selects it', () => {
    const project = projectWithSource();
    const result = applyTraceToExisting({ project, undoStack: [] }, 'src1', tracedVector());
    const objects = result.project.scene.objects;
    expect(objects[objects.length - 1]?.kind).toBe('traced-image');
    expect(result.selectedObjectId).toBe('trace1');
  });

  it('ensures a line layer for the trace color', () => {
    const project = projectWithSource();
    const result = applyTraceToExisting({ project, undoStack: [] }, 'src1', tracedVector());
    expect(result.project.scene.layers.find((l) => l.color === '#000000')?.mode).toBe('line');
  });

  it('records a single undo entry == the project before', () => {
    const project = projectWithSource();
    const result = applyTraceToExisting({ project, undoStack: [] }, 'src1', tracedVector());
    expect(result.undoStack).toHaveLength(1);
    expect(result.undoStack[0]).toBe(project);
  });

  it("tags the source raster 'trace-source' so the canvas tints the deletable backing", () => {
    const project = projectWithSource();
    const result = applyTraceToExisting({ project, undoStack: [] }, 'src1', tracedVector());
    const raster = result.project.scene.objects.find((o) => o.kind === 'raster-image');
    if (raster?.kind === 'raster-image') {
      expect(raster.role).toBe('trace-source');
    } else {
      throw new Error('expected a raster-image to remain in the scene');
    }
  });

  it('degrades gracefully: missing source → trace added at its own transform, nothing tagged', () => {
    const project = projectWithSource();
    const result = applyTraceToExisting({ project, undoStack: [] }, 'no-such-id', tracedVector());
    const objects = result.project.scene.objects;
    const trace = objects.find((o) => o.kind === 'traced-image');
    const raster = objects.find((o) => o.kind === 'raster-image');
    // No source to adopt → trace keeps its own placeholder transform.
    expect(trace?.transform).toEqual(IDENTITY_TRANSFORM);
    // The unrelated existing bitmap is left untouched (not tagged).
    if (raster?.kind === 'raster-image') {
      expect(raster.role).toBeUndefined();
    }
  });
});
