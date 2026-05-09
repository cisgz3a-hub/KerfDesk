/**
 * Safe read-only GRBL diagnostics for support.
 *
 * These commands identify the controller, settings, modal state, work offsets,
 * and live status without homing, jogging, spindle/laser output, or motion.
 */
export const SAFE_GRBL_DIAGNOSTIC_COMMANDS = ['$I', '$$', '$G', '$#', '?'] as const;

export type SafeGrblDiagnosticCommand = typeof SAFE_GRBL_DIAGNOSTIC_COMMANDS[number];

export function buildSafeGrblDiagnosticsRequest(): string {
  return [
    'LaserForge safe GRBL diagnostics',
    '',
    'Please paste these commands into the console one at a time, then send the full replies back for support:',
    ...SAFE_GRBL_DIAGNOSTIC_COMMANDS.map(cmd => `  ${cmd}`),
    '',
    'This list intentionally excludes homing, motion, and laser-output commands.',
  ].join('\n');
}
