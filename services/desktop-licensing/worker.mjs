/* global Request, URL */
import { LicensingAuthority } from './authority.mjs';
import {
  browserPurchasePreflight,
  browserPurchaseResponse,
  requirePurchaseOrigin,
} from './browser-purchase.mjs';
import { createCryptography } from './crypto.mjs';
import { authorityRequest, failure, json } from './http.mjs';
import { rateLimitKey, rateLimiterFor } from './rate-limit.mjs';
import { logRequest } from './request-log.mjs';
import { ROUTE } from './routes.mjs';
import { SqliteRecords } from './storage.mjs';
import { requireValue } from './validation.mjs';
import { publicConfiguration } from './public-config.mjs';

export class LicenseAuthority {
  constructor(ctx, env) {
    this.env = env;
    this.records = new SqliteRecords(ctx.storage);
    this.crypto = null;
  }

  async fetch(request) {
    try {
      // The health check needs no secrets and answers while licensing is switched off.
      if (request.method === 'GET' && new URL(request.url).pathname === ROUTE.health) {
        this.records.ping();
        return json({ ok: true });
      }
      requireValue(this.env.LICENSING_ENABLED === 'true', 503, 'service_unavailable');
      this.crypto ??= createCryptography(this.env).catch(() => {
        this.crypto = null;
        throw new Error('Configuration unavailable');
      });
      const authority = new LicensingAuthority(this.records, await this.crypto);
      return authorityRequest(request, this.env, authority);
    } catch (error) {
      return failure(error);
    }
  }
}

function authorityObject(env) {
  return env.LICENSE_AUTHORITY.get(env.LICENSE_AUTHORITY.idFromName('licensing-authority-v1'));
}

// Every licence call goes through the one Durable Object, so a client polling the
// health check in a loop must not queue ahead of them: each isolate reuses its last
// answer for a binding this long. An uptime monitor asks far less often.
const HEALTH_ANSWER_MS = 10_000;
const recentHealth = new WeakMap();

/**
 * One round trip to the Durable Object and its SQLite store, for an uptime monitor.
 * Like the public configuration it skips the rate limit and works while licensing is
 * switched off (ADR-523 Amendment 3).
 */
async function health(request, env) {
  const binding = env.LICENSE_AUTHORITY;
  if (!binding) return json({ ok: false }, 503);
  const now = Date.now();
  let recent = recentHealth.get(binding);
  // An answer from the future (a clock that stepped back) counts as stale.
  if (!recent || now < recent.at || now - recent.at >= HEALTH_ANSWER_MS) {
    recent = { at: now, ok: await pingAuthority(request, env) };
    recentHealth.set(binding, recent);
  }
  return recent.ok ? json({ ok: true }) : json({ ok: false }, 503);
}

async function pingAuthority(request, env) {
  try {
    const response = await authorityObject(env).fetch(
      new Request(new URL(ROUTE.health, request.url), { method: 'GET' }),
    );
    const body = response.ok ? await response.json() : null;
    return body?.ok === true;
  } catch {
    return false;
  }
}

async function route(request, env, url) {
  if (request.method === 'GET' && !url.search) {
    if (url.pathname === ROUTE.config) return publicConfiguration(request, env);
    if (url.pathname === ROUTE.health) return health(request, env);
  }
  requirePurchaseOrigin(request, url);
  if (request.method === 'OPTIONS') return browserPurchasePreflight(request, url);
  requireValue(env.LICENSING_ENABLED === 'true', 503, 'service_unavailable');
  requireValue(url.protocol === 'https:', 400, 'https_required');
  const limiter = rateLimiterFor(env, url.pathname);
  requireValue(env.LICENSE_AUTHORITY && limiter, 503, 'service_unavailable');
  // Cloudflare supplies this header at the edge. The rate-limit key is an address (a
  // /64 for IPv6) only inside the binding; bodies and credentials are never keys.
  const key = rateLimitKey(request.headers.get('cf-connecting-ip'));
  requireValue(key, 400, 'client_address_required');
  const limit = await limiter.limit({ key });
  requireValue(limit.success, 429, 'rate_limited');
  return await authorityObject(env).fetch(request);
}

export default {
  async fetch(request, env) {
    const started = Date.now();
    let url = null;
    let response;
    try {
      url = new URL(request.url);
      response = await route(request, env, url);
    } catch (error) {
      response = failure(error);
    }
    response = browserPurchaseResponse(request, url, response);
    try {
      return await logRequest(request, url, response, started);
    } catch {
      return response; // A log line must never cost the caller an answer.
    }
  },
};
