import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deserializeProject, serializeProject } from '../../io/project';
import { materializeVariableText } from '../../io/gcode/prepare-output-snapshot';
import { prepareProductionRow } from './production-manifest-preparation';
import { resetStore } from './test-helpers';
import { useStore } from './store';
import { fixtureState, NOW, renderFixture, textValues } from './variable-array-test-fixture';

beforeEach(() => {
  resetStore();
  useStore.setState(fixtureState());
});
function run() {
  expect(useStore.getState().createProductionRun('Badge run', 3, NOW)).toBeNull();
  return useStore.getState().project.productionManifest!;
}
function blockedRenderer() {
  let release = (): void => undefined;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release: () => release(),
    render: vi.fn(async (input: Parameters<typeof renderFixture>[0]) => {
      await waiting;
      return renderFixture(input);
    }),
  };
}

describe('production allocation and reviewed result attribution', () => {
  it('allocates stable rows once and keeps the cursor unchanged across save/reopen', () => {
    const variables = useStore.getState().project.variables,
      manifest = run();
    expect(manifest.rows.map((row) => [row.recordIndex, row.serialValue, row.status])).toEqual([
      [0, 10, 'pending'],
      [1, 11, 'pending'],
      [2, 12, 'pending'],
    ]);
    expect(useStore.getState().project.variables).toBe(variables);
    const parsed = deserializeProject(serializeProject(useStore.getState().project));
    expect(parsed.kind).toBe('ok');
    if (parsed.kind === 'ok') expect(parsed.project.productionManifest).toEqual(manifest);
    expect(useStore.getState().createProductionRun('Second', 3, NOW)).toContain('already');
  });
  it('opens a fixed row and reopens its reviewed geometry without reevaluation or cursor advancement', async () => {
    const manifest = run(),
      row = manifest.rows[1]!;
    expect(await useStore.getState().openProductionRow(row.id, renderFixture)).toBe(true);
    expect(textValues(useStore.getState().project)[0]).toBe('B'.repeat(40) + '-011');
    expect(useStore.getState().project.variables).toMatchObject({
      recordIndex: 1,
      serialValue: 11,
      advancement: 'manual',
    });
    expect(await useStore.getState().captureProductionVariant(renderFixture, NOW)).toBeNull();
    const reviewed = useStore.getState().project.productionManifest!;
    const render = vi.fn(renderFixture);
    const reopened = await prepareProductionRow(reviewed, reviewed.rows[1]!, render);
    expect(render).not.toHaveBeenCalled();
    const output = await materializeVariableText(
      { ...reopened, variables: { ...reopened.variables!, serialValue: 900 } },
      { now: new Date('2030-01-01') },
      render,
    );
    expect(output.ok && textValues(output.project)).toEqual(textValues(reopened));
    expect(render).not.toHaveBeenCalled();
  });
  it('cancels a delayed row open after document replacement', async () => {
    const manifest = run(),
      waiting = blockedRenderer();
    const pending = useStore.getState().openProductionRow(manifest.rows[0]!.id, waiting.render);
    useStore.getState().newProject();
    const replacement = useStore.getState().project;
    waiting.release();
    expect(await pending).toBe(false);
    expect(useStore.getState().project).toBe(replacement);
  });
  it('cancels an in-flight variant capture when the editor closes', async () => {
    const manifest = run();
    await useStore.getState().openProductionRow(manifest.rows[0]!.id, renderFixture);
    const active = useStore.getState().project,
      waiting = blockedRenderer();
    useStore.setState({
      project: {
        ...active,
        scene: { ...active.scene, objects: fixtureState().project.scene.objects },
      },
    });
    const before = useStore.getState().project;
    let current = true;
    const pending = useStore
      .getState()
      .captureProductionVariant(waiting.render, NOW, () => current);
    current = false;
    waiting.release();
    expect(await pending).toContain('cancelled');
    expect(useStore.getState().project).toBe(before);
    expect(before.productionManifest!.rows[0]!.reviewedProjectJson).toBeUndefined();
  });
  it('captures new variable edits against the allocated CSV and assigns observations only to the selected row', async () => {
    const manifest = run();
    await useStore.getState().openProductionRow(manifest.rows[0]!.id, renderFixture);
    const active = useStore.getState().project;
    useStore.setState({
      project: {
        ...active,
        variables: {
          ...active.variables!,
          serialValue: 800,
          csv: { sourceName: 'changed.csv', headers: ['name'], records: [['Changed']] },
        },
        scene: { ...active.scene, objects: fixtureState().project.scene.objects },
      },
    });
    expect(await useStore.getState().captureProductionVariant(renderFixture, NOW)).toBeNull();
    const captured = useStore.getState().project.productionManifest!.rows[0]!;
    const parsed = deserializeProject(captured.reviewedProjectJson!);
    expect(parsed.kind === 'ok' && textValues(parsed.project)[0]).toBe('A-010');
    expect(textValues(useStore.getState().project)[0]).toBe('A-010');
    const outputRender = vi.fn(renderFixture);
    await materializeVariableText(
      useStore.getState().project,
      { now: new Date('2030-01-01') },
      outputRender,
    );
    expect(outputRender).not.toHaveBeenCalled();
    expect(
      useStore
        .getState()
        .recordProductionResult(manifest.rows[1]!.id, 'completed', 'Unreviewed', NOW),
    ).toContain('Capture');
    expect(
      useStore
        .getState()
        .recordProductionResult(
          manifest.rows[0]!.id,
          'completed',
          'Operator observed good print',
          NOW,
        ),
    ).toBeNull();
    const rows = useStore.getState().project.productionManifest!.rows;
    expect(rows.map((row) => row.status)).toEqual(['completed', 'pending', 'pending']);
    expect(rows[0]?.notes).toBe('Operator observed good print');
    expect(rows[0]?.reviewedProjectJson).toBe(captured.reviewedProjectJson);
    expect(useStore.getState().project.variables?.serialValue).toBe(800);
  });
});
