import type { PreflightSummary } from './Preflight';
import type { ValidatedJobTicket } from '../job/ValidatedJobTicket';
import type { BurnEnvelopeDivergenceReport } from '../output/burnEnvelopeDivergence';

// T1-191: human-readable label for each divergence kind.
function divergenceKindLabel(kind: BurnEnvelopeDivergenceReport['kind']): string {
  switch (kind) {
    case 'emitted-empty-plan-non-empty':
      return 'The emitted G-code contains no burn moves, but the plan does.';
    case 'plan-empty-emitted-non-empty':
      return 'The emitted G-code contains burn moves the plan does not.';
    case 'envelope-edge-mismatch':
      return 'The emitted G-code\'s burn region differs from the plan\'s by more than the tolerance.';
  }
}

function divergenceMessage(report: BurnEnvelopeDivergenceReport): string {
  const lines: string[] = [
    '⚠ Burn-region divergence detected between the planned preview and the emitted G-code.',
    divergenceKindLabel(report.kind),
    '',
    `Max edge delta: ${report.maxEdgeDeltaMm.toFixed(3)} mm (tolerance: ${report.toleranceMm} mm)`,
    `Plan burn moves: ${report.planBurnMoveCount}`,
    `Emitted burn moves: ${report.emittedBurnMoveCount}`,
    '',
    'LaserForge blocked this start because the visual preview does not match the bytes that would be streamed to the machine. Recompile, inspect the support log, and fix the mismatch before running this job.',
  ];
  return lines.join('\n');
}

/** Ticket + preflight snapshot after the user confirms the preflight dialog. */
export interface ConfirmedJobTicket {
  readonly ticket: ValidatedJobTicket;
  readonly preflight: PreflightSummary | null;
}

export interface ConfirmedJobTicketResult {
  confirmed: boolean;
  ticket: ConfirmedJobTicket | null;
}

/**
 * Prompts for blockers/warnings before starting a job.
 * When `validatedTicket` is passed and the user confirms, returns it wrapped with preflight.
 */
export async function confirmPreflightForJobStart(
  preflight: PreflightSummary | null,
  showAlert: (title: string, message: string, details?: string) => Promise<void>,
  showConfirm: (title: string, message: string, details?: string) => Promise<boolean>,
  validatedTicket?: ValidatedJobTicket,
): Promise<ConfirmedJobTicketResult> {
  // T1-191 / S25-06-001: if compile detects a burn-envelope divergence
  // (T1-188), hard-block start before the normal blocker/warning flow.
  // Preview/output mismatch means the operator cannot trust the preview
  // to describe the bytes that would be streamed to the machine.
  if (validatedTicket?.burnEnvelopeDivergence) {
    await showAlert(
      'Cannot start job',
      divergenceMessage(validatedTicket.burnEnvelopeDivergence),
    );
    return { confirmed: false, ticket: null };
  }

  if (preflight && !preflight.canStart) {
    await showAlert(
      'Cannot start job',
      'Cannot start job — resolve all blockers first:\n\n' +
        preflight.issues
          .filter(i => i.severity === 'blocker')
          .map(i => `• ${i.title}${i.fix ? '\n  → ' + i.fix : ''}`)
          .join('\n\n'),
    );
    return { confirmed: false, ticket: null };
  }

  if (preflight && preflight.warnings > 0) {
    // T1-63: warnings include detail + fix in the confirmation dialog, matching
    // the blocker dialog above. Pre-T1-63 the user saw "\u25B2 High cut power" with
    // no value, no consequence, and no remediation \u2014 pressed Start because the
    // title didn't sound serious. Showing detail and fix lets the user make an
    // informed acknowledge-and-continue decision.
    //
    // T1-183 (external audit F-022): include info-severity findings
    // (e.g. LAYER_OUTPUT_SUMMARIES "1 layer cuts at 2000 mm/min \u00D7 75%
    // power, 3 passes") in the confirm dialog above the warnings.
    // Pre-T1-183 the user only saw warnings here \u2014 info was confined
    // to the side panel, easy to miss. Showing info first gives the
    // user the "what will run" context BEFORE the warnings list.
    const warningsText = preflight.issues
      .filter(i => i.severity === 'warning')
      .map(i => {
        let line = `\u25B2 ${i.title}`;
        if (i.detail && i.detail !== i.title) line += `\n  ${i.detail}`;
        if (i.fix) line += `\n  \u2192 ${i.fix}`;
        return line;
      })
      .join('\n\n');
    const infoIssues = preflight.issues.filter(i => i.severity === 'info');
    const infoText = infoIssues.length > 0
      ? infoIssues
          .map(i => {
            let line = `\u2139 ${i.title}`;
            if (i.detail && i.detail !== i.title) line += `\n  ${i.detail}`;
            return line;
          })
          .join('\n\n') + '\n\n'
      : '';
    const proceed = await showConfirm(
      'Start job?',
      `${infoText}${preflight.warnings} warning(s):\n\n` +
        warningsText +
        '\n\nStart job anyway?',
    );
    if (!proceed) {
      return { confirmed: false, ticket: null };
    }
  }

  if (validatedTicket) {
    return {
      confirmed: true,
      ticket: { ticket: validatedTicket, preflight },
    };
  }
  return { confirmed: true, ticket: null };
}
