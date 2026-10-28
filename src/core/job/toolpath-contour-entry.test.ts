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

  it('previews a custom compiled entry distance exactly', () => {
    const toolpath = buildToolpath(
      { groups: [{ ...baseGroup, entryRunwayMm: 2 }] },
      { startPoint: { x: 0, y: 0 } },
    );

    expect(toolpath.steps.at(0)).toMatchObject({ to: { x: 8, y: 10 } });
    expect(toolpath.steps.at(1)).toMatchObject({ from: { x: 8, y: 10 }, to: { x: 10, y: 10 } });
    expect(toolpath.steps.at(1)?.length).toBeCloseTo(2, 9);
  });
});

describe('toolpath preview with ADR-239 Amendment 2 contour exits', () => {
  it('previews the laser-off feed exit after the cut and continues from its end', () => {
    const toolpath = buildToolpath(
      {
        groups: [
          { ...baseGroup, entryRunwayMm: 5, exitRunwayMm: 5 },
          {
            ...baseGroup,
            layerId: 'next',
            segments: [
              { ...square, polyline: square.polyline.map((p) => ({ x: p.x + 30, y: p.y })) },
            ],
          },
        ],
      },
      { startPoint: { x: 0, y: 0 } },
    );

    const [, , cut, exit, nextSeek] = toolpath.steps;
    expect(cut).toMatchObject({ kind: 'cut' });
    expect(exit).toMatchObject({
      kind: 'travel',
      motion: 'feed',
      from: { x: 10, y: 10 },
      to: { x: 10, y: 5 },
    });
    expect(exit?.length).toBeCloseTo(5, 9);
    expect(nextSeek).toMatchObject({ kind: 'travel', from: { x: 10, y: 5 }, to: { x: 40, y: 10 } });
  });

  it('skips the previewed exit with an unknown bed envelope, as emission does', () => {
    const toolpath = buildToolpath({
      groups: [{ ...baseGroup, entryRunwayMm: 5, exitRunwayMm: 5 }],
      contourEntryBounds: null,
    });

    expect(toolpath.steps.map((step) => step.kind)).toEqual(['cut']);
  });
});
