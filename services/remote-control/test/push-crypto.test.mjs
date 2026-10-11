import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

/** Bundles src/push.ts for Node so the exact Worker code is tested. */
async function loadPush() {
  const result = await build({
    entryPoints: [
      new URL('../src/push.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    ],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const b64 = (value) => Buffer.from(value.replace(/\s/g, ''), 'base64url');

// RFC 8291 Section 5 and Appendix A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('push encryption reproduces the RFC 8291 example byte for byte', async () => {
  const { encryptPayload } = await loadPush();
  const asPublic = b64(RFC.asPublic);
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: RFC.asPrivate,
      x: asPublic.subarray(1, 33).toString('base64url'),
      y: asPublic.subarray(33, 65).toString('base64url'),
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const publicKey = await crypto.subtle.importKey(
    'raw',
    asPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  const body = await encryptPayload(
    {
      endpoint: 'https://fcm.googleapis.com/fcm/send/x',
      keys: { p256dh: RFC.uaPublic, auth: RFC.auth },
    },
    new TextEncoder().encode(RFC.plaintext),
    new Uint8Array(b64(RFC.salt)),
    { privateKey, publicKey },
  );
  assert.equal(Buffer.from(body).toString('base64url'), RFC.body);
});

test('VAPID authorisation is a valid ES256 JWT for the push service origin only', async () => {
  const { sendPush, allowedEndpoint, pushSubscriptionSchema } = await loadPush();
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
  const raw = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey));
  const config = {
    publicKey: raw.toString('base64url'),
    privateKey: jwk.d,
    subject: 'mailto:support@example.com',
  };
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: {
      p256dh: Buffer.from(await crypto.subtle.exportKey('raw', ua.publicKey)).toString('base64url'),
      auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url'),
    },
  };
  assert.equal(pushSubscriptionSchema.safeParse(subscription).success, true);
  const original = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(null, { status: 201 });
  };
  try {
    assert.equal(await sendPush(subscription, '{"title":"KerfDesk"}', config), 201);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(captured.init.redirect, 'manual');
  assert.equal(captured.init.headers['Content-Encoding'], 'aes128gcm');
  const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(captured.init.headers.Authorization);
  assert.equal(key, config.publicKey);
  const [header, claims, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const body = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(body.aud, 'https://fcm.googleapis.com');
  assert.equal(body.sub, config.subject);
  assert.ok(body.exp > Date.now() / 1000 && body.exp <= Date.now() / 1000 + 24 * 3600);
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    keys.publicKey,
    Buffer.from(signature, 'base64url'),
    new TextEncoder().encode(`${header}.${claims}`),
  );
  assert.equal(valid, true);
  for (const endpoint of [
    'http://fcm.googleapis.com/x',
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/x',
    'https://user@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://169.254.169.254/latest',
  ])
    assert.equal(allowedEndpoint(endpoint), false, endpoint);
  for (const endpoint of [
    'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://web.push.apple.com/x',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
  ])
    assert.equal(allowedEndpoint(endpoint), true, endpoint);
});
