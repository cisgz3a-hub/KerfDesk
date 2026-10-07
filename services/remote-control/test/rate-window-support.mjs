import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ORIGIN, start } from './support.mjs';

const HEADER = 'x-audit-rate-calls';
const PERIOD_MS = 60_000;

/** Wrap real public/client/Abort bindings only to witness call times; no replacement clock/limiter. */
export function startObservedRateWorker(options = {}) {
  const source = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
  const matches = [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*_default) as default/g)];
  assert.equal(matches.length, 1, 'Witness must wrap the actual built Worker default.');
  const wrapped =
    source.replace(matches[0][0], 'rateWindowWitness as default') +
    `
const rateWindowWitness = { async fetch(request, env, ctx) {
  if (new URL(request.url).pathname === '/__audit_rate_window')
    return Response.json({ now: Date.now() });
  const calls = [], limits = {};
  for (const binding of ['PUBLIC_LIMIT', 'CLIENT_LIMIT', 'ABORT_LIMIT'])
    limits[binding] = { async limit(input) {
      const started = Date.now();
      const result = await env[binding].limit(input);
      calls.push({ binding, started, ended: Date.now(), success: result.success });
      return result;
    } };
  const response = await ${matches[0][1]}.fetch(request, { ...env, ...limits }, ctx);
  if (response.status === 101 || !calls.length) return response;
  const headers = new Headers(response.headers);
  headers.set('${HEADER}', JSON.stringify(calls));
  return new Response(response.body, { status: response.status, headers });
} };
`;
  // This route/header exists only in the local wrapper, never in production source or assets.
  return start({ ...options, extra: { ...options.extra, scriptPath: undefined, script: wrapped } });
}

async function runtimeNow(worker) {
  const response = await worker.dispatchFetch(`${ORIGIN}/__audit_rate_window`);
  assert.equal(response.status, 200);
  const { now } = await response.json();
  assert.ok(Number.isSafeInteger(now));
  return now;
}

/** Start with enough witnessed Workerd time for the bounded burst, without retries. */
export async function admissionWindow(worker) {
  let now = await runtimeNow(worker);
  const remaining = PERIOD_MS - (now % PERIOD_MS);
  if (remaining < 10_000) {
    await new Promise((resolve) => setTimeout(resolve, remaining + 50));
    now = await runtimeNow(worker);
  }
  assert.ok(PERIOD_MS - (now % PERIOD_MS) >= 10_000, 'Fresh runtime window required.');
  return Math.floor(now / PERIOD_MS);
}

export function rateCall(response, epoch, binding, success) {
  const calls = JSON.parse(response.headers.get(HEADER) ?? 'null');
  assert.equal(calls?.length, 1, 'Exactly one real rate binding call must be witnessed.');
  const call = calls[0];
  const evidence = JSON.stringify({ expectedBinding: binding, expectedEpoch: epoch, ...call });
  assert.equal(call.binding, binding, 'Another admission lane was used: ' + evidence);
  assert.equal(
    Math.floor(call.started / PERIOD_MS),
    epoch,
    'Binding call started in another window: ' + evidence,
  );
  assert.equal(
    Math.floor(call.ended / PERIOD_MS),
    epoch,
    'Binding call crossed a window: ' + evidence,
  );
  assert.equal(call.success, success, 'Binding outcome differed: ' + evidence);
  return call;
}

export function publicRateCall(response, epoch, success) {
  return rateCall(response, epoch, 'PUBLIC_LIMIT', success);
}
