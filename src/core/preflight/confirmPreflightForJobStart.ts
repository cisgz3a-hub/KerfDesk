import type { PreflightResult } from './PreflightChecker';

/**
 * Prompts for blockers/warnings before starting a job. Returns false if the user must not start.
 */
export async function confirmPreflightForJobStart(
  preflight: PreflightResult | null,
  showAlert: (title: string, message: string, details?: string) => Promise<void>,
  showConfirm: (title: string, message: string, details?: string) => Promise<boolean>,
): Promise<boolean> {
  if (preflight && !preflight.canStart) {
    await showAlert(
      'Cannot start job',
      'Cannot start job — resolve all blockers first:\n\n' +
        preflight.issues
          .filter(i => i.severity === 'blocker')
          .map(i => `• ${i.title}${i.fix ? '\n  → ' + i.fix : ''}`)
          .join('\n\n'),
    );
    return false;
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
    if (!proceed) return false;
  }

  return true;
}
