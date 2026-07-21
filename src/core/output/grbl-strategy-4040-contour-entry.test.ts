import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { findLaserOnTravelIssues } from '../invariants';
import type { CutGroup, FillGroup } from '../job';
import { grblStrategy } from './grbl-strategy';

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

const lineGroupWithoutEntry: CutGroup = {
  kind: 'cut',
  layerId: 'outline',
  color: '#000000',
  power: 30,
  speed: 1500,
  passes: 1,
  airAssist: false,
  segments: [square],
};

const lineGroup: CutGroup = { ...lineGroupWithoutEntry, entryRunwayMm: 5 };

const offsetFillGroup: FillGroup = {
  kind: 'fill',
  layerId: 'follow-shape',
  color: '#000000',
  power: 30,
  speed: 1500,
  passes: 1,
  airAssist: false,
  fillStyle: 'offset',
  overscanMm: 5,
  entryRunwayMm: 5,
  segments: [{ ...square, reverse: false }],
};

describe('4040 contour entry emission (ADR-239)', () => {
  it('gives a Line-mode contour a tangential feed-matched entry after the controlled seek', () => {
    const out = grblStrategy.emit({ groups: [lineGroup] }, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);

    expect(out).toContain(
      [
        'G1 X5.000 Y10.000 F800 S0 ; kerfdesk:laser-off-motion',
        'G1 X10.000 Y10.000 F1500 S0 ; kerfdesk:laser-off-motion',
        'G1 X20.000 Y10.000 F1500 S300',
      ].join('\n'),
    );
    expect(out).not.toContain('G0 ');
    expect(findLaserOnTravelIssues(out)).toEqual([]);
  });

  it('gives every Follow Shape loop its own tangential entry', () => {
    const inner = {
      polyline: [
        { x: 12, y: 12 },
        { x: 18, y: 12 },
        { x: 18, y: 18 },
        { x: 12, y: 18 },
        { x: 12, y: 12 },
      ],
      closed: true,
      reverse: false,
    };
    const out = grblStrategy.emit(
      { groups: [{ ...offsetFillGroup, segments: [...offsetFillGroup.segments, inner] }] },
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    );

    expect(out).toContain('; offset fill layer follow-shape');
    expect(out).toContain(
      [
        'G1 X5.000 Y10.000 F800 S0 ; kerfdesk:laser-off-motion',
        'G1 X10.000 Y10.000 F1500 S0 ; kerfdesk:laser-off-motion',
        'G1 X20.000 Y10.000 F1500 S300',
      ].join('\n'),
    );
    expect(out).toContain(
      [
        'G1 X7.000 Y12.000 F800 S0 ; kerfdesk:laser-off-motion',
        'G1 X12.000 Y12.000 F1500 S0 ; kerfdesk:laser-off-motion',
        'G1 X18.000 Y12.000 F1500 S300',
      ].join('\n'),
    );
    expect(out).not.toContain('G0 ');
    expect(findLaserOnTravelIssues(out)).toEqual([]);
  });

  it('emits one entry per contour per pass', () => {
    const out = grblStrategy.emit(
      { groups: [{ ...lineGroup, passes: 2 }] },
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    );

    const entries = out.match(/G1 X10\.000 Y10\.000 F1500 S0 /g) ?? [];
    expect(entries).toHaveLength(2);
  });

  it('shortens the entry at the bed edge instead of commanding off-bed motion', () => {
    const edgeLine: CutGroup = {
      ...lineGroup,
      segments: [
        {
          polyline: [
            { x: 1, y: 10 },
            { x: 9, y: 10 },
          ],
          closed: false,
        },
      ],
    };
    const out = grblStrategy.emit({ groups: [edgeLine] }, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);

    expect(out).toContain(
      [
        'G1 X0.000 Y10.000 F800 S0 ; kerfdesk:laser-off-motion',
        'G1 X1.000 Y10.000 F1500 S0 ; kerfdesk:laser-off-motion',
        'G1 X9.000 Y10.000 F1500 S300',
      ].join('\n'),
    );
  });

  it('falls back to the legacy seek when the contour starts on the bed boundary', () => {
    const boundaryLine: CutGroup = {
      ...lineGroup,
      segments: [
        {
          polyline: [
            { x: 0, y: 10 },
            { x: 9, y: 10 },
          ],
          closed: false,
        },
      ],
    };
    const out = grblStrategy.emit(
      { groups: [boundaryLine] },
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    );

    expect(out).toContain(
      [
        'G1 X0.000 Y10.000 F800 S0 ; kerfdesk:laser-off-motion',
        'G1 X9.000 Y10.000 F1500 S300',
      ].join('\n'),
    );
  });

  it('keeps the legacy direct seek when the group carries no entry runway', () => {
    const out = grblStrategy.emit(
      { groups: [lineGroupWithoutEntry] },
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    );

    expect(out).toContain(
      [
        'G1 X10.000 Y10.000 F800 S0 ; kerfdesk:laser-off-motion',
        'G1 X20.000 Y10.000 F1500 S300',
      ].join('\n'),
    );
    expect(out).not.toContain('F1500 S0');
  });

  it('keeps generic profiles byte-stable: G0 seek, no controlled or entry motion', () => {
    const out = grblStrategy.emit({ groups: [lineGroupWithoutEntry] }, DEFAULT_DEVICE_PROFILE);

    expect(out).toContain('G0 X10.000 Y10.000');
    expect(out).not.toContain('kerfdesk:laser-off-motion');
  });
});
