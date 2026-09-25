// Audit HF-6 repro: FluidNC's long-form name for `$RST` is not blocked.
//
// KerfDesk blocks every `$RST=` form in the Console (ADR-362 decision 1, audit
// settings-console-8: console-command.ts isBlockedPersistentCommand matches
// /^\$RST=/). FluidNC registers the same command under a second, long name:
//
//   FluidNC v4.0.3 ProcessSettings.cpp:1067
//     new UserCommand("RST", "Settings/Restore", restore_settings, notIdleOrAlarm, WA);
//   https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1067
//   do_command_or_setting() matches either getGrblName() or getName()
//   case-insensitively (ProcessSettings.cpp:1100-1101; authentication is compiled out by default, Config.h:29), and restore_settings()
//   (l.546-556) with "#"/"gcode" resets every G54-G59/G28/G30 offset
//   (settings_restore, l.157-163), "$"/"settings" restores defaults, "*"/"all" both.
//
// Correct behaviour: `$Settings/Restore=<x>` is refused exactly like `$RST=<x>`.
// Current code prepares it as an ordinary command (no confirmation), and its
// 'machine-state' effect keeps the persistent-origin state the firmware just wiped.
import { describe, expect, it } from 'vitest';
import { fluidncDriver } from '../../core/controllers/fluidnc/driver';

describe('HF-6 FluidNC long-form settings restore', () => {
  it('control: the short form is blocked', () => {
    expect(fluidncDriver.prepareConsoleCommand('$RST=#').ok).toBe(false);
  });

  it.each(['$Settings/Restore=#', '$settings/restore=gcode', '$Settings/Restore=*'])(
    'blocks %s like $RST=',
    (input) => {
      expect(fluidncDriver.prepareConsoleCommand(input).ok).toBe(false);
    },
  );

  // Same class, both spellings: FluidNC v4.0.3 ProcessSettings.cpp:1034
  //   new UserCommand("NVX", "Settings/Erase", Setting::eraseNVS, notIdleOrAlarm, WA);
  // and Settings.h:136-139 eraseNVS() { nvs.erase_all(); return Error::Ok; } wipe the
  // non-volatile store that also holds the G54-G59/G28/G30 offsets (Coordinates
  // are NVS blobs, Settings.cpp:413-420). Current code prepares both as ordinary
  // commands with no confirmation.
  // https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Settings.h#L136-L139
  it.each(['$NVX', '$Settings/Erase'])('blocks %s like $RST=', (input) => {
    expect(fluidncDriver.prepareConsoleCommand(input).ok).toBe(false);
  });
});
