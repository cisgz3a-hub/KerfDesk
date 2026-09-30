/* global btoa */
import { licensingRequest, validBrowserOrder, validClaim } from './desktop-checkout-api.mjs';

export const PURCHASE_STORAGE_KEY = 'kerfdesk.browser-purchase.v1';
const PURCHASE_LOCK = 'kerfdesk.browser-purchase';

export function readPurchase(storage) {
  const raw = storage.getItem(PURCHASE_STORAGE_KEY);
  if (raw === null) return null;
  if (raw.length > 4096) throw new Error('Saved purchase unavailable');
  const saved = JSON.parse(raw);
  if (
    saved?.schemaVersion !== 1 ||
    !/^[A-Za-z0-9_-]{43}$/u.test(saved.requestId ?? '') ||
    (saved.order !== undefined && !validBrowserOrder(saved.order))
  )
    throw new Error('Saved purchase unavailable');
  return saved;
}

function savePurchase(storage, value) {
  const raw = JSON.stringify(value);
  storage.setItem(PURCHASE_STORAGE_KEY, raw);
  if (storage.getItem(PURCHASE_STORAGE_KEY) !== raw) throw new Error('Purchase could not be saved');
}

export function supportsBrowserPurchase(window) {
  return (
    typeof window.navigator.locks?.request === 'function' &&
    typeof window.crypto?.getRandomValues === 'function'
  );
}

export async function prepareBrowserPurchase(window, fetcher) {
  if (!supportsBrowserPurchase(window)) throw new Error('Browser purchase unavailable');
  return window.navigator.locks.request(PURCHASE_LOCK, { mode: 'exclusive' }, async () => {
    const storage = window.localStorage;
    let saved = readPurchase(storage);
    if (saved?.order !== undefined) return saved.order;
    if (saved === null) {
      const bytes = window.crypto.getRandomValues(new Uint8Array(32));
      const requestId = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/u, '');
      saved = { schemaVersion: 1, requestId };
      savePurchase(storage, saved);
    }
    const order = await licensingRequest(fetcher, '/v1/checkout', {
      requestId: saved.requestId,
      operation: 'purchase',
    });
    if (!validBrowserOrder(order)) throw new Error('Invalid purchase response');
    const recorded = {
      orderId: order.orderId,
      claimToken: order.claimToken,
      checkoutUrl: order.checkoutUrl,
      amount: order.amount,
      currency: order.currency,
    };
    savePurchase(storage, { ...saved, order: recorded });
    return recorded;
  });
}

export async function claimBrowserPurchase(order, fetcher) {
  if (!validBrowserOrder(order)) throw new Error('Saved purchase unavailable');
  const value = await licensingRequest(fetcher, '/v1/orders/claim', {
    orderId: order.orderId,
    claimToken: order.claimToken,
  });
  if (!validClaim(value)) throw new Error('Licence confirmation unavailable');
  return value.licenseKey;
}
