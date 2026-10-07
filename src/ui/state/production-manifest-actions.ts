import type { Project } from '../../core/scene';
import {
  createProductionManifest,
  type ProductionManifest,
  type ProductionRowStatus,
  type ProductionRow,
} from '../../core/scene/production-manifest';
import {
  materializeVariableText,
  type VariableTextRenderer,
} from '../../io/gcode/prepare-output-snapshot';
import { validateProductionManifest } from '../../io/project/project-manifest-validator';
import { validateProjectShape } from '../../io/project/project-shape-validator';
import {
  prepareProductionRow,
  productionVariantJson,
  productionRowProject,
} from './production-manifest-preparation';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { projectWithCurrentJobSetup } from './project-job-setup';
import { visitWorkflowArchives } from '../../io/project/project-workflow-archives';
import { useToastStore } from './toast-store';

type Set = (patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;
export type ProductionManifestActions = {
  readonly createProductionRun: (name: string, count: number, now: Date) => string | null;
  readonly openProductionRow: (
    id: string,
    render: VariableTextRenderer,
    isCurrent?: () => boolean,
  ) => Promise<boolean>;
  readonly captureProductionVariant: (
    render: VariableTextRenderer,
    now: Date,
    isCurrent?: () => boolean,
  ) => Promise<string | null>;
  readonly recordProductionResult: (
    id: string,
    status: ProductionRowStatus,
    notes: string,
    now: Date,
  ) => string | null;
};
type Context = { readonly set: Set; readonly get: () => AppState };

export function productionManifestActions(
  set: Set,
  get: () => AppState,
): ProductionManifestActions {
  const context = { set, get };
  return {
    createProductionRun: (name, count, now) => createRun(context, name, count, now),
    openProductionRow: (id, render, isCurrent) => openRow(context, id, render, isCurrent),
    captureProductionVariant: (render, now, isCurrent) =>
      captureVariant(context, render, now, isCurrent),
    recordProductionResult: (id, status, notes, now) =>
      recordResult(context, id, status, notes, now),
  };
}

function update(
  context: Context,
  manifest: ProductionManifest,
  expected: Project,
  label: string,
  working?: Project,
): string | null {
  const next = { ...(working ?? expected), productionManifest: manifest };
  const error =
    visitWorkflowArchives(next) ?? validateProductionManifest(manifest, validateProjectShape);
  if (error !== null) return error;
  if (context.get().project !== expected) return 'The working document changed; review it again.';
  context.set((state) =>
    state.project !== expected
      ? {}
      : {
          project: next,
          undoStack: pushUndo(state.project, state.undoStack, label),
          redoStack: [],
          dirty: true,
        },
  );
  return null;
}

function createRun(context: Context, name: string, count: number, now: Date): string | null {
  const state = context.get(),
    project = state.project;
  if (project.productionManifest !== undefined)
    return 'This sheet already has a production run. Duplicate a sheet to start a separate run.';
  try {
    return update(
      context,
      createProductionManifest(project, {
        name,
        count,
        now,
        designProjectJson: productionVariantJson(projectWithCurrentJobSetup(state)),
        idFactory: () => crypto.randomUUID(),
      }),
      project,
      'Create production run',
    );
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function openRow(
  context: Context,
  id: string,
  render: VariableTextRenderer,
  isCurrent?: () => boolean,
): Promise<boolean> {
  if (isCurrent?.() === false) return false;
  const captured = context.get(),
    manifest = captured.project.productionManifest;
  const row = manifest?.rows.find((entry) => entry.id === id);
  if (manifest === undefined || row === undefined) return false;
  const prepared = await prepareProductionRow(manifest, row, render);
  if (!currentDocument(context, captured) || isCurrent?.() === false) return false;
  const project: Project = {
    ...prepared,
    productionManifest: { ...manifest, activeRowId: row.id },
    ...(captured.project.sheetBook === undefined ? {} : { sheetBook: captured.project.sheetBook }),
  };
  const error = visitWorkflowArchives(project);
  if (error !== null) {
    useToastStore.getState().pushToast(error, 'warning');
    return false;
  }
  if (context.get().setProject(project).kind === 'desktop-required') return false;
  context.set({
    savedName: captured.savedName,
    lastSaveTarget: captured.lastSaveTarget,
    dirty: true,
  });
  return true;
}

async function captureVariant(
  context: Context,
  render: VariableTextRenderer,
  now: Date,
  isCurrent?: () => boolean,
): Promise<string | null> {
  if (isCurrent?.() === false) return 'Capturing cancelled.';
  const captured = context.get(),
    project = captured.project,
    manifest = project.productionManifest;
  const row = manifest?.rows.find((entry) => entry.id === manifest.activeRowId);
  if (manifest === undefined || row === undefined) return 'Open a production row first.';
  const captureError = captureRowError(row, now);
  if (captureError !== null) return captureError;
  const result = await materializeVariableText(
    productionRowProject(projectWithCurrentJobSetup(captured), manifest, row),
    {
      now: new Date(manifest.frozenAt),
      recordIndex: row.recordIndex,
      serialValue: row.serialValue,
    },
    render,
  );
  if (!currentDocument(context, captured) || isCurrent?.() === false)
    return 'The working document changed; capture was cancelled.';
  if (!result.ok) return result.preflight.issues.map((issue) => issue.message).join(' ');
  const reviewedProjectJson = productionVariantJson(result.project);
  return update(
    context,
    {
      ...manifest,
      rows: manifest.rows.map((entry) =>
        entry.id === row.id
          ? { ...entry, status: 'reviewed', reviewedProjectJson, reviewedAt: now.toISOString() }
          : entry,
      ),
    },
    project,
    'Capture production variant',
    { ...project, scene: result.project.scene, jobSetup: result.project.jobSetup },
  );
}

function recordResult(
  context: Context,
  id: string,
  status: ProductionRowStatus,
  notes: string,
  now: Date,
): string | null {
  if (!Number.isFinite(now.getTime())) return 'Use a valid result date.';
  const project = context.get().project,
    manifest = project.productionManifest;
  const row = manifest?.rows.find((entry) => entry.id === id);
  if (manifest === undefined || row === undefined) return 'Missing production row.';
  if ((status === 'reviewed' || status === 'completed') && row.reviewedProjectJson === undefined)
    return 'Capture the reviewed variant before recording this result.';
  return update(
    context,
    {
      ...manifest,
      rows: manifest.rows.map((entry) =>
        entry.id === id ? { ...entry, status, notes, resultAt: now.toISOString() } : entry,
      ),
    },
    project,
    'Record production result',
  );
}

function currentDocument(context: Context, captured: AppState): boolean {
  const current = context.get();
  return (
    current.project === captured.project &&
    current.projectDocumentEpoch === captured.projectDocumentEpoch
  );
}

function captureRowError(row: ProductionRow, now: Date): string | null {
  if (!Number.isFinite(now.getTime())) return 'Use a valid capture date.';
  return row.status !== 'pending' && row.status !== 'reviewed'
    ? 'Record an explicit pending result before revising this row’s variant.'
    : null;
}
