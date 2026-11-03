// What Save G-code says once the file is written (H12, AUDIT-2026-06-10): the
// same job-intent warnings the Start path surfaces, non-blocking since the
// export itself succeeded. CNC mode has its own advisory set (stock footprint,
// H.2) via the machine-aware selector.
//
// Only the newest three toasts show (Toasts.tsx), so the order is a ranking
// (UX audit U3-P3-6, ADR-686). Pushed last, and so seen first: the saved
// confirmation, then the preflight's findings such as a job off the bed
// (ADR-591 Amendment 3), then the warnings written for a beginner. Everything
// else (controller assumptions, scan offsets, power scale, runway policy) folds
// into one toast whose notes open on a click.
import type { PreflightIssue } from '../../core/preflight';
import {
  DEFAULT_OUTPUT_SCOPE,
  machineKindOf,
  validateOutputScope,
  type Project,
} from '../../core/scene';
import { detectCompiledVCarveDepthWarnings } from '../laser/cnc-compiled-depth-warnings';
import { isCutBeforeEngravingWarning } from '../laser/cut-order-warnings';
import { isUncalibratedDefaultsWarning } from '../laser/uncalibrated-job-warnings';
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
  const notes: Notice[] = [];
  const leading: Notice[] = [];
  if (machineKindOf(ctx.project.machine) === 'cnc') {
    const note = cncExportOtherControllersNote(ctx.project.device, ctx.controllerSettings);
    if (note !== null) notes.push({ message: note, variant: 'info' });
    const bitChanges = cncSavedBitChangesNote(findings.cncToolPlanLength);
    if (bitChanges !== null) notes.push({ message: bitChanges, variant: 'info' });
  } else if (ctx.controllerSettings === null) {
    notes.push({
      message: `Exported G-code assumes GRBL $30=${ctx.project.device.maxPowerS} and laser mode ($32=1) — not verified against a connected controller this session.`,
      variant: 'info',
    });
  }
  for (const warning of findings.machineWarnings) {
    (isBeginnerWarning(warning) ? leading : notes).push({ message: warning, variant: 'warning' });
  }
  const warningProject = outputScopedWarningProject(ctx);
  if (warningProject.machine?.kind === 'cnc') {
    for (const warning of detectCompiledVCarveDepthWarnings(
      findings.cncVCarveDepths,
      warningProject.machine.stock.thicknessMm,
    )) {
      leading.push({ message: warning, variant: 'warning' });
    }
  }
  for (const advisory of findings.preflightAdvisories) {
    leading.push({ message: advisory.message, variant: 'warning' });
  }
  pushFoldedNotes(ctx, notes, leading.length > 0);
  for (const notice of leading) ctx.pushToast(notice.message, notice.variant);
  ctx.pushToast(`Saved G-code to ${savedName}`, 'success');
}

// Warnings a beginner can act on before burning: a material test, cut last.
function isBeginnerWarning(warning: string): boolean {
  return isUncalibratedDefaultsWarning(warning) || isCutBeforeEngravingWarning(warning);
}

function pushFoldedNotes(
  ctx: SavedGcodeNoticeCtx,
  notes: ReadonlyArray<Notice>,
  afterOthers: boolean,
): void {
  const [only] = notes;
  if (only === undefined) return;
  if (notes.length === 1) {
    ctx.pushToast(only.message, only.variant);
    return;
  }
  const variant = notes.some((note) => note.variant === 'warning') ? 'warning' : 'info';
  const count = `${notes.length} ${afterOthers ? 'more notes' : 'notes'}`;
  ctx.pushToast(`${count} about this G-code.`, variant, {
    details: notes.map((note) => note.message),
  });
}

function outputScopedWarningProject(ctx: SavedGcodeNoticeCtx): Project {
  const scoped = validateOutputScope(ctx.project.scene, ctx.outputScope ?? DEFAULT_OUTPUT_SCOPE);
  if (!scoped.ok || scoped.scene === ctx.project.scene) return ctx.project;
  return { ...ctx.project, scene: scoped.scene };
}
