// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  checkGrantTime,
  checkInDueAt,
  checkInOverdue,
  clockErrorMessage,
  clockRolledBack,
  grantTimeChecked,
  LicenceClockError,
  nextClockMark,
  nextPaidMark,
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
  it('saves each forward whole-second trial mark without rewriting unchanged or paid time', () => {
    expect(nextClockMark(claims('trial'), NOW, NOW)).toBeNull();
    expect(nextClockMark(claims('trial'), NOW, NOW + 1)).toBe(NOW + 1);
    expect(nextClockMark(claims('trial'), NOW, NOW + 59)).toBe(NOW + 59);
    expect(nextClockMark(claims('trial'), NOW, NOW + 60)).toBe(NOW + 60);
    expect(nextClockMark(claims('trial'), NOW, NOW - 600)).toBeNull();
    expect(nextClockMark(claims('paid'), NOW, NOW + 86_400)).toBeNull();
  });
  it('saves a paid mark at most every five minutes, and never for developer rights', () => {
    expect(nextPaidMark(claims('paid'), NOW, NOW + 299)).toBeNull();
    expect(nextPaidMark(claims('paid'), NOW, NOW + 300)).toBe(NOW + 300);
    expect(nextPaidMark(claims('paid'), NOW, NOW - 600)).toBeNull();
    expect(nextPaidMark(claims('developer'), NOW, NOW + 86_400)).toBeNull();
    expect(nextPaidMark(claims('trial'), NOW, NOW + 86_400)).toBeNull();
  });
  it('holds only a trial to a check-in, never paid or developer rights (ADR-623 Amendment 2)', () => {
    const trial = claims('trial');
    expect(checkInOverdue(trial, NOW, NOW + 3 * 86_400)).toBe(false);
    expect(checkInOverdue(trial, NOW, NOW + 3 * 86_400 + 1)).toBe(true);
    expect(checkInOverdue(trial, NOW + 3 * 86_400 + 1, NOW)).toBe(true);
    expect(checkInOverdue(trial, NOW, NOW - 301)).toBe(true);
    expect(checkInDueAt(trial)).toBe(NOW + 3 * 86_400);
    for (const tier of ['paid', 'developer'] as const) {
      expect(checkInOverdue(claims(tier), NOW, NOW + 1000 * 86_400)).toBe(false);
      expect(checkInOverdue(claims(tier), NOW + 1000 * 86_400, NOW - 1000 * 86_400)).toBe(false);
      expect(checkInDueAt(claims(tier))).toBeNull();
    }
  });
  it('holds a trial or developer grant to the clock, never a paid one', () => {
    expect(grantTimeChecked(claims('trial'))).toBe(true);
    expect(grantTimeChecked(claims('developer'))).toBe(true);
    expect(grantTimeChecked(claims('paid'))).toBe(false);
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
    expect(clockErrorMessage(301, 'win32')).toContain('about 5 minutes ahead');
    expect(clockErrorMessage(-89 * 60, 'win32')).toContain('about 89 minutes behind');
    expect(clockErrorMessage(90 * 60 - 1, 'win32')).toContain('about 90 minutes ahead');
    expect(clockErrorMessage(-90 * 60, 'win32')).toContain('about 2 hours behind');
    expect(clockErrorMessage(47 * 3600, 'win32')).toContain('about 47 hours ahead');
    expect(clockErrorMessage(48 * 3600 - 1, 'win32')).toContain('about 48 hours ahead');
    expect(clockErrorMessage(48 * 3600, 'win32')).toContain('about 2 days ahead');
    expect(clockErrorMessage(-400 * 86_400, 'win32')).toContain('about 400 days behind');
    expect(clockErrorMessage(600, 'win32')).toContain(
      'Turn on Set time automatically in Windows’ Date & time settings, check the time zone',
    );
  });
  // The desktop app ships for macOS and Linux too (ADR-623 Amendment 1).
  it.each([
    ['win32', 'Set time automatically in Windows’ Date & time settings'],
    ['darwin', 'Set time and date automatically in System Settings > General > Date & Time'],
    ['linux', 'automatic date and time in your desktop’s date and time settings'],
  ])('names where %s keeps its automatic time setting', (platform, setting) => {
    expect(clockErrorMessage(600, platform)).toContain(`Turn on ${setting}, check the time zone`);
    if (platform !== 'win32') expect(clockErrorMessage(600, platform)).not.toContain('Windows');
  });
});
