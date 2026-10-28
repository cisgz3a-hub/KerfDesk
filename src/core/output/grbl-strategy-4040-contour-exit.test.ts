import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { findLaserOnTravelIssues } from '../invariants';
import type { CutGroup, FillGroup } from '../job';
import { grblStrategy } from './grbl-strategy';

// ADR-239 Amendment 2 (quality audit Q6-P2-1): a constant-power (M3) contour
// on the 4040-safe profile leaves its last burn point by a laser-off exit
// along its last edge, so the head decelerates dark instead of on the ink.

const device = NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE;

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

const lineGroup: CutGroup = {
  kind: 'cut',
  layerId: 'outline',
  color: '#000000',
  power: 30,
  speed: 1500,
  passes: 1,
  airAssist: false,
  entryRunwayMm: 5,
  exitRunwayMm: 5,
  segments: [square],
};

const exitLine = (x: string, y: string): string =>
  `G1 X${x} Y${y} F1500 S0 ; kerfdesk:laser-off-motion`;

describe('4040 contour exit emission (ADR-239 Amendment 2)', () => {
  it('ends a closed Line contour with a laser-off exit along its closing edge', () => {
    const out = grblStrategy.emit({ groups: [lineGroup] }, device);

    expect(out).toContain(
      [
        'G1 X10.000 Y20.000 F1500 S300',
        'G1 X10.000 Y10.000 F1500 S300',
        exitLine('10.000', '5.000'),
      ].join('\n'),
    );
    expect(out).toContain('contour-exit 5.000 mm effective laser-off feed');
    expect(findLaserOnTravelIssues(out)).toEqual([]);
  });

  it('ends an open path along its last edge', () => {
    const open: CutGroup = {
      ...lineGroup,
      segments: [{ polyline: square.polyline.slice(0, 3), closed: false }],
    };
    const out = grblStrategy.emit({ groups: [open] }, device);

    expect(out).toContain(
      ['G1 X20.000 Y20.000 F1500 S300', exitLine('20.000', '25.000')].join('\n'),
    );
  });

  it('switches the laser off at the job end after the dark exit, not on the lit burn', () => {
    const out = grblStrategy.emit({ groups: [lineGroup] }, device);

    expect(out.trimEnd().endsWith([exitLine('10.000', '5.000'), 'M5'].join('\n'))).toBe(true);
  });

  it('exits each pass from where that pass ends, after the final-pass overcut', () => {
    const out = grblStrategy.emit(
      { groups: [{ ...lineGroup, passes: 2, finalPassOvercutMm: 2 }] },
      device,
    );

    expect(out).toContain(
      ['G1 X10.000 Y10.000 F1500 S300', exitLine('10.000', '5.000')].join('\n'),
    );
    expect(out).toContain(
      ['G1 X12.000 Y10.000 F1500 S300', exitLine('17.000', '10.000')].join('\n'),
    );
  });

  it('shortens the exit at the bed edge instead of commanding off-bed motion', () => {
    const towardEdge: CutGroup = {
      ...lineGroup,
      segments: [
        {
          polyline: [
            { x: 9, y: 10 },
            { x: 1, y: 10 },
          ],
          closed: false,
        },
      ],
    };
    const out = grblStrategy.emit({ groups: [towardEdge] }, device);

    expect(out).toContain(['G1 X1.000 Y10.000 F1500 S300', exitLine('0.000', '10.000')].join('\n'));
  });

  it('skips the exit, and says so, when the bed position is unknown (ADR-343)', () => {
    const out = grblStrategy.emit({ groups: [lineGroup], contourEntryBounds: null }, device);

    expect(out).not.toContain('F1500 S0');
    expect(out).toContain('contour-exit skipped (bed position unknown)');
    expect(out.trimEnd().endsWith(['G1 X10.000 Y10.000 F1500 S300', 'M5'].join('\n'))).toBe(true);
  });

  it('gives a constant-power Follow Shape loop the same exit', () => {
    const offset: FillGroup = {
      kind: 'fill',
      layerId: 'follow-shape',
      color: '#000000',
      power: 30,
      powerMode: 'constant',
      speed: 1500,
      passes: 1,
      airAssist: false,
      fillStyle: 'offset',
      overscanMm: 5,
      entryRunwayMm: 5,
      exitRunwayMm: 5,
      segments: [{ ...square, reverse: false }],
    };
    const out = grblStrategy.emit({ groups: [offset] }, device);

    expect(out).toContain(
      ['G1 X10.000 Y10.000 F1500 S300', exitLine('10.000', '5.000')].join('\n'),
    );
    expect(out).toContain('; offset fill layer follow-shape');
    expect(out).toContain('contour-exit 5.000 mm effective laser-off feed');
  });
});
