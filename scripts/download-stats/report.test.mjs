import assert from 'node:assert/strict';
import test from 'node:test';
import { DownloadStatsError } from './analytics.mjs';
import { fetchDownloadReport, recognizeInstallerPath } from './report.mjs';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const ZONE = 'a'.repeat(32);
const TOKEN = 'private-test-token';
const MANUAL = '/desktop/commercial-manual/releases/1.2.3/KerfDesk-1.2.3-windows-x64-setup.exe';
const PREVIEW = '/desktop/previews/0.2.0-preview.14/KerfDesk-0.2.0-preview.14-macos-arm64.dmg';
const settings = (patch = {}) => ({
  enabled: true,
  availableFields: [
    'count',
    'avg_sampleInterval',
    'dimensions_date',
    'dimensions_clientCountryName',
    'dimensions_clientRequestPath',
    'dimensions_clientRequestHTTPMethodName',
    'dimensions_edgeResponseStatus',
  ],
  maxPageSize: 10000,
  maxNumberOfFields: 30,
  notOlderThan: 604800,
  maxDuration: 86400,
  ...patch,
});
const json = (value) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const result = (zone) => json({ data: { viewer: { zones: [zone] } }, errors: null });
const row = (date, count = 1, path = MANUAL, status = 200, interval = 1, country = 'US') => ({
  count,
  avg: { sampleInterval: interval },
  dimensions: {
    date,
    clientCountryName: country,
    clientRequestPath: path,
    clientRequestHTTPMethodName: 'GET',
    edgeResponseStatus: status,
  },
});
function fixture({ configured = settings(), rows = () => [], now = NOW } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    assert.equal(url, 'https://api.cloudflare.com/client/v4/graphql');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    const body = JSON.parse(init.body);
    calls.push(body);
    return body.query.includes('DownloadSettings')
      ? result({ settings: { httpRequestsAdaptiveGroups: configured } })
      : result({ httpRequestsAdaptiveGroups: rows(body.variables, calls.length, body.query) });
  };
  return { calls, options: { token: TOKEN, zoneId: ZONE, now, fetcher } };
}
function errorCode(code) {
  return (error) =>
    error instanceof DownloadStatsError &&
    error.code === code &&
    error.publicMessage === error.message &&
    !error.message.includes(TOKEN);
}

test('recognizes exact published paths, platforms and the genuine unversioned legacy alias', () => {
  for (const [path, version, platform, channel] of [
    [MANUAL, '1.2.3', 'windows-x64', 'commercial-manual'],
    [MANUAL.replace('commercial-manual', 'commercial'), '1.2.3', 'windows-x64', 'commercial'],
    [PREVIEW, '0.2.0-preview.14', 'macos-arm64', 'preview'],
    [
      PREVIEW.replace('macos-arm64.dmg', 'macos-x64.dmg'),
      '0.2.0-preview.14',
      'macos-x64',
      'preview',
    ],
    [
      PREVIEW.replace('macos-arm64.dmg', 'windows-x64-setup.exe'),
      '0.2.0-preview.14',
      'windows-x64',
      'preview',
    ],
    ['/desktop/KerfDesk-1.2.3-windows-x64-setup.exe', '1.2.3', 'windows-x64', 'legacy-stable'],
    [
      '/desktop/releases/1.2.3/KerfDesk-1.2.3-windows-x64-setup.exe',
      '1.2.3',
      'windows-x64',
      'legacy-stable',
    ],
    ['/desktop/kerfdesk-latest-x64-setup.exe', 'unknown', 'windows-x64', 'legacy-stable'],
  ])
    assert.deepEqual(recognizeInstallerPath(path), { version, platform, channel });
  for (const path of [
    MANUAL + '.blockmap',
    MANUAL + '?token=secret',
    MANUAL.replace('/1.2.3/', '/1.2.4/'),
    MANUAL.replace('1.2.3', '01.2.3'),
    MANUAL.replace('/desktop/', '/Desktop/'),
    MANUAL.replace('windows-x64-setup.exe', 'macos-x64.dmg'),
    MANUAL.replace('KerfDesk', '%4berfDesk'),
    '/desktop/previews/latest.json',
    '/desktop/arbitrary-setup.exe',
    '/desktop/../' + MANUAL,
  ])
    assert.equal(recognizeInstallerPath(path), null, path);
});

