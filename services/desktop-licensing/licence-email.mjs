/* global AbortSignal, URL, fetch */
// Emails a buyer their licence key once Paddle's signed webhook has fulfilled the
// purchase (ADR-579), so a key survives a closed tab or a cleared browser.
//
// The buyer's address comes from Paddle (GET /customers/{id}) only at send time. It
// is never stored, logged or audited; the order records only whether sending
// succeeded and a fixed error code. Sending happens after fulfilment and never
// changes it: a failure leaves the purchase claimable as before.

const FROM = /^[a-z0-9._-]{1,64}@kerfdesk\.com$/u;
const ADDRESS = /^[^\s@<>"',;:\\]{1,64}@[^\s@<>"',;:\\]{1,253}\.[^\s@<>"',;:\\]{2,63}$/u;
const CUSTOMER = /^ctm_[a-z0-9]{26}$/u;
const ERROR_CODE = /^E_[A-Z_]{1,60}$/u;

/** Whether this deployment emails keys: the switch, the binding and a kerfdesk.com sender. */
export function licenceEmailEnabled(env) {
  return (
    env.LICENCE_EMAIL_ENABLED === 'true' &&
    typeof env.EMAIL?.send === 'function' &&
    FROM.test(env.LICENCE_EMAIL_FROM ?? '') &&
    typeof env.PADDLE_API_KEY === 'string'
  );
}

export function validCustomerId(value) {
  return typeof value === 'string' && CUSTOMER.test(value);
}

/** The buyer's email address from Paddle, or null when Paddle cannot supply one. */
export async function paddleCustomerEmail(env, customerId, fetcher = fetch) {
  if (!validCustomerId(customerId)) return null;
  const api =
    env.PADDLE_ENVIRONMENT === 'live' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
  let response;
  try {
    response = await fetcher(new URL(`/customers/${customerId}`, api).href, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
      headers: { authorization: `Bearer ${env.PADDLE_API_KEY}`, 'paddle-version': '1' },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    const email = (await response.json())?.data?.email;
    return typeof email === 'string' && email.length <= 320 && ADDRESS.test(email) ? email : null;
  } catch {
    return null;
  }
}

/** The message: plain steps, the key, and the order number support asks for. */
export function licenceEmailMessage(licenseKey, orderId) {
  const text = [
    'Thank you for buying KerfDesk Pro.',
    '',
    'Your licence key:',
    licenseKey,
    '',
    'To activate it on a Windows computer:',
    '1. Copy the key above.',
    '2. In KerfDesk, open Help > Licence, or click Free · Try Pro in the status bar.',
    '3. Choose Paste key, then Activate licence.',
    '',
    'The key works on three computers at a time. Keep this email: it is how you activate KerfDesk again after replacing or reinstalling a computer.',
    '',
    `Order number: ${orderId}`,
    'Help: support@kerfdesk.com. Never send your full key or card details in an email.',
  ].join('\n');
  // The key and order ID are base64url/UUID characters; nothing here needs escaping.
  const html = `<p>Thank you for buying KerfDesk Pro.</p>
<p>Your licence key:</p>
<p style="font-family:monospace;font-size:15px;word-break:break-all">${licenseKey}</p>
<p>To activate it on a Windows computer:</p>
<ol><li>Copy the key above.</li><li>In KerfDesk, open <b>Help &gt; Licence</b>, or click <b>Free · Try Pro</b> in the status bar.</li><li>Choose <b>Paste key</b>, then <b>Activate licence</b>.</li></ol>
<p>The key works on three computers at a time. Keep this email: it is how you activate KerfDesk again after replacing or reinstalling a computer.</p>
<p>Order number: ${orderId}<br>Help: support@kerfdesk.com. Never send your full key or card details in an email.</p>`;
  return { subject: 'Your KerfDesk Pro licence key', text, html };
}

/**
 * Sends the key for a just-fulfilled purchase and records the outcome on the order.
 * Renewals, duplicates and refused payments send nothing.
 */
export async function emailLicenceKey(authority, env, event, result, fetcher = fetch) {
  if (!licenceEmailEnabled(env) || result?.duplicate !== false || result.rejected) return;
  const order = authority.records.get(`order:${event.orderId}`);
  if (order?.status !== 'fulfilled' || order.operation !== 'purchase' || order.keyEmail) return;
  const license = authority.records.get(`license:${order.licenseId}`);
  let outcome;
  try {
    const to = await paddleCustomerEmail(env, event.customerId, fetcher);
    if (to === null) outcome = { status: 'failed', code: 'no_address' };
    else {
      const message = licenceEmailMessage(
        await authority.licenseKey(order.licenseId, license?.keyVersion),
        order.orderId,
      );
      await env.EMAIL.send({
        to,
        from: { email: env.LICENCE_EMAIL_FROM, name: 'KerfDesk' },
        replyTo: 'support@kerfdesk.com',
        ...message,
      });
      outcome = { status: 'sent', code: null };
    }
  } catch (error) {
    const code =
      typeof error?.code === 'string' && ERROR_CODE.test(error.code) ? error.code : 'send_failed';
    outcome = { status: 'failed', code };
  }
  authority.records.transaction((tx) => {
    const current = tx.get(`order:${event.orderId}`);
    if (current && !current.keyEmail)
      tx.put(`order:${event.orderId}`, {
        ...current,
        keyEmail: { ...outcome, at: authority.now() },
      });
  });
}
