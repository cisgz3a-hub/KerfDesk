import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CutGroup, CutSegment } from '../job';
import { withCutArcMoves } from '../job/cut-arc-moves';
import { grblStrategy } from './grbl-strategy';
function emit(segments: ReadonlyArray<CutSegment>, extra: Partial<CutGroup> = {}) {
  const group: CutGroup = {
    kind: 'cut',
    layerId: 'focus',
    color: '#000000',
    power: 10,
    speed: 1200,
    passes: 1,
    airAssist: false,
    focusTest: { offsetMm: 1, travelFeedMmPerMin: 300 },
    segments,
    ...extra,
  };
  return grblStrategy.emit(
    { groups: [group] },
    { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' },
  );
}
describe('Focus only wraps represented burn motion', () => {
  it('does not confuse separation between collapsed contours with a burn', () => {
    const segments = [0, 20].map((x) => ({
      closed: false,
      polyline: [
        { x, y: 0 },
        { x: x + 0.0001, y: 0 },
      ],
    }));
    expect(emit(segments)).not.toContain('G1 Z');
    expect(emit(segments)).not.toContain('Focus Test Z offset');
  });
  it('retains a closed contour whose final endpoint equals its start, including overcut passes', () => {
    const segment = {
      closed: true,
      polyline: [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
        { x: 10, y: 10 },
      ],
    };
    const result = emit([segment], { passes: 3, finalPassOvercutMm: 2 });
    expect(result.match(/; pass /g) ?? []).toHaveLength(3);
    expect(result).toContain('G1 X12.000 Y10.000');
    expect(result.match(/G1 Z/g) ?? []).toHaveLength(2);
  });
  it('retains actual fitted arc burns', () => {
    const segment = withCutArcMoves(
      {
        closed: false,
        polyline: [
          { x: 10, y: 20 },
          { x: 12.929, y: 27.071 },
          { x: 20, y: 30 },
        ],
      },
      [{ kind: 'arc', to: { x: 20, y: 30 }, center: { x: 20, y: 20 }, clockwise: true }],
    );
    const result = emit([segment]);
    expect(result).toContain('G2 X20.000 Y30.000');
    expect(result.match(/G1 Z/g) ?? []).toHaveLength(2);
  });
});
