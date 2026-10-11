import { z } from 'zod';

const PREFIX = 'push:v1:';
const MAX_SUBSCRIPTIONS = 20;
/** Browser push services only; the relay never fetches an arbitrary URL. */
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  'notify.windows.com',
];
const MESSAGES: Record<string, string> = {
  'job.finished': 'Your job finished on the KerfDesk computer.',
  'job.stopped': 'The job stopped on the KerfDesk computer. Check the machine.',
  'machine.alarm': 'The machine reported an alarm. Check it on the KerfDesk computer.',
};

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);
export const pushSubscriptionSchema = z.strictObject({
  endpoint: z
    .string()
    .max(1024)
    .refine((value) => allowedEndpoint(value)),
  keys: z.strictObject({ p256dh: base64url.length(87), auth: base64url.length(22) }),
});
export type StoredSubscription = z.output<typeof pushSubscriptionSchema>;

export function allowedEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      url.username === '' &&
      PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };
export function vapidConfig(env: Env): VapidConfig | null {
  const values = env as unknown as Record<string, unknown>;
  const publicKey = values.VAPID_PUBLIC_KEY;
  const privateKey = values.VAPID_PRIVATE_KEY;
  const subject = values.VAPID_SUBJECT;
  if (
    typeof publicKey !== 'string' ||
    typeof privateKey !== 'string' ||
    typeof subject !== 'string' ||
    !/^[A-Za-z0-9_-]{87}$/.test(publicKey) ||
    !/^[A-Za-z0-9_-]{43}$/.test(privateKey) ||
    !/^(mailto:|https:)/.test(subject)
  )
    return null;
  return { publicKey, privateKey, subject };
}

/** One subscription per approved client, deleted with the client (ADR-583). */
export class PushAlerts {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
  ) {}
  save(clientId: string, subscription: StoredSubscription | null): boolean {
    const key = `${PREFIX}${clientId}`;
    if (subscription === null) {
      this.storage.kv.delete(key);
      return true;
    }
    const existing = Array.from(
      this.storage.kv.list({ prefix: PREFIX, limit: MAX_SUBSCRIPTIONS + 1 }),
    );
    if (existing.length >= MAX_SUBSCRIPTIONS && this.storage.kv.get(key) === undefined)
      return false;
    this.storage.kv.put(key, subscription);
    return true;
  }
  remove(clientId: string): void {
    this.storage.kv.delete(`${PREFIX}${clientId}`);
  }
  async deliver(kind: string, approved: (clientId: string) => boolean): Promise<void> {
    const config = vapidConfig(this.env);
    const body = MESSAGES[kind];
    if (config === null || body === undefined) return;
    const payload = JSON.stringify({ title: 'KerfDesk', body, tag: kind });
    for (const [key, value] of this.storage.kv.list({ prefix: PREFIX, limit: MAX_SUBSCRIPTIONS })) {
      const clientId = key.slice(PREFIX.length);
      const subscription = pushSubscriptionSchema.safeParse(value);
      if (!subscription.success || !approved(clientId)) {
        this.storage.kv.delete(key);
        continue;
      }
      try {
        const status = await sendPush(subscription.data, payload, config);
        if (status === 404 || status === 410) this.storage.kv.delete(key);
      } catch {
        /* Delivery is best effort; the PC and machine stay authoritative. */
      }
    }
  }
}

export async function sendPush(
  subscription: StoredSubscription,
  payload: string,
  config: VapidConfig,
): Promise<number> {
  const body = await encryptPayload(subscription, new TextEncoder().encode(payload));
  const audience = new URL(subscription.endpoint).origin;
  const jwt = await vapidJwt(audience, config);
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'high',
      Authorization: `vapid t=${jwt}, k=${config.publicKey}`,
    },
    body,
  });
  await response.body?.cancel();
  return response.status;
}

/** RFC 8291 aes128gcm with a single record. */
export async function encryptPayload(
  subscription: StoredSubscription,
  plaintext: Uint8Array,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
  localKeys?: CryptoKeyPair,
): Promise<Uint8Array> {
  const uaPublic = decodeBase64url(subscription.keys.p256dh);
  const authSecret = decodeBase64url(subscription.keys.auth);
  const keys =
    localKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair);
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer,
  );
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  // Web Crypto's ECDH parameter is `public`; the Workers typings spell it `$public`.
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, keys.privateKey, 256));
  const keyInfo = concat(new TextEncoder().encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hmac(await hmac(authSecret, shared), concat(keyInfo, [1]));
  const prk = await hmac(salt, ikm);
  const cek = (
    await hmac(prk, concat(new TextEncoder().encode('Content-Encoding: aes128gcm\0'), [1]))
  ).slice(0, 16);
  const nonce = (
    await hmac(prk, concat(new TextEncoder().encode('Content-Encoding: nonce\0'), [1]))
  ).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, [2])),
  );
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

async function vapidJwt(audience: string, config: VapidConfig): Promise<string> {
  const publicKey = decodeBase64url(config.publicKey);
  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: config.privateKey,
      x: encodeBase64url(publicKey.slice(1, 33)),
      y: encodeBase64url(publicKey.slice(33, 65)),
      ext: false,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const encode = (value: unknown) =>
    encodeBase64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: config.subject,
  })}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${encodeBase64url(new Uint8Array(signature))}`;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data));
}
function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
export function decodeBase64url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
export function encodeBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
