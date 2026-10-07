import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deserializeProject, serializeProject } from '../../io/project';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { prepareProductionRow } from './production-manifest-preparation';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { fixtureState, NOW, renderFixture, textValues } from './variable-array-test-fixture';

beforeEach(() => {
  resetStore();
  useStore.setState(fixtureState());
});
const NEXT_RUN_DATE = new Date('2026-10-07T03:00:00Z');
function archivedOriginal() {
  const archive = useStore.getState().project.sheetBook!.inactive[0]!;
  const parsed = deserializeProject(archive.projectJson);
  if (parsed.kind !== 'ok') throw new Error('Original sheet was not retained');
  return { id: archive.id, project: parsed.project };
}
describe('duplicating a production sheet for an explicit separate run', () => {
  it('preserves editable templates and original allocation while permitting fresh row identities', async () => {
    expect(useStore.getState().createProductionRun('Original', 2, NOW)).toBeNull();
    const original = useStore.getState().project,
      manifest = original.productionManifest!;
    expect(useStore.getState().addProjectSheet('Next batch', true)).not.toBeNull();
    const duplicate = useStore.getState().project;
    expect(duplicate.productionManifest).toBeUndefined();
    expect(duplicate.scene).toEqual(original.scene);
    expect(archivedOriginal().project.productionManifest).toEqual(manifest);
    expect(useStore.getState().createProductionRun('Next', 2, NEXT_RUN_DATE)).toBeNull();
    const next = useStore.getState().project.productionManifest!;
    expect(next.id).not.toBe(manifest.id);
    expect(next.frozenAt).toBe(NEXT_RUN_DATE.toISOString());
    expect(next.activeRowId).toBeUndefined();
    expect(
      next.rows.map((row) => [row.recordIndex, row.serialValue, row.status, row.notes]),
    ).toEqual([
      [0, 10, 'pending', ''],
      [1, 11, 'pending', ''],
    ]);
    expect(next.rows.every((row) => !manifest.rows.some((old) => old.id === row.id))).toBe(true);
    expect(
      next.rows.every(
        (row) =>
          row.reviewedAt === undefined &&
          row.resultAt === undefined &&
          row.reviewedProjectJson === undefined,
      ),
    ).toBe(true);
    expect(useStore.getState().project.variables).toBe(duplicate.variables);
    expect(await useStore.getState().openProductionRow(next.rows[1]!.id, renderFixture)).toBe(true);
    expect(textValues(useStore.getState().project)[0]).toBe('B'.repeat(40) + '-011');
    expect(archivedOriginal().project.productionManifest).toEqual(manifest);
  });
  it('keeps the current completed variant as fixed artwork, archives observations, and requires fresh review attribution', async () => {
    expect(useStore.getState().createProductionRun('Original', 1, NOW)).toBeNull();
    const originalId = useStore.getState().project.productionManifest!.rows[0]!.id;
    expect(await useStore.getState().openProductionRow(originalId, renderFixture)).toBe(true);
    expect(await useStore.getState().captureProductionVariant(renderFixture, NOW)).toBeNull();
    expect(
      useStore
        .getState()
        .recordProductionResult(originalId, 'completed', 'Only the original run was observed', NOW),
    ).toBeNull();
    const original = useStore.getState().project,
      manifest = original.productionManifest!,
      originalBytes = emitGcode(original).gcode;
    expect(useStore.getState().addProjectSheet('Copy of reviewed artwork', true)).not.toBeNull();
    const duplicate = useStore.getState().project;
    expect(duplicate.productionManifest).toBeUndefined();
    expect(duplicate.scene).toEqual(original.scene);
    expect(emitGcode(duplicate).gcode).toBe(originalBytes);
    expect(archivedOriginal().project.productionManifest).toEqual(manifest);
    expect(
      useStore.getState().createProductionRun('Repeat reviewed artwork', 1, NEXT_RUN_DATE),
    ).toBeNull();
    const next = useStore.getState().project.productionManifest!,
      row = next.rows[0]!;
    expect(next.id).not.toBe(manifest.id);
    expect(row.id).not.toBe(originalId);
    expect(row.status).toBe('pending');
    expect(row.notes).toBe('');
    const renderer = vi.fn(renderFixture),
      prepared = await prepareProductionRow(next, row, renderer);
    expect(renderer).not.toHaveBeenCalled();
    expect(textValues(prepared)).toEqual(textValues(original));
    expect(emitGcode(prepared).gcode).toBe(originalBytes);
    expect(
      useStore
        .getState()
        .recordProductionResult(originalId, 'completed', 'Wrong owner', NEXT_RUN_DATE),
    ).toContain('Missing');
    expect(
      useStore
        .getState()
        .recordProductionResult(row.id, 'completed', 'Not reviewed', NEXT_RUN_DATE),
    ).toContain('Capture');
    expect(await useStore.getState().openProductionRow(row.id, renderer)).toBe(true);
    expect(await useStore.getState().captureProductionVariant(renderer, NEXT_RUN_DATE)).toBeNull();
    expect(
      useStore
        .getState()
        .recordProductionResult(row.id, 'completed', 'Observed repeat', NEXT_RUN_DATE),
    ).toBeNull();
    const old = archivedOriginal();
    expect(old.project.productionManifest).toEqual(manifest);
    const saved = deserializeProject(serializeProject(useStore.getState().project));
    if (saved.kind !== 'ok') throw new Error('Both runs must reopen');
    useStore.getState().setProject(saved.project);
    expect(useStore.getState().switchProjectSheet(old.id)).toBe(true);
    expect(useStore.getState().project.productionManifest).toEqual(manifest);
    expect(emitGcode(useStore.getState().project).gcode).toBe(originalBytes);
  });
});
