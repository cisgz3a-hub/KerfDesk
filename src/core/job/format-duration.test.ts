import { describe, expect, it } from 'vitest';
import { formatDuration } from './format-duration';

describe('formatDuration', () => {
  it('shows seconds-only under one minute', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(7.4)).toBe('7s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('shows minutes-and-seconds under one hour', () => {
    expect(formatDuration(60)).toBe('1m 0s');
    expect(formatDuration(263)).toBe('4m 23s');
    expect(formatDuration(3599)).toBe('59m 59s');
  });

  it('keeps seconds once over an hour', () => {
    expect(formatDuration(3600)).toBe('1h 0m 0s');
    expect(formatDuration(4332)).toBe('1h 12m 12s');
  });

  it.each([
    [59.49, '59s'],
    [59.5, '1m 0s'],
    [119.6, '2m 0s'],
    [3599.5, '1h 0m 0s'],
    [3659.6, '1h 1m 0s'],
    [7199.6, '2h 0m 0s'],
  ])('carries rounded seconds into minutes and hours: %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it('handles non-finite and negative inputs as 0s', () => {
    expect(formatDuration(NaN)).toBe('0s');
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0s');
  });
});

describe('formatDuration rounding boundaries', () => {
  it.each([
    [59.49, '59s'],
    [59.5, '1m 0s'],
    [119.5, '2m 0s'],
    [3599.49, '59m 59s'],
    [3599.5, '1h 0m 0s'],
    [7199.5, '2h 0m 0s'],
    [86399.5, '24h 0m 0s'],
  ])('formats %s seconds as %s with carried rounding', (seconds, label) => {
    expect(formatDuration(seconds)).toBe(label);
  });

  it('keeps the ordinary duration format for zero and fractional seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(0.49)).toBe('0s');
    expect(formatDuration(7.4)).toBe('7s');
    expect(formatDuration(263)).toBe('4m 23s');
    expect(formatDuration(4332)).toBe('1h 12m 12s');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    'formats invalid duration %s as zero',
    (seconds) => {
      expect(formatDuration(seconds)).toBe('0s');
    },
  );
});
