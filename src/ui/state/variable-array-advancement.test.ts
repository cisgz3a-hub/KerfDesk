import { afterEach, describe, expect, it } from 'vitest';
import { createLayer, type Project } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { applyArraySelection } from './array-actions';
import { prepareVariableArray } from './prepare-variable-array';
import { useStore } from './store';
import { fixtureState, GRID, NOW, renderFixture } from './variable-array-test-fixture';

const initial = useStore.getState();
afterEach(() => useStore.setState(initial, true));

describe('variable sheet advancement', () => {
  it('round-trips the largest copy offset and advances its safe step count without throwing', () => {
    const before = fixtureState().project;
    const project: Project = {
      ...before,
      variables: {
        ...before.variables!,
        sequence: {
          recordStartIndex: 0,
          recordEndIndex: 5,
          serialStartValue: 10,
          serialEndValue: 20,
          advanceBy: 1,
        },
      },
      scene: {
        ...before.scene,
        objects: before.scene.objects.map((object) =>
          object.kind === 'text' && object.variableTemplate !== undefined
            ? {
                ...object,
                variableTemplate: {
                  ...object.variableTemplate,
                  sequenceOffset: Number.MAX_SAFE_INTEGER - 1,
                },
              }
            : object,
        ),
      },
    };
    const restored = deserializeProject(serializeProject(project));
    expect(restored.kind).toBe('ok');
    useStore.setState({ project });
    expect(() =>
      useStore.getState().advanceVariablesAfter(project, 'successful-export'),
    ).not.toThrow();
    expect(useStore.getState().project.variables).toMatchObject({
      recordIndex: Number(BigInt(Number.MAX_SAFE_INTEGER) % 6n),
      serialValue: 10 + Number(BigInt(Number.MAX_SAFE_INTEGER) % 11n),
    });
  });
  it('uses the last emitted non-contiguous slot and excludes later selected-out/disabled slots', async () => {
    const before = fixtureState();
    const prepared = await prepareVariableArray(before, GRID, {
      render: renderFixture,
      clock: () => NOW,
    });
    if (!prepared.ok) throw new Error(prepared.message);
    const sheet = {
      ...before,
      ...applyArraySelection(before, GRID, undefined, prepared.materialized),
    }.project;
    const selectedObjectIds = sheet.scene.objects.flatMap((object) =>
      object.kind === 'text' && [1, 3, 5].includes(object.variableTemplate?.sequenceOffset ?? -1)
        ? [object.id]
        : [],
    );
    const project: Project = {
      ...sheet,
      scene: {
        ...sheet.scene,
        layers: [
          ...sheet.scene.layers,
          { ...createLayer({ id: 'off', color: '#ff0000' }), output: false },
        ],
        objects: sheet.scene.objects.map((object) =>
          object.kind === 'text' && object.variableTemplate?.sequenceOffset === 5
            ? {
                ...object,
                operationIds: ['off'],
                paths: object.paths.map((path) => ({ ...path, operationIds: ['off'] })),
              }
            : object,
        ),
      },
    };
    useStore.setState({ project });
    useStore.getState().advanceVariablesAfter(project, 'successful-export', {
      cutSelectedGraphics: true,
      useSelectionOrigin: false,
      selectedObjectIds,
    });
    expect(useStore.getState().project.variables).toMatchObject({
      serialValue: 14,
      recordIndex: 4,
    });
    useStore.setState({ project });
    useStore.getState().advanceVariablesAfter(project, 'successful-export', {
      cutSelectedGraphics: true,
      useSelectionOrigin: false,
      selectedObjectIds: ['fixed'],
    });
    expect(useStore.getState().project).toBe(project);
  });
  it.each(['manual', 'after-successful-export', 'after-successful-stream'] as const)(
    'consumes six slots once only for the selected %s boundary',
    async (advancement) => {
      const before = fixtureState();
      const project = {
        ...before.project,
        variables: { ...before.project.variables!, advancement },
      };
      const state = { ...before, project };
      const prepared = await prepareVariableArray(state, GRID, {
        render: renderFixture,
        clock: () => NOW,
      });
      if (!prepared.ok) throw new Error(prepared.message);
      const array = applyArraySelection(state, GRID, undefined, prepared.materialized);
      const sheet = { ...state, ...array }.project;
      useStore.setState({ ...state, project: sheet });
      expect(sheet.variables).toMatchObject({ serialValue: 10, recordIndex: 0 });
      const wrong =
        advancement === 'after-successful-export' ? 'successful-stream' : 'successful-export';
      useStore.getState().advanceVariablesAfter(sheet, wrong);
      expect(useStore.getState().project).toBe(sheet);
      const chosen =
        advancement === 'after-successful-stream' ? 'successful-stream' : 'successful-export';
      useStore.getState().advanceVariablesAfter(sheet, chosen);
      const after = useStore.getState().project;
      expect(after.variables).toMatchObject({
        serialValue: advancement === 'manual' ? 10 : 16,
        recordIndex: 0,
      });
      useStore.getState().advanceVariablesAfter(sheet, chosen);
      expect(useStore.getState().project).toBe(after);
    },
  );

  it('does not advance a replaced source, and keeps normal same-value copies one step', async () => {
    const before = fixtureState();
    const ordinary = { ...before, ...applyArraySelection(before, GRID) }.project;
    useStore.setState({ project: ordinary });
    useStore.getState().advanceVariablesAfter(ordinary, 'successful-export');
    expect(useStore.getState().project.variables).toMatchObject({
      serialValue: 11,
      recordIndex: 1,
    });
    const replacement = { ...ordinary, notes: 'replaced while saving' };
    useStore.setState({ project: replacement });
    useStore.getState().advanceVariablesAfter(ordinary, 'successful-export');
    expect(useStore.getState().project).toBe(replacement);
  });

  it('honours CSV/serial range wrap and a stride larger than one', async () => {
    const before = fixtureState();
    const project = {
      ...before.project,
      variables: {
        ...before.project.variables!,
        recordIndex: 1,
        serialValue: 11,
        sequence: {
          recordStartIndex: 1,
          recordEndIndex: 4,
          serialStartValue: 10,
          serialEndValue: 20,
          advanceBy: 2,
        },
      },
    };
    const prepared = await prepareVariableArray({ ...before, project }, GRID, {
      render: renderFixture,
      clock: () => NOW,
    });
    if (!prepared.ok) throw new Error(prepared.message);
    expect(
      prepared.materialized.sources.map((slot) =>
        slot[0]?.kind === 'text' ? slot[0].content : '',
      ),
    ).toEqual([
      'B'.repeat(40) + '-011',
      'D-013',
      'B'.repeat(40) + '-015',
      'D-017',
      'B'.repeat(40) + '-019',
      'D-010',
    ]);
  });
});
