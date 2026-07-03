import { describe, expect, it } from 'vitest';
import { generateBox, type BoxSpec } from '../../core/box';
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

function generatedPanels() {
  const result = generateBox(SPEC);
  if (result.kind !== 'generated') throw new Error(result.kind);
  return result.panels;
}

function emptySlice() {
  return { project: createProject(), undoStack: [] };
}

describe('applyInsertBoxPanels', () => {
  it('inserts one closed polyline shape per panel with fresh unique ids', () => {
    const result = applyInsertBoxPanels(emptySlice(), generatedPanels());
    expect(result).not.toBeNull();
    if (result === null) return;
    const objects = result.project.scene.objects;
    expect(objects).toHaveLength(6);
    expect(new Set(objects.map((o) => o.id)).size).toBe(6);
    for (const object of objects) {
      expect(object.kind).toBe('shape');
      if (object.kind !== 'shape') continue;
      expect(object.spec.kind).toBe('polyline');
      if (object.spec.kind !== 'polyline') continue;
      expect(object.spec.closed).toBe(true);
      // The spec must not repeat the closing vertex; materialization does.
      const first = object.spec.points[0];
      const last = object.spec.points[object.spec.points.length - 1];
      expect(first).not.toEqual(last);
    }
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
    // Fresh ids each generate — no collisions between the two sheets.
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

  it('keeps the sheet geometry verbatim in scene coordinates', () => {
    const panels = generatedPanels();
    const result = applyInsertBoxPanels(emptySlice(), panels);
    if (result === null) throw new Error('expected insertion');
    const object = result.project.scene.objects[0];
    if (object?.kind !== 'shape') throw new Error('expected shape');
    const polyline = object.paths[0]?.polylines[0];
    expect(polyline?.points).toEqual(panels[0]?.outline.points);
  });
});
