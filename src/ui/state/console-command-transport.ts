import type { ControllerDriver } from '../../core/controllers';
import { startControllerCommand, type ControllerLifecycleRefs } from './laser-interactive-command';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { TranscriptSource } from './laser-transcript';

// Command-arbiter label for a console $$ (distinct from the controllerOperation
// marker label): surfaces in the timeout/rejection message.
const SETTINGS_READ_COMMAND_LABEL = 'Read controller settings';

type ConsoleCommandWriteFn = (
  line: string,
  action: LaserSafetyAction | undefined,
  source: TranscriptSource,
) => Promise<void>;

type ConsoleTransportRefs = ControllerLifecycleRefs & { readonly driver: ControllerDriver };

type PreparedWireCommand = {
  readonly kind: string;
  readonly normalized: string;
  readonly wire: string;
};

// Route a prepared console command to the serial transport. Owned reads ($I
// firmware identity, $$ settings dump) go through the timeout-armed command
// arbiter so a silent or error-terminated controller rejects instead of
// leaving the caller's operation marker stranded; everything else is a plain
// fire-and-forget write.
export function writeConsoleCommand(
  refs: ConsoleTransportRefs,
  write: ConsoleCommandWriteFn,
  command: PreparedWireCommand,
): Promise<unknown> {
  if (isOwnedControllerIdentityCommand(refs, command)) {
    return startControllerCommand(
      refs,
      (line, action, source) => write(line, action, source ?? 'console'),
      {
        kind: 'controller-identity',
        label: 'Read controller firmware identity',
        command: command.wire,
        action: actionForConsoleCommand(command.kind),
        source: 'console',
      },
    );
  }
  if (command.kind === 'settings-query') {
    // A silent or error-terminated $$ dump must not strand the settings-read
    // controllerOperation forever — that marker blocks Frame/Start/console
    // until a controller reset. Route it through the timeout-armed command
    // arbiter, exactly as the Machine Settings Read button does, so a stalled
    // controller rejects and the caller releases the marker. The parallel
    // settings collector still fills the table on the terminal ok.
    return startControllerCommand(
      refs,
      (line, action, source) => write(line, action, source ?? 'console'),
      {
        kind: 'interactive-command',
        label: SETTINGS_READ_COMMAND_LABEL,
        command: command.wire,
        action: actionForConsoleCommand(command.kind),
        source: 'console',
      },
    );
  }
  return write(command.wire, actionForConsoleCommand(command.kind), 'console');
}

export function isOwnedControllerIdentityCommand(
  refs: { readonly driver: ControllerDriver },
  command: { readonly normalized: string },
): boolean {
  return refs.driver.kind === 'marlin' && command.normalized.trim().toUpperCase() === 'M115';
}

function actionForConsoleCommand(kind: string): LaserSafetyAction {
  return kind === 'unlock' ? 'unlock' : 'console';
}
