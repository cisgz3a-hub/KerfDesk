const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const MAX_BYTES = 4 * 1024 * 1024;
const REQUIRED_FIELDS = [
  'count',
  'avg_sampleInterval',
  'dimensions_date',
  'dimensions_clientCountryName',
  'dimensions_clientRequestPath',
  'dimensions_clientRequestHTTPMethodName',
  'dimensions_edgeResponseStatus',
];

export class DownloadStatsError extends Error {
  constructor(code, message, retryAfterSeconds) {
    super(message);
    this.name = 'DownloadStatsError';
    this.code = code;
    this.publicMessage = message;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const SETTINGS_QUERY = `query DownloadSettings($zoneTag: string!) {
  viewer { zones(filter: {zoneTag: $zoneTag}) { settings {
    httpRequestsAdaptiveGroups {
      enabled availableFields maxPageSize maxNumberOfFields notOlderThan maxDuration
    }
  } } }
}`;

export const DOWNLOAD_QUERY = `query DownloadRequests($zoneTag: string!, $start: Time!, $end: Time!) {
  viewer { zones(filter: {zoneTag: $zoneTag}) {
    httpRequestsAdaptiveGroups(limit: 1000, filter: {
      datetime_geq: $start, datetime_lt: $end,
      clientRequestHTTPHost: "dl.kerfdesk.com", requestSource: "eyeball",
      clientRequestHTTPMethodName: "GET", edgeResponseStatus_in: [200, 206],
      clientRequestPath_like: "/desktop/%"
    }) {
      count avg { sampleInterval }
      dimensions { date clientCountryName clientRequestPath clientRequestHTTPMethodName edgeResponseStatus }
    }
  } }
}`;

function invalidResponse() {
  return new DownloadStatsError(
    'analytics_response',
    'Cloudflare returned invalid analytics data.',
  );
}

function retryAfter(value, now) {
  const seconds = /^\d+$/u.test(value ?? '') ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60;
}

async function readJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw invalidResponse();
  const reader = response.body?.getReader();
  if (!reader) throw invalidResponse();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BYTES) throw invalidResponse();
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw invalidResponse();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function responseZone(value) {
  if (Array.isArray(value?.errors) && value.errors.length > 0) {
    // Upstream messages can contain user-controlled values. Never return them.
    const messages = value.errors.map((error) => String(error?.message ?? '')).join(' ');
    if (/rate.?limit|quota|too many/iu.test(messages))
      throw new DownloadStatsError(
        'analytics_rate_limited',
        'Cloudflare analytics is rate limited. Try again later.',
        60,
      );
    if (/permission|not authorized|not authorised|access denied|not allowed/iu.test(messages))
      throw new DownloadStatsError(
        'analytics_forbidden',
        'The token cannot read analytics for this zone.',
      );
    throw new DownloadStatsError(
      'analytics_query_failed',
      'Cloudflare could not complete the analytics query.',
    );
  }
  if (value?.errors !== undefined && value.errors !== null && !Array.isArray(value.errors))
    throw invalidResponse();
  const zones = value?.data?.viewer?.zones;
  if (!Array.isArray(zones) || zones.length !== 1 || !zones[0]) throw invalidResponse();
  return zones[0];
}

async function request({ token, fetcher, now }, query, variables) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetcher(ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (response.status === 429)
      throw new DownloadStatsError(
        'analytics_rate_limited',
        'Cloudflare analytics is rate limited. Try again later.',
        retryAfter(response.headers.get('retry-after'), now),
      );
    if (response.status === 401 || response.status === 403)
      throw new DownloadStatsError(
        'analytics_forbidden',
        'The token cannot read analytics for this zone.',
      );
    if (!response.ok)
      throw new DownloadStatsError(
        'analytics_unavailable',
        'Cloudflare analytics is temporarily unavailable.',
      );
    return responseZone(await readJson(response));
  } catch (error) {
    if (controller.signal.aborted)
      throw new DownloadStatsError('analytics_timeout', 'Cloudflare analytics timed out.');
    if (error instanceof DownloadStatsError) throw error;
    throw new DownloadStatsError(
      controller.signal.aborted ? 'analytics_timeout' : 'analytics_network',
      controller.signal.aborted
        ? 'Cloudflare analytics timed out.'
        : 'Cloudflare analytics could not be reached.',
    );
  } finally {
    clearTimeout(timer);
  }
}

