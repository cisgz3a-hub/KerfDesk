import { describe, expect, it } from 'vitest';
import { compareSettingsSnapshots } from './compare-settings-snapshots';

describe('controller settings snapshot comparison', () => {
  it('numeric-normalizes equivalent raw forms', () => {
    const result = compareSettingsSnapshots(
      { settings: [{ id: 110, rawValue: ' 6e3 ' }] },
      { settings: [{ id: 110, rawValue: '6000.000' }] },
    );

    expect(result).toEqual([
      {
        id: 110,
        code: '$110',
        leftRawValue: ' 6e3 ',
        rightRawValue: '6000.000',
        leftNumericValue: 6000,
        rightNumericValue: 6000,
        status: 'equivalent',
        basis: 'numeric',
        delta: 0,
        percentDeltaFromLeft: 0,
      },
    ]);
  });

  it('keeps X and Y axes independent and reports direction-neutral deltas', () => {
    const result = compareSettingsSnapshots(
      {
        settings: [
          { id: 110, rawValue: '6000' },
          { id: 111, rawValue: '5000' },
          { id: 120, rawValue: '500' },
          { id: 121, rawValue: '500' },
        ],
      },
      {
        settings: [
          { id: 110, rawValue: '3000' },
          { id: 111, rawValue: '5000' },
          { id: 120, rawValue: '250' },
          { id: 121, rawValue: '750' },
        ],
      },
    );

    expect(
      result.map(({ code, status, delta, percentDeltaFromLeft }) => ({
        code,
        status,
        delta,
        percentDeltaFromLeft,
      })),
    ).toEqual([
      { code: '$110', status: 'different', delta: -3000, percentDeltaFromLeft: -50 },
      { code: '$111', status: 'equivalent', delta: 0, percentDeltaFromLeft: 0 },
      { code: '$120', status: 'different', delta: -250, percentDeltaFromLeft: -50 },
      { code: '$121', status: 'different', delta: 250, percentDeltaFromLeft: 50 },
    ]);
    expect(result.every((entry) => !('better' in entry) && !('worse' in entry))).toBe(true);
  });

  it('reports missing settings without inventing numeric comparisons', () => {
    const result = compareSettingsSnapshots(
      { settings: [{ id: 100, rawValue: '80' }] },
      { settings: [{ id: 101, rawValue: '80' }] },
    );

    expect(result).toMatchObject([
      {
        id: 100,
        status: 'missing-right',
        basis: 'missing',
        leftRawValue: '80',
        rightRawValue: null,
        delta: null,
        percentDeltaFromLeft: null,
      },
      {
        id: 101,
        status: 'missing-left',
        basis: 'missing',
        leftRawValue: null,
        rightRawValue: '80',
        delta: null,
        percentDeltaFromLeft: null,
      },
    ]);
  });

  it('falls back to exact raw comparison for non-numeric values', () => {
    const result = compareSettingsSnapshots(
      {
        settings: [
          { id: 200, rawValue: 'unknown' },
          { id: 201, rawValue: 'unknown' },
        ],
      },
      {
        settings: [
          { id: 200, rawValue: 'unknown' },
          { id: 201, rawValue: 'UNKNOWN' },
        ],
      },
    );

    expect(result).toMatchObject([
      {
        id: 200,
        status: 'equivalent',
        basis: 'raw',
        leftNumericValue: null,
        rightNumericValue: null,
      },
      {
        id: 201,
        status: 'different',
        basis: 'raw',
        delta: null,
        percentDeltaFromLeft: null,
      },
    ]);
  });

  it('returns a null percent delta for a zero baseline', () => {
    expect(
      compareSettingsSnapshots(
        { settings: [{ id: 31, rawValue: '0' }] },
        { settings: [{ id: 31, rawValue: '1' }] },
      )[0],
    ).toMatchObject({
      status: 'different',
      delta: 1,
      percentDeltaFromLeft: null,
    });
  });

  it('does not expose non-finite deltas when finite values overflow arithmetic', () => {
    const result = compareSettingsSnapshots(
      { settings: [{ id: 999, rawValue: String(-Number.MAX_VALUE) }] },
      { settings: [{ id: 999, rawValue: String(Number.MAX_VALUE) }] },
    );

    expect(result[0]).toMatchObject({
      leftNumericValue: -Number.MAX_VALUE,
      rightNumericValue: Number.MAX_VALUE,
      status: 'different',
      delta: null,
      percentDeltaFromLeft: null,
    });
  });

  it('rejects duplicate and invalid ids instead of silently collapsing evidence', () => {
    expect(() =>
      compareSettingsSnapshots(
        {
          settings: [
            { id: 110, rawValue: '1' },
            { id: 110, rawValue: '2' },
          ],
        },
        { settings: [] },
      ),
    ).toThrow('duplicate id 110');
    expect(() =>
      compareSettingsSnapshots({ settings: [{ id: -1, rawValue: '1' }] }, { settings: [] }),
    ).toThrow('non-negative integer');
  });
});
