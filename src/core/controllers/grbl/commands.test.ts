import { describe, expect, it } from 'vitest';
import {
  buildJogCommand,
  CMD_CLEAR_PERSISTENT_ORIGIN,
  CMD_HOME,
  CMD_SET_PERSISTENT_ORIGIN_HERE,
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

  it('uses explicit G10 commands for advanced persistent G54 origin', () => {
    expect(CMD_SET_PERSISTENT_ORIGIN_HERE).toBe('G10 L20 P1 X0 Y0');
    expect(CMD_CLEAR_PERSISTENT_ORIGIN).toBe('G10 L2 P1 X0 Y0');
  });
});

describe('buildJogCommand', () => {
  it('emits a relative-mode jog with mm units by default', () => {
    expect(buildJogCommand({ dx: 10, dy: 0, feed: 1500 })).toBe('$J=G91 G21 X10.000 F1500');
  });

  it('includes both axes when both are non-zero', () => {
    expect(buildJogCommand({ dx: 5, dy: -3, feed: 1000 })).toBe('$J=G91 G21 X5.000 Y-3.000 F1000');
  });

  it('includes Z when a powered focus axis is jogged', () => {
    expect(buildJogCommand({ dz: 1, feed: 300 })).toBe('$J=G91 G21 Z1.000 F300');
    expect(buildJogCommand({ dz: -0.5, feed: 300 })).toBe('$J=G91 G21 Z-0.500 F300');
  });

  it('emits absolute-mode when relative: false', () => {
    expect(buildJogCommand({ dx: 100, feed: 1500, relative: false })).toBe(
      '$J=G90 G21 X100.000 F1500',
    );
  });

  it('keeps zero-valued axis words in absolute mode (X0 is a real destination)', () => {
    // Dropping X0/Y0 in G90 silently keeps the previous coordinate — an
    // absolute move to a bed edge would land the head at the wrong place
    // (the click-to-position path moves to arbitrary bed points).
    expect(buildJogCommand({ dx: 0, dy: 50, feed: 1500, relative: false })).toBe(
      '$J=G90 G21 X0.000 Y50.000 F1500',
    );
    expect(buildJogCommand({ dx: 12, dy: 0, feed: 1500, relative: false })).toBe(
      '$J=G90 G21 X12.000 Y0.000 F1500',
    );
    // Relative jogs still drop zero deltas (a zero delta is "don't move").
    expect(buildJogCommand({ dx: 0, dy: 5, feed: 1500 })).toBe('$J=G91 G21 Y5.000 F1500');
  });

  it('clamps and rounds the feed to an integer ≥ 1', () => {
    expect(buildJogCommand({ dx: 1, feed: 0 })).toContain('F1');
    expect(buildJogCommand({ dx: 1, feed: 1234.7 })).toContain('F1235');
  });

  it('formats axes to 3 decimal places', () => {
    expect(buildJogCommand({ dx: 0.1234, feed: 1500 })).toContain('X0.123');
  });

  it('rejects non-finite axes and feed before producing firmware text', () => {
    expect(() => buildJogCommand({ dx: Number.NaN, feed: 1500 })).toThrow(/dx must be finite/);
    expect(() => buildJogCommand({ dy: Number.POSITIVE_INFINITY, feed: 1500 })).toThrow(
      /dy must be finite/,
    );
    expect(() => buildJogCommand({ dz: Number.NEGATIVE_INFINITY, feed: 1500 })).toThrow(
      /dz must be finite/,
    );
    expect(() => buildJogCommand({ dx: 1, feed: Number.NaN })).toThrow(/feed must be finite/);
  });

  // Audit F11: an all-zero jog produced `$J=G91 G21 F…` with no axis word —
  // GRBL rejects it with error:16 on the wire. Fail loudly at the caller.
  it('rejects a jog with no nonzero axis distance', () => {
    expect(() => buildJogCommand({ feed: 1500 })).toThrow(/nonzero/);
    expect(() => buildJogCommand({ dx: 0, dy: 0, feed: 1500 })).toThrow(/nonzero/);
  });
});
