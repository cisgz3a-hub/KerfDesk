import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createDownloadDashboard } from './server.mjs';
import { mergeHistory, readHistory } from './history.mjs';

const TOKEN = 'synthetic-read-token-not-a-secret';
const ZONE = 'a'.repeat(32);
const day = (full = 4, from = '2026-09-29T00:00:00.000Z', to = '2026-09-30T00:00:00.000Z') => ({
  date: '2026-09-29',
  from,
  to,
  full,
  partial: 2,
});
function report(full = 4) {
  return {
    generatedAt: '2026-09-30T12:00:00.000Z',
    days: [day(full)],
    rows: [
      {
        date: '2026-09-29',
        version: '1.0.2',
        platform: 'windows-x64',
        channel: 'commercial-manual',
        full,
        partial: 2,
      },
    ],
  };
}
async function fixture(t, fetchReport = async () => report()) {
  const directory = await mkdtemp(join(tmpdir(), 'kerfdesk-download-stats-'));
  const historyPath = join(directory, 'history.json');
  const server = await createDownloadDashboard({ historyPath, fetchReport });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true });
  });
  const post = (path, body, headers = {}) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return { server, historyPath, origin, post };
}

test('loopback dashboard rejects foreign origins and DNS rebinding before calling analytics', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls += 1;
    return report();
  });
  const body = { token: TOKEN, zoneId: ZONE };
  assert.equal(
    (await f.post('/api/connect', body, { Origin: 'https://attacker.invalid' })).status,
    403,
  );
  const rebound = await new Promise((resolve, reject) => {
    const call = request(
      `${f.origin}/api/status`,
      { headers: { Host: 'attacker.invalid' } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    call.on('error', reject);
    call.end();
  });
  assert.equal(rebound, 403);
  assert.equal(calls, 0);
  const page = await fetch(f.origin);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/u);
  assert.equal(page.headers.get('cache-control'), 'no-store');
});

test('token never leaves process; repeated refresh replaces snapshots and disconnect forgets it', async (t) => {
  const f = await fixture(t);
  const connected = await f.post('/api/connect', { token: TOKEN, zoneId: ZONE });
  assert.equal(connected.status, 200);
  assert.equal((await connected.json()).configured, true);
  assert.equal((await f.post('/api/refresh', { days: 7 })).status, 200);
  const text = await readFile(f.historyPath, 'utf8');
  assert.equal(text.includes(TOKEN), false);
  assert.equal(text.includes(ZONE), false);
  assert.equal(JSON.parse(text).days[0].full, 4);
  const status = await (await fetch(`${f.origin}/api/status`)).text();
  assert.equal(status.includes(TOKEN), false);
  assert.equal(status.includes(ZONE), false);
  await f.post('/api/disconnect', {});
  assert.equal((await f.post('/api/refresh', {})).status, 400);
});

test('upstream failure preserves successful observations and does not expose arbitrary exception text', async (t) => {
  let failed = false;
  const f = await fixture(t, async () => {
    if (failed) throw new Error(TOKEN);
    return report();
  });
  await f.post('/api/connect', { token: TOKEN, zoneId: ZONE });
  const before = await readFile(f.historyPath, 'utf8');
  failed = true;
  const response = await f.post('/api/refresh', {});
  assert.equal(response.status, 400);
  assert.equal((await response.text()).includes(TOKEN), false);
  assert.equal(await readFile(f.historyPath, 'utf8'), before);
});

test('failed initial connection remains editable and concurrent refresh is rejected', async (t) => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const f = await fixture(t, async () => {
    entered();
    await waiting;
    throw new Error('unavailable');
  });
  const first = f.post('/api/connect', { token: TOKEN, zoneId: ZONE });
  await started;
  assert.equal((await f.post('/api/refresh', {})).status, 409);
  release();
  assert.equal((await first).status, 400);
  assert.equal((await (await fetch(`${f.origin}/api/status`)).json()).configured, false);
});

test('archive preserves wider coverage, replaces expanded days, and never sums repeated polls', () => {
  const original = mergeHistory({ schemaVersion: 1, days: [] }, report());
  assert.equal(mergeHistory(original, report()).days[0].full, 4);
  const clipped = { ...report(1), days: [day(1, '2026-09-29T12:00:00.000Z')] };
  assert.equal(mergeHistory(original, clipped).days[0].full, 4);
  const provisional = {
    schemaVersion: 1,
    days: [day(2, '2026-09-29T00:00:00.000Z', '2026-09-29T12:00:00.000Z')],
  };
  assert.equal(mergeHistory(provisional, report(6)).days[0].full, 6);
});

test('requests with incomplete bodies reserve the refresh slot before analytics starts', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls += 1;
    return report();
  });
  const entered = once(f.server, 'request');
  let finish;
  const first = new Promise((resolve, reject) => {
    const call = request(
      `${f.origin}/api/connect`,
      { method: 'POST', headers: { Origin: f.origin, 'Content-Type': 'application/json' } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    call.on('error', reject);
    call.write('{"token":');
    finish = () => call.end(`${JSON.stringify(TOKEN)},"zoneId":"${ZONE}"}`);
  });
  await entered;
  assert.equal((await f.post('/api/connect', { token: TOKEN, zoneId: ZONE })).status, 409);
  assert.equal(calls, 0);
  finish();
  assert.equal(await first, 200);
  assert.equal(calls, 1);
});

test('Cloudflare Retry-After blocks repeated requests without preventing disconnect', async (t) => {
  let limited = false;
  let calls = 0;
  const f = await fixture(t, async () => {
    calls += 1;
    if (limited)
      throw Object.assign(new Error('limit'), {
        publicMessage: 'Wait for Cloudflare.',
        code: 'analytics_rate_limited',
        retryAfterSeconds: 90,
      });
    return report();
  });
  await f.post('/api/connect', { token: TOKEN, zoneId: ZONE });
  limited = true;
  const failure = await f.post('/api/refresh', {});
  assert.equal(failure.status, 429);
  assert.equal(failure.headers.get('retry-after'), '90');
  assert.equal((await f.post('/api/refresh', {})).status, 429);
  assert.equal(calls, 2);
  assert.equal((await f.post('/api/disconnect', {})).status, 200);
});

test('malformed archive cannot inflate totals or be silently replaced', async (t) => {
  const f = await fixture(t);
  const valid = mergeHistory({ schemaVersion: 1, days: [] }, report());
  const corruptions = [
    { ...valid, days: [valid.days[0], valid.days[0]] },
    { ...valid, days: [{ ...valid.days[0], full: '999' }] },
    { ...valid, days: [{ ...valid.days[0], partial: -1 }] },
    { ...valid, days: [{ ...valid.days[0], rows: [] }] },
    { ...valid, days: [{ ...valid.days[0], from: '2026-09-28T00:00:00.000Z' }] },
  ];
  for (const value of corruptions) {
    const text = JSON.stringify(value);
    await writeFile(f.historyPath, text);
    await assert.rejects(readHistory(f.historyPath), /not been replaced/u);
    assert.equal(await readFile(f.historyPath, 'utf8'), text);
  }
});
