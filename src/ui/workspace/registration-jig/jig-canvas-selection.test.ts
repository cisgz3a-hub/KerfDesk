import { describe, expect, it } from 'vitest';
import { createLayer, createProject, type Project } from '../../../core/scene';
import { createRectangle } from '../../../core/shapes/primitives';
import { jigSelectionForHit, moveJigSelection } from './jig-canvas-selection';

function fixture(): Project {
  const layer = createLayer({ id: 'artwork', color: '#000000' });
  const hidden = { ...createLayer({ id: 'hidden', color: '#ff0000' }), visible: false };
  const objects = ['a', 'b', 'locked', 'hidden', 'other'].map((id) => ({
    ...createRectangle({
      id,
      color: id === 'hidden' ? hidden.color : layer.color,
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    }),
    locked: id === 'locked',
  }));
  return {
    ...createProject(),
    scene: {
      objects,
      layers: [layer, hidden],
      groups: [{ id: 'group', name: 'Group', objectIds: ['a', 'b', 'locked', 'hidden'] }],
    },
  };
}

describe('registration jig canvas selection', () => {
  it('selects a complete editable group without its locked or hidden members', () => {
    expect([...jigSelectionForHit(fixture().scene, 'a', new Set(), false)]).toEqual(['a', 'b']);
  });

  it('shift-click adds and removes the whole editable group', () => {
    const scene = fixture().scene;
    const added = jigSelectionForHit(scene, 'a', new Set(['other']), true);
    expect([...added]).toEqual(['a', 'b', 'other']);
    expect([...jigSelectionForHit(scene, 'b', added, true)]).toEqual(['other']);
  });

  it('keeps a multiselection when starting a drag on an already selected member', () => {
    expect([
      ...jigSelectionForHit(fixture().scene, 'a', new Set(['a', 'b', 'other']), false),
    ]).toEqual(['a', 'b', 'other']);
  });

  it('translates only visible unlocked selected objects without mutating source or settings', () => {
    const project = fixture();
    const next = moveJigSelection(project, new Set(['a', 'b', 'locked', 'hidden']), 12, -4);
    expect(next.scene.objects.slice(0, 2).map((object) => object.transform)).toEqual([
      { ...project.scene.objects[0]!.transform, x: 12, y: -4 },
      { ...project.scene.objects[1]!.transform, x: 12, y: -4 },
    ]);
    expect(project.scene.objects[0]!.transform.x).toBe(0);
    expect(next.scene.objects[2]).toBe(project.scene.objects[2]);
    expect(next.scene.objects[3]).toBe(project.scene.objects[3]);
    expect(next.scene.objects[4]).toBe(project.scene.objects[4]);
    expect(next.scene.layers).toBe(project.scene.layers);
    expect(next.scene.groups).toBe(project.scene.groups);
  });

  it('returns the source for a click, invalid displacement or noneditable selection', () => {
    const project = fixture();
    expect(moveJigSelection(project, new Set(['a']), 0, 0)).toBe(project);
    expect(moveJigSelection(project, new Set(['a']), Number.NaN, 2)).toBe(project);
    expect(moveJigSelection(project, new Set(['locked', 'hidden']), 4, 2)).toBe(project);
  });
});
