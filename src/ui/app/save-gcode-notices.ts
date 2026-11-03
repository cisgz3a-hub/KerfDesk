// What Save G-code says once the file is written (H12, AUDIT-2026-06-10): the
// same job-intent warnings the Start path surfaces, non-blocking since the
// export itself succeeded. CNC mode has its own advisory set (stock footprint,
// H.2) via the machine-aware selector.
//
// Only the newest three toasts show (Toasts.tsx), so the order is a ranking
// (UX audit U3-P3-6, ADR-687), shared with Job Review (review-note-rank.ts).
// Pushed last, and so seen first: the saved confirmation, then the preflight's
// findings such as a job off the bed (ADR-591 Amendment 3), then the warnings
// written for a beginner, then any other warning. The technical notes and the
// controller assumptions fold into one "Technical notes (n)" toast whose notes
// open on a click.
import type { PreflightIssue } from '../../core/preflight';
import {
  DEFAULT_OUTPUT_SCOPE,
  machineKindOf,
  validateOutputScope,
  type Project,
} from '../../core/scene';
import { detectCompiledVCarveDepthWarnings } from '../laser/cnc-compiled-depth-warnings';
import { reviewNoteRank, technicalNotesLabel } from '../laser/review-note-rank';
import type { ToastVariant } from '../state/toast-store';
import {
  cncExportOtherControllersNote,
  cncSavedBitChangesNote,
} from './cnc-export-controller-advisory';
import type { SaveGcodeCtx } from './file-actions';

type SavedGcodeNoticeCtx = Pick<
  SaveGcodeCtx,
  'project' | 'outputScope' | 'controllerSettings' | 'pushToast'
>;

type Notice = { readonly message: string; readonly variant: ToastVariant };

export function pushSavedGcodeNotices(
  ctx: SavedGcodeNoticeCtx,
  savedName: string,
  findings: {
    readonly preflightAdvisories: ReadonlyArray<PreflightIssue>;
    readonly cncVCarveDepths: Parameters<typeof detectCompiledVCarveDepthWarnings>[0];
    readonly machineWarnings: ReadonlyArray<string>;
    readonly cncToolPlanLength?: number;
  },
): void {
  const notes: Notice[] = controllerNotes(ctx, findings.cncToolPlanLength).map((message) => ({
    message,
    variant: 'info',
  }));
  const others: string[] = [];
  const leading: Notice[] = [];
  for (const warning of findings.machineWarnings) {
    const rank = reviewNoteRank(warning);
    if (rank === 'technical') notes.push({ message: warning, variant: 'warning' });
    else if (rank === 'beginner') leading.push({ message: warning, variant: 'warning' });
    else others.push(warning);
  }
  for (const warning of vCarveDepthWarnings(ctx, findings.cncVCarveDepths)) {
    leading.push({ message: warning, variant: 'warning' });
  }
  for (const advisory of findings.preflightAdvisories) {
    leading.push({ message: advisory.message, variant: 'warning' });
  }
  pushFoldedNotes(ctx, notes);
  for (const warning of others) ctx.pushToast(warning, 'warning');
  for (const notice of leading) ctx.pushToast(notice.message, notice.variant);
  ctx.pushToast(`Saved G-code to ${savedName}`, 'success');
}

// What the file assumes about the controller it was not checked against.
function controllerNotes(
  ctx: SavedGcodeNoticeCtx,
  cncToolPlanLength: number | undefined,
): ReadonlyArray<string> {
  if (machineKindOf(ctx.project.machine) === 'cnc') {
    return [
      cncExportOtherControllersNote(ctx.project.device, ctx.controllerSettings),
      cncSavedBitChangesNote(cncToolPlanLength),
    ].filter((note): note is string => note !== null);
  }
  if (ctx.controllerSettings !== null) return [];
  return [
    `Exported G-code assumes GRBL $30=${ctx.project.device.maxPowerS} and laser mode ($32=1) — not verified against a connected controller this session.`,
  ];
}

function vCarveDepthWarnings(
  ctx: SavedGcodeNoticeCtx,
  depths: Parameters<typeof detectCompiledVCarveDepthWarnings>[0],
): ReadonlyArray<string> {
  const warningProject = outputScopedWarningProject(ctx);
  if (warningProject.machine?.kind !== 'cnc') return [];
  return detectCompiledVCarveDepthWarnings(depths, warningProject.machine.stock.thicknessMm);
}

function pushFoldedNotes(ctx: SavedGcodeNoticeCtx, notes: ReadonlyArray<Notice>): void {
  const [only] = notes;
  if (only === undefined) return;
  if (notes.length === 1) {
    ctx.pushToast(only.message, only.variant);
    return;
  }
  const variant = notes.some((note) => note.variant === 'warning') ? 'warning' : 'info';
  ctx.pushToast(`${technicalNotesLabel(notes.length)} about this G-code.`, variant, {
    details: notes.map((note) => note.message),
  });
}

function outputScopedWarningProject(ctx: SavedGcodeNoticeCtx): Project {
  const scoped = validateOutputScope(ctx.project.scene, ctx.outputScope ?? DEFAULT_OUTPUT_SCOPE);
  if (!scoped.ok || scoped.scene === ctx.project.scene) return ctx.project;
  return { ...ctx.project, scene: scoped.scene };
}
