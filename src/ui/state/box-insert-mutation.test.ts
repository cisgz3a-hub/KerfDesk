import { describe, expect, it } from 'vitest';
import { generateBox, type BoxPanel, type BoxSpec } from '../../core/box';
import { createProject } from '../../core/scene';
import { applyInsertBoxPanels } from './box-insert-mutation';

const SPEC: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
};

function generatedPanels(): ReadonlyArray<BoxPanel> {
  const result = generateBox(SPEC);
  if (result.kind !== 'generated') throw new Error(result.kind);
  return result.panels;
}

function emptySlice() {
  return { project: createProject(), undoStack: [] };
}

describe('applyInsertBoxPanels', () => {
  it('inserts one named vector object per panel with fresh unique ids', () => {
    const result = applyInsertBoxPanels(emptySlice(), generatedPanels());
    expect(result).not.toBeNull();
    if (result === null) return;
    const objects = result.project.scene.objects;
    expect(objects).toHaveLength(6);
    expect(new Set(objects.map((o) => o.id)).size).toBe(6);
    const sources = objects.map((o) => (o.kind === 'imported-svg' ? o.source : o.kind));
    expect(sources).toEqual([
      'Box panel: Bottom',
      'Box panel: Top',
      'Box panel: Front',
      'Box panel: Back',
      'Box panel: Left',
      'Box panel: Right',
    ]);
  });

  it('selects every inserted panel and nothing else', () => {
    const result = applyInsertBoxPanels(emptySlice(), generatedPanels());
    if (result === null) throw new Error('expected insertion');
    const ids = result.project.scene.objects.map((o) => o.id);
    expect(result.selectedObjectId).toBe(ids[0]);
    expect([...result.additionalSelectedIds].sort()).toEqual(ids.slice(1).sort());
  });

  it('creates the cut layer once and reuses it on repeated generates', () => {
    const firstInsert = applyInsertBoxPanels(emptySlice(), generatedPanels());
    if (firstInsert === null) throw new Error('expected insertion');
    const layers = firstInsert.project.scene.layers.filter((l) => l.color === '#000000');
    expect(layers).toHaveLength(1);
    expect(layers[0]?.mode).toBe('line');
    const secondInsert = applyInsertBoxPanels(
      { project: firstInsert.project, undoStack: firstInsert.undoStack },
      generatedPanels(),
    );
    if (secondInsert === null) throw new Error('expected insertion');
    expect(secondInsert.project.scene.objects).toHaveLength(12);
    expect(secondInsert.project.scene.layers.filter((l) => l.color === '#000000')).toHaveLength(1);
    expect(new Set(secondInsert.project.scene.objects.map((o) => o.id)).size).toBe(12);
  });

  it('is a single undo step and marks the project dirty', () => {
    const slice = emptySlice();
    const result = applyInsertBoxPanels(slice, generatedPanels());
    if (result === null) throw new Error('expected insertion');
    expect(result.undoStack).toEqual([slice.project]);
    expect(result.redoStack).toEqual([]);
    expect(result.dirty).toBe(true);
  });

  it('does nothing for an empty panel list', () => {
    expect(applyInsertBoxPanels(emptySlice(), [])).toBeNull();
  });

  it('keeps every ring verbatim: outline first, then cutouts (holes)', () => {
    const panels = generatedPanels();
    const first = panels[0];
    if (first === undefined) throw new Error('missing panel');
    const withCutout: BoxPanel = {
      ...first,
      cutouts: [
        {
          closed: true,
          points: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 16 },
            { x: 10, y: 16 },
            { x: 10, y: 10 },
          ],
        },
      ],
    };
    const result = applyInsertBoxPanels(emptySlice(), [withCutout, ...panels.slice(1)]);
    if (result === null) throw new Error('expected insertion');
    const object = result.project.scene.objects[0];
    if (object?.kind !== 'imported-svg') throw new Error('expected imported-svg');
    const polylines = object.paths[0]?.polylines;
    expect(polylines).toHaveLength(2);
    expect(polylines?.[0]?.points).toEqual(withCutout.outline.points);
    expect(polylines?.[1]?.points).toEqual(withCutout.cutouts[0]?.points);
    expect(object.bounds.minX).toBeCloseTo(0, 9);
  });
});
