import { describe, expect, it } from 'vitest';
import { prepareConsoleCommand } from './console-command';

describe('prepareConsoleCommand', () => {
  it('rejects empty and multiline input', () => {
    expect(prepareConsoleCommand('   ')).toEqual({
      ok: false,
      reason: 'Enter one GRBL or G-code command.',
    });
    expect(prepareConsoleCommand('$$\n$G')).toEqual({
      ok: false,
      reason: 'Console commands and saved macros must contain exactly one line.',
    });
  });

  it('keeps realtime status query as a raw single-byte command', () => {
    expect(prepareConsoleCommand('?')).toEqual({
      ok: true,
      command: {
        kind: 'realtime-status',
        normalized: '?',
        wire: '?',
        requiresIdle: false,
        requiresNoActiveOperation: false,
        requiresConfirmation: false,
        stateEffect: 'read-only',
      },
    });
  });

  it('classifies safe diagnostic quick commands', () => {
    expect(prepareConsoleCommand(' $$ ')).toMatchObject({
      ok: true,
      command: {
        kind: 'settings-query',
        normalized: '$$',
        wire: '$$\n',
        requiresIdle: false,
        requiresNoActiveOperation: true,
        requiresConfirmation: false,
        stateEffect: 'read-only',
      },
    });
    expect(prepareConsoleCommand('$#')).toMatchObject({
      ok: true,
      command: { kind: 'offset-query', wire: '$#\n' },
    });
    expect(prepareConsoleCommand('$I')).toMatchObject({
      ok: true,
      command: { kind: 'build-info-query', wire: '$I\n' },
    });
    expect(prepareConsoleCommand('$G')).toMatchObject({
      ok: true,
      command: { kind: 'modal-state-query', wire: '$G\n' },
    });
  });

  it('allows setting writes only as confirmed idle commands', () => {
    expect(prepareConsoleCommand('$32=1')).toEqual({
      ok: true,
      command: {
        kind: 'setting-write',
        normalized: '$32=1',
        wire: '$32=1\n',
        requiresIdle: true,
        requiresNoActiveOperation: true,
        requiresConfirmation: true,
        stateEffect: 'configuration-nonpositional',
      },
    });
    expect(prepareConsoleCommand('$120 = 250')).toMatchObject({
      ok: true,
      command: {
        kind: 'setting-write',
        normalized: '$120=250',
        wire: '$120=250\n',
        requiresConfirmation: true,
      },
    });
  });

  it('blocks destructive EEPROM reset and startup/build-info writes', () => {
    for (const input of [
      '$RST=*',
      '$RST = *',
      '$RST=$',
      '$RST=#',
      '$N0=G92 X0',
      '$N0 = G92 X0',
      '$I=foo',
      '$I = foo',
    ]) {
      expect(prepareConsoleCommand(input)).toEqual({
        ok: false,
        reason:
          'This persistent controller command is blocked in the Console. Back up settings and use Machine Settings in a later lane.',
      });
    }
  });

  it('normalizes whitespace in read-only dollar queries before classification', () => {
    expect(prepareConsoleCommand('$ $')).toMatchObject({
      ok: true,
      command: { kind: 'settings-query', normalized: '$$', wire: '$$\n' },
    });
    expect(prepareConsoleCommand('$ G')).toMatchObject({
      ok: true,
      command: { kind: 'modal-state-query', normalized: '$G', wire: '$G\n' },
    });
  });

  it('classifies arbitrary one-line G-code as idle-only', () => {
    expect(prepareConsoleCommand('G0 X10 Y10')).toEqual({
      ok: true,
      command: {
        kind: 'gcode',
        normalized: 'G0 X10 Y10',
        wire: 'G0 X10 Y10\n',
        requiresIdle: true,
        requiresNoActiveOperation: true,
        requiresConfirmation: false,
        stateEffect: 'machine-state',
      },
    });
  });

  it('accepts spindle-off and coolant-off together as one guarded block', () => {
    expect(prepareConsoleCommand('M5 M9')).toEqual({
      ok: true,
      command: {
        kind: 'gcode',
        normalized: 'M5 M9',
        wire: 'M5 M9\n',
        requiresIdle: true,
        requiresNoActiveOperation: true,
        requiresConfirmation: false,
        stateEffect: 'accessories',
      },
    });
  });

  it('classifies commands that can invalidate setup evidence', () => {
    const cases = [
      ['$H', 'reference'],
      ['G92 X0 Y0', 'coordinates-xy'],
      ['G92 Z0', 'coordinates-z'],
      ['G92.1', 'coordinates-all'],
      ['G10 L20 P1 X0 Z15', 'coordinates-all'],
      ['G43.1 Z-12.5', 'tool'],
      ['T2 M6', 'tool'],
    ] as const;
    for (const [input, stateEffect] of cases) {
      expect(prepareConsoleCommand(input)).toMatchObject({
        ok: true,
        command: { stateEffect },
      });
    }
  });

  it('keeps axis-calibration writes position-invalidating', () => {
    expect(prepareConsoleCommand('$100=250')).toMatchObject({
      ok: true,
      command: { stateEffect: 'configuration' },
    });
  });
});

