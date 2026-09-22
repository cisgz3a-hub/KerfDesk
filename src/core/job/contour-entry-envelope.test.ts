import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import { contourEntryPoint } from './contour-entry';
import type { CutGroup, FillGroup, Job } from './job';
import { computeJobMotionBounds } from './job-bounds';
import { applyJobOrigin } from './job-origin';
import { applyRotaryYScale } from './rotary-transform';
import { buildToolpath } from './toolpath';

const ENVELOPE = { minX: -200, minY: -200, maxX: 200, maxY: 200 };
const group: CutGroup = {
  kind: 'cut',
  layerId: 'line',
  color: '#ff0000',
  power: 30,
  speed: 1500,
  passes: 1,
  airAssist: false,
  entryRunwayMm: 5,
  segments: [
    {
      closed: false,
      polyline: [
        { x: 198, y: 30 },
        { x: 188, y: 30 },
      ],
    },
  ],
};

describe('contour-entry envelope boundaries', () => {
  it('clips at a centred bound instead of a positive-bed maximum', () => {
    expect(contourEntryPoint(group.segments[0]?.polyline ?? [], 5, ENVELOPE)).toEqual({
      x: 200,
      y: 30,
    });
  });
  it('clips diagonals at the first reached side', () => {
    expect(
      contourEntryPoint(
        [
          { x: -199, y: -198 },
          { x: -196, y: -194 },
        ],
        5,
        ENVELOPE,
      ),
    ).toEqual({ x: -200, y: -199.33333333333334 });
  });
  it.each([
    [
      { x: 201, y: 30 },
      { x: 202, y: 30 },
    ],
    [
      { x: -201, y: 30 },
      { x: -202, y: 30 },
    ],
    [
      { x: 30, y: 201 },
      { x: 30, y: 202 },
    ],
    [
      { x: 30, y: -201 },
      { x: 30, y: -202 },
    ],
    [
      { x: 30, y: 201 },
      { x: 40, y: 201 },
    ],
  ])('omits entry for an already outside start, even if backing toward the bed: %j', (a, b) => {
    expect(contourEntryPoint([a, b], 5, ENVELOPE)).toBeNull();
  });
  it('does not add a runway when the explicit physical envelope is unknown', () => {
    expect(contourEntryPoint(group.segments[0]?.polyline ?? [], 5, null)).toBeNull();
  });
  it('keeps archived jobs without metadata on their original positive-bed clamp', () => {
    const device = { ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, origin: 'center' as const };
    const archived: Job = { groups: [group] };
    expect(grblStrategy.emit(archived, device)).toContain('X203.000 Y30.000 F800 S0');
    expect(computeJobMotionBounds(archived, device)?.maxX).toBe(203);
  });
  it('uses explicit bounds for each Follow Shape loop and pass', () => {
    const fill: FillGroup = {
      ...group,
      kind: 'fill',
      fillStyle: 'offset',
      overscanMm: 5,
      passes: 2,
      segments: group.segments.map((segment) => ({ ...segment, reverse: false })),
    };
    const job: Job = { groups: [fill], contourEntryBounds: ENVELOPE };
    const text = grblStrategy.emit(job, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    expect(text.match(/X200\.000 Y30\.000 F800 S0/g)).toHaveLength(2);
    expect(computeJobMotionBounds(job)?.maxX).toBe(200);
    expect(buildToolpath(job, { startPoint: { x: 0, y: 0 } }).steps.at(0)).toMatchObject({
      to: { x: 200, y: 30 },
    });
  });
  it('invalidates placement evidence even when the selected anchor is already work zero', () => {
    const centered = {
      ...group,
      segments: [
        {
          closed: false,
          polyline: [
            { x: -5, y: 0 },
            { x: 5, y: 0 },
          ],
        },
      ],
    };
    const job = { groups: [centered], contourEntryBounds: ENVELOPE };
    expect(
      applyJobOrigin(job, { startFrom: 'user-origin', anchor: 'center' }).contourEntryBounds,
    ).toBeNull();
  });
  it.each([false, true])(
    'rotary scaling/rebasing transforms explicit envelope Y, reverse=%s',
    (reverse) => {
      const job: Job = { groups: [group], contourEntryBounds: ENVELOPE };
      const rotary = applyRotaryYScale(job, 2, reverse);
      expect(rotary.contourEntryBounds).toEqual({
        minX: -200,
        maxX: 200,
        minY: reverse ? -340 : -460,
        maxY: reverse ? 460 : 340,
      });
      const unknown = applyRotaryYScale({ ...job, contourEntryBounds: null }, 2, reverse);
      expect(unknown.contourEntryBounds).toBeNull();
      expect(applyRotaryYScale({ groups: [group] }, 2, reverse).contourEntryBounds).toBeUndefined();
    },
  );
});
