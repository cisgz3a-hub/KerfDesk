// handleInspectCurrentGcode — compile the CURRENT canvas project through the
// exact Save-G-code emission path and hand the resulting program text to the
// 3D Inspector (ADR-255, WORKFLOW.md F-M1). This is the dogfood entry point:
// what the operator would save or stream is what the Inspector renders.
//
// Read-only by construction: nothing is written, streamed, or advanced (the
// variable-text serial advance stays with the real export). Findings inform;
// the only refusal is the factual "no program could be produced" case.

import { DEFAULT_JOB_PLACEMENT, resolveExportJobPlacement } from '../job-placement';
import type { SaveGcodeCtx } from './file-actions';
import { emitSaveGcode } from './save-gcode-emission';

type InspectCtx = Omit<SaveGcodeCtx, 'advanceVariablesAfter'>;

export async function handleInspectCurrentGcode(
  ctx: InspectCtx,
  openInspector: (programName: string, text: string) => void,
): Promise<void> {
  const placement = resolveExportJobPlacement(ctx.jobPlacement ?? DEFAULT_JOB_PLACEMENT, {
    statusReport: null,
    workOriginActive: false,
    wcoCache: null,
    ...ctx.machine,
  });
  if (!placement.ok) {
    ctx.pushToast(`Cannot compile G-code: ${placement.messages.join(' ')}`, 'error');
    return;
  }
  let gcode: string;
  try {
    ({ gcode } = await emitSaveGcode(ctx, placement));
  } catch (err) {
    ctx.pushToast(
      `Could not compile G-code: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
    return;
  }
  if (gcode.trim() === '') {
    ctx.pushToast('Nothing to inspect — this project produces no G-code yet.', 'warning');
    return;
  }
  openInspector(currentProgramName(ctx.savedName), gcode);
}

function currentProgramName(savedName: string | null): string {
  const base = savedName === null || savedName.trim() === '' ? 'untitled' : savedName;
  return `${base} (current canvas)`;
}
