// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  LICENCE_CHECK_INTERVAL_MS,
  licenceRefreshDue,
  scheduleLicenceChecks,
  type StartTimer,
} from './licensing-schedule';

describe('when a quiet check asks the licence service (ADR-592)', () => {
  const NOW = 1_790_000_000;
  const paid = { state: 'ready', tier: 'paid' };
  it('asks weekly for paid rights, daily for a trial, and at once when overdue', () => {
    const seen = { refreshedAt: NOW, lastSeenAt: NOW };
    expect(licenceRefreshDue(paid, seen, NOW + 6 * 86_400)).toBe(false);
    expect(licenceRefreshDue(paid, seen, NOW + 7 * 86_400)).toBe(true);
    expect(licenceRefreshDue({ state: 'ready', tier: 'trial' }, seen, NOW + 86_400)).toBe(true);
    expect(licenceRefreshDue({ state: 'checkin-required', tier: 'paid' }, seen, NOW)).toBe(true);
    expect(licenceRefreshDue({ state: 'unavailable', tier: null }, seen, NOW + 30 * 86_400)).toBe(
      false,
    );
  });
  it('asks at once when the clock is earlier than the device was last seen', () => {
    const seen = { refreshedAt: NOW + 19 * 86_400, lastSeenAt: NOW + 20 * 86_400 };
    expect(licenceRefreshDue(paid, seen, NOW + 20 * 86_400 - 300)).toBe(false);
    expect(licenceRefreshDue(paid, seen, NOW + 20 * 86_400 - 301)).toBe(true);
    expect(licenceRefreshDue(paid, { refreshedAt: NOW, lastSeenAt: NOW }, NOW - 301)).toBe(true);
  });
});

function fakeTimer() {
  const timer = { unref: vi.fn(), clear: vi.fn() };
  let tick: () => void = () => undefined;
  const start = vi.fn<StartTimer>((run) => {
    tick = run;
    return timer;
  });
  return { start, timer, tick: () => tick() };
}

describe('the repeating licence check (ADR-523 Amendment 2)', () => {
  it('runs every 30 minutes on a timer that never keeps KerfDesk open, until stopped', async () => {
    const clock = fakeTimer();
    const check = vi.fn(async () => undefined);
    const stop = scheduleLicenceChecks(check, clock.start);
    expect(LICENCE_CHECK_INTERVAL_MS).toBe(30 * 60_000);
    expect(clock.start).toHaveBeenCalledWith(expect.any(Function), LICENCE_CHECK_INTERVAL_MS);
    expect(clock.timer.unref).toHaveBeenCalledOnce();
    expect(check).not.toHaveBeenCalled();
    clock.tick();
    await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());
    stop();
    expect(clock.timer.clear).toHaveBeenCalledOnce();
  });
  it('never starts a check while the last one is still running, and survives a failure', async () => {
    const clock = fakeTimer();
    let finish: () => void = () => undefined;
    const check = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((done) => (finish = done)))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    scheduleLicenceChecks(check, clock.start);
    clock.tick();
    clock.tick();
    expect(check).toHaveBeenCalledOnce();
    finish();
    await vi.waitFor(() => {
      clock.tick();
      expect(check).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      clock.tick();
      expect(check).toHaveBeenCalledTimes(3);
    });
  });
});
