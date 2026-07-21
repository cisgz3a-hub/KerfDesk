import { describe, expect, it } from 'vitest';
import type { CutGroup } from './job';
import { buildToolpath } from './toolpath';

const square = {
  polyline: [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
    { x: 10, y: 20 },
    { x: 10, y: 10 },
  ],
  closed: true,
};

const baseGroup: CutGroup = {
  kind: 'cut',
  layerId: 'outline',
  color: '#000000',
  power: 30,
  speed: 1500,
  passes: 1,
  airAssist: false,
  segments: [square],
};

describe('toolpath preview with ADR-239 contour entries', () => {
  it('previews rapid-to-entry then a laser-off feed ramp into the first vertex', () => {
    const toolpath = buildToolpath(
      { groups: [{ ...baseGroup, entryRunwayMm: 5 }] },
      { startPoint: { x: 0, y: 0 } },
    );

    const [seek, entry, cut] = toolpath.steps;
    expect(seek).toMatchObject({ kind: 'travel', motion: 'rapid', to: { x: 5, y: 10 } });
    expect(entry).toMatchObject({
      kind: 'travel',
      motion: 'feed',
      from: { x: 5, y: 10 },
      to: { x: 10, y: 10 },
    });
    expect(entry?.length).toBeCloseTo(5, 9);
    expect(cut).toMatchObject({ kind: 'cut' });
  });

  it('keeps the legacy direct travel without an entry runway', () => {
    const toolpath = buildToolpath({ groups: [baseGroup] }, { startPoint: { x: 0, y: 0 } });

    const [seek, cut] = toolpath.steps;
    expect(seek).toMatchObject({ kind: 'travel', to: { x: 10, y: 10 } });
    expect(seek !== undefined && 'motion' in seek ? seek.motion : undefined).toBeUndefined();
    expect(cut).toMatchObject({ kind: 'cut' });
  });
});
