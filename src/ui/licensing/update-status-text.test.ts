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
    const text = updateStatusText(status('not-covered', '2026.44.0'), 1_790_000_000, at);
    expect(text).toContain('KerfDesk 2026.44.0 is out, but your licence');
    expect(text).toContain(new Date(1_790_000_000_000).toLocaleDateString());
    expect(text).toContain('The version you have keeps working.');
    expect(updateStatusText(status('not-covered', '2026.44.0'), null, at)).toContain(
      "updates don't cover it",
    );
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
    const allowed = (['idle', 'up-to-date', 'not-covered', 'failed'] as const).map((state) =>
      updateCheckAllowed(status(state)),
    );
    const refused = (['unavailable', 'checking', 'downloading', 'ready'] as const).map((state) =>
      updateCheckAllowed(status(state)),
    );
    expect(allowed).toEqual([true, true, true, true]);
    expect(refused).toEqual([false, false, false, false]);
    expect(updateStatusSettled(status('checking'))).toBe(false);
    expect(updateStatusSettled(status('ready'))).toBe(true);
  });
});
