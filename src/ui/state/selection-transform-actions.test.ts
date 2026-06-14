import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { resetStore, svgObj } from './test-helpers';
import { useStore } from './store';

describe('selection transform actions', () => {
  beforeEach(() => resetStore());

  it('applies multiple object transforms as one undoable edit', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('B', ['#00ff00']));
    const beforeA = useStore.getState().project.scene.objects.find((object) => object.id === 'A');
    const beforeB = useStore.getState().project.scene.objects.find((object) => object.id === 'B');
    useStore.setState({ undoStack: [], dirty: false });

    useStore.getState().applySelectionTransforms([
      { id: 'A', transform: { ...IDENTITY_TRANSFORM, x: 10, y: 20 } },
      { id: 'B', transform: { ...IDENTITY_TRANSFORM, x: 30, y: 40 } },
    ]);

    const after = useStore.getState();
    expect(
      after.project.scene.objects.find((object) => object.id === 'A')?.transform,
    ).toMatchObject({ x: 10, y: 20 });
    expect(
      after.project.scene.objects.find((object) => object.id === 'B')?.transform,
    ).toMatchObject({ x: 30, y: 40 });
    expect(after.undoStack).toHaveLength(1);
    expect(after.dirty).toBe(true);

    useStore.getState().undo();

    const restored = useStore.getState();
    expect(
      restored.project.scene.objects.find((object) => object.id === 'A')?.transform,
    ).toMatchObject({ x: beforeA?.transform.x, y: beforeA?.transform.y });
    expect(
      restored.project.scene.objects.find((object) => object.id === 'B')?.transform,
    ).toMatchObject({ x: beforeB?.transform.x, y: beforeB?.transform.y });
  });
});
