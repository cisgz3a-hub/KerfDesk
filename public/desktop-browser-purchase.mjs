/* global URL */
import { checkoutTransaction, publicConfig } from './desktop-checkout-api.mjs';
import {
  readPurchase,
  prepareBrowserPurchase,
  claimBrowserPurchase,
  supportsBrowserPurchase,
} from './desktop-browser-order.mjs';

const PENDING =
  'Payment is not confirmed yet. Check payment again in a moment. Do not start another purchase.';
const RECOVERY =
  'Checkout could not continue. Keep this browser’s data and try Check payment or Retry availability. If you already paid, contact support with your receipt before paying again.';

export async function startBrowserPurchase(window, fetcher, openCheckout, agreement) {
  const page = new BrowserPurchasePage(window, fetcher, openCheckout, agreement);
  await page.start();
  return page;
}

class BrowserPurchasePage {
  constructor(window, fetcher, openCheckout, agreement) {
    this.window = window;
    this.fetcher = fetcher;
    this.openCheckout = openCheckout;
    this.agreement = agreement;
    this.config = null;
    this.pending = null;
    this.busy = false;
    this.key = null;
    this.storageReady = false;
    this.element = (id) => window.document.getElementById(id);
  }

  async start() {
    for (const box of this.agreement?.boxes ?? [])
      box.addEventListener('change', () => this.render());
    this.element('browser-purchase').hidden = false;
    this.element('desktop-checkout-note').hidden = true;
    this.element('purchase-open').addEventListener('click', () => void this.run(() => this.buy()));
    this.element('purchase-check').addEventListener(
      'click',
      () => void this.run(() => this.check()),
    );
    this.element('purchase-refresh').addEventListener('click', () => void this.refresh());
    this.element('licence-copy').addEventListener('click', () => void this.copyKey());
    await this.refresh();
  }

  status(message) {
    this.element('checkout-status').textContent = message;
  }

  async run(action) {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await action();
    } catch (error) {
      if (error?.code === 'payment_pending') this.status(PENDING);
      else if (error?.code === 'payment_rejected')
        this.status(
          'The payment needs support review. Do not pay again. Contact support with your receipt and order reference.',
        );
      else this.status(RECOVERY);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  readSaved() {
    try {
      this.pending = readPurchase(this.window.localStorage);
      this.storageReady = true;
      return true;
    } catch {
      this.storageReady = false;
      this.status(
        'This browser cannot recover a saved purchase. Allow site storage before buying. If you already paid, contact support with your receipt.',
      );
      return false;
    }
  }

  async refresh() {
    await this.run(async () => {
      if (!this.readSaved()) return;
      try {
        this.config = await publicConfig(this.fetcher);
      } catch {
        this.config = null;
        this.status(
          'Purchasing is temporarily unavailable. Try again when you are online. A saved purchase can still be checked below.',
        );
        return;
      }
      if (this.pending !== null) {
        this.status(
          this.pending.order === undefined && this.config === null
            ? 'An unfinished purchase is saved, but checkout is closed. Keep this browser data and contact support if you paid. Do not start another purchase.'
            : 'A purchase is saved on this device. Check payment to retrieve your licence, or resume the same checkout.',
        );
      } else if (this.config === null)
        this.status(
          'Pro purchases are not open yet. No payment will be taken. You can still download and use KerfDesk Free.',
        );
      else if (!supportsBrowserPurchase(this.window))
        this.status(
          'Purchasing needs a browser with secure site storage and Web Locks. Use a current browser or buy through the Windows app.',
        );
      else
        this.status(
          this.config.environment === 'sandbox'
            ? 'Test checkout only. No real payment will be taken.'
            : 'Buy here, then activate your licence in the Windows app. This phone does not use a licence seat.',
        );
    });
  }

  async buy() {
    if (this.agreement && !this.agreement.agreed()) return;
    if (!this.readSaved() || this.key !== null) return;
    this.config = await publicConfig(this.fetcher);
    if (this.config === null) {
      this.status('Pro purchases are not open yet. Your saved purchase, if any, has been kept.');
      return;
    }
    this.status('Saving your purchase before opening secure checkout…');
    const order = await prepareBrowserPurchase(this.window, this.fetcher);
    this.readSaved();
    // Never reopen payment for an order already fulfilled. Only the service's
    // explicit pending result permits the payment UI; errors never mean unpaid.
    try {
      this.showKey(await claimBrowserPurchase(order, this.fetcher));
      return;
    } catch (error) {
      if (error?.code !== 'payment_pending') throw error;
    }
    const transaction = checkoutTransaction(new URL(order.checkoutUrl).search);
    await this.openCheckout(this.window, this.config, transaction, () => {
      this.status(
        'Checkout finished. Select Check payment to confirm with the licence service and reveal your key.',
      );
      this.element('purchase-check').focus();
    });
    this.status(
      'Secure checkout is open. Afterwards, select Check payment here to get your licence key.',
    );
  }

  async check() {
    if (!this.readSaved() || this.pending === null) return;
    let order = this.pending.order;
    if (order === undefined) {
      this.config = await publicConfig(this.fetcher);
      if (this.config === null) {
        this.status(
          'Checkout is closed and this browser has no confirmed order response. Keep its saved data and contact support with your receipt if you paid.',
        );
        return;
      }
      order = await prepareBrowserPurchase(this.window, this.fetcher);
      this.readSaved();
    }
    this.status('Confirming payment with the licence service…');
    this.showKey(await claimBrowserPurchase(order, this.fetcher));
  }

  showKey(key) {
    this.key = key;
    const field = this.element('licence-key');
    field.value = key;
    this.element('licence-result').hidden = false;
    this.status(
      'Payment confirmed. Save your licence key, then enter it in Help → Licence in KerfDesk for Windows.',
    );
    field.focus();
  }

  async copyKey() {
    if (this.key === null) return;
    try {
      await this.window.navigator.clipboard.writeText(this.key);
      this.element('licence-copy-status').textContent = 'Licence key copied.';
    } catch {
      const field = this.element('licence-key');
      field.focus();
      field.select();
      this.element('licence-copy-status').textContent = 'Select and copy the licence key above.';
    }
  }

  render() {
    if (this.agreement) this.agreement.element.hidden = !this.config;
    const buy = this.element('purchase-open');
    buy.disabled =
      this.busy ||
      !this.config ||
      !this.storageReady ||
      this.key !== null ||
      (this.agreement && !this.agreement.agreed()) ||
      !supportsBrowserPurchase(this.window);
    buy.textContent =
      this.key !== null
        ? 'Licence ready'
        : this.config === null
          ? 'Purchase unavailable'
          : this.config.environment === 'sandbox'
            ? 'Open test purchase · no charge'
            : this.pending === null
              ? 'Buy Pro · US$49.50'
              : 'Resume purchase';
    const check = this.element('purchase-check');
    check.hidden = this.pending === null;
    check.disabled = this.busy || !this.storageReady;
    this.element('purchase-refresh').disabled = this.busy;
    this.element('purchase-reference').textContent =
      this.pending?.order === undefined ? '' : `Order reference: ${this.pending.order.orderId}`;
    this.element('browser-purchase').setAttribute('aria-busy', String(this.busy));
  }
}
