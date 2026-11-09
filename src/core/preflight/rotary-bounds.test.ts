import { describe, expect, it } from 'vitest';
import { rotaryWrapIssue } from './rotary-bounds';

// Rolling audit v12 X8-P3-1: a 270 mm design on an Ø80 glass in the Creality
// chuck (40 machine mm per turn, k = 40 / (π · 80)) was reported as
// "spans 42.972 mm in Y … (40.000 mm)", numbers that appear nowhere in the
// operator's design or in Rotary Setup.

const K = 40 / (Math.PI * 80);

function program(spanMm: number): string {
  return ['G90', 'G0 X0 Y0 S0', `G1 X0 Y${spanMm.toFixed(3)} F238 S500`].join('\n');
}

describe('rotaryWrapIssue', () => {
  it('names the wrap in surface mm and turns when the rotary is known', () => {
    const message = rotaryWrapIssue(program(270 * K), 40, { yScale: K, objectDiameterMm: 80 });
    expect(message).toBe(
      'The artwork wraps 270.0 mm round the part (1.07 turns), more than one turn of the ' +
        'Ø80 mm object (251.3 mm), so it would burn over its own start. Scale the artwork ' +
        'down or check the rotary setup.',
    );
    expect(message).not.toContain('42.97');
  });

  it('names a pen the design does not fit in its own millimetres (refuter example)', () => {
    // A 40 mm design on a Ø10 pen in the same chuck was "spans 50.930 mm … (40.000 mm)".
    const pen = 40 / (Math.PI * 10);
    expect(rotaryWrapIssue(program(40 * pen), 40, { yScale: pen, objectDiameterMm: 10 })).toMatch(
      /^The artwork wraps 40\.0 mm round the part \(1\.27 turns\), more than one turn of the Ø10 mm object \(31\.4 mm\)/,
    );
  });

  it('is silent within one turn', () => {
    expect(rotaryWrapIssue(program(250 * K), 40, { yScale: K, objectDiameterMm: 80 })).toBeNull();
  });

  it('keeps the machine wording when only the limit is known', () => {
    expect(rotaryWrapIssue(program(42.972), 40)).toMatch(/^Rotary job motion spans 42\.972 mm/);
  });
});
