import { describe, expect, it } from 'vitest';
import { buildRelativeJogCommand } from './relative-jog-commands';

// Oracle audit O8-P3-2: the Marlin/Smoothieware jog builder wrote
// `G0 XNaN F1000` and `X1e+21`; neither is a G-code number (RS274/NGC
// §3.3.2.1). The GRBL builder already refused them.
describe('buildRelativeJogCommand number guard', () => {
  it.each([
    [{ dx: Number.NaN, feed: 1000 }],
    [{ dy: Number.POSITIVE_INFINITY, feed: 1000 }],
    [{ dz: Number.NEGATIVE_INFINITY, feed: 1000 }],
    [{ dx: 5, feed: Number.NaN }],
  ])('refuses a non-finite word %j', (params) => {
    expect(() => buildRelativeJogCommand(params)).toThrow(/must be finite/);
  });

  it('still writes an ordinary jog', () => {
    expect(buildRelativeJogCommand({ dx: 1.5, dy: -0.25, feed: 1200 })).toBe(
      'G21\nG91\nG0 X1.500 Y-0.250 F1200\nG90',
    );
  });
});
