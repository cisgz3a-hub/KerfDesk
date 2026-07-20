import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { findLaserOnTravelIssues, findLongBlankFeedMoves } from '../invariants';
import type { FillGroup, Job } from '../job';
import { grblStrategy } from './grbl-strategy';

const enlargedJFillGroup: FillGroup = {
  kind: 'fill',
  layerId: 'script-name',
  color: '#000000',
  power: 30,
  speed: 1500,
  passes: 1,
  airAssist: false,
  fillRunwayPolicy: 'feed-matched-entry',
  overscanMm: 5,
  segments: [
    {
      polyline: [
        { x: 6.551, y: 43 },
        { x: 7.015, y: 43 },
      ],
      closed: false,
      reverse: false,
    },
    {
      polyline: [
        { x: 16.62, y: 43 },
        { x: 18.108, y: 43 },
      ],
      closed: false,
      reverse: false,
    },
    {
      polyline: [
        { x: 18.693, y: 43 },
        { x: 18.972, y: 43 },
      ],
      closed: false,
      reverse: false,
    },
  ],
};

describe('4040 split-fill controlled entry emission', () => {
  it('gives the enlarged J fragment a feed-matched 5 mm entry after a controlled seek', () => {
    const out = grblStrategy.emit(
      { groups: [enlargedJFillGroup] },
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    );

    expect(out).toContain(
      [
        'G1 X7.015 Y43.000 F1500 S300',
        'G1 X11.620 Y43.000 F800 S0 ; kerfdesk:laser-off-motion',
        'G1 X16.620 Y43.000 F1500 S0 ; kerfdesk:laser-off-motion',
        'G1 X18.108 Y43.000 F1500 S300',
      ].join('\n'),
    );
    expect(out).not.toContain('G0 ');
    expect(findLaserOnTravelIssues(out)).toEqual([]);
    expect(findLongBlankFeedMoves(out, { thresholdMm: 5 })).toEqual([
      expect.objectContaining({
        line: 'G1 X1.551 Y43.000 F800 S0 ; kerfdesk:laser-off-motion',
      }),
    ]);
  });

  it('gives both enlarged C gaps monotonic 5 mm feed entries without overlap', () => {
    const cJob: Job = {
      groups: [
        {
          ...enlargedJFillGroup,
          segments: [
            {
              polyline: [
                { x: 0, y: 46 },
                { x: 1.275, y: 46 },
              ],
              closed: false,
              reverse: false,
            },
            {
              polyline: [
                { x: 7.958, y: 46 },
                { x: 10.434, y: 46 },
              ],
              closed: false,
              reverse: false,
            },
            {
              polyline: [
                { x: 17.482, y: 46 },
                { x: 19.197, y: 46 },
              ],
              closed: false,
              reverse: false,
            },
          ],
        },
      ],
    };
    const out = grblStrategy.emit(cJob, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);

    expect(out).toContain(
      'G1 X2.958 Y46.000 F800 S0 ; kerfdesk:laser-off-motion\n' +
        'G1 X7.958 Y46.000 F1500 S0 ; kerfdesk:laser-off-motion',
    );
    expect(out).toContain(
      'G1 X12.482 Y46.000 F800 S0 ; kerfdesk:laser-off-motion\n' +
        'G1 X17.482 Y46.000 F1500 S0 ; kerfdesk:laser-off-motion',
    );
    expect(out).not.toContain('G0 ');
  });
});
