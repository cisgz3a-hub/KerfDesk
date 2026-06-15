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
      },
    });
  });

  it('blocks destructive EEPROM reset and startup/build-info writes', () => {
    for (const input of ['$RST=*', '$RST=$', '$RST=#', '$N0=G92 X0', '$I=foo']) {
      expect(prepareConsoleCommand(input)).toEqual({
        ok: false,
        reason:
          'This persistent controller command is blocked in the Console. Back up settings and use Machine Settings in a later lane.',
      });
    }
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
      },
    });
  });
});
