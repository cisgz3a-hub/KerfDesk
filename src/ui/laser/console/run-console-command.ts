import type { ControllerDriver } from '../../../core/controllers';
import type { ConsoleCommandOptions } from '../../state/laser-console-actions';
import type { ConsoleCommandProvenance } from '../../state';
import { jobAwareConfirm } from '../../state/job-aware-dialogs';

export type SendConsoleCommand = (
  command: string,
  options?: ConsoleCommandOptions,
) => Promise<void>;

export type RunConsoleCommandResult =
  | { readonly status: 'sent'; readonly command: string }
  | { readonly status: 'cancelled'; readonly command: string }
  | { readonly status: 'rejected'; readonly command: string; readonly reason: string };

/**
 * Validates one Console command with the active driver, obtains the existing persistent-write
 * confirmation when required, and dispatches through the supplied Console action. The result
 * distinguishes sent, cancelled, and rejected outcomes; optional macro provenance is forwarded
 * without creating another command path.
 */
export async function runConsoleCommand(
  driver: ControllerDriver,
  input: string,
  sendConsoleCommand: SendConsoleCommand,
  provenance?: ConsoleCommandProvenance,
): Promise<RunConsoleCommandResult> {
  const prepared = driver.prepareConsoleCommand(input);
  if (!prepared.ok) {
    return { status: 'rejected', command: input.trim(), reason: prepared.reason };
  }

  const command = prepared.command.normalized;
  if (
    prepared.command.requiresConfirmation &&
    !jobAwareConfirm(`Send persistent controller setting?\n\n${command}`)
  ) {
    return { status: 'cancelled', command };
  }

  try {
    if (prepared.command.requiresConfirmation) {
      await sendConsoleCommand(command, {
        confirmed: true,
        ...(provenance === undefined ? {} : { provenance }),
      });
    } else if (provenance !== undefined) {
      await sendConsoleCommand(command, { provenance });
    } else {
      await sendConsoleCommand(command);
    }
    return { status: 'sent', command };
  } catch (error) {
    return { status: 'rejected', command, reason: consoleCommandErrorMessage(error) };
  }
}

function consoleCommandErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  const message = String(error).trim();
  return message === '' ? 'The controller rejected the console command.' : message;
}
