import { profileAutofocusIssue } from '../../core/devices/autofocus-command';
import { isControllerCommandSet, isKnownControllerKind } from '../../core/devices/device-profile';
import { recoverPositioningLight } from './machine-profile-positioning-light';

type Recovery = {
  readonly value: Record<string, unknown>;
  readonly notes: ReadonlyArray<string>;
};

/** The profile's controller commands a press can send: the positioning light
 * and the Auto-focus command, each cleared with a review note when refused. */
export function recoverProfileCommands(value: Record<string, unknown>): Recovery {
  const light = recoverPositioningLight(value);
  const autofocus = recoverAutofocusCommand(light.value);
  return { value: autofocus.value, notes: [...light.notes, ...autofocus.notes] };
}

/** A refused Auto-focus command (ADR-400 Amendment 1) is cleared with a review
 * note instead of refusing the whole profile, so a saved last machine still
 * restores; Auto-focus is set up again in Device Setup. */
export function recoverAutofocusCommand(value: Record<string, unknown>): Recovery {
  const command = value['autofocusCommand'];
  if (typeof command !== 'string') return { value, notes: [] };
  const kind = value['controllerKind'];
  const commandSet = value['controllerCommandSet'];
  const issue = profileAutofocusIssue({
    autofocusCommand: command,
    controllerKind: isKnownControllerKind(kind) ? kind : undefined,
    controllerCommandSet: isControllerCommandSet(commandSet) ? commandSet : undefined,
  });
  if (issue === null) return { value, notes: [] };
  return {
    value: { ...value, autofocusCommand: '' },
    notes: [`Auto-focus command removed: ${issue} Set it up again in Device Setup.`],
  };
}
