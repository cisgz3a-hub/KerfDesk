import { beforeEach, describe, expect, it } from 'vitest';
import {
  createProject,
  findRegistrationBoxes,
  findRegistrationLayer,
  IDENTITY_TRANSFORM,
  REGISTRATION_LAYER_ID,
  type Project,
} from '../../core/scene';
import { createRectangle, createRegistrationBox } from '../../core/shapes';
import {
  applyAddRegistrationBox,
  registrationBoxDefaultPosition,
} from './registration-box-actions';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function slice(): { readonly project: Project; readonly undoStack: ReadonlyArray<Project> } {
  return { project: createProject(), undoStack: [] };
}

describe('applyAddRegistrationBox', () => {
  it('adds the box on the reserved registration layer and selects it', () => {
    const box = createRegistrationBox({ widthMm: 80, heightMm: 40 });
    const result = applyAddRegistrationBox(slice(), box);
    expect(findRegistrationLayer(result.project.scene)?.id).toBe(REGISTRATION_LAYER_ID);
    const boxes = findRegistrationBoxes(result.project.scene);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.id).toBe(box.id);
    expect(result.selectedObjectId).toBe(box.id);
    expect(result.dirty).toBe(true);
    expect(result.undoStack).toHaveLength(1);
  });

  it('replaces an existing box so only one jig ever exists', () => {
    const afterFirst = applyAddRegistrationBox(
      slice(),
      createRegistrationBox({ widthMm: 80, heightMm: 40, id: 'box-1' }),
    );
    const afterSecond = applyAddRegistrationBox(
      { project: afterFirst.project, undoStack: afterFirst.undoStack },
      createRegistrationBox({ widthMm: 50, heightMm: 50, id: 'box-2' }),
    );
    const boxes = findRegistrationBoxes(afterSecond.project.scene);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.id).toBe('box-2');
  });
});

describe('registrationBoxDefaultPosition', () => {
  it('centers the box on the bed', () => {
    expect(registrationBoxDefaultPosition(400, 400, 100, 60)).toEqual({ x: 150, y: 170 });
  });

  it('clamps to 0 when the box is larger than the bed', () => {
    expect(registrationBoxDefaultPosition(400, 30, 100, 100).y).toBe(0);
  });
});

describe('addRegistrationBox store action', () => {
  beforeEach(() => {
    resetStore();
  });

  it('creates the sized box centered, selects it, and dirties the project', () => {
    useStore.getState().addRegistrationBox(80, 40);
    const state = useStore.getState();
    const boxes = findRegistrationBoxes(state.project.scene);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.spec).toMatchObject({ kind: 'rect', widthMm: 80, heightMm: 40 });
    expect(state.selectedObjectId).toBe(boxes[0]?.id);
    expect(state.dirty).toBe(true);
    expect(boxes[0]?.transform.x).toBe((state.project.device.bedWidth - 80) / 2);
    expect(boxes[0]?.transform.y).toBe((state.project.device.bedHeight - 40) / 2);
  });

  it('replace keeps the existing box position instead of re-centering', () => {
    useStore.getState().addRegistrationBox(80, 40);
    const created = findRegistrationBoxes(useStore.getState().project.scene)[0];
    // Drag the (selected) box away from center.
    useStore.getState().nudgeSelection(50, 30);
    const moved = findRegistrationBoxes(useStore.getState().project.scene)[0];
    expect(moved?.transform.x).toBe((created?.transform.x ?? 0) + 50);
    // Replace with a new size — position must be preserved.
    useStore.getState().addRegistrationBox(100, 60);
    const replaced = findRegistrationBoxes(useStore.getState().project.scene)[0];
    expect(replaced?.transform.x).toBe(moved?.transform.x);
    expect(replaced?.transform.y).toBe(moved?.transform.y);
    expect(replaced?.spec).toMatchObject({ kind: 'rect', widthMm: 100, heightMm: 60 });
  });
});

describe('centerSelectionInRegistrationBox store action', () => {
  beforeEach(() => {
    resetStore();
  });

  function addArt(id: string, x: number, y: number): void {
    useStore.getState().drawShape(
      createRectangle({
        id,
        color: '#0000ff',
        spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x, y },
      }),
    );
  }

  it('centers the selected artwork on the registration box', () => {
    // 80x40 box centers at (160,180) on the 400x400 bed -> box center (200,200).
    useStore.getState().addRegistrationBox(80, 40);
    addArt('art', 10, 10);
    useStore.getState().centerSelectionInRegistrationBox();
    const moved = useStore.getState().project.scene.objects.find((o) => o.id === 'art');
    // 20x20 art centered on (200,200) -> top-left (190,190).
    expect(moved?.transform.x).toBe(190);
    expect(moved?.transform.y).toBe(190);
  });

  it('leaves the registration box itself unmoved', () => {
    useStore.getState().addRegistrationBox(80, 40);
    const before = findRegistrationBoxes(useStore.getState().project.scene)[0]?.transform;
    addArt('art2', 0, 0);
    useStore.getState().centerSelectionInRegistrationBox();
    const after = findRegistrationBoxes(useStore.getState().project.scene)[0]?.transform;
    expect(after).toEqual(before);
  });
});

describe('removeRegistrationBox store action', () => {
  beforeEach(() => {
    resetStore();
  });

  it('deletes the box and the reserved registration layer', () => {
    useStore.getState().addRegistrationBox(80, 40);
    expect(findRegistrationBoxes(useStore.getState().project.scene)).toHaveLength(1);
    useStore.getState().removeRegistrationBox();
    const scene = useStore.getState().project.scene;
    expect(findRegistrationBoxes(scene)).toHaveLength(0);
    expect(findRegistrationLayer(scene)).toBeNull();
    expect(useStore.getState().selectedObjectId).toBeNull();
  });

  it('is a no-op when there is no jig', () => {
    const before = useStore.getState().project;
    useStore.getState().removeRegistrationBox();
    expect(useStore.getState().project).toBe(before);
  });
});

describe('setRegistrationBoxLocked store action', () => {
  beforeEach(() => {
    resetStore();
  });

  function boxLocked(): boolean | undefined {
    return findRegistrationBoxes(useStore.getState().project.scene)[0]?.locked;
  }

  it('locks and unlocks the box', () => {
    useStore.getState().addRegistrationBox(80, 40);
    expect(boxLocked()).toBeUndefined();
    useStore.getState().setRegistrationBoxLocked(true);
    expect(boxLocked()).toBe(true);
    useStore.getState().setRegistrationBoxLocked(false);
    expect(boxLocked()).toBe(false);
  });

  it('is a no-op when there is no jig', () => {
    const before = useStore.getState().project;
    useStore.getState().setRegistrationBoxLocked(true);
    expect(useStore.getState().project).toBe(before);
  });
});
