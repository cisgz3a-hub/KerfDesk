// FluidNC driver — GRBL-compatible wire protocol (banner "Grbl 3.x
// [FluidNC vX]"), same realtime bytes, jog, and status reports. The key
// delta: numeric `$N=value` writes are legacy-mapped or ignored by FluidNC
// (real configuration lives in the $/tree YAML config), so the settings
// capability is a read-only dump and the GRBL laser-setup panel is disabled.

import type { ControllerDriver } from '../controller-driver';
import type { ConsoleCommandResult } from '../grbl/console-command';
import { grblDriver } from '../grbl/driver';

// FluidNC report commands that only print configuration or lists. Stock GRBL
// has no such commands, so the shared classifier took them for an unknown
// machine-state change and dropped homing and Frame evidence; Machine Setup's
// read-only checks send `$CD` (audit settings-console-7). Registered as
// ReportCommand in FluidNC ProcessSettings.cpp make_user_commands(); the list
// is explicit because some report-type commands do change state ($RI, $13).
// `$CD=<file>` writes a file, has an '=' and is never matched here.
// https://github.com/bdring/FluidNC/blob/main/FluidNC/src/ProcessSettings.cpp
const FLUIDNC_READ_ONLY_REPORTS: ReadonlySet<string> = new Set([
  '$CD',
  '$CONFIG/DUMP',
  '$S',
  '$SETTINGS/LIST',
  '$SC',
  '$SETTINGS/LISTCHANGED',
  '$L',
  '$GRBLNAMES/LIST',
  '$CMD',
  '$COMMANDS/LIST',
  '$SS',
  '$STARTUP/SHOW',
  '$A',
  '$ALARMS/LIST',
  '$E',
  '$ERRORS/LIST',
]);

function prepareFluidncConsoleCommand(input: string): ConsoleCommandResult {
  const prepared = grblDriver.prepareConsoleCommand(input);
  if (!prepared.ok || !FLUIDNC_READ_ONLY_REPORTS.has(prepared.command.normalized.toUpperCase())) {
    return prepared;
  }
  return {
    ok: true,
    command: {
      ...prepared.command,
      requiresIdle: false,
      requiresNoActiveOperation: true,
      requiresConfirmation: false,
      stateEffect: 'read-only',
    },
  };
}

export const fluidncDriver: ControllerDriver = {
  ...grblDriver,
  kind: 'fluidnc',
  label: 'FluidNC',
  prepareConsoleCommand: prepareFluidncConsoleCommand,
  commands: {
    ...grblDriver.commands,
    // FluidNC identity/build output is not the strict stock-GRBL `$I` shape.
    buildInfoQuery: null,
  },
  capabilities: {
    ...grblDriver.capabilities,
    settings: 'readonly-dump',
    firmwareSetupPanel: 'none',
  },
};
