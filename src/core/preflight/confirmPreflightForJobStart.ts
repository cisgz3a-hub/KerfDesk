import type { PreflightSummary } from './Preflight';
import type { ValidatedJobTicket } from '../job/ValidatedJobTicket';

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