test('separates full/range estimates, releases and days without persisting paths or secrets', async () => {
  const f = fixture({
    rows: ({ start }) => [
      row(start.slice(0, 10), 20, MANUAL, 200, 2),
      row(start.slice(0, 10), 3, MANUAL, 206),
      row(start.slice(0, 10), 4, PREVIEW),
      row(start.slice(0, 10), 999, '/desktop/previews/latest.json'),
    ],
  });
  const report = await fetchDownloadReport({ ...f.options, days: 1 });
  assert.deepEqual(report.totals, { full: 24, partial: 3 }); // count is already scaled; not40.
  assert.deepEqual(report.days, [
    {
      date: '2026-09-30',
      from: '2026-09-30T00:00:00.000Z',
      to: '2026-09-30T12:00:00.000Z',
      full: 24,
      partial: 3,
    },
  ]);
  assert.equal(report.rows.length, 2);
  assert.equal(report.releases.length, 2);
  assert.deepEqual(report.countries, [{ country: 'US', full: 24, partial: 3 }]);
  assert.ok(report.rows.every((item) => item.country === 'US'));
  assert.equal(report.coverage.sampled, true);
  assert.equal(report.coverage.queryCount, 2);
  assert.equal(report.measurement, 'estimated-download-requests');
  assert.equal(JSON.stringify(report).includes(TOKEN), false);
  assert.equal(JSON.stringify(report).includes('KerfDesk-'), false);
  assert.equal(JSON.stringify(report).includes('/desktop/'), false);
  assert.match(f.calls[1].query, /clientRequestHTTPMethodName: "GET"/u);
  assert.match(f.calls[1].query, /requestSource: "eyeball"/u);
  assert.match(f.calls[1].query, /edgeResponseStatus_in: \[200, 206\]/u);
  assert.match(f.calls[1].query, /dimensions \{ date clientCountryName /u);
  assert.doesNotMatch(f.calls[1].query, /clientIP/u);
});

test('country grouping preserves every total and combines only explicit non-country markers', async () => {
  const f = fixture({
    rows: ({ start }) => [
      row(start.slice(0, 10), 8, MANUAL, 200, 2, 'US'),
      row(start.slice(0, 10), 3, MANUAL, 206, 1, 'US'),
      row(start.slice(0, 10), 5, MANUAL, 200, 1, 'ZA'),
      row(start.slice(0, 10), 2, MANUAL, 200, 1, 'XX'),
      row(start.slice(0, 10), 4, MANUAL, 200, 1, 'T1'),
      row(start.slice(0, 10), 1, PREVIEW, 206, 1, 'ZA'),
    ],
  });
  const report = await fetchDownloadReport({ ...f.options, days: 2 });
  assert.deepEqual(report.totals, { full: 38, partial: 8 });
  assert.deepEqual(report.countries, [
    { country: 'US', full: 16, partial: 6 },
    { country: 'ZA', full: 10, partial: 2 },
    { country: 'unknown', full: 12, partial: 0 },
  ]);
  assert.equal(report.rows.length, 8);
  assert.equal(report.releases.length, 2);
  for (const collection of [report.countries, report.days, report.rows, report.releases]) {
    for (const field of ['full', 'partial'])
      assert.equal(
        collection.reduce((sum, item) => sum + item[field], 0),
        report.totals[field],
      );
  }
  const unknown = report.rows.filter((item) => item.country === 'unknown');
  assert.equal(unknown.length, 2);
  assert.ok(unknown.every((item) => item.full === 6 && item.partial === 0));
  assert.ok(report.limitations.some((item) => item.includes('approximate network geolocation')));
});

test('missing country access or malformed country data fails without discarding its counts', async () => {
  for (const configured of [
    settings({
      availableFields: settings().availableFields.filter(
        (field) => field !== 'dimensions_clientCountryName',
      ),
    }),
    settings({ maxNumberOfFields: 6 }),
  ]) {
    const f = fixture({ configured });
    await assert.rejects(fetchDownloadReport(f.options), errorCode('analytics_fields'));
    assert.equal(f.calls.length, 1);
  }
  for (const country of [null, '', 'us', 'USA', 'United States', '<script>', 'T2', 42]) {
    const f = fixture({
      rows: ({ start }) => [row(start.slice(0, 10), 1, MANUAL, 200, 1, country)],
    });
    await assert.rejects(
      fetchDownloadReport({ ...f.options, days: 1 }),
      errorCode('analytics_response'),
    );
  }
  const f = fixture({
    rows: ({ start }) => {
      const missing = row(start.slice(0, 10));
      delete missing.dimensions.clientCountryName;
      return [missing];
    },
  });
  await assert.rejects(
    fetchDownloadReport({ ...f.options, days: 1 }),
    errorCode('analytics_response'),
  );
});

test('preserves requested UTC days and clips oldest day to actual retention and query duration', async () => {
  const f = fixture({ configured: settings({ notOlderThan: 25 * 3600, maxDuration: 6 * 3600 }) });
  const report = await fetchDownloadReport(f.options);
  assert.equal(report.coverage.requestedFrom, '2026-09-24T00:00:00.000Z');
  assert.equal(report.from, '2026-09-29T11:00:00.000Z');
  assert.equal(report.to, '2026-09-30T12:00:00.000Z');
  assert.equal(report.coverage.clipped, true);
  assert.deepEqual(
    report.days.map(({ date, from, to }) => ({ date, from, to })),
    [
      { date: '2026-09-29', from: report.from, to: '2026-09-30T00:00:00.000Z' },
      { date: '2026-09-30', from: '2026-09-30T00:00:00.000Z', to: report.to },
    ],
  );
  let lastEnd = report.from;
  for (const call of f.calls.slice(1)) {
    assert.equal(call.variables.start, lastEnd);
    assert.ok(Date.parse(call.variables.end) - Date.parse(call.variables.start) <= 6 * 3600_000);
    lastEnd = call.variables.end;
  }
  assert.equal(lastEnd, report.to);
  assert.equal(report.coverage.queryCount, 6);
});

test('at midnight today has an explicit zero-duration interval, not an invented full day', async () => {
  const f = fixture({ now: Date.parse('2026-09-30T00:00:00Z') });
  const report = await fetchDownloadReport({ ...f.options, days: 1 });
  assert.equal(report.days.length, 1);
  assert.equal(report.days[0].from, report.days[0].to);
  assert.equal(f.calls.length, 1);
});

test('full pages are discarded and split into disjoint windows without double counting', async () => {
  const f = fixture({
    configured: settings({ maxPageSize: 2 }),
    rows: ({ start }, call) =>
      call === 2
        ? [row(start.slice(0, 10), 999), row(start.slice(0, 10), 999, PREVIEW)]
        : [row(start.slice(0, 10), 2)],
  });
  const report = await fetchDownloadReport({ ...f.options, days: 1 });
  assert.deepEqual(report.totals, { full: 4, partial: 0 });
  assert.equal(f.calls[2].variables.end, f.calls[3].variables.start);
  assert.match(f.calls[1].query, /limit: 2/u);
});

test('irreducibly full one-second pages fail instead of reporting partial totals', async () => {
  const f = fixture({
    configured: settings({ maxPageSize: 1 }),
    now: Date.parse('2026-09-30T00:00:01Z'),
    rows: ({ start }) => [row(start.slice(0, 10))],
  });
  await assert.rejects(
    fetchDownloadReport({ ...f.options, days: 1 }),
    errorCode('analytics_truncated'),
  );
});

test('unavailable datasets and missing fields fail before requesting counts', async () => {
  for (const [configured, code] of [
    [settings({ enabled: false }), 'analytics_unavailable'],
    [settings({ availableFields: ['count'] }), 'analytics_fields'],
    [settings({ maxNumberOfFields: 1 }), 'analytics_fields'],
    [settings({ maxDuration: 0 }), 'analytics_response'],
  ]) {
    const f = fixture({ configured });
    await assert.rejects(fetchDownloadReport(f.options), errorCode(code));
    assert.equal(f.calls.length, 1);
  }
});

test('malformed, duplicate or out-of-scope result groups cannot become zeros or inflated totals', async () => {
  for (const rows of [
    [row('2026-09-30', -1)],
    [row('2026-09-30', 1.5)],
    [row('2026-09-30'), row('2026-09-30')],
    [row('2026-09-29')],
    [row('2026-09-30', 1, MANUAL, 404)],
    [
      {
        ...row('2026-09-30'),
        dimensions: { ...row('2026-09-30').dimensions, clientRequestHTTPMethodName: 'HEAD' },
      },
    ],
  ]) {
    const f = fixture({ rows: () => rows });
    await assert.rejects(
      fetchDownloadReport({ ...f.options, days: 1 }),
      errorCode('analytics_response'),
    );
  }
});

test('GraphQL errors, including partial data, are not successful zero reports and never reflect messages', async () => {
  const options = fixture().options;
  for (const [message, code] of [
    ['Permission denied ' + TOKEN, 'analytics_forbidden'],
    ['rate limited ' + TOKEN, 'analytics_rate_limited'],
    ['unknown ' + TOKEN, 'analytics_query_failed'],
  ])
    await assert.rejects(
      fetchDownloadReport({
        ...options,
        fetcher: async () =>
          json({
            data: { viewer: { zones: [] } },
            errors: [{ message }],
          }),
      }),
      errorCode(code),
    );
});

test('429 preserves seconds and HTTP-date retry windows without automatically retrying', async () => {
  for (const header of ['180', new Date(NOW + 180_000).toUTCString()]) {
    let calls = 0;
    await assert.rejects(
      fetchDownloadReport({
        ...fixture().options,
        fetcher: async () => {
          calls += 1;
          return new Response(TOKEN, { status: 429, headers: { 'Retry-After': header } });
        },
      }),
      (error) => errorCode('analytics_rate_limited')(error) && error.retryAfterSeconds === 180,
    );
    assert.equal(calls, 1);
  }
});

test('authentication/network/oversize failures expose only controlled setup messages', async () => {
  for (const [fetcher, code] of [
    [async () => new Response(TOKEN, { status: 403 }), 'analytics_forbidden'],
    [
      async () => {
        throw new Error(TOKEN);
      },
      'analytics_network',
    ],
    [
      async () => new Response('{}', { headers: { 'Content-Length': String(5 * 1024 * 1024) } }),
      'analytics_response',
    ],
  ])
    await assert.rejects(fetchDownloadReport({ ...fixture().options, fetcher }), errorCode(code));
});

test('invalid local configuration makes no network request', async () => {
  for (const [patch, code] of [
    [{ token: '' }, 'missing_token'],
    [{ token: 'token\nvalue' }, 'invalid_token'],
    [{ zoneId: 'wrong' }, 'invalid_zone'],
    [{ days: 0 }, 'invalid_days'],
    [{ now: NaN }, 'invalid_options'],
  ]) {
    const f = fixture();
    await assert.rejects(fetchDownloadReport({ ...f.options, ...patch }), errorCode(code));
    assert.equal(f.calls.length, 0);
  }
});

test('a later day failing discards the entire report instead of returning earlier-day totals', async () => {
  const f = fixture({ rows: ({ start }) => [row(start.slice(0, 10), 10)] });
  const delegate = f.options.fetcher;
  let calls = 0;
  await assert.rejects(
    fetchDownloadReport({
      ...f.options,
      days: 2,
      fetcher: async (...args) => {
        calls += 1;
        if (calls === 3) return new Response('unavailable', { status: 503 });
        return delegate(...args);
      },
    }),
    errorCode('analytics_unavailable'),
  );
  assert.equal(calls, 3);
});

test('tiny query windows are bounded by a hard query budget', async () => {
  const f = fixture({
    configured: settings({ maxDuration: 1 }),
    now: Date.parse('2026-09-30T00:05:00Z'),
  });
  await assert.rejects(
    fetchDownloadReport({ ...f.options, days: 1 }),
    errorCode('analytics_query_budget'),
  );
  assert.equal(f.calls.length, 240);
});

test('aggregate overflow fails rather than silently rounding request counts', async () => {
  const f = fixture({ rows: ({ start }) => [row(start.slice(0, 10), Number.MAX_SAFE_INTEGER)] });
  await assert.rejects(
    fetchDownloadReport({ ...f.options, days: 2 }),
    errorCode('analytics_response'),
  );
});
