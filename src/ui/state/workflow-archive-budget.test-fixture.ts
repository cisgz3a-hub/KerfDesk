import { createProject, type Project, type GridArraySpec } from '../../core/scene';
import { serializeProject } from '../../io/project';
import { visitWorkflowArchives } from '../../io/project/project-workflow-archives';
import { fixtureState } from './variable-array-test-fixture';
import { svgObj } from './test-helpers';
import type { AppState } from './store';
import { useStore } from './store';
import { expect } from 'vitest';

/** 98 references to two padded, valid tiny project strings keep fixture
 * allocations compact while exercising the real cumulative 50M boundary. */
export function nearArchiveLimit(
  project: Project,
  existingArchiveChars = 0,
  headroom = 1,
): Project {
  const json = serializeProject(createProject(), { compact: true });
  const total = 50_000_000 - existingArchiveChars - headroom;
  const each = Math.floor(total / 98);
  const remainder = total - each * 98;
  const ordinary = json + ' '.repeat(each - json.length);
  const last = ordinary + ' '.repeat(remainder);
  const next: Project = {
    ...project,
    sheetBook: {
      activeId: 'active',
      activeName: 'Active',
      inactive: Array.from({ length: 98 }, (_, index) => ({
        id: `archive-${index}`,
        name: `Archive ${index}`,
        projectJson: index === 97 ? last : ordinary,
      })),
    },
  };
  expect(visitWorkflowArchives(next)).toBeNull();
  return next;
}
export function budgetArrayState(): AppState {
  const base = fixtureState();
  const object = svgObj('part', [base.project.scene.layers[0]?.color ?? 'black']);
  return {
    ...useStore.getState(),
    ...base,
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
    project: { ...base.project, scene: { ...base.project.scene, objects: [object], groups: [] } },
  };
}
export function grid(columns: number): GridArraySpec {
  return { kind: 'grid', rows: 1, columns, spacingX: 4, spacingY: 0 };
}
export function archiveChars(project: Project): number {
  return (project.arrayLayouts ?? []).reduce(
    (sum, layout) => sum + layout.sourceProjectJson.length + layout.baselineProjectJson.length,
    0,
  );
}
export function expectWorkflowOwnerUnchanged(before: AppState): void {
  const after = useStore.getState();
  for (const field of [
    'project',
    'projectDocumentEpoch',
    'undoStack',
    'redoStack',
    'selectedObjectId',
    'additionalSelectedIds',
    'selectedPathNode',
    'selectedPathNodes',
    'dirty',
    'savedName',
    'lastSaveTarget',
    'jobPlacement',
    'pendingUndo',
  ] as const)
    expect(after[field]).toBe(before[field]);
}
