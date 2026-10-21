import { autofocusCommandIssue } from '../../core/devices/autofocus-command';
import { isKnownControllerKind } from '../../core/devices/device-profile';

/** A refused Auto-focus command (ADR-400 Amendment 1) is cleared with a review
 * note instead of refusing the whole profile, so a saved last machine still
 * restores; Auto-focus is set up again in Device Setup. */
export function recoverAutofocusCommand(value: Record<string, unknown>): {
  readonly value: Record<string, unknown>;
  readonly notes: ReadonlyArray<string>;
} {
  const command = value['autofocusCommand'];
  if (typeof command !== 'string') return { value, notes: [] };
  const kind = value['controllerKind'];
  const issue = autofocusCommandIssue(command, isKnownControllerKind(kind) ? kind : undefined);
  if (issue === null) return { value, notes: [] };
  return {
    value: { ...value, autofocusCommand: '' },
    notes: [`Auto-focus command removed: ${issue} Set it up again in Device Setup.`],
  };
}
