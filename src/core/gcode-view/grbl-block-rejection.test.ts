import { expect, it } from 'vitest';
import { grblBlockRejection } from './grbl-block-rejection';
import { buildGcodeRenderModel } from './gcode-render-model';

it.each(['G2 X-10 I-5 F600 S0', 'G2 X-10 R-20 F600', 'G90.0001', 'G49.1', 'M7', 'M56 P1'])(
  'does not assert a stock rejection for valid or build-dependent %s',
  (line) => {
    expect(grblBlockRejection(line)).toBeNull();
  },
);

it.each(['G91 Q1', 'G91 T256', 'G91 N10000001', 'G91 M3.1', 'G91 G10 L3', 'G90.999'])(
  'recognizes a statically rejected block %s',
  (line) => {
    expect(grblBlockRejection(line)).not.toBeNull();
  },
);

it('does not apply stock command restrictions to an unspecified controller', () => {
  const result = buildGcodeRenderModel('G91 G123\nG1 X10 F600', {
    initialPositionMm: { x: 100, y: 0, z: 0 },
  });
  expect(result.kind).toBe('ok');
  if (result.kind === 'ok') expect(result.model.stats.motionBounds?.maxX).toBe(110);
});
