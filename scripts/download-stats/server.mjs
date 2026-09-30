import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fetchDownloadReport } from './report.mjs';
import { historySummary, mergeHistory, readHistory, saveHistory } from './history.mjs';

const ASSETS = new Map([
  ['/', ['dashboard.html', 'text/html; charset=utf-8']],
  ['/dashboard.css', ['dashboard.css', 'text/css; charset=utf-8']],
  ['/dashboard.mjs', ['dashboard.mjs', 'text/javascript; charset=utf-8']],
]);
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function json(response, status, body, extraHeaders = {}) {
  response.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json', ...extraHeaders });
  response.end(JSON.stringify(body));
}

async function requestBody(request) {
  if (request.headers['content-type'] !== 'application/json') throw new Error('invalid_request');
  let body = '';
  for await (const part of request) {
    body += part;
    if (body.length > 2048) throw new Error('invalid_request');
  }
  return JSON.parse(body);
}

function credentials(value) {
  if (
    typeof value.token !== 'string' ||
    !/^[\w-]{20,256}$/u.test(value.token) ||
    typeof value.zoneId !== 'string' ||
    !/^[a-f\d]{32}$/iu.test(value.zoneId)
  )
    throw new Error('invalid_credentials');
  return { token: value.token, zoneId: value.zoneId };
}

/** Only loopback clients and same-origin JSON actions can reach the credential. */
export async function createDownloadDashboard({
  historyPath,
  token,
  zoneId,
  fetchReport = fetchDownloadReport,
}) {
  let config = token && zoneId ? credentials({ token, zoneId }) : null;
  let history = await readHistory(historyPath);
  let report = null;
  let busy = false;
  let retryAt = 0;
  const state = () => ({
    configured: config !== null,
    busy,
    report,
    history: historySummary(history),
    retryAt,
  });
  const refresh = async (days, selected = config) => {
    if (!selected) throw new Error('not_connected');
    const next = await fetchReport({ ...selected, days });
    const archive = mergeHistory(history, next);
    await saveHistory(historyPath, archive);
    history = archive;
    report = next;
  };
  const server = createServer(async (request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (request.headers.host !== new URL(origin).host) {
      json(response, 403, { error: 'This dashboard accepts local connections only.' });
      return;
    }
    try {
      const path = new URL(request.url, origin).pathname;
      if (request.method === 'GET' && path === '/favicon.ico') {
        response.writeHead(204, HEADERS);
        response.end();
        return;
      }
      if (request.method === 'GET' && ASSETS.has(path)) {
        const [name, type] = ASSETS.get(path);
        const body = await readFile(new URL(name, import.meta.url));
        response.writeHead(200, { ...HEADERS, 'Content-Type': type });
        response.end(body);
        return;
      }
      if (request.method === 'GET' && path === '/api/status') {
        json(response, 200, state());
        return;
      }
      if (request.method !== 'POST' || request.headers.origin !== origin) {
        json(response, 403, { error: 'Use the dashboard in this browser to make changes.' });
        return;
      }
      if (!['/api/connect', '/api/refresh', '/api/disconnect'].includes(path)) {
        json(response, 404, { error: 'Not found' });
        return;
      }
      if (busy) {
        json(response, 409, { error: 'A refresh is already running. Please wait.' });
        return;
      }
      if (path !== '/api/disconnect' && Date.now() < retryAt) {
        const remaining = Math.ceil((retryAt - Date.now()) / 1000);
        json(
          response,
          429,
          {
            error: `Cloudflare is rate limited. Try again in ${remaining} seconds.`,
            code: 'analytics_rate_limited',
            retryAfterSeconds: remaining,
          },
          { 'Retry-After': String(remaining) },
        );
        return;
      }
      busy = true;
      try {
        const body = await requestBody(request);
        if (path === '/api/disconnect') config = null;
        else {
          const selected = path === '/api/connect' ? credentials(body) : config;
          const days = body.days ?? 7;
          if (![1, 7, 30].includes(days)) throw new Error('invalid_request');
          await refresh(days, selected);
          config = selected;
        }
        json(response, 200, { ...state(), busy: false });
      } finally {
        busy = false;
      }
    } catch (error) {
      const delayed = Number.isFinite(error.retryAfterSeconds) && error.retryAfterSeconds > 0;
      if (delayed) retryAt = Math.max(retryAt, Date.now() + error.retryAfterSeconds * 1000);
      const messages = {
        invalid_credentials:
          'Enter a valid Cloudflare Analytics read token and 32-character Zone ID.',
        invalid_request: 'The request was invalid. Reload the dashboard and try again.',
        not_connected: 'Connect a Cloudflare Analytics read token first.',
      };
      json(
        response,
        delayed ? 429 : 400,
        {
          error:
            messages[error.message] ??
            error.publicMessage ??
            'The refresh failed. Saved figures are unchanged; no zero total was recorded.',
          code: error.code ?? 'refresh_failed',
          ...(delayed ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        },
        delayed ? { 'Retry-After': String(Math.ceil(error.retryAfterSeconds)) } : {},
      );
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}
