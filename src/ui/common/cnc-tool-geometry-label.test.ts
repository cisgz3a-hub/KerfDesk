import { describe, expect, it } from 'vitest';
import type { CncTool } from '../../core/scene';
import { cncToolGeometryLabel } from './cnc-tool-geometry-label';

const ENGRAVER: CncTool = {
  id: 'engraver',
  name: 'engraver',
  kind: 'engraving',
  diameterMm: 3.175,
  tipAngleDeg: 30,
};

describe('cncToolGeometryLabel', () => {
  it('distinguishes a flat-tip engraver from a pointed engraver canonically', () => {
    expect(cncToolGeometryLabel({ ...ENGRAVER, tipDiameterMm: 0.2 })).toBe(
      '3.175 mm, 30° Engraving bit, 0.2 mm tip flat',
    );
    expect(cncToolGeometryLabel(ENGRAVER)).toBe('3.175 mm, 30° Engraving bit, pointed tip');
    expect(cncToolGeometryLabel({ ...ENGRAVER, tipDiameterMm: 0 })).toBe(
      '3.175 mm, 30° Engraving bit, pointed tip',
    );
  });

  it('keeps a V-bit pointed even if malformed runtime data carries a tip diameter', () => {
    expect(
      cncToolGeometryLabel({
        ...ENGRAVER,
        id: 'v-bit',
        kind: 'v-bit',
        diameterMm: 6,
        tipAngleDeg: 60,
        tipDiameterMm: 0.2,
      }),
    ).toBe('6 mm, 60° V-bit');
  });

  it('labels a tapered ball nose by its tip and per-side taper, as sellers list it', () => {
    const taperedBall: CncTool = {
      id: 'tbn',
      name: 'tbn',
      kind: 'tapered-ball-nose',
      diameterMm: 6.25,
      tipAngleDeg: 10.8,
      tipDiameterMm: 1.5875,
    };
    expect(cncToolGeometryLabel(taperedBall)).toBe(
      '6.25 mm, 1.5875 mm tip, 5.4° per side, Tapered ball nose',
    );
    const { tipDiameterMm: _tip, ...noTip } = taperedBall;
    expect(cncToolGeometryLabel(noTip)).toBe(
      '6.25 mm, tip diameter missing, 5.4° per side, Tapered ball nose',
    );
    expect(cncToolGeometryLabel({ ...taperedBall, tipDiameterMm: 7, tipAngleDeg: 0 })).toBe(
      '6.25 mm, invalid tip diameter, taper angle missing, Tapered ball nose',
    );
  });
});
