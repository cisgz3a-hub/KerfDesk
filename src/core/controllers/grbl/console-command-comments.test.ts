// Meta audit v1 M6-P2-1 (ADR-375 Amendment 6): GRBL's line reader drops
// `( … )` and `;` comments and the block-delete '/' before it looks for a `$`
// command (gnea/grbl protocol.c L78-L149), and grblHAL reads a setting number
// with read_float and never checks what follows it (system.c L1155-L1212). A
// comment or '/' in or before a `$` command therefore ran it as G-code, past
// the persistent-command block, the confirmation, the value check and the `$$`
// re-read. Every GRBL-family Console refuses such a line.
import { describe, expect, it } from 'vitest';
import type { ControllerDriver } from '../controller-driver';
import { fluidncDriver } from '../fluidnc/driver';
import { grblHalDriver } from '../grblhal/driver';
import { grblDriver } from './driver';
import { grblLineReaderView } from './grbl-line-reader';

const BLOCKED_PERSISTENT_REASON =
  'KerfDesk does not send this command. It erases or rewrites settings stored on the controller (a factory restore, a startup line or the build info), so the Console refuses it. To run it you need another sender.';

const DRIVERS: ReadonlyArray<readonly [string, ControllerDriver]> = [
  ['GRBL', grblDriver],
  ['grblHAL', grblHalDriver],
  ['FluidNC', fluidncDriver],
];

describe('grblLineReaderView', () => {
  it.each([
    ['(x)$30=255', '$30=255'],
    ['$30(x)=255', '$30=255'],
    ['$3/0 = 255 ; max power', '$30=255'],
    ['$n(x)0=g0 x100', '$N0=G0X100'],
    ['(unclosed $30=255', ''],
    ['$30=255)', '$30=255)'],
  ])('reads %j as GRBL does: %j', (line, view) => {
    expect(grblLineReaderView(line)).toBe(view);
  });
});

describe.each(DRIVERS)('%s Console lines with comments or "/" in a $ command', (_label, driver) => {
  it.each([
    '(x)$30=255',
    '$30(x)=255',
    '$22(x)=0.5',
    '/$30=255',
    '$3/0=255',
    '$30;x=255',
    '$30)=255',
    '$(x)30=255',
    '(x)$H',
    '$H(x)',
    '$X;',
    '(x)$J=G91 X10 F1000',
  ])('refuses %j before it reaches the controller', (input) => {
    expect(driver.prepareConsoleCommand(input).ok).toBe(false);
  });

  it.each([
    '$RST(x)=*',
    '$RS(x)T=*',
    '(x)$RST=*',
    '/$RST=#',
    '$N(x)0=G0X100',
    '$N0(x)=G0X100',
    '$I(x)=x',
  ])('blocks %j as the persistent command GRBL would run', (input) => {
    expect(driver.prepareConsoleCommand(input)).toEqual({
      ok: false,
      reason: BLOCKED_PERSISTENT_REASON,
    });
  });

  it('names the command GRBL would run instead', () => {
    const prepared = driver.prepareConsoleCommand('(x)$30=255');
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.reason).toContain('can run as $30=255');
  });

  it.each(['G0 X10 (move)', '(note) G0 X10', '/G0 X10', '(just a note)', 'G0 X10 ; move'])(
    'still sends %j, a G-code line with a comment, as G-code',
    (input) => {
      expect(driver.prepareConsoleCommand(input)).toMatchObject({
        ok: true,
        command: { kind: 'gcode', wire: `${input}\n` },
      });
    },
  );

  it('keeps plain $ commands as they were', () => {
    expect(driver.prepareConsoleCommand('$$')).toMatchObject({
      ok: true,
      command: { kind: 'settings-query' },
    });
    expect(driver.prepareConsoleCommand('$J=G91 X10 F1000')).toMatchObject({
      ok: true,
      command: { kind: 'gcode' },
    });
  });
});

// Stock GRBL stores `$30.0=` and `$+30=` as `$30=` (read_float, then a cast;
// system.c L252-L271) and keeps trunc() of a startup line's number
// (system.c L237-L266); grblHAL takes any key that starts with a number.
describe.each(DRIVERS)('%s Console setting numbers that are not plain digits', (_label, driver) => {
  it.each(['$30.0=255', '$+30=255', '$030.5=255', '$.5=1', '$0x1E=255', '$(x)30.0=255'])(
    'refuses %j',
    (input) => {
      const prepared = driver.prepareConsoleCommand(input);
      expect(prepared.ok).toBe(false);
      if (prepared.ok) return;
      expect(prepared.reason).toMatch(/plain setting number|without the checks/);
    },
  );

  it.each(['$N+0=G0X100', '$N0.5=G0X100', '$N.9=G0X100', '$N=G0X100'])(
    'blocks the startup-line store %j',
    (input) => {
      expect(driver.prepareConsoleCommand(input)).toEqual({
        ok: false,
        reason: BLOCKED_PERSISTENT_REASON,
      });
    },
  );
});

describe('setting writes the firmware reads as typed', () => {
  it('keeps a stock-GRBL comment after the value a confirmed setting write', () => {
    // The value check and the re-read already read the value as GRBL does
    // (console-setting-writes.ts), so the write keeps every safeguard.
    expect(grblDriver.prepareConsoleCommand('$30=255 (max power)')).toMatchObject({
      ok: true,
      command: { kind: 'setting-write', requiresConfirmation: true },
    });
  });

  it.each([
    '$Sta/SSID=My Home WiFi',
    '$/axes/x/max_rate_mm_per_min=5000',
    '$Notification/Type=None',
  ])('sends the FluidNC setting %j as typed', (input) => {
    expect(fluidncDriver.prepareConsoleCommand(input)).toMatchObject({
      ok: true,
      command: { wire: `${input}\n` },
    });
  });
});
