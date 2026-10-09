import type { LicenceAdapter, LicenceStatus } from '../../platform/types';
import { PRO_PRICE_LABEL, RENEWAL_PRICE_LABEL } from './pro-features';

/**
 * What the Buy Pro / Renew updates button does (owner's choice, 2026-10-09).
 * Buy Pro opens the KerfDesk purchase page itself: the page takes payment and
 * shows the licence key, which the buyer enters in Help > Licence. Renewing
 * updates still starts in the app, because the purchase page is purchase-only
 * and a renewal must name the licence it extends.
 */
export function startPurchase(
  client: LicenceAdapter,
  status: LicenceStatus | null,
): Promise<LicenceStatus> {
  if (status?.tier === 'paid') return client.checkout('renewal');
  return client.openPurchasePage?.() ?? client.checkout('purchase');
}

export function purchaseLabel(status: LicenceStatus | null): string {
  return status?.tier === 'paid'
    ? `Renew updates · ${RENEWAL_PRICE_LABEL}`
    : `Buy Pro · ${PRO_PRICE_LABEL}`;
}

export function purchaseTitle(status: LicenceStatus | null): string {
  return status?.tier === 'paid'
    ? 'Buy another year of updates'
    : 'Open the KerfDesk purchase page in your browser';
}
