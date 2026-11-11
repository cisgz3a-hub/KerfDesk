// Rolling audit v3 G4-P1-1. FluidNC v4.0.3 runs a line that starts with `[` as
// the `$` command it names: execute_line() routes `$` and `[` lines alike, and
// settings_execute_line() splits `[key]value` at ']' where `$key=value` splits
// at '=' before both reach do_command_or_setting() (ProcessSettings.cpp
// L1088-L1113, L1209-L1240). `13` is Report/Inches (L1080), and the machine
// config's `report_inches` item is the same flag (MachineConfig.cpp L86).
// https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1209-L1240
import { describe, expect, it } from 'vitest';
import { fluidncDriver } from './driver';
import { fluidncDollarForm } from './fluidnc-command-names';

function prepared(input: string) {
  const result = fluidncDriver.prepareConsoleCommand(input);
  if (!result.ok) throw new Error(`expected ${input} to be prepared: ${result.reason}`);
  return result.command;
}

describe('FluidNC [key]value lines (rolling audit v3 G4-P1-1)', () => {
  it.each([
    ['[13]1', '$13=1'],
    ['[RST]#', '$RST=#'],
    ['[NVX]', '$NVX'],
    ['  [J]G91 X10 F100', '$J=G91 X10 F100'],
    ['[13', '$13'],
    ['[Settings/Restore]*', '$Settings/Restore=*'],
  ])('reads %s as %s', (input, dollar) => {
    expect(fluidncDollarForm(input)).toEqual({ ok: true, line: dollar });
  });

  it('leaves a line that does not start with "[" unchanged', () => {
    expect(fluidncDollarForm('G0 X1 ; [13]1')).toEqual({ ok: true, line: 'G0 X1 ; [13]1' });
  });

  it.each(['[RST]#', '[rst]*', '[RST]$', '[Settings/Restore]*', '[settings/restore]gcode'])(
    'blocks %s like the RST= restore',
    (input) => {
      const result = fluidncDriver.prepareConsoleCommand(input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toMatch(/KerfDesk does not send this command/);
    },
  );

  it.each(['[NVX]', '[nvx]1', '[Settings/Erase]'])('blocks %s like the NVX erase', (input) => {
    const result = fluidncDriver.prepareConsoleCommand(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/\$NVX/);
  });

  it.each(['[13]1', '[Report/Inches]1', '[report/inches]1'])(
    'prepares %s as the 13=1 setting write, with its confirmation and re-read',
    (input) => {
      expect(prepared(input)).toEqual(prepared('$13=1'));
    },
  );

  it('prepares [H] as $H, which drops the homing reference', () => {
    expect(prepared('[H]')).toEqual(prepared('$H'));
    expect(prepared('[H]').stateEffect).toBe('reference');
  });

  it('prepares [J]value as the $J= jog and [CD] as the read-only $CD', () => {
    expect(prepared('[J]G91X10F100')).toEqual(prepared('$J=G91X10F100'));
    expect(prepared('[CD]').stateEffect).toBe('read-only');
  });

  it('refuses a comment in the key, as in its $ form', () => {
    expect(fluidncDriver.prepareConsoleCommand('[13(x)]1').ok).toBe(false);
    expect(fluidncDriver.prepareConsoleCommand('[RST(x)]#').ok).toBe(false);
  });

  it('refuses a key with "=", which names no FluidNC command but would read as one', () => {
    const result = fluidncDriver.prepareConsoleCommand('[J=G91X10F100]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no command name contains "="/);
  });

  it('control: G-code is unchanged', () => {
    expect(prepared('G0 X10').wire).toBe('G0 X10\n');
  });
});

describe('FluidNC report_inches writes (rolling audit v3 G4-P1-1)', () => {
  it.each([
    '$report_inches=true',
    '$Report_Inches=on',
    '$/report_inches=1',
    '$/REPORT_INCHES/=yes',
    '[report_inches]true',
    '[/report_inches]false',
  ])('refuses %s, which switches the position reports to inches', (input) => {
    const result = fluidncDriver.prepareConsoleCommand(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/report_inches switches FluidNC's position reports to inches/);
  });

  it('prepares $report_inches with no value, which only prints it', () => {
    expect(prepared('$report_inches').wire).toBe('$report_inches\n');
    expect(prepared('[report_inches]').wire).toBe('$report_inches\n');
  });

  it('control: the item next to it (MachineConfig.cpp L85) is not refused for its name', () => {
    expect(fluidncDriver.prepareConsoleCommand('$verbose_errors=true').ok).toBe(true);
  });
});
