/* global URL */
import { LicensingAuthority } from './authority.mjs';
import { createCryptography } from './crypto.mjs';
import { authorityRequest, failure } from './http.mjs';
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

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/v1/public/config' && !url.search)
        return publicConfiguration(request, env);
      requireValue(env.LICENSING_ENABLED === 'true', 503, 'service_unavailable');
      requireValue(url.protocol === 'https:', 400, 'https_required');
      requireValue(env.LICENSE_AUTHORITY && env.REQUEST_RATE_LIMITER, 503, 'service_unavailable');
      const ip = request.headers.get('cf-connecting-ip');
      requireValue(ip && ip.length <= 64, 400, 'client_address_required');
      // Cloudflare supplies this header at the edge. The rate-limit key is an
      // address only inside the binding; request bodies and credentials are never keys.
      const limit = await env.REQUEST_RATE_LIMITER.limit({ key: ip });
      requireValue(limit.success, 429, 'rate_limited');
      const id = env.LICENSE_AUTHORITY.idFromName('licensing-authority-v1');
      return await env.LICENSE_AUTHORITY.get(id).fetch(request);
    } catch (error) {
      return failure(error);
    }
  },
};
