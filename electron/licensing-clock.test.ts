// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  checkGrantTime,
  clockErrorMessage,
  clockRolledBack,
  LicenceClockError,
  nextClockMark,
} from './licensing-clock';
import type { LicenceClaims } from './licensing-verification';

const NOW = 1_790_000_000;
function claims(tier: LicenceClaims['tier']): LicenceClaims {
  const trial = tier === 'trial';
  return {
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    licenseId: 'license-1',
    activationId: 'activation-1',
    deviceId: 'd'.repeat(43),
    tier,
    issuedAt: NOW,
    accessExpiresAt: trial ? NOW + 30 * 86_400 : null,
    updatesUntil: tier === 'developer' ? null : NOW + 30 * 86_400,
    perpetualUpdates: tier === 'developer',
    maxDevices: 3,
  };
}

describe('licence clock rules (ADR-523 Amendment 2)', () => {
  it('holds only a trial to a clock that went back more than five minutes', () => {
    expect(clockRolledBack(claims('trial'), NOW, NOW - 301)).toBe(true);
    expect(clockRolledBack(claims('trial'), NOW, NOW - 300)).toBe(false);
    expect(clockRolledBack(claims('trial'), NOW + 86_400, NOW)).toBe(true);
    expect(clockRolledBack(claims('paid'), NOW + 86_400, NOW - 86_400)).toBe(false);
    expect(clockRolledBack(claims('developer'), NOW + 86_400, NOW - 86_400)).toBe(false);
  });
  it('saves a trial clock mark only once it has moved a minute on', () => {
    expect(nextClockMark(claims('trial'), NOW, NOW + 59)).toBeNull();
    expect(nextClockMark(claims('trial'), NOW, NOW + 60)).toBe(NOW + 60);
    expect(nextClockMark(claims('trial'), NOW, NOW - 600)).toBeNull();
    expect(nextClockMark(claims('paid'), NOW, NOW + 86_400)).toBeNull();
  });
  it('refuses a fresh grant more than five minutes from this clock, with the offset', () => {
    expect(() => checkGrantTime(NOW, NOW + 300)).not.toThrow();
    expect(() => checkGrantTime(NOW, NOW - 300)).not.toThrow();
    try {
      checkGrantTime(NOW, NOW + 601);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LicenceClockError);
      expect((error as LicenceClockError).offset).toBe(601);
    }
  });
  it('says roughly how far off the clock is, which way, and what to do', () => {
    expect(clockErrorMessage(301)).toContain('about 5 minutes ahead');
    expect(clockErrorMessage(-89 * 60)).toContain('about 89 minutes behind');
    expect(clockErrorMessage(90 * 60 - 1)).toContain('about 90 minutes ahead');
    expect(clockErrorMessage(-90 * 60)).toContain('about 2 hours behind');
    expect(clockErrorMessage(47 * 3600)).toContain('about 47 hours ahead');
    expect(clockErrorMessage(48 * 3600 - 1)).toContain('about 48 hours ahead');
    expect(clockErrorMessage(48 * 3600)).toContain('about 2 days ahead');
    expect(clockErrorMessage(-400 * 86_400)).toContain('about 400 days behind');
    expect(clockErrorMessage(600)).toContain(
      'Turn on Set time automatically in Windows’ Date & time settings, check the time zone',
    );
  });
});
