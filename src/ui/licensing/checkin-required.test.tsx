import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LicenceAdapter, LicenceStatus } from '../../platform/types';
import { editionLabel } from './EditionStatusButton';
import { ProFeatureDialog } from './ProFeatureDialog';
import { checkInReminder } from './use-checkin-reminder';

const NOW = 2_000_000_000;
const paid: LicenceStatus = {
  channel: 'commercial',
  edition: 'pro',
  state: 'ready',
  tier: 'paid',
  accessExpiresAt: null,
  checkInDueAt: NOW + 20 * 86_400,
  updatesUntil: NOW + 365 * 86_400,
  perpetualUpdates: false,
  licenseKey: null,
  deactivationPending: false,
  paymentPending: false,
  paymentOrderId: null,
  storeUnreadable: false,
  message: null,
};
const overdue: LicenceStatus = {
  ...paid,
  edition: 'free',
  state: 'checkin-required',
  message: 'Connect to the internet and choose Refresh licence.',
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')];
}

it.each(['checkin-required', 'clock-error'] as const)(
  'offers Refresh licence first, not a renewal, when a paid licence is %s',
  async (state) => {
    const refreshed = { ...paid };
    const refresh = vi.fn(async () => refreshed);
    const checkout = vi.fn(async () => overdue);
    const onStatus = vi.fn(async () => undefined);
    const client = { refresh, checkout } as unknown as LicenceAdapter;
    await act(async () =>
      root.render(
        <ProFeatureDialog
          feature="vcarve"
          client={client}
          status={{ ...overdue, state }}
          onStatus={onStatus}
          onClose={() => undefined}
        />,
      ),
    );
    const labels = buttons().map((button) => button.textContent);
    expect(labels.some((label) => label?.includes('Renew updates'))).toBe(false);
    const primary = buttons().find((button) => button.textContent === 'Refresh licence');
    expect(primary?.className).toContain('primary');
    await act(async () => primary?.click());
    expect(refresh).toHaveBeenCalledOnce();
    expect(checkout).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith(refreshed);
  },
);

it('names paid and trial rights that wait on a check-in in the status bar', () => {
  expect(editionLabel(overdue, NOW)).toBe('Pro · check-in needed');
  expect(editionLabel({ ...overdue, edition: 'pro' }, NOW)).toBe('Pro · check-in needed');
  expect(editionLabel({ ...overdue, tier: 'trial', accessExpiresAt: NOW + 86_400 }, NOW)).toBe(
    'Pro trial · check-in needed',
  );
  expect(editionLabel(paid, NOW)).toBe('Pro');
});

it('reminds a paid device only within five days of its check-in', () => {
  const due = paid.checkInDueAt ?? 0;
  expect(checkInReminder(paid, due - 6 * 86_400)).toBeNull();
  expect(checkInReminder(paid, due - 5 * 86_400)).toContain('within 5 days');
  expect(checkInReminder(paid, due - 3600)).toContain('within 1 day');
  expect(checkInReminder(paid, due)).toBeNull();
  expect(checkInReminder({ ...paid, tier: 'trial' }, due - 3600)).toBeNull();
  expect(checkInReminder(overdue, due - 3600)).toBeNull();
  expect(checkInReminder(null, due - 3600)).toBeNull();
});
