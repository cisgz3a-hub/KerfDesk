// ADR-029 Convert to Bitmap — the pure scene mutation. Asserts the
// LightBurn-faithful behavior: the source vector is DELETED (the inverse of
// Trace, which keeps its source), the rasterized bitmap takes its place on a
// fresh image-mode layer, the source's orphaned color layer is pruned, and
// the whole swap is a single undo step. DOM-side bitmap construction (canvas
// PNG, luma) is the UI's job and is verified separately (A2-ii/iv).

import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { applyConvertToBitmap } from './convert-to-bitmap';

const SOURCE_COLOR = '#ff0000';
const RASTER_COLOR = '#808080';

function importedSvgSource(color: string = SOURCE_COLOR): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'src-vec',
    source: 'logo.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: { ...IDENTITY_TRANSFORM, x: 5, y: 7, rotationDeg: 30 },
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 0, y: 20 },
            ],
          },
        ],
      },
    ],
  };
}

// The bitmap the UI builds from the source: same bounds + transform so it
// overlays exactly where the vector was, on its own image-mode color.
function bitmapFor(source: ImportedSvg, linesPerMm = 10): RasterImage {
  return {
    kind: 'raster-image',
    id: 'bmp1',
    source: `${source.source} (bitmap)`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 200,
    pixelHeight: 200,
    bounds: source.bounds,
    transform: source.transform,
    color: RASTER_COLOR,
    dither: 'floyd-steinberg',
    linesPerMm,
    lumaBase64: 'gID/',
  };
}

function projectWithVector(color: string = SOURCE_COLOR): Project {
  const base = createProject();
  return {
    ...base,
    scene: { objects: [importedSvgSource(color)], layers: [createLayer({ id: color, color })] },
  };
}

describe('applyConvertToBitmap (ADR-029)', () => {
  it('deletes the source vector and adds the raster (LightBurn discards the original)', () => {
    const result = applyConvertToBitmap(
      { project: projectWithVector(), undoStack: [] },
      'src-vec',
      bitmapFor(importedSvgSource()),
    );
    const objects = result.project.scene.objects;
    expect(objects.find((o) => o.id === 'src-vec')).toBeUndefined();
    expect(objects.filter((o) => o.kind === 'imported-svg')).toHaveLength(0);
    expect(objects.filter((o) => o.kind === 'raster-image')).toHaveLength(1);
  });

  it('adds the bitmap unchanged so it overlays the source bounds + transform', () => {
    const src = importedSvgSource();
    const raster = bitmapFor(src);
    const result = applyConvertToBitmap(
      { project: projectWithVector(), undoStack: [] },
      'src-vec',
      raster,
    );
    const added = result.project.scene.objects.find((o) => o.kind === 'raster-image');
    expect(added).toEqual(raster); // mutation must not mangle the built bitmap
    expect(added?.bounds).toEqual(src.bounds);
    expect(added?.transform).toEqual(src.transform);
  });

  it('selects the new bitmap', () => {
    const result = applyConvertToBitmap(
      { project: projectWithVector(), undoStack: [] },
      'src-vec',
      bitmapFor(importedSvgSource()),
    );
    expect(result.selectedObjectId).toBe('bmp1');
  });

  it('ensures an image-mode layer for the raster color', () => {
    const result = applyConvertToBitmap(
      { project: projectWithVector(), undoStack: [] },
      'src-vec',
      bitmapFor(importedSvgSource()),
    );
    expect(result.project.scene.layers.find((l) => l.color === RASTER_COLOR)?.mode).toBe('image');
  });

  it('creates the image layer at the converted bitmap density', () => {
    const raster = bitmapFor(importedSvgSource(), 3.2);
    const result = applyConvertToBitmap(
      { project: projectWithVector(), undoStack: [] },
      'src-vec',
      raster,
    );
    expect(result.project.scene.layers.find((l) => l.color === raster.color)?.linesPerMm).toBe(3.2);
  });

  it('does not reuse an existing image layer with a different density', () => {
    const source = importedSvgSource();
    const existingRaster: RasterImage = { ...bitmapFor(source), id: 'existing-bmp' };
    const project: Project = {
      ...projectWithVector(),
      scene: {
        objects: [source, existingRaster],
        layers: [
          createLayer({ id: SOURCE_COLOR, color: SOURCE_COLOR }),
          createLayer({ id: RASTER_COLOR, color: RASTER_COLOR, mode: 'image' }),
        ],
      },
    };
    const raster = bitmapFor(source, 3.2);

    const result = applyConvertToBitmap({ project, undoStack: [] }, 'src-vec', raster);
    const added = result.project.scene.objects.find(
      (o): o is RasterImage => o.kind === 'raster-image' && o.id === raster.id,
    );

    expect(added).toBeDefined();
    if (added === undefined) throw new Error('converted raster was not added');
    expect(added.color).not.toBe(RASTER_COLOR);
    expect(result.project.scene.layers.find((l) => l.color === RASTER_COLOR)?.linesPerMm).toBe(10);
    expect(result.project.scene.layers.find((l) => l.color === added.color)?.linesPerMm).toBe(3.2);
  });

  it("prunes the source vector's now-orphaned color layer", () => {
    const result = applyConvertToBitmap(
      { project: projectWithVector(), undoStack: [] },
      'src-vec',
      bitmapFor(importedSvgSource()),
    );
    const colors = result.project.scene.layers.map((l) => l.color);
    expect(colors).not.toContain(SOURCE_COLOR);
    expect(colors).toContain(RASTER_COLOR);
  });

  it('keeps the source color layer when another object still uses it', () => {
    const base = projectWithVector();
    const sibling: ImportedSvg = { ...importedSvgSource(), id: 'sibling' };
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [...base.scene.objects, sibling] },
    };
    const result = applyConvertToBitmap(
      { project, undoStack: [] },
      'src-vec',
      bitmapFor(importedSvgSource()),
    );
    expect(result.project.scene.layers.map((l) => l.color)).toContain(SOURCE_COLOR);
  });

  it('records exactly one undo entry == the project before, redo cleared, dirty set', () => {
    const project = projectWithVector();
    const result = applyConvertToBitmap(
      { project, undoStack: [] },
      'src-vec',
      bitmapFor(importedSvgSource()),
    );
    expect(result.undoStack).toHaveLength(1);
    expect(result.undoStack[0]).toBe(project);
    expect(result.redoStack).toEqual([]);
    expect(result.dirty).toBe(true);
  });

  it('degrades gracefully: missing source → raster still added, nothing removed', () => {
    const project = projectWithVector();
    const before = project.scene.objects.length;
    const result = applyConvertToBitmap(
      { project, undoStack: [] },
      'no-such-id',
      bitmapFor(importedSvgSource()),
    );
    const objects = result.project.scene.objects;
    expect(objects).toHaveLength(before + 1);
    expect(objects.find((o) => o.id === 'src-vec')).toBeDefined();
    expect(objects.filter((o) => o.kind === 'raster-image')).toHaveLength(1);
  });
});
