import { describe, expect, it } from 'vitest';
import { iterateLines } from '../util';
import { buildGcodeRenderModel } from './gcode-render-model';
import { createGcodeRenderModelBuilder } from './gcode-render-model-builder';

describe('createGcodeRenderModelBuilder', () => {
  it('matches the whole-text compatibility wrapper line for line', () => {
    const text = ['G21 G90', 'G0 X2 Y3', 'G1 X8 Y3 F200', 'G2 X10 Y5 I0 J2', 'M2', ''].join('\r\n');
    const builder = createGcodeRenderModelBuilder({ renderPressureThreshold: 2 });

    for (const line of iterateLines(text)) builder.pushLine(line);

    expect(builder.finish()).toEqual(buildGcodeRenderModel(text, { renderPressureThreshold: 2 }));
  });
});
