import { describe, expect, it } from 'vitest';
import {
  buildJogCommand,
  CMD_HOME,
  CMD_UNLOCK,
  RT_HOLD,
  RT_JOG_CANCEL,
  RT_RESUME,
  RT_SOFT_RESET,
  RT_STATUS,
} from './commands';

describe('GRBL real-time command bytes', () => {
  it('uses the documented single-byte forms', () => {
    expect(RT_STATUS).toBe('?');
    expect(RT_RESUME).toBe('~');
    expect(RT_HOLD).toBe('!');
    expect(RT_SOFT_RESET).toBe('\x18');
    expect(RT_JOG_CANCEL).toBe('\x85');
  });
});

describe('GRBL line commands', () => {
  it('uses the documented $-prefixed forms', () => {
    expect(CMD_HOME).toBe('$H');
    expect(CMD_UNLOCK).toBe('$X');
  });
});

describe('buildJogCommand', () => {
  it('emits a relative-mode jog with mm units by default', () => {
    expect(buildJogCommand({ dx: 10, dy: 0, feed: 1500 })).toBe('$J=G91 G21 X10.000 F1500');
  });

  it('includes both axes when both are non-zero', () => {
    expect(buildJogCommand({ dx: 5, dy: -3, feed: 1000 })).toBe('$J=G91 G21 X5.000 Y-3.000 F1000');
  });

  it('emits absolute-mode when relative: false', () => {
    expect(buildJogCommand({ dx: 100, feed: 1500, relative: false })).toBe(
      '$J=G90 G21 X100.000 F1500',
    );
  });

  it('clamps and rounds the feed to an integer ≥ 1', () => {
    expect(buildJogCommand({ dx: 1, feed: 0 })).toContain('F1');
    expect(buildJogCommand({ dx: 1, feed: 1234.7 })).toContain('F1235');
  });

  it('formats axes to 3 decimal places', () => {
    expect(buildJogCommand({ dx: 0.1234, feed: 1500 })).toContain('X0.123');
  });
});
