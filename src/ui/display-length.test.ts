import { describe, expect, it } from 'vitest';
import {
  feedUnitLabel,
  formatDisplayArea,
  formatDisplayLength,
  formatDisplayLengthFixed,
  formatLengthWithUnit,
  fromDisplayLength,
  toDisplayLength,
} from './display-length';

describe('display lengths (ADR-629)', () => {
  it('leaves millimetres unchanged', () => {
    expect(toDisplayLength(12.5, 'mm')).toBe(12.5);
    expect(fromDisplayLength(12.5, 'mm')).toBe(12.5);
    expect(formatDisplayLength(12.5, 'mm')).toBe('12.5');
    expect(formatLengthWithUnit(3, 'mm')).toBe('3 mm');
  });

  it('converts inches both ways with 25.4 mm to the inch', () => {
    expect(toDisplayLength(25.4, 'in')).toBe(1);
    expect(fromDisplayLength(0.5, 'in')).toBe(12.7);
    expect(fromDisplayLength(toDisplayLength(12.7, 'in'), 'in')).toBe(12.7);
  });

  it('shows up to four decimals of an inch without trailing zeros', () => {
    expect(formatDisplayLength(25.4, 'in')).toBe('1');
    expect(formatDisplayLength(10, 'in')).toBe('0.3937');
    expect(formatDisplayLength(-6.35, 'in')).toBe('-0.25');
    expect(formatDisplayLength(0, 'in')).toBe('0');
    expect(formatLengthWithUnit(12.7, 'in')).toBe('0.5 in');
  });

  it('never rounds a nonzero length to zero', () => {
    expect(formatDisplayLength(0.001, 'in')).toBe('3.937e-5');
  });

  it('formats fixed decimals two places finer in inches', () => {
    expect(formatDisplayLengthFixed(100, 'mm', 1)).toBe('100.0');
    expect(formatDisplayLengthFixed(100, 'in', 1)).toBe('3.937');
    expect(formatDisplayLengthFixed(-0.0001, 'in', 1)).toBe('0.000');
  });

  it('labels feeds and areas in the display unit', () => {
    expect(feedUnitLabel('mm')).toBe('mm/min');
    expect(feedUnitLabel('in')).toBe('in/min');
    expect(formatDisplayArea(645.16, 'in')).toBe('1 in²');
    expect(formatDisplayArea(12, 'mm')).toBe('12 mm²');
  });
});
