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
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';

type InspectCtx = Omit<SaveGcodeCtx, 'advanceVariablesAfter'>;

export type InspectCurrentGcodeOptions = {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: OutputCompilationProgress) => void;
};

export type InspectCurrentGcodeResult =
  | { readonly kind: 'ready' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'cancelled' };

export async function handleInspectCurrentGcode(
  ctx: InspectCtx,
  openInspector: (programName: string, text: string) => void,
  options: InspectCurrentGcodeOptions = {},
): Promise<InspectCurrentGcodeResult> {
  const placement = resolveExportJobPlacement(ctx.jobPlacement ?? DEFAULT_JOB_PLACEMENT, {
    statusReport: null,
    workOriginActive: false,
    wcoCache: null,
    ...ctx.machine,
  });
  if (!placement.ok) {
    const message = placement.messages.join(' ');
    ctx.pushToast(`Cannot compile G-code: ${message}`, 'error');
    return { kind: 'failed', message };
  }
  let emission: Awaited<ReturnType<typeof emitSaveGcode>>;
  try {
    emission = await emitSaveGcode(ctx, placement, options);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { kind: 'cancelled' };
    const message = err instanceof Error ? err.message : String(err);
    ctx.pushToast(`Could not compile G-code: ${message}`, 'error');
    return { kind: 'failed', message };
  }
  if (emission.kind === 'preparation-unavailable') {
    ctx.pushToast(`Could not compile G-code: ${emission.message}`, 'error');
    return { kind: 'unavailable', message: emission.message };
  }
  const { gcode } = emission;
  if (gcode.trim() === '') {
    ctx.pushToast('Nothing to inspect — this project produces no G-code yet.', 'warning');
    return { kind: 'empty' };
  }
  openInspector(currentProgramName(ctx.savedName), gcode);
  return { kind: 'ready' };
}

function currentProgramName(savedName: string | null): string {
  const base = savedName === null || savedName.trim() === '' ? 'untitled' : savedName;
  return `${base} (current canvas)`;
}
