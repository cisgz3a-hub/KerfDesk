import { machineCapabilityWarningMessage } from '../machine/machine-capability-messages';
import { useToastStore } from '../state/toast-store';
import { switchToSavedMachine, type SavedMachineSwitchResult } from './switch-saved-machine';

export type SwitchFeedback = {
  readonly tone: 'success' | 'warning' | 'error';
  readonly text: string;
};

export function switchFeedback(result: SavedMachineSwitchResult): SwitchFeedback {
  if (result.kind === 'missing') {
    return { tone: 'error', text: 'That saved machine is no longer in My machines.' };
  }
  if (result.kind === 'blocked') return { tone: 'error', text: result.reason };
  const reconnect = result.reconnect
    ? ' Disconnect and reconnect so the connection uses its controller settings.'
    : '';
  const capability =
    result.capabilityWarning === null
      ? ''
      : ` ${machineCapabilityWarningMessage(result.capabilityWarning)}`;
  return {
    tone: reconnect === '' && capability === '' ? 'success' : 'warning',
    text: `Switched to “${result.machine.name}”. Frame the job again before Start.${reconnect}${capability}`,
  };
}

/** Switch and report the outcome as a toast, for surfaces without room for a
 * status line of their own (the connect notice, the project banner). */
export function switchWithToast(
  id: string,
  options: Parameters<typeof switchToSavedMachine>[1] = {},
): SavedMachineSwitchResult {
  const result = switchToSavedMachine(id, options);
  const feedback = switchFeedback(result);
  useToastStore.getState().pushToast(feedback.text, feedback.tone);
  return result;
}
