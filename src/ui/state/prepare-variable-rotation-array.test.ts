import { afterEach, describe, expect, it } from 'vitest';
import { type ArraySpec, type CircularArraySpec, type SceneObject } from '../../core/scene';
import {
  materializeVariableText,
  prepareOutputSnapshot,
} from '../../io/gcode/prepare-output-snapshot';
import { emitGcodeSnapshot } from '../../io/gcode/emit-gcode-snapshot';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { serializeProject } from '../../io/project/serialize-project';
import { deserializeProject } from '../../io/project/deserialize-project';
import { applyArraySelection } from './array-actions';
import { prepareVariableArray } from './prepare-variable-array';
import { useStore, type AppState } from './store';
import { fixtureState, NAMES, NOW, renderFixture, textValues } from './variable-array-test-fixture';

const CIRCLE: CircularArraySpec = {
  kind: 'circular',
  count: 6,
  centerX: 100,
  centerY: 80,
  radius: 60,
  startAngleDeg: 30,
  rotateCopies: false,
};
const POINT: ArraySpec = { kind: 'point-rotation', count: 6, totalAngleDeg: -180 };
const MODES = [CIRCLE, POINT];
const initial = useStore.getState();
afterEach(() => useStore.setState(initial, true));

async function array(spec: ArraySpec, before = fixtureState()): Promise<AppState> {
  const result = await prepareVariableArray(before, spec, {
    render: renderFixture,
    clock: () => NOW,
  });
  if (!result.ok) throw new Error(result.message);
  let id = 0;
  return {
    ...before,
    ...applyArraySelection(before, spec, () => `copy-${id++}`, result.materialized),
  };
}

function rotate(x: number, y: number, angle: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: x * Math.cos(rad) - y * Math.sin(rad), y: x * Math.sin(rad) + y * Math.cos(rad) };
}

function expectOrigin(object: SceneObject, x: number, y: number): void {
  expect(object.transform.x).toBeCloseTo(x, 8);
  expect(object.transform.y).toBeCloseTo(y, 8);
}

