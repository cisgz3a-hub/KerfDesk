import { describe, expect, it } from 'vitest';
import { PROGRAM_PARSE_REASON } from '../gcode';
import { iterateLines } from '../util';
import { buildGcodeRenderModel } from './gcode-render-model';
import { createGcodeRenderModelBuilder } from './gcode-render-model-builder';

function reasonFor(text: string): string {
  const builder = createGcodeRenderModelBuilder();
  for (const line of iterateLines(text)) builder.pushLine(line);
  const result = builder.finish();
  return result.kind === 'error' ? result.reason : 'unexpectedly parsed';
}

describe('createGcodeRenderModelBuilder', () => {
  it('matches the whole-text compatibility wrapper line for line', () => {
    const text = ['G21 G90', 'G0 X2 Y3', 'G1 X8 Y3 F200', 'G2 X10 Y5 I0 J2', 'M2', ''].join('\r\n');
    const builder = createGcodeRenderModelBuilder({ renderPressureThreshold: 2 });

    for (const line of iterateLines(text)) builder.pushLine(line);

    expect(builder.finish()).toEqual(buildGcodeRenderModel(text, { renderPressureThreshold: 2 }));
  });

  // A comment-only program is well-formed G-code that commands nothing — the
  // exact shape an all-open-path V-carve layer emits (provenance header, empty
  // body). Reporting that as "not G-code" sent the operator hunting for a parse
  // fault that does not exist.
  it('separates a program with no motion from input that is not G-code at all', () => {
    expect(reasonFor('; KerfDesk\n; version: 0.1.0\n')).toBe(PROGRAM_PARSE_REASON.noMotion);
    expect(reasonFor('hello world\nthis is prose\n')).toBe(PROGRAM_PARSE_REASON.notGcode);
  });
});
