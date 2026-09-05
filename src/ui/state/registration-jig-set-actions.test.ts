import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findRegistrationBoxBounds, findRegistrationBoxes } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { createRectangle } from '../../core/shapes/primitives';
import { serializeProject } from '../../io/project/serialize-project';
import { deserializeProject } from '../../io/project/deserialize-project';
import {
  createRegistrationJigOutlines,
  MAX_REGISTRATION_JIG_OUTLINES,
  registrationJigSetIssue,
} from './registration-jig-set-actions';

const FIVE_JIGS = {
  outline: { kind: 'rectangle', widthMm: 40, heightMm: 30 },
  rows: 1,
  columns: 5,
  spacingX: 10,
  spacingY: 0,
} as const;

describe('registration jig set actions', () => {
  beforeEach(() => resetStore());

  it('rejects the combined allocation before creating IDs or changing undo state', () => {
    const spec = { ...FIVE_JIGS, rows: 10_000, columns: 10_000 };
    const idFactory = vi.fn(() => 'unused');
    const before = useStore.getState();
    expect(() =>
      createRegistrationJigOutlines(spec.outline, spec, { x: 0, y: 0 }, [], idFactory),
    ).toThrow('at most 10000');
    expect(idFactory).not.toHaveBeenCalled();
    expect(() => before.replaceRegistrationJigSet(spec)).toThrow('at most 10000');
    expect(useStore.getState()).toBe(before);
    expect(
      registrationJigSetIssue({ ...spec, rows: 1, columns: MAX_REGISTRATION_JIG_OUTLINES }),
    ).toBeNull();
  });

  it.each([Number.NaN, 0, -1, 1.5, Number.POSITIVE_INFINITY])(
    'rejects invalid rows %s without mutation',
    (rows) => {
      const before = useStore.getState();
      expect(() => before.replaceRegistrationJigSet({ ...FIVE_JIGS, rows })).toThrow('Rows must');
      expect(useStore.getState()).toBe(before);
    },
  );

  it('creates five registered outlines as one centered row and one undo step', () => {
    useStore.getState().replaceRegistrationJigSet(FIVE_JIGS);

    const state = useStore.getState();
    const boxes = findRegistrationBoxes(state.project.scene);
    expect(boxes).toHaveLength(5);
    expect(boxes.map((box) => box.transform.x)).toEqual([80, 130, 180, 230, 280]);
    expect(boxes.every((box) => box.transform.y === 185)).toBe(true);
    expect(state.selectedObjectId).toBe(boxes[0]?.id);
    expect(state.additionalSelectedIds).toEqual(new Set(boxes.slice(1).map((box) => box.id)));
    expect(state.undoStack).toHaveLength(1);
  });

  it('does not multiply zero by an unused overflowing stride', () => {
    const outline = { kind: 'rectangle', widthMm: 1e308, heightMm: 1 } as const;
    const boxes = createRegistrationJigOutlines(
      outline,
      { rows: 1, columns: 1, spacingX: 1e308, spacingY: 0 },
      { x: 0, y: 0 },
      [],
      () => 'unused',
    );
    expect(boxes[0]?.transform.x).toBe(0);
    expect(() =>
      createRegistrationJigOutlines(
        outline,
        { rows: 1, columns: 1, spacingX: 0, spacingY: 0 },
        { x: 1e308, y: 0 },
        [],
        () => 'unused',
      ),
    ).toThrow('finite coordinates');
  });

  it('reserves retained artwork capacity and round-trips a replacement at the project limit', () => {
    const project = useStore.getState().project;
    const retained = Array.from({ length: MAX_REGISTRATION_JIG_OUTLINES - 5 }, (_, index) =>
      createRectangle({
        id: `art-${index}`,
        color: '#000000',
        spec: { widthMm: 1, heightMm: 1, cornerRadiusMm: 0 },
      }),
    );
    useStore.setState({ project: { ...project, scene: { ...project.scene, objects: retained } } });
    useStore.getState().replaceRegistrationJigSet(FIVE_JIGS);
    const before = useStore.getState();
    expect(before.project.scene.objects).toHaveLength(MAX_REGISTRATION_JIG_OUTLINES);
    expect(deserializeProject(serializeProject(before.project))).toMatchObject({ kind: 'ok' });
    expect(() => before.replaceRegistrationJigSet({ ...FIVE_JIGS, columns: 6 })).toThrow(
      'room for 5',
    );
    expect(useStore.getState()).toBe(before);
    before.replaceRegistrationJigSet({ ...FIVE_JIGS, spacingX: 2 });
    expect(deserializeProject(serializeProject(useStore.getState().project))).toMatchObject({
      kind: 'ok',
    });
  });

  it('replaces a set at the same fixture origin and carries its all-locked state', () => {
    useStore.getState().replaceRegistrationJigSet({ ...FIVE_JIGS, columns: 2 });
    useStore.getState().nudgeSelection(12, 8);
    useStore.getState().setRegistrationBoxLocked(true);
    const before = findRegistrationBoxBounds(useStore.getState().project.scene);

    useStore.getState().replaceRegistrationJigSet(FIVE_JIGS);

    const state = useStore.getState();
    const boxes = findRegistrationBoxes(state.project.scene);
    const after = findRegistrationBoxBounds(state.project.scene);
    expect(after?.minX).toBe(before?.minX);
    expect(after?.minY).toBe(before?.minY);
    expect(boxes).toHaveLength(5);
    expect(boxes.every((box) => box.locked === true)).toBe(true);
  });

  it('does not replace a captured-board outline through the jig-set action', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    const before = useStore.getState().project;

    useStore.getState().replaceRegistrationJigSet(FIVE_JIGS);

    expect(useStore.getState().project).toBe(before);
    expect(findRegistrationBoxes(before.scene)).toHaveLength(1);
  });
});
