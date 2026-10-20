import { describe, expect, it } from 'vitest';
import { jogStepOptions } from './JogSettingsRow';

describe('jog step choices (ADR-629)', () => {
  it('offers millimetre steps in millimetres', () => {
    expect(jogStepOptions('mm', 1)).toEqual([0.1, 0.5, 1, 2, 5, 10, 25, 50, 100]);
  });

  it('offers inch steps, stored as the millimetres they move', () => {
    const options = jogStepOptions('in', 25.4);
    expect(options[0]).toBeCloseTo(0.0254, 12);
    expect(options).toContain(25.4);
    expect(options.at(-1)).toBeCloseTo(101.6, 12);
  });

  it('keeps the current step listed when it is not one of the unit choices', () => {
    expect(jogStepOptions('in', 10)).toContain(10);
    expect(jogStepOptions('mm', 0.0254)).toContain(0.0254);
  });
});
