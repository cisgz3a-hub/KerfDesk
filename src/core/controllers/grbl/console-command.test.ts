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
      reason: 'Console commands must be one line. Use macros later for multi-line commands.',
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
