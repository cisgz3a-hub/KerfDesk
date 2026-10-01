/* global setTimeout, clearTimeout, fetch, window */
import { checkoutTransaction, publicConfig } from './desktop-checkout-api.mjs';
import { startBrowserPurchase } from './desktop-browser-purchase.mjs';
export { checkoutTransaction, checkoutConfiguration } from './desktop-checkout-api.mjs';

const sessions = new WeakMap();

async function paddleScript(document) {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    script.async = true;
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error('Checkout load timed out'));
    }, 15000);
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error('Checkout failed to load'));
    };
    document.head.append(script);
  });
}

async function openCheckout(window, config, transaction, onCompleted) {
  let session = sessions.get(window);
  if (session === undefined) {
    await paddleScript(window.document);
    const paddle = window.Paddle;
    if (!paddle?.Initialize || !paddle?.Checkout?.open) throw new Error('Checkout unavailable');
    session = { token: config.token, environment: config.environment, onCompleted };
    if (config.environment === 'sandbox') paddle.Environment.set('sandbox');
    paddle.Initialize({
      token: config.token,
      eventCallback: (event) => {
        if (event.name === 'checkout.completed') session.onCompleted();
      },
    });
    sessions.set(window, session);
  }
  if (session.token !== config.token || session.environment !== config.environment)
    throw new Error('Checkout configuration changed; reload this page');
  session.onCompleted = onCompleted;
  window.Paddle.Checkout.open({
    transactionId: transaction,
    settings: { showAddDiscounts: false },
  });
}

const UNAVAILABLE =
  'Checkout is temporarily unavailable. Return to KerfDesk to check an existing payment before trying again.';
export async function startCheckoutPage(window, fetcher = fetch) {
  const status = window.document.getElementById('checkout-status');
  const button = window.document.getElementById('checkout-open');
  const agreement = window.document.getElementById('checkout-agreement');
  if (!status || !button || !agreement) return;
  const boxes = [...agreement.querySelectorAll('input[data-checkout-agreement]')];
  const agreed = () => boxes.length === 2 && boxes.every((box) => box.checked);
  const transaction = checkoutTransaction(window.location.search);
  if (transaction === null) {
    if (window.location.search === '')
      return startBrowserPurchase(window, fetcher, openCheckout, {
        element: agreement,
        boxes,
        agreed,
      });
    status.textContent =
      'This checkout link is invalid. Reopen it from the desktop app or visit the licence page without a query string.';
    return;
  }
  try {
    const config = await publicConfig(fetcher);
    if (config === null) {
      status.textContent =
        'Checkout is not available yet. Return to KerfDesk to check an existing payment.';
      return;
    }
    const refresh = () => {
      button.disabled = !agreed();
    };
    for (const box of boxes) box.addEventListener('change', refresh);
    // No discount field: the licence service refuses a discounted payment, so a code
    // entered here would take money without issuing a licence (ADR-523 Amendment 3).
    button.addEventListener('click', () => {
      if (!agreed()) return;
      void (async () => {
        try {
          await openCheckout(window, config, transaction, () => {
            status.textContent =
              'Return to KerfDesk and select Check payment to confirm and activate your purchase.';
          });
        } catch {
          status.textContent = UNAVAILABLE;
        }
      })();
    });
    refresh();
    agreement.hidden = false;
    button.hidden = false;
    status.textContent =
      config.environment === 'sandbox'
        ? 'Test checkout. No real payment will be taken. Tick both boxes to open the checkout.'
        : 'Tick both boxes to open the secure checkout.';
  } catch {
    status.textContent = UNAVAILABLE;
  }
}

if (typeof window !== 'undefined') void startCheckoutPage(window);
