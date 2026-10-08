import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';
import { applyArraySelection } from './array-actions';
import { NOW, fixtureState, renderFixture } from './variable-array-test-fixture';
import {
  nearArchiveLimit,
  budgetArrayState,
  grid,
  archiveChars,
  expectWorkflowOwnerUnchanged,
} from './workflow-archive-budget.test-fixture';

beforeEach(() => {
  resetStore();
  useStore.setState(fixtureState());
});
afterEach(() => {
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().dismissToast(toast.id);
});
function loadNearLimit(project = useStore.getState().project, existingChars = 0): void {
  useStore.setState({
    project: nearArchiveLimit(project, existingChars),
    dirty: false,
    undoStack: [project],
    redoStack: [project],
    savedName: 'preserved.lf2',
  });
}
function warning(): string {
  return useToastStore.getState().toasts.at(-1)?.message ?? '';
}
describe('compositional workflow archive limits before commit', () => {
  it('refuses adding or duplicating a sheet before replacing the document', () => {
    loadNearLimit();
    const before = useStore.getState();
    expect(before.addProjectSheet('Too large', false)).toBeNull();
    expectWorkflowOwnerUnchanged(before);
    expect(warning()).toContain('50 million');
    expect(before.addProjectSheet('Too large', true)).toBeNull();
    expectWorkflowOwnerUnchanged(before);
  });
  it('refuses a sheet switch whose newly archived active content exceeds the combined budget', () => {
    loadNearLimit({ ...useStore.getState().project, notes: 'x'.repeat(600_000) });
    const before = useStore.getState();
    expect(before.switchProjectSheet('archive-0')).toBe(false);
    expectWorkflowOwnerUnchanged(before);
    expect(warning()).toContain('50 million');
  });
  it('refuses a retained array even when its own source and baseline are small valid archives', () => {
    const before = budgetArrayState();
    const project = nearArchiveLimit(before.project);
    const bounded = { ...before, project };
    const result = applyArraySelection(bounded, grid(2), () => crypto.randomUUID(), undefined, {
      name: 'Parts',
    });
    expect(result).toBe(bounded);
    expect(warning()).toContain('50 million');
    expect(bounded.project).toBe(project);
    expect(bounded.project.scene).toBe(before.project.scene);
    expect(bounded.undoStack).toBe(before.undoStack);
    expect(bounded.additionalSelectedIds).toBe(before.additionalSelectedIds);
  });
  it('refuses array regeneration before changing artwork, undo history or selection', () => {
    const before = budgetArrayState();
    const created = {
      ...before,
      ...applyArraySelection(before, grid(1), () => crypto.randomUUID(), undefined, {
        name: 'Parts',
      }),
    };
    const layout = created.project.arrayLayouts?.[0];
    if (layout === undefined) throw new Error('Expected retained layout');
    useStore.setState(created);
    loadNearLimit(created.project, archiveChars(created.project));
    const owner = useStore.getState();
    expect(owner.regenerateArrayLayout(layout.id, grid(2))).toContain('50 million');
    expectWorkflowOwnerUnchanged(owner);
  });
  it('refuses production creation and variant capture through their existing action messages', async () => {
    loadNearLimit();
    const before = useStore.getState();
    expect(before.createProductionRun('Too large', 1, NOW)).toContain('50 million');
    expectWorkflowOwnerUnchanged(before);
    resetStore();
    useStore.setState(fixtureState());
    expect(useStore.getState().createProductionRun('Run', 1, NOW)).toBeNull();
    const manifest = useStore.getState().project.productionManifest;
    if (manifest === undefined) throw new Error('Expected run');
    const row = manifest.rows[0];
    if (row === undefined) throw new Error('Expected row');
    expect(await useStore.getState().openProductionRow(row.id, renderFixture)).toBe(true);
    loadNearLimit(useStore.getState().project, manifest.designProjectJson.length);
    const owner = useStore.getState();
    expect(await owner.captureProductionVariant(renderFixture, NOW)).toContain('50 million');
    expectWorkflowOwnerUnchanged(owner);
  });
  it('refuses opening a row when restoring its array archives exceeds the project-wide budget', async () => {
    const base = budgetArrayState();
    const created = {
      ...base,
      ...applyArraySelection(base, grid(1), () => crypto.randomUUID(), undefined, {
        name: 'Parts',
      }),
    };
    useStore.setState(created);
    expect(useStore.getState().createProductionRun('Run', 1, NOW)).toBeNull();
    const project = useStore.getState().project;
    const manifest = project.productionManifest;
    if (manifest === undefined || manifest.rows[0] === undefined) throw new Error('Expected run');
    const { arrayLayouts: _layouts, ...working } = project;
    loadNearLimit(working, manifest.designProjectJson.length + archiveChars(project));
    const owner = useStore.getState();
    expect(await owner.openProductionRow(manifest.rows[0].id, renderFixture)).toBe(false);
    expectWorkflowOwnerUnchanged(owner);
    expect(warning()).toContain('50 million');
  });
});
