import { describe, expect, it } from 'vitest';
import type { CommercialUpdateStatus } from '../../platform/types';
import { updateCheckAllowed, updateStatusSettled, updateStatusText } from './update-status-text';

function status(
  state: CommercialUpdateStatus['state'],
  version: string | null = null,
): CommercialUpdateStatus {
  return { state, currentVersion: '2026.40.0', version, checkedAt: 1_000 };
}
const at = (): string => '09:15';

describe('update status text (ADR-547)', () => {
  it.each([
    [status('unavailable'), "This copy of KerfDesk doesn't update itself."],
    [status('idle'), "KerfDesk hasn't checked for updates since it opened."],
    [status('checking'), 'Checking for updates...'],
    [status('downloading', '2026.41.0'), 'Downloading KerfDesk 2026.41.0...'],
    [status('up-to-date'), 'KerfDesk is up to date. Checked at 09:15.'],
    [
      status('ready', '2026.41.0'),
      'KerfDesk 2026.41.0 is ready. It installs when you close KerfDesk.',
    ],
    [status('failed'), "KerfDesk couldn't check for updates."],
    [status('failed', '2026.41.0'), "KerfDesk 2026.41.0 couldn't be prepared."],
  ])('describes %o', (value, expected) => {
    expect(updateStatusText(value, null, at)).toContain(expected);
  });

  it('says when a licence does not cover the newer version, and that nothing stops working', () => {
    const now = 1_800_000_000_000;
    const text = updateStatusText(status('not-covered', '2026.44.0'), 1_790_000_000, at, now);
    expect(text).toContain('KerfDesk 2026.44.0 is out, but your licence');
    expect(text).toContain(`ended on ${new Date(1_790_000_000_000).toLocaleDateString()}.`);
    expect(text).toContain('The version you have keeps working.');
    expect(updateStatusText(status('not-covered', '2026.44.0'), null, at, now)).toContain(
      "updates don't cover it",
    );
  });

  it('never says updates ended on a date still to come (ADR-547 Amendment 1)', () => {
    const now = 1_790_000_000_000;
    const until = 1_820_000_000;
    const text = updateStatusText(status('not-covered', '2026.44.0'), until, at, now);
    expect(text).not.toContain('ended');
    expect(text).not.toContain(new Date(until * 1000).toLocaleDateString());
    expect(text).toContain("your licence's updates don't cover it.");
  });

  it('says a covered version waits for the licence to be confirmed, not that updates ended', () => {
    const text = updateStatusText(status('licence-unconfirmed', '2026.44.0'), 1_820_000_000, at);
    expect(text).toContain('KerfDesk 2026.44.0 is out and your licence covers it');
    expect(text).toContain("KerfDesk couldn't confirm your licence just now");
    expect(text).toContain('Check your connection, then open Help > Licence');
    expect(text).toContain('choose Refresh licence and try Check now again.');
    expect(text).toContain('The version you have keeps working.');
    expect(text).not.toContain('ended');
  });

  it('points macOS and Linux to the download page instead of a download (ADR-613)', () => {
    const page = (state: CommercialUpdateStatus['state'], version: string | null = null) => ({
      ...status(state, version),
      mode: 'manual' as const,
      delivery: 'download-page' as const,
    });
    const available = updateStatusText(page('available', '1.0.21'), null, at);
    expect(available).toContain('KerfDesk 1.0.21 is available. Open its download page');
    expect(available).toContain('install it after you close KerfDesk');
    expect(available).not.toContain('Download it');
    expect(updateStatusText(page('failed'), null, at)).toContain('open the download page');
  });

  it('reads the status before it arrives', () => {
    expect(updateStatusText(null, null, at)).toBe('Reading the update status...');
    expect(updateCheckAllowed(null)).toBe(false);
  });

  it('requires explicit manual installation consent and describes errors without automatic promises', () => {
    const manual = {
      ...status('ready', '2026.41.0'),
      mode: 'manual' as const,
      installOnQuit: false,
    };
    expect(updateStatusText(manual, null)).toContain('Choose Install when I close KerfDesk');
    expect(updateStatusText({ ...manual, installOnQuit: true }, null)).toContain(
      'installer will open after you close KerfDesk normally',
    );
    expect(updateStatusText({ ...manual, state: 'available' }, null)).toContain(
      'Download it when you are ready',
    );
    expect(updateStatusText({ ...manual, state: 'failed' }, null)).toContain('try Check now again');
    expect(updateStatusText({ ...manual, state: 'unavailable' }, null)).toContain(
      'update status is unavailable',
    );
  });

  it('lets the owner check only when no check, download or install is waiting', () => {
    const allowed = (
      ['idle', 'up-to-date', 'not-covered', 'licence-unconfirmed', 'failed'] as const
    ).map((state) => updateCheckAllowed(status(state)));
    const refused = (['unavailable', 'checking', 'downloading', 'ready'] as const).map((state) =>
      updateCheckAllowed(status(state)),
    );
    expect(allowed).toEqual([true, true, true, true, true]);
    expect(updateStatusSettled(status('licence-unconfirmed'))).toBe(true);
    expect(refused).toEqual([false, false, false, false]);
    expect(updateStatusSettled(status('checking'))).toBe(false);
    expect(updateStatusSettled(status('ready'))).toBe(true);
  });
});
