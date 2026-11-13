// Tools audit T1, T28-P2-2 (ADR-350 Amendment 1): shapes in one operation did
// not weld when their path colours differed. Assign to operation and an
// operation recolour keep the old path colour, which only shows when no
// operation binds the path, so Weld said "Nothing to weld", or left one
// shape's whole outline cutting through the welded shape.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { burnMoves, litLength as litLengthOf } from './weld-burn-test-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const st = () => useStore.getState();
const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

const lineOp = (id: string, color: string, speed: number, power: number): Layer => ({
  ...createLayer({ id, color, name: id, mode: 'line' }),
  speed,
  power,
});

// A 20 × 10 mm rectangle with its left edge at x0, y 10–20.
const rect = (id: string, color: string, x0: number, op: string): SceneObject =>
  ({
    ...createRectangle({
      id,
      color,
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: x0 + 10, y: 15 },
    }),
    operationIds: [op],
  }) as SceneObject;

function load(objects: ReadonlyArray<SceneObject>, layers: ReadonlyArray<Layer>, ids: string[]) {
  const base = createProject();
  const project: Project = {
    ...base,
    scene: { ...base.scene, objects: [...objects], layers: [...layers], groups: [] },
  };
  useStore.setState({
    project,
    selectedObjectId: ids[0] ?? null,
    additionalSelectedIds: new Set(ids.slice(1)),
    undoStack: [],
    redoStack: [],
  });
}

function select(ids: string[]): void {
  useStore.setState({
    selectedObjectId: ids[0] ?? null,
    additionalSelectedIds: new Set(ids.slice(1)),
  });
}

/** Total lit G1 length, read back from the emitted G-code. */
const litLength = (project: Project): number => litLengthOf(burnMoves(project));

describe('Weld joins shapes of one operation whatever their path colours (T28-P2-2)', () => {
  it('welds a shape moved into the operation with Assign to operation', () => {
    load(
      [rect('A', '#000000', 10, 'L1'), rect('B', '#ff0000', 20, 'L2')],
      [lineOp('L1', '#000000', 1000, 80), lineOp('L2', '#ff0000', 500, 40)],
      ['B'],
    );
    st().assignSelectionToLayer('L1');
    const assigned = st().project.scene.objects.find((object) => object.id === 'B') as ImportedSvg;
    expect(assigned.operationIds).toEqual(['L1']);
    expect(assigned.paths[0]?.color).toBe('#ff0000');
    const before = st().project;
    expect(litLength(before)).toBeCloseTo(120, 3);

    select(['A', 'B']);
    st().weldSelection();

    const after = st().project;
    expect(after).not.toBe(before);
    expect(after.scene.objects).toHaveLength(1);
    // Oracle: the union [10, 40] × [10, 20] has a 80 mm outline.
    expect(litLength(after)).toBeCloseTo(80, 3);
    expect(toasts().join(' ')).not.toMatch(/Nothing to weld/);
  });

  it('welds a new shape drawn after the operation was recoloured', () => {
    load([rect('A', '#000000', 10, 'L1')], [lineOp('L1', '#000000', 1000, 80)], []);
    st().setLayerColor('L1', '#0000ff');
    const recoloured = st().project;
    const drawn = rect('N', '#0000ff', 20, 'L1');
    useStore.setState({
      project: {
        ...recoloured,
        scene: { ...recoloured.scene, objects: [...recoloured.scene.objects, drawn] },
      },
    });
    select(['A', 'N']);

    st().weldSelection();

    expect(st().project.scene.objects).toHaveLength(1);
    expect(toasts().join(' ')).not.toMatch(/Nothing to weld/);
  });

  it('cuts one outline around a mixed-colour weld, not the off-colour shape inside it', () => {
    // A and C black, B red, all on L1: the union is [10, 55] × [10, 20].
    load(
      [
        rect('A', '#000000', 10, 'L1'),
        rect('B', '#ff0000', 35, 'L1'),
        rect('C', '#000000', 25, 'L1'),
      ],
      [lineOp('L1', '#000000', 1000, 80)],
      ['A', 'B', 'C'],
    );
    expect(litLength(st().project)).toBeCloseTo(180, 3);

    st().weldSelection();

    const welded = st().project.scene.objects[0] as ImportedSvg;
    expect(welded.paths).toHaveLength(1);
    // 110 mm, where the colour-split weld burned (A ∪ C) 90 + B 60 = 150 mm.
    expect(litLength(st().project)).toBeCloseTo(110, 3);
  });
});
