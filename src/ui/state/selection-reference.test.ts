import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { resetStore, svgObj } from './test-helpers';
import { useStore } from './store';

// Every svgObj is a 10 x 10 mm box at its transform origin, so an object's
// transform x is also its left edge. Objects stack in the order they are
// seeded, so the last one seeded is the top-most.

describe('Align reference follows the order the objects were clicked', () => {
  beforeEach(() => resetStore());

  it('aligns to the object Shift+clicked last, though another is higher in the stack', () => {
    seed({ plate: 100, label: 20 });
    click('label', 'plate');

    useStore.getState().alignSelection('left');

    expect(left('plate')).toBe(100);
    expect(left('label')).toBe(100);
  });

  it('aligns to the top-most object when that one was clicked last', () => {
    seed({ plate: 100, label: 20 });
    click('plate', 'label');

    useStore.getState().alignSelection('left');

    expect(left('plate')).toBe(20);
    expect(left('label')).toBe(20);
  });

  it('falls back to the top-most object for a marquee, which has no click order', () => {
    seed({ plate: 100, label: 20 });
    click('label', 'plate');
    useStore.getState().selectObjects(['plate', 'label']);

    useStore.getState().alignSelection('left');

    expect(left('plate')).toBe(20);
    expect(left('label')).toBe(20);
  });

  it('keeps the reference when Shift+click removes another object', () => {
    seed({ P: 10, Q: 50, R: 90 });
    click('R', 'Q', 'P', 'R');

    useStore.getState().alignSelection('left');

    expect(left('P')).toBe(10);
    expect(left('Q')).toBe(10);
    expect(left('R')).toBe(90);
  });

  it('falls back to the top-most object once Shift+click removes the reference', () => {
    seed({ P: 10, Q: 50, R: 90 });
    click('R', 'P', 'Q', 'Q');

    useStore.getState().alignSelection('left');

    expect(left('P')).toBe(90);
    expect(left('R')).toBe(90);
  });

  it('falls back to the top-most object once the reference is deleted', () => {
    seed({ P: 10, Q: 50, R: 90 });
    click('R', 'Q', 'P');
    useStore.getState().removeSceneObject('P');

    useStore.getState().alignSelection('left');

    expect(left('Q')).toBe(90);
    expect(left('R')).toBe(90);
  });

  it('keeps the reference through undo and redo', () => {
    seed({ plate: 100, label: 20 });
    click('label', 'plate');
    useStore
      .getState()
      .applySelectionTransforms([{ id: 'label', transform: { ...IDENTITY_TRANSFORM, x: 40 } }]);
    useStore.getState().undo();
    expect(left('label')).toBe(20);
    useStore.getState().redo();
    expect(left('label')).toBe(40);

    useStore.getState().alignSelection('left');

    expect(left('plate')).toBe(100);
    expect(left('label')).toBe(100);
  });

  it('keeps the reference through group and ungroup', () => {
    seed({ plate: 100, label: 20 });
    click('label', 'plate');
    useStore.getState().groupSelection();
    useStore.getState().ungroupSelection();

    useStore.getState().alignSelection('left');

    expect(left('plate')).toBe(100);
    expect(left('label')).toBe(100);
  });

  it('keeps the reference when a drag is cancelled', () => {
    seed({ plate: 100, label: 20 });
    click('label', 'plate');
    useStore.getState().beginInteraction();
    useStore.getState().setObjectTransform('plate', { ...IDENTITY_TRANSFORM, x: 150 });
    useStore.getState().cancelInteraction();

    useStore.getState().alignSelection('left');

    expect(left('plate')).toBe(100);
    expect(left('label')).toBe(100);
  });
});

function seed(positions: Readonly<Record<string, number>>): void {
  const entries = Object.entries(positions);
  for (const [id] of entries) useStore.getState().importSvgObject(svgObj(id, ['#ff0000']));
  useStore
    .getState()
    .applySelectionTransforms(
      entries.map(([id, x]) => ({ id, transform: { ...IDENTITY_TRANSFORM, x } })),
    );
  useStore.setState({ undoStack: [], redoStack: [] });
}

// A plain click on the first object, then a Shift+click on each of the rest.
function click(first: string, ...shiftClicked: ReadonlyArray<string>): void {
  useStore.getState().selectObject(first);
  for (const id of shiftClicked) useStore.getState().toggleSelectObject(id);
}

function left(id: string): number | undefined {
  return useStore.getState().project.scene.objects.find((object) => object.id === id)?.transform.x;
}
