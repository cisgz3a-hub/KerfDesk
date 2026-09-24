import { describe, expect, it } from 'vitest';
import { WireEncodingError, wireEncodingError } from './serial-wire-encoding';

describe('what the serial wire can carry', () => {
  it('accepts ASCII lines and the single realtime bytes GRBL defines', () => {
    // Soft reset 0x18, jog cancel 0x85, feed override 0x91 (GRBL v1.1
    // realtime commands): each is exactly one byte on the wire.
    expect(wireEncodingError('G1 X10 F600\n')).toBeNull();
    expect(wireEncodingError('\x18')).toBeNull();
    expect(wireEncodingError('\x85')).toBeNull();
    expect(wireEncodingError('\x91')).toBeNull();
  });

  it('refuses a character with no single byte, naming it for the operator', () => {
    const refusal = wireEncodingError('G4 P0 (dwell — none)');

    expect(refusal).toBeInstanceOf(WireEncodingError);
    expect(refusal?.codePoint).toBe(0x2014);
    expect(refusal?.message).toMatch(/^Not sent: .*"—" \(U\+2014\).*plain ASCII/);
  });

  // GRBL and grblHAL take every received byte above 0x7F as a realtime command
  // before parsing the line (gnea/grbl serial.c): 0xA0 toggles flood coolant,
  // 0xA1 mist. Inside a queued line such a byte switches an accessory instead
  // of being read as text (audit transport-2).
  it('refuses a byte above 0x7F inside a queued line, where GRBL would run it as a realtime command', () => {
    const nbsp = wireEncodingError('G0\xA0X1\n');
    expect(nbsp?.codePoint).toBe(0xa0);
    expect(nbsp?.message).toMatch(/realtime command/);

    const degree = wireEncodingError('G0 X1 (45° corner)\n');
    expect(degree?.codePoint).toBe(0xb0);
    expect(degree?.message).toContain('"°" (U+00B0)');
  });

  it('still allows the same byte on its own as a realtime command', () => {
    expect(wireEncodingError('\xA0')).toBeNull();
    expect(wireEncodingError('\x9E')).toBeNull();
  });

  it('names a character outside the Basic Multilingual Plane whole, not half a surrogate pair', () => {
    const refusal = wireEncodingError('G0 X1 (🔥)');

    expect(refusal?.codePoint).toBe(0x1f525);
    expect(refusal?.message).toContain('"🔥" (U+1F525)');
  });
});