// Controller audit 2026-09-23: settings-console-8 (every $RST= form is a
// persistent restore) and settings-console-9 (a value's interior spaces
// survive; grblHAL and FluidNC store them).
describe('persistent restores and $ string values', () => {
  it.each(['$RST=&', '$rst = &', '$RST=*1', '$RST=$$'])('blocks %s', (input) => {
    const prepared = prepareConsoleCommand(input);
    expect(prepared.ok).toBe(false);
  });

  it('keeps the spaces inside a $ setting value and compacts only the key', () => {
    const prepared = prepareConsoleCommand('$ 74 = My Net');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.command.wire).toBe('$74=My Net\n');
    expect(prepared.command.kind).toBe('setting-write');
  });

  it('sends a FluidNC string setting as typed', () => {
    const prepared = prepareConsoleCommand('$Sta/SSID=My Home WiFi');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.command.wire).toBe('$Sta/SSID=My Home WiFi\n');
  });
});

// Controller audit 2026-09-25 GP-3: GRBL-family firmware runs `!`, `~` and `?`
// the moment they arrive, even inside a comment (gnea/grbl serial.c ISR), so a
// line carrying one is never sent as ordinary G-code. GP-4: `$C` is accepted
// in Idle or Check mode and `$H`/`$SLP` in Idle or Alarm (system.c).
describe('realtime characters and state-dependent $ commands', () => {
  it.each(['!', 'M8 (air on!)', 'G0 X10 ; go!', 'G1 X1 ~', 'M5 (done?)', '$J=G91 X1 F100 ?'])(
    'refuses %s instead of queuing a realtime byte inside a line',
    (input) => {
      const prepared = prepareConsoleCommand(input);
      expect(prepared.ok).toBe(false);
      if (!prepared.ok) expect(prepared.reason).toMatch(/acts the moment it arrives/);
    },
  );

  it('sends a lone ~ as the realtime cycle-start byte, with no newline and no owed ack', () => {
    expect(prepareConsoleCommand(' ~ ')).toEqual({
      ok: true,
      command: {
        kind: 'realtime-cycle-start',
        normalized: '~',
        wire: '~',
        requiresIdle: false,
        requiresNoActiveOperation: true,
        requiresConfirmation: false,
        stateEffect: 'read-only',
      },
    });
  });

  it('accepts $C in Idle or Check mode, so the second $C can leave Check mode', () => {
    expect(prepareConsoleCommand('$c')).toMatchObject({
      ok: true,
      command: {
        kind: 'check-mode',
        wire: '$C\n',
        requiresIdle: false,
        allowedStates: ['Idle', 'Check'],
      },
    });
  });

  it.each(['$H', '$HX', '$slp'])('accepts %s in Idle or Alarm, like the firmware', (input) => {
    expect(prepareConsoleCommand(input)).toMatchObject({
      ok: true,
      command: { requiresIdle: false, allowedStates: ['Idle', 'Alarm'] },
    });
  });
});
