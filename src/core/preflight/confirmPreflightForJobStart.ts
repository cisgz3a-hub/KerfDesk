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
    const proceed = await showConfirm(
      'Start job?',
      `${preflight.warnings} warning(s):\n\n` +
        preflight.issues
          .filter(i => i.severity === 'warning')
          .map(i => `\u25B2 ${i.title}`)
          .join('\n') +
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