describe('distinct variable Circular and Point Rotation arrays', () => {
  it.each([false, true])(
    'centres every measured badge on the requested circle (rotation %s)',
    async (rotateCopies) => {
      const result = await array({ ...CIRCLE, rotateCopies });
      const widths = [5, 44, 7, 5, 5, 5];
      for (let index = 0; index < 6; index += 1) {
        const angle = 30 + index * 60;
        const ring = rotate(60, 0, angle);
        const rotation = rotateCopies ? angle + 90 : 0;
        for (let field = 0; field < 3; field += 1) {
          const relative = rotate(-widths[index]! / 2, field * 4 - 5, rotation);
          const object = result.project.scene.objects[index * 3 + field]!;
          expectOrigin(object, 100 + ring.x + relative.x, 80 + ring.y + relative.y);
          expect(object.transform.rotationDeg).toBe(rotation % 360);
        }
      }
      expect(result.project.scene.groups).toHaveLength(6);
    },
  );

  it('uses the first evaluated badge centre as the shared signed exclusive-endpoint pivot', async () => {
    const result = await array(POINT);
    for (let index = 0; index < 6; index += 1) {
      const angle = -index * 30;
      for (let field = 0; field < 3; field += 1) {
        const relative = rotate(-2.5, field * 4 - 5, angle);
        const object = result.project.scene.objects[index * 3 + field]!;
        expectOrigin(object, 2.5 + relative.x, 5 + relative.y);
        expect(object.transform.rotationDeg).toBe((angle + 360) % 360);
      }
    }
  });

  it('composes point rotation with an already rotated source', async () => {
    const state = fixtureState();
    const before = {
      ...state,
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object) => ({
            ...object,
            transform: { ...object.transform, x: 20, y: object.transform.y + 30, rotationDeg: 90 },
          })),
        },
      },
    };
    const result = await array({ kind: 'point-rotation', count: 4, totalAngleDeg: 360 }, before);
    // The first rendered badge spans x=18..20, y=30..43, despite later CSV widths.
    for (let index = 0; index < 4; index += 1) {
      const relative = rotate(1, -6.5, index * 90);
      const object = result.project.scene.objects[index * 3]!;
      expectOrigin(object, 19 + relative.x, 36.5 + relative.y);
      expect(object.transform.rotationDeg).toBe((90 + index * 90) % 360);
    }
  });

  it('allows requested initial overlap without changing a zero radius', async () => {
    const result = await array({ ...CIRCLE, radius: 0, count: 2 });
    expectOrigin(result.project.scene.objects[0]!, 97.5, 75);
    expectOrigin(result.project.scene.objects[3]!, 78, 75);
  });

  it.each(MODES)(
    '$kind assigns distinct records in placement order and preserves ordinary copies',
    async (spec) => {
      const before = fixtureState();
      const result = await array(spec, before);
      expect(textValues(result.project)).toEqual(
        NAMES.flatMap((name, index) => [
          `${name}-${String(10 + index).padStart(3, '0')}`,
          `D${110 + index}`,
          'Fixed',
        ]),
      );
      expect(result.project.variables).toBe(before.project.variables);
      expect(result.undoStack).toEqual([before.project]);
      const ordinary = applyArraySelection(before, spec) as AppState;
      const rendered = await materializeVariableText(ordinary.project, { now: NOW }, renderFixture);
      if (!rendered.ok) throw new Error('ordinary render failed');
      expect(textValues(rendered.project)).toEqual(
        Array.from({ length: 6 }, () => ['A-010', 'D110', 'Fixed']).flat(),
      );
    },
  );

  it.each(MODES)(
    '$kind retains edited relative offsets through save/reopen, preview and undo',
    async (spec) => {
      const state = fixtureState();
      const before = {
        ...state,
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: state.project.scene.objects.map((object, index) =>
              object.kind === 'text' && object.variableTemplate !== undefined
                ? {
                    ...object,
                    variableTemplate: {
                      ...object.variableTemplate,
                      sequenceOffset: index === 0 ? 2 : 4,
                    },
                  }
                : object,
            ),
          },
        },
      };
      const result = await array(spec, before);
      expect(
        result.project.scene.objects.flatMap((object) =>
          object.kind === 'text' && object.variableTemplate !== undefined
            ? [object.variableTemplate.sequenceOffset]
            : [],
        ),
      ).toEqual([2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19]);
      const parsed = deserializeProject(serializeProject(result.project));
      if (parsed.kind !== 'ok') throw new Error(JSON.stringify(parsed));
      // Loading may add canonical line curves to legacy polyline geometry.
      expect(parsed.project.scene).toMatchObject(result.project.scene);
      const preview = await materializeVariableText(parsed.project, { now: NOW }, renderFixture);
      if (!preview.ok) throw new Error('preview failed');
      expect(preview.project.scene.objects.map((object) => object.transform)).toEqual(
        result.project.scene.objects.map((object) => object.transform),
      );
      expect(textValues(preview.project)).toEqual(textValues(result.project));
      useStore.setState(result);
      useStore.getState().undo();
      expect(useStore.getState().project).toBe(before.project);
      useStore.getState().redo();
      expect(useStore.getState().project).toBe(result.project);
      useStore.getState().advanceVariablesAfter(before.project, 'successful-export');
      useStore.getState().advanceVariablesAfter(result.project, 'successful-stream');
      expect(useStore.getState().project).toBe(result.project);
      useStore.getState().advanceVariablesAfter(result.project, 'successful-export', {
        cutSelectedGraphics: true,
        useSelectionOrigin: false,
        selectedObjectIds: [
          result.project.scene.objects[0]!.id,
          result.project.scene.objects[6]!.id,
        ],
      });
      expect(useStore.getState().project.variables).toMatchObject({
        serialValue: 19,
        recordIndex: 3,
      });
    },
  );

  it.each(MODES)(
    '$kind shares assigned geometry between preview, output and Frame source without advancing',
    async (spec) => {
      const result = await array(spec);
      const options = { clock: () => NOW, renderVariableText: renderFixture };
      const preview = await prepareOutputSnapshot(result.project, options);
      const frameSource = await prepareOutputSnapshot(result.project, options);
      expect(frameSource).toBe(preview);
      if (!preview.ok) throw new Error(JSON.stringify(preview.preflight));
      expect(textValues(preview.project)).toEqual(textValues(result.project));
      expect(await emitGcodeSnapshot(result.project, options)).toEqual(
        emitPreparedGcode(frameSource),
      );
      expect(result.project.variables).toMatchObject({ serialValue: 10, recordIndex: 0 });
    },
  );

  it.each(MODES)('$kind uses configured record and serial strides and wrapping', async (spec) => {
    const before = fixtureState();
    const result = await array(spec, {
      ...before,
      project: {
        ...before.project,
        variables: {
          ...before.project.variables!,
          recordIndex: 1,
          sequence: {
            advanceBy: 2,
            recordStartIndex: 1,
            recordEndIndex: 4,
            serialStartValue: 10,
            serialEndValue: 14,
          },
        },
      },
    });
    expect(textValues(result.project)).toEqual([
      `${NAMES[1]}-010`,
      'D110',
      'Fixed',
      'D-012',
      'D112',
      'Fixed',
      `${NAMES[1]}-014`,
      'D114',
      'Fixed',
      'D-011',
      'D111',
      'Fixed',
      `${NAMES[1]}-013`,
      'D113',
      'Fixed',
      'D-010',
      'D110',
      'Fixed',
    ]);
    useStore.setState(result);
    useStore.getState().advanceVariablesAfter(result.project, 'successful-export');
    expect(useStore.getState().project.variables).toMatchObject({
      recordIndex: 1,
      serialValue: 12,
    });
  });

  it.each(MODES)('$kind preserves later manual placements when data changes', async (spec) => {
    const result = await array(spec);
    const project = {
      ...result.project,
      variables: { ...result.project.variables!, serialValue: 42, recordIndex: 3 },
      scene: {
        ...result.project.scene,
        objects: result.project.scene.objects.map((object, index) =>
          index === 3
            ? {
                ...object,
                transform: { ...object.transform, x: object.transform.x + 17, rotationDeg: 23 },
              }
            : object,
        ),
      },
    };
    const rendered = await materializeVariableText(project, { now: NOW }, renderFixture);
    if (!rendered.ok) throw new Error(JSON.stringify(rendered.preflight));
    expect(rendered.project.scene.objects.map((object) => object.transform)).toEqual(
      project.scene.objects.map((object) => object.transform),
    );
    expect(textValues(rendered.project).filter((_, index) => index % 3 === 0)).toEqual([
      'D-042',
      'E-043',
      'F-044',
      'A-045',
      `${NAMES[1]}-046`,
      'CCC-047',
    ]);
    expect(project.variables).toMatchObject({ serialValue: 42, recordIndex: 3 });
  });
});
