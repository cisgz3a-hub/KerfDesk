// FluidNC report commands only print configuration or lists (registered as
// ReportCommand in FluidNC ProcessSettings.cpp), so the Console must not treat
// them as a machine-state change that drops homing and Frame evidence (audit
// settings-console-7).
import { describe, expect, it } from 'vitest';
import { fluidncDriver } from './driver';
import { fluidncGrblCommandForm } from './fluidnc-command-names';

function prepare(input: string) {
  const prepared = fluidncDriver.prepareConsoleCommand(input);
  if (!prepared.ok) throw new Error(`expected ${input} to be prepared: ${prepared.reason}`);
  return prepared.command;
}

describe('FluidNC Console report commands', () => {
  it.each(['$CD', '$cd', '$Config/Dump', '$S', '$SC', '$L', '$CMD', '$SS'])(
    'prepares %s as a read-only report',
    (input) => {
      const prepared = fluidncDriver.prepareConsoleCommand(input);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.command.stateEffect).toBe('read-only');
      expect(prepared.command.requiresIdle).toBe(false);
    },
  );

  it('keeps $CD=<file>, which writes a controller file, a mutation', () => {
    const prepared = fluidncDriver.prepareConsoleCommand('$CD=config.yaml');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.command.stateEffect).not.toBe('read-only');
  });
});

// Audit HF-6. FluidNC v4.0.3 registers every `$` command under a Grbl name and
// a long name and runs it for either, ignoring case (ProcessSettings.cpp
// make_user_commands() 1012-1085, do_command_or_setting() 1100-1101):
//   new UserCommand("RST", "Settings/Restore", restore_settings, notIdleOrAlarm, WA);
//   new UserCommand("NVX", "Settings/Erase", Setting::eraseNVS, notIdleOrAlarm, WA);
// restore_settings() with "#"/"gcode" resets every G54-G59/G28/G30 offset, and
// eraseNVS() wipes the whole non-volatile store (Settings.h:136-139).
// https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1067
describe('FluidNC long command names (audit HF-6)', () => {
  it('control: the short form is blocked', () => {
    expect(fluidncDriver.prepareConsoleCommand('$RST=#').ok).toBe(false);
  });

  it.each([
    '$Settings/Restore=#',
    '$settings/restore=gcode',
    '$Settings/Restore=*',
    '$SETTINGS/RESTORE=$',
    '$Settings / Restore = all',
  ])('blocks %s like $RST=', (input) => {
    expect(fluidncDriver.prepareConsoleCommand(input).ok).toBe(false);
  });

  it.each(['$NVX', '$nvx', '$NVX=1', '$Settings/Erase', '$settings/erase'])(
    'blocks %s, which erases the stored settings and offsets',
    (input) => {
      const prepared = fluidncDriver.prepareConsoleCommand(input);
      expect(prepared.ok).toBe(false);
      if (prepared.ok) return;
      expect(prepared.reason).toContain('$NVX');
    },
  );

  it.each([
    ['$Home', '$H\n'],
    ['$home', '$H\n'],
    ['$Home/X', '$HX\n'],
    ['$home/u', '$HU\n'],
    ['$HW', '$HW\n'],
    ['$H=XY', '$H=XY\n'],
    ['$Home=XZ', '$H=XZ\n'],
    ['$H=21', '$H=21\n'],
  ])('classifies %s as a homing reference in Idle or Alarm', (input, wire) => {
    const command = prepare(input);
    expect(command.wire).toBe(wire);
    expect(command.stateEffect).toBe('reference');
    expect(command.requiresIdle).toBe(false);
    expect(command.allowedStates).toEqual(['Idle', 'Alarm']);
  });

  it.each(['$Alarm/Disable', '$alarm/disable', '$X'])('treats %s as the owned unlock', (input) => {
    const command = prepare(input);
    expect(command.kind).toBe('unlock');
    expect(command.wire).toBe('$X\n');
  });

  it.each([
    ['$GrblSettings/List', 'settings-query'],
    ['$GCode/Offsets', 'offset-query'],
    ['$GCode/Modes', 'modal-state-query'],
    ['$Build/Info', 'build-info-query'],
    ['$GCode/Check', 'check-mode'],
  ] as const)('classifies %s like its Grbl name (%s)', (input, kind) => {
    expect(prepare(input).kind).toBe(kind);
  });

  it('keeps $System/Sleep on the Idle-or-Alarm rule of $SLP', () => {
    const command = prepare('$System/Sleep');
    expect(command.wire).toBe('$SLP\n');
    expect(command.allowedStates).toEqual(['Idle', 'Alarm']);
  });

  it('leaves commands that have no long name, and settings, as typed', () => {
    expect(fluidncGrblCommandForm('$Heap')).toBe('$Heap');
    expect(fluidncGrblCommandForm('$Sta/SSID=My Home WiFi')).toBe('$Sta/SSID=My Home WiFi');
    expect(fluidncGrblCommandForm('G0 X10')).toBe('G0 X10');
    expect(prepare('$Sta/SSID=My Home WiFi').wire).toBe('$Sta/SSID=My Home WiFi\n');
  });

  it('keeps a long-name value exactly as typed after the equals sign', () => {
    expect(fluidncGrblCommandForm('$Settings/Restore= gcode')).toBe('$RST= gcode');
    expect(fluidncGrblCommandForm('$Jog=G91 X1 F100')).toBe('$J=G91 X1 F100');
  });
});
