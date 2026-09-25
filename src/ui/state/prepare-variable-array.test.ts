import { describe, expect, it, vi } from 'vitest';
import { PROJECT_SCHEMA_VERSION } from '../../core/scene';
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
import {
  fixtureState,
  GRID,
  NAMES,
  NOW,
  renderFixture,
  textValues,
} from './variable-array-test-fixture';

async function sheet(before = fixtureState()): Promise<AppState> {
  const result = await prepareVariableArray(before, GRID, {
    render: renderFixture,
    clock: () => NOW,
  });
  if (!result.ok) throw new Error(result.message);
  let nextId = 0;
  return {
    ...before,
    ...applyArraySelection(before, GRID, () => `copy-${nextId++}`, result.materialized),
  };
}

describe('variable grid copies', () => {
  it('renders a 2 by 3 badge sheet in row-major order, measuring the longest later name', async () => {
    const before = fixtureState();
    const result = await sheet(before);
    expect(textValues(result.project)).toEqual(
      NAMES.flatMap((name, index) => [
        `${name}-${String(10 + index).padStart(3, '0')}`,
        `D${110 + index}`,
        'Fixed',
      ]),
    );
    expect(
      result.project.scene.objects
        .filter((_, index) => index % 3 === 0)
        .map((object) => object.transform),
    ).toEqual(
      [
        [0, 0],
        [49, 0],
        [98, 0],
        [0, 13],
        [49, 13],
        [98, 13],
      ].map(([x, y]) => ({ ...before.project.scene.objects[0]!.transform, x, y })),
    );
    expect(result.project.scene.groups).toHaveLength(6);
    expect(result.project.scene.groups?.every((group) => group.objectIds.length === 3)).toBe(true);
    expect(result.project.variables).toBe(before.project.variables);
    expect(result.undoStack).toEqual([before.project]);
  });

  it('keeps ordinary arrays on the same record and does not label constant text as variable', async () => {
    const before = fixtureState();
    const ordinary = applyArraySelection(before, GRID) as AppState;
    const rendered = await materializeVariableText(ordinary.project, { now: NOW }, renderFixture);
    if (!rendered.ok) throw new Error('fixture did not render');
    expect(textValues(rendered.project)).toEqual(
      Array.from({ length: 6 }, () => ['A-010', 'D110', 'Fixed']).flat(),
    );
    const distinct = await sheet();
    expect(
      distinct.project.scene.objects
        .filter((_, index) => index % 3 === 2)
        .every((object) => object.kind === 'text' && object.variableTemplate === undefined),
    ).toBe(true);
  });

  it('retains relative field offsets when an already sequenced group is copied', async () => {
    const before = fixtureState();
    const objects = before.project.scene.objects.map((object, index) =>
      object.kind === 'text' && object.variableTemplate !== undefined
        ? {
            ...object,
            variableTemplate: { ...object.variableTemplate, sequenceOffset: index === 0 ? 2 : 4 },
          }
        : object,
    );
    const result = await sheet({
      ...before,
      project: { ...before.project, scene: { ...before.project.scene, objects } },
    });
    expect(
      result.project.scene.objects.flatMap((object) =>
        object.kind === 'text' && object.variableTemplate !== undefined
          ? [object.variableTemplate.sequenceOffset]
          : [],
      ),
    ).toEqual([2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19]);
  });

  it('cancels delayed rendering without changing the project or variable cursor', async () => {
    const before = fixtureState();
    let current = true;
    let release = (): void => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const render = vi.fn(async (input: Parameters<typeof renderFixture>[0]) => {
      await waiting;
      return renderFixture(input);
    });
    const pending = prepareVariableArray(before, GRID, {
      render,
      clock: () => NOW,
      isCurrent: () => current,
    });
    current = false;
    release();
    expect(await pending).toMatchObject({ ok: false, cancelled: true });
    expect(render).toHaveBeenCalledTimes(2);
    expect(before.project.variables).toMatchObject({ recordIndex: 0, serialValue: 10 });
    expect(before.undoStack).toEqual([]);
  });

  it('reports the affected copy for unavailable CSV records without producing a partial sheet', async () => {
    const before = fixtureState();
    const empty = {
      ...before,
      project: {
        ...before.project,
        variables: {
          ...before.project.variables!,
          csv: { sourceName: 'empty.csv', headers: ['name'], records: [] },
        },
      },
    };
    expect(
      await prepareVariableArray(empty, GRID, { render: renderFixture, clock: () => NOW }),
    ).toMatchObject({ ok: false, message: 'Copy 1: CSV record 1 is missing.' });
    expect(empty.project.scene.objects).toHaveLength(3);
    expect(empty.project.variables.recordIndex).toBe(0);
  });

  it('round-trips copy identity and evaluated geometry and keeps the array one undo action', async () => {
    const before = fixtureState();
    const prepared = await prepareVariableArray(before, GRID, {
      render: renderFixture,
      clock: () => NOW,
    });
    if (!prepared.ok) throw new Error(prepared.message);
    useStore.setState(before);
    useStore.getState().arraySelection(GRID, prepared.materialized, before.project);
    const created = useStore.getState().project;
    const parsed = deserializeProject(serializeProject(created));
    if (parsed.kind !== 'ok') throw new Error(JSON.stringify(parsed));
    expect(parsed.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    const rendered = await materializeVariableText(parsed.project, { now: NOW }, renderFixture);
    if (!rendered.ok) throw new Error('round-trip render failed');
    expect(textValues(rendered.project)).toEqual(textValues(created));
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before.project);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(created);
  });

  it('uses the same assigned geometry for preview, emitted export and the prepared Frame source', async () => {
    const result = await sheet();
    const options = { clock: () => NOW, renderVariableText: renderFixture };
    const preview = await prepareOutputSnapshot(result.project, options);
    const frameSource = await prepareOutputSnapshot(result.project, options);
    expect(frameSource).toBe(preview);
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error(JSON.stringify(preview.preflight));
    expect(textValues(preview.project)).toEqual(textValues(result.project));
    expect(await emitGcodeSnapshot(result.project, options)).toEqual(
      emitPreparedGcode(frameSource),
    );
    expect(result.project.variables).toMatchObject({ serialValue: 10, recordIndex: 0 });
  });
});
