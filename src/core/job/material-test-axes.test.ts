import { describe, expect, it } from 'vitest';
import {
  materialTestAxesIssue,
  materialTestAxisValues,
  materialTestRiskOrder,
  type MaterialTestAxis,
} from './material-test-axes';

function values(
  axis: MaterialTestAxis,
  mode: 'line' | 'fill' | 'image' = 'fill',
  maxFeed?: number,
) {
  return materialTestAxisValues(axis, mode, maxFeed);
}

describe('materialTestAxisValues', () => {
  it('steps power from start to end and clamps it to 0..100 %', () => {
    expect(values({ parameter: 'power', start: 10, end: 40, count: 4 })).toEqual([
      { requested: 10, effective: 10, label: '10' },
      { requested: 20, effective: 20, label: '20' },
      { requested: 30, effective: 30, label: '30' },
      { requested: 40, effective: 40, label: '40' },
    ]);
    expect(
      values({ parameter: 'power', start: -30, end: 250, count: 3 }).map((v) => v.requested),
    ).toEqual([0, 50, 100]);
  });

  it('keeps requested speed and labels the feed the profile ceiling allows', () => {
    expect(values({ parameter: 'speed', start: 3000, end: 1000, count: 3 }, 'fill', 2500)).toEqual([
      { requested: 3000, effective: 2500, label: '2500' },
      { requested: 2000, effective: 2000, label: '2000' },
      { requested: 1000, effective: 1000, label: '1000' },
    ]);
    expect(values({ parameter: 'speed', start: 0, end: -5, count: 2 })[0]?.requested).toBe(1);
  });

  it('emits whole, distinct pass counts and never more steps than integers in range', () => {
    expect(values({ parameter: 'passes', start: 1, end: 4, count: 4 }).map((v) => v.label)).toEqual(
      ['1', '2', '3', '4'],
    );
    expect(
      values({ parameter: 'passes', start: 1, end: 3, count: 10 }).map((v) => v.requested),
    ).toEqual([1, 2, 3]);
    expect(
      values({ parameter: 'passes', start: 1, end: 10, count: 4 }).map((v) => v.requested),
    ).toEqual([1, 4, 7, 10]);
    expect(
      values({ parameter: 'passes', start: 0, end: 500, count: 2 }).map((v) => v.requested),
    ).toEqual([1, 100]);
  });

  it('clamps interval to the Fill bounds and to the Image lines-per-mm range', () => {
    expect(
      values({ parameter: 'interval', start: 0.05, end: 0.2, count: 4 }, 'fill').map(
        (v) => v.label,
      ),
    ).toEqual(['0.05', '0.1', '0.15', '0.2']);
    expect(
      values({ parameter: 'interval', start: 0.001, end: 50, count: 2 }, 'fill').map(
        (v) => v.requested,
      ),
    ).toEqual([0.05, 10]);
    // Image scan lines are limited to 5..25 lines/mm (0.2..0.04 mm).
    expect(
      values({ parameter: 'interval', start: 0.01, end: 1, count: 2 }, 'image').map(
        (v) => v.requested,
      ),
    ).toEqual([0.04, 0.2]);
  });

  it('limits every axis to 1..20 steps', () => {
    expect(values({ parameter: 'power', start: 0, end: 100, count: 99 })).toHaveLength(20);
    expect(values({ parameter: 'power', start: 0, end: 100, count: 0 })).toHaveLength(1);
    expect(values({ parameter: 'speed', start: 100, end: 900, count: Number.NaN })).toHaveLength(1);
  });
});

describe('materialTestRiskOrder', () => {
  it('runs the fastest, weakest, widest and fewest-pass values first', () => {
    const order = (axis: MaterialTestAxis) =>
      materialTestRiskOrder(axis.parameter, values(axis, 'fill'));
    expect(order({ parameter: 'speed', start: 1000, end: 3000, count: 3 })).toEqual([2, 1, 0]);
    expect(order({ parameter: 'power', start: 40, end: 10, count: 3 })).toEqual([2, 1, 0]);
    expect(order({ parameter: 'interval', start: 0.05, end: 0.2, count: 3 })).toEqual([2, 1, 0]);
    expect(order({ parameter: 'passes', start: 3, end: 1, count: 3 })).toEqual([2, 1, 0]);
    expect(order({ parameter: 'power', start: 20, end: 20, count: 3 })).toEqual([0, 1, 2]);
  });
});

describe('materialTestAxesIssue', () => {
  it('rejects the same setting on both axes and interval in Line mode', () => {
    expect(materialTestAxesIssue({ parameter: 'power' }, { parameter: 'power' }, 'fill')).toMatch(
      /different setting/,
    );
    expect(
      materialTestAxesIssue({ parameter: 'interval' }, { parameter: 'power' }, 'line'),
    ).toMatch(/Fill or Image/);
    expect(materialTestAxesIssue({ parameter: 'interval' }, { parameter: 'passes' }, 'image')).toBe(
      null,
    );
  });
});
