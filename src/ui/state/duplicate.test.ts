import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

describe('useStore — duplicateSelection (Cmd+D)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('clones the selected object with a 10 mm offset', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    const before = useStore.getState().project.scene.objects[0];
    useStore.getState().duplicateSelection();
    const after = useStore.getState().project.scene.objects;
    expect(after).toHaveLength(2);
    const clone = after[1];
    expect(clone).toBeDefined();
    if (clone === undefined || before === undefined) return;
    expect(clone.id).not.toBe(before.id);
    expect(clone.transform.x).toBeCloseTo(before.transform.x + 10, 5);
    expect(clone.transform.y).toBeCloseTo(before.transform.y + 10, 5);
    // New clone becomes the selection.
    expect(useStore.getState().selectedObjectId).toBe(clone.id);
  });

  it('on multi-select clones every selected object', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0000ff']));
    useStore.getState().selectObject('O1');
    useStore.getState().toggleSelectObject('O2');
    useStore.getState().duplicateSelection();
    const objs = useStore.getState().project.scene.objects;
    expect(objs).toHaveLength(4);
    // Selection resets to the new clones — confirm the new primary is one
    // of the clones (not O1 / O2), and the extras set has the other.
    const sel = useStore.getState().selectedObjectId;
    expect(sel === 'O1' || sel === 'O2').toBe(false);
    expect(useStore.getState().additionalSelectedIds.size).toBe(1);
  });

  it('is a no-op with no selection', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject(null);
    const before = useStore.getState().project.scene.objects.length;
    useStore.getState().duplicateSelection();
    expect(useStore.getState().project.scene.objects).toHaveLength(before);
  });
});