function validateSettings(settings) {
  if (settings?.enabled === false)
    throw new DownloadStatsError(
      'analytics_unavailable',
      'HTTP analytics is not available for this zone.',
    );
  if (settings?.enabled !== true) throw invalidResponse();
  if (
    !Array.isArray(settings.availableFields) ||
    REQUIRED_FIELDS.some((field) => !settings.availableFields.includes(field))
  )
    throw new DownloadStatsError(
      'analytics_fields',
      'This zone or token does not expose the required download analytics fields.',
    );
  const limits = ['maxPageSize', 'maxNumberOfFields', 'notOlderThan', 'maxDuration'];
  if (limits.some((field) => !Number.isSafeInteger(settings[field]) || settings[field] <= 0))
    throw invalidResponse();
  if (settings.maxNumberOfFields < REQUIRED_FIELDS.length)
    throw new DownloadStatsError(
      'analytics_fields',
      'The analytics field limit is too small for a complete report.',
    );
  return settings;
}

function validateRows(rows, from) {
  if (!Array.isArray(rows)) throw invalidResponse();
  const seen = new Set();
  for (const row of rows) {
    const dimension = row?.dimensions;
    if (
      !Number.isSafeInteger(row?.count) ||
      row.count < 0 ||
      !Number.isFinite(row.avg?.sampleInterval) ||
      row.avg.sampleInterval < 1 ||
      dimension?.date !== new Date(from).toISOString().slice(0, 10) ||
      typeof dimension.clientCountryName !== 'string' ||
      !/^(?:[A-Z]{2}|T1)$/u.test(dimension.clientCountryName) ||
      typeof dimension.clientRequestPath !== 'string' ||
      dimension.clientRequestPath.length > 2048 ||
      dimension.clientRequestHTTPMethodName !== 'GET' ||
      ![200, 206].includes(dimension.edgeResponseStatus)
    )
      throw invalidResponse();
    const key = JSON.stringify([
      dimension.date,
      dimension.clientCountryName,
      dimension.clientRequestPath,
      dimension.edgeResponseStatus,
    ]);
    if (seen.has(key)) throw invalidResponse();
    seen.add(key);
  }
  return rows;
}

export async function createAnalyticsReader(options) {
  const started = Date.now();
  let queryCount = 1;
  const zone = await request(options, SETTINGS_QUERY, { zoneTag: options.zoneId });
  const settings = validateSettings(zone.settings?.httpRequestsAdaptiveGroups);
  const limit = Math.min(1000, settings.maxPageSize);
  const read = async (from, to) => {
    if (Date.now() - started > 120_000)
      throw new DownloadStatsError(
        'analytics_timeout',
        'The analytics report took too long. Request fewer days.',
      );
    if (++queryCount > 240)
      throw new DownloadStatsError(
        'analytics_query_budget',
        'The report needs too many queries. Request fewer days.',
      );
    const result = await request(
      options,
      DOWNLOAD_QUERY.replace('limit: 1000', `limit: ${limit}`),
      {
        zoneTag: options.zoneId,
        start: new Date(from).toISOString(),
        end: new Date(to).toISOString(),
      },
    );
    const rows = validateRows(result.httpRequestsAdaptiveGroups, from);
    if (rows.length < limit) return rows;
    // Full pages may omit groups. Discard that page and query disjoint windows.
    if (to - from <= 1000)
      throw new DownloadStatsError(
        'analytics_truncated',
        'Cloudflare returned a full results page; complete totals cannot be established.',
      );
    const middle = from + Math.floor((to - from) / 2000) * 1000;
    return [...(await read(from, middle)), ...(await read(middle, to))];
  };
  return { settings, read, queryCount: () => queryCount };
}
