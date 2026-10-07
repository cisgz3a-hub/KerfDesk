import { beforeEach, describe, expect, it } from 'vitest';
import type { Project, SceneObject } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { fixtureState, NOW, renderFixture, textValues } from './variable-array-test-fixture';

const NEXT_RUN_DATE = new Date(2030, 9, 8, 12, 0, 0);

beforeEach(() => {
  resetStore();
  const fixture = fixtureState();
  useStore.setState({
    ...fixture,
    project: {
      ...fixture.project,
      scene: {
        ...fixture.project.scene,
        objects: fixture.project.scene.objects.map(
          (object): SceneObject =>
            object.kind !== 'text' || object.id !== 'name'
              ? object
              : {
                  ...object,
                  variableTemplate: {
                    tokens: [
                      ...object.variableTemplate!.tokens,
                      { kind: 'literal', value: '/' },
                      { kind: 'date-time', format: 'date-iso' },
                    ],
                  },
                },
        ),
      },
    },
    savedName: 'badges.lf2',
  });
});

function reopened(json: string): Project {
  const parsed = deserializeProject(json);
  if (parsed.kind !== 'ok') throw new Error('Expected the production sheets to reopen');
  return parsed.project;
}

describe('independent production runs on duplicate sheets', () => {
  it('restores editable design after a completed row and preserves the original run on save/reopen', async () => {
    expect(useStore.getState().createProductionRun('Original batch', 3, NOW)).toBeNull();
    const allocated = useStore.getState().project.productionManifest!;
    const seed = reopened(allocated.designProjectJson);
    const completedRow = allocated.rows[1]!;
    expect(await useStore.getState().openProductionRow(completedRow.id, renderFixture)).toBe(true);
    expect(await useStore.getState().captureProductionVariant(renderFixture, NOW)).toBeNull();
    expect(
      useStore
        .getState()
        .recordProductionResult(completedRow.id, 'completed', 'Observed original batch', NOW),
    ).toBeNull();
    const original = useStore.getState().project;
    const originalManifest = original.productionManifest!;
    const originalEpoch = useStore.getState().projectDocumentEpoch;
    expect(original.variables).toMatchObject({
      recordIndex: 1,
      serialValue: 11,
      advancement: 'manual',
    });
    expect(
      original.scene.objects.find((object) => object.kind === 'text' && object.id === 'name'),
    ).not.toHaveProperty('variableTemplate');

    const copyId = useStore.getState().addProjectSheet('Next batch', true);
    expect(copyId).not.toBeNull();
    const duplicate = useStore.getState().project;
    const originalSheet = duplicate.sheetBook!.inactive[0]!;
    expect(duplicate.productionManifest).toBeUndefined();
    expect(duplicate.scene).toEqual(seed.scene);
    expect(duplicate.variables).toEqual(seed.variables);
    expect(reopened(originalSheet.projectJson).productionManifest).toEqual(originalManifest);
    expect(useStore.getState().projectDocumentEpoch).toBe(originalEpoch + 1);
    expect(useStore.getState().savedName).toBe('badges.lf2');
    expect(useStore.getState().dirty).toBe(true);

    expect(useStore.getState().createProductionRun('Next batch', 3, NEXT_RUN_DATE)).toBeNull();
    const nextManifest = useStore.getState().project.productionManifest!;
    const originalIds = new Set(originalManifest.rows.map((row) => row.id));
    expect(nextManifest.id).not.toBe(originalManifest.id);
    expect(nextManifest.frozenAt).toBe(NEXT_RUN_DATE.toISOString());
    expect(nextManifest.activeRowId).toBeUndefined();
    expect(nextManifest.rows.map((row) => [row.recordIndex, row.serialValue])).toEqual([
      [0, 10],
      [1, 11],
      [2, 12],
    ]);
    for (const row of nextManifest.rows) {
      expect(originalIds.has(row.id)).toBe(false);
      expect(row).toMatchObject({ status: 'pending', notes: '' });
      expect(row.reviewedProjectJson).toBeUndefined();
      expect(row.reviewedAt).toBeUndefined();
      expect(row.resultAt).toBeUndefined();
    }

    useStore.getState().setProject(reopened(serializeProject(useStore.getState().project)));
    expect(useStore.getState().switchProjectSheet(originalSheet.id)).toBe(true);
    expect(useStore.getState().project.productionManifest).toEqual(originalManifest);
    expect(textValues(useStore.getState().project)).toEqual(textValues(original));
    expect(useStore.getState().switchProjectSheet(copyId!)).toBe(true);
    expect(useStore.getState().project.productionManifest).toEqual(nextManifest);
    expect(
      await useStore.getState().openProductionRow(nextManifest.rows[0]!.id, renderFixture),
    ).toBe(true);
    expect(textValues(useStore.getState().project)[0]).toBe('A-010/2030-10-08');
    const retainedOriginal = useStore
      .getState()
      .project.sheetBook!.inactive.find((sheet) => sheet.id === originalSheet.id)!;
    expect(reopened(retainedOriginal.projectJson).productionManifest).toEqual(originalManifest);

    expect(useStore.getState().switchProjectSheet(originalSheet.id)).toBe(true);
    expect(
      useStore.getState().addProjectSheet('Another copy of the original', true),
    ).not.toBeNull();
    const restoredDuplicate = useStore.getState().project;
    expect(restoredDuplicate.productionManifest).toBeUndefined();
    expect(restoredDuplicate.scene).toEqual(seed.scene);
    expect(restoredDuplicate.variables).toEqual(seed.variables);
    const archivedOriginal = restoredDuplicate.sheetBook!.inactive.find(
      (sheet) => sheet.id === originalSheet.id,
    )!;
    expect(reopened(archivedOriginal.projectJson).productionManifest).toEqual(originalManifest);
  });

  it('keeps current editable changes when no production row has been opened', () => {
    expect(useStore.getState().createProductionRun('Allocated batch', 3, NOW)).toBeNull();
    const original = useStore.getState().project;
    const edited = {
      ...original,
      notes: 'Edited before opening a row',
      variables: { ...original.variables!, serialValue: 900 },
    };
    useStore.setState({ project: edited });
    expect(useStore.getState().addProjectSheet('Edited copy', true)).not.toBeNull();
    const duplicate = useStore.getState().project;
    expect(duplicate.productionManifest).toBeUndefined();
    expect(duplicate.notes).toBe(edited.notes);
    expect(duplicate.scene).toEqual(edited.scene);
    expect(duplicate.variables).toEqual(edited.variables);
    expect(useStore.getState().createProductionRun('Edited batch', 1, NEXT_RUN_DATE)).toBeNull();
    expect(useStore.getState().project.productionManifest!.rows[0]!.serialValue).toBe(900);
    expect(reopened(duplicate.sheetBook!.inactive[0]!.projectJson).productionManifest).toEqual(
      original.productionManifest,
    );
  });
});
