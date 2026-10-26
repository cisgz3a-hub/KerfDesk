import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { focusTestPowerIssue } from './focus-test-power';

describe('focusTestPowerIssue', () => {
  it('refuses a power that is emitted as S0 on the profile S range', () => {
    const device = { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 1000 };
    expect(focusTestPowerIssue(0.04, device)).toContain('S0');
    expect(focusTestPowerIssue(0.05, device)).toBeNull();
    expect(focusTestPowerIssue(0.04, { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 1 })).toContain('S0');
  });
  it('accepts fractional S that current output retains', () => {
    expect(focusTestPowerIssue(10, { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 0.5 })).toBeNull();
    // ADR-567 Amendment 1: a small whole-number $30 keeps 10% as S0.1.
    expect(focusTestPowerIssue(10, { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 1 })).toBeNull();
  });
});
