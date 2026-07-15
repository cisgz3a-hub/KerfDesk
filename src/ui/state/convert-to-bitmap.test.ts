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
  primaryOperationForObject,
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

function operationForRaster(project: Project, id = 'bmp1') {
  const raster = project.scene.objects.find(
    (object): object is RasterImage => object.kind === 'raster-image' && object.id === id,
  );
  if (raster === undefined) throw new Error(`missing raster ${id}`);
  const operation = primaryOperationForObject(raster, project.scene.layers);
  if (operation === null) throw new Error(`missing operation for raster ${id}`);
  return operation;
}

describe('applyConvertToBitmap (ADR-029)', () => {
  it('deletes the source vector and adds the raster (LightBurn discards the original)', () => {
    const result = applyConvertToBitmap(
      { project: projectWithVector(), undoStack: [] },
      ['src-vec'],
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
      ['src-vec'],
      raster,
    );
    const added = result.project.scene.objects.find((o) => o.kind === 'raster-image');
    expect(added).toMatchObject(raster); // geometry stays intact while the bitmap gains its operation
    expect(added?.operationIds).toHaveLength(1);
    expect(added?.bounds).toEqual(src.bounds);
    expect(added?.transform).toEqual(src.transform);
  });

  it('selects the new bitmap', () => {
    const result = applyConvertToBitmap(
      { project: projectWithVector(), undoStack: [] },
      ['src-vec'],
      bitmapFor(importedSvgSource()),
    );
    expect(result.selectedObjectId).toBe('bmp1');
  });

  it('creates an image-mode operation for the raster', () => {
    const result = applyConvertToBitmap(
      { project: projectWithVector(), undoStack: [] },
      ['src-vec'],
      bitmapFor(importedSvgSource()),
    );
    expect(operationForRaster(result.project).mode).toBe('image');
  });

  it('creates the image layer at the converted bitmap density', () => {
    const raster = bitmapFor(importedSvgSource(), 3.2);
    const result = applyConvertToBitmap(
      { project: projectWithVector(), undoStack: [] },
      ['src-vec'],
      raster,
    );
    expect(operationForRaster(result.project).linesPerMm).toBe(3.2);
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

    const result = applyConvertToBitmap({ project, undoStack: [] }, ['src-vec'], raster);
    const added = result.project.scene.objects.find(
      (o): o is RasterImage => o.kind === 'raster-image' && o.id === raster.id,
    );

    expect(added).toBeDefined();
    if (added === undefined) throw new Error('converted raster was not added');
    const existingOperation = operationForRaster(result.project, existingRaster.id);
    const convertedOperation = operationForRaster(result.project, added.id);
    expect(convertedOperation.id).not.toBe(existingOperation.id);
    expect(existingOperation.linesPerMm).toBe(10);
    expect(convertedOperation.linesPerMm).toBe(3.2);
  });

  it("prunes the source vector's now-orphaned color layer", () => {
    const result = applyConvertToBitmap(
      { project: projectWithVector(), undoStack: [] },
      ['src-vec'],
      bitmapFor(importedSvgSource()),
    );
    expect(result.project.scene.layers.map((operation) => operation.id)).not.toContain(
      SOURCE_COLOR,
    );
    expect(operationForRaster(result.project).mode).toBe('image');
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
      ['src-vec'],
      bitmapFor(importedSvgSource()),
    );
    expect(result.project.scene.layers.map((l) => l.color)).toContain(SOURCE_COLOR);
  });

  it('records exactly one undo entry == the project before, redo cleared, dirty set', () => {
    const project = projectWithVector();
    const result = applyConvertToBitmap(
      { project, undoStack: [] },
      ['src-vec'],
      bitmapFor(importedSvgSource()),
    );
    expect(result.undoStack).toHaveLength(1);
    expect(result.undoStack[0]).toBe(project);
    expect(result.redoStack).toEqual([]);
    expect(result.dirty).toBe(true);
  });

  // ADR-029 amendment ii: a multi-selection merges into ONE bitmap — every
  // source vector is deleted in the same single undo entry, and the stale
  // multi-selection is cleared so Delete/duplicate can't act on ghosts.
  it('removes every source of a multi-selection merge in one undo entry', () => {
    const base = projectWithVector();
    const sibling: ImportedSvg = { ...importedSvgSource(), id: 'src-vec-2' };
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [...base.scene.objects, sibling] },
    };

    const result = applyConvertToBitmap(
      { project, undoStack: [] },
      ['src-vec', 'src-vec-2'],
      bitmapFor(importedSvgSource()),
    );

    const objects = result.project.scene.objects;
    expect(objects.filter((o) => o.kind === 'imported-svg')).toHaveLength(0);
    expect(objects.filter((o) => o.kind === 'raster-image')).toHaveLength(1);
    expect(result.selectedObjectId).toBe('bmp1');
    expect(result.additionalSelectedIds.size).toBe(0);
    expect(result.undoStack).toHaveLength(1);
    expect(result.undoStack[0]).toBe(project);
    // Both sources shared one color layer — orphaned after the merge.
    expect(result.project.scene.layers.map((l) => l.color)).not.toContain(SOURCE_COLOR);
  });

  it('degrades gracefully: missing source → raster still added, nothing removed', () => {
    const project = projectWithVector();
    const before = project.scene.objects.length;
    const result = applyConvertToBitmap(
      { project, undoStack: [] },
      ['no-such-id'],
      bitmapFor(importedSvgSource()),
    );
    const objects = result.project.scene.objects;
    expect(objects).toHaveLength(before + 1);
    expect(objects.find((o) => o.id === 'src-vec')).toBeDefined();
    expect(objects.filter((o) => o.kind === 'raster-image')).toHaveLength(1);
  });
});
