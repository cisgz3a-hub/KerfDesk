// FluidNC driver — GRBL-compatible wire protocol (banner "Grbl 3.x
// [FluidNC vX]"), same realtime bytes, jog, and status reports. The key
// delta: numeric `$N=value` writes are legacy-mapped or ignored by FluidNC
// (real configuration lives in the $/tree YAML config), so the settings
// capability is a read-only dump and the GRBL laser-setup panel is disabled.

import type { ControllerDriver } from '../controller-driver';
import type { ConsoleCommandResult, PreparedConsoleCommand } from '../grbl/console-command';
import { grblDriver } from '../grbl/driver';
import { fluidncCommandKey, fluidncGrblCommandForm } from './fluidnc-command-names';

// FluidNC report commands that only print configuration or lists. Stock GRBL
// has no such commands, so the shared classifier took them for an unknown
// machine-state change and dropped homing and Frame evidence; Machine Setup's
// read-only checks send `$CD` (audit settings-console-7). Registered as
// ReportCommand in FluidNC ProcessSettings.cpp make_user_commands(); the list
// is explicit because some report-type commands do change state ($RI, $13).
// `$CD=<file>` writes a file, has an '=' and is never matched here. Long names
// ($Config/Dump, $Settings/List, ...) arrive here as their Grbl names.
// https://github.com/bdring/FluidNC/blob/main/FluidNC/src/ProcessSettings.cpp
const FLUIDNC_READ_ONLY_REPORTS: ReadonlySet<string> = new Set([
  '$CD',
  '$S',
  '$SC',
  '$L',
  '$CMD',
  '$SS',
  '$A',
  '$E',
]);

// `$NVX` (`$Settings/Erase`) runs nvs.erase_all(), with or without a value: it
// wipes every stored setting and the G54-G59, G28 and G30 offsets FluidNC keeps
// in NVS (v4.0.3 ProcessSettings.cpp:1034, Settings.h:136-139). Blocked like
// every `$RST=` form (audit HF-6).
const NVS_ERASE_REASON =
  '$NVX ($Settings/Erase) erases every setting and work offset the controller stores. This persistent controller command is blocked in the Console.';

// FluidNC homes with `$H`, one axis with `$HX` ... `$HW` (it has U, V and W
// axes), and a listed set of axes or homing cycles with `$H=<axes|cycles>`
// (ProcessSettings.cpp:425-455, 1044-1053), in Idle or Alarm like GRBL's `$H`.
const FLUIDNC_HOME_RE = /^\$H(?:[XYZABCUVW]?|=.*)$/;
const IDLE_OR_ALARM: ReadonlyArray<string> = ['Idle', 'Alarm'];

function prepareFluidncConsoleCommand(input: string): ConsoleCommandResult {
  const grblForm = fluidncGrblCommandForm(input);
  if (fluidncCommandKey(grblForm) === 'NVX') return { ok: false, reason: NVS_ERASE_REASON };
  const prepared = grblDriver.prepareConsoleCommand(grblForm);
  if (!prepared.ok) return prepared;
  const upper = prepared.command.normalized.toUpperCase();
  if (FLUIDNC_READ_ONLY_REPORTS.has(upper)) return readOnlyReport(prepared.command);
  if (FLUIDNC_HOME_RE.test(upper)) return homeCommand(prepared.command);
  return prepared;
}

function readOnlyReport(command: PreparedConsoleCommand): ConsoleCommandResult {
  return {
    ok: true,
    command: {
      ...command,
      requiresIdle: false,
      requiresNoActiveOperation: true,
      requiresConfirmation: false,
      stateEffect: 'read-only',
    },
  };
}

function homeCommand(command: PreparedConsoleCommand): ConsoleCommandResult {
  return {
    ok: true,
    command: {
      ...command,
      kind: 'gcode',
      requiresIdle: false,
      requiresNoActiveOperation: true,
      requiresConfirmation: false,
      stateEffect: 'reference',
      allowedStates: IDLE_OR_ALARM,
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
