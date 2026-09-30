import { createAnalyticsReader, DownloadStatsError } from './analytics.mjs';
import { commercialArtifactNames } from '../../public/desktop-commercial-catalog.mjs';
import { isPreviewVersion, previewArtifactNames } from '../../public/desktop-release-manifest.mjs';

const DAY = 86_400_000;
const STABLE = /^(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})$/u;
const iso = (time) => new Date(time).toISOString();
const date = (time) => iso(time).slice(0, 10);

/** Recognize only first-party publisher contracts; never infer a release from a loose suffix. */
export function recognizeInstallerPath(path) {
  if (typeof path !== 'string' || path.length > 300 || !path.startsWith('/desktop/')) return null;
  const parts = path.slice(1).split('/');
  if (path === '/desktop/kerfdesk-latest-x64-setup.exe')
    return { version: 'unknown', platform: 'windows-x64', channel: 'legacy-stable' };
  let version;
  let name;
  let channel;
  if (
    parts.length === 5 &&
    ['commercial', 'commercial-manual'].includes(parts[1]) &&
    parts[2] === 'releases'
  ) {
    [, channel, , version, name] = parts;
  } else if (parts.length === 4 && parts[1] === 'previews') {
    [, , version, name] = parts;
    if (!isPreviewVersion(version)) return null;
    const position = previewArtifactNames(version).slice(0, 3).indexOf(name);
    if (position < 0) return null;
    return {
      version,
      platform: ['windows-x64', 'macos-x64', 'macos-arm64'][position],
      channel: 'preview',
    };
  } else if (parts.length === 4 && parts[1] === 'releases') {
    [, , version, name] = parts;
    channel = 'legacy-stable';
  } else if (parts.length === 2) {
    name = parts[1];
    version = /^KerfDesk-(.+)-windows-x64-setup\.exe$/u.exec(name)?.[1];
    channel = 'legacy-stable';
  }
  if (!STABLE.test(version ?? '')) return null;
  if (name !== commercialArtifactNames(version)[0]) return null;
  return { version, platform: 'windows-x64', channel };
}

function validateOptions({ token, zoneId, days, now, fetcher }) {
  if (typeof token !== 'string' || token.length === 0)
    throw new DownloadStatsError(
      'missing_token',
      'Set a private Cloudflare analytics API token first.',
    );
  if (token.length > 4096 || /[^\x21-\x7e]/u.test(token))
    throw new DownloadStatsError(
      'invalid_token',
      'The Cloudflare analytics token format is invalid.',
    );
  if (typeof zoneId !== 'string' || !/^[a-f0-9]{32}$/iu.test(zoneId))
    throw new DownloadStatsError(
      'invalid_zone',
      'Set the 32-character Cloudflare zone ID for kerfdesk.com.',
    );
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new DownloadStatsError('invalid_days', 'Request between 1 and 90 calendar days.');
  if (
    !Number.isFinite(now) ||
    now < DAY ||
    now > 8_640_000_000_000_000 ||
    typeof fetcher !== 'function'
  )
    throw new DownloadStatsError('invalid_options', 'The report options are invalid.');
}

function add(target, count, partial) {
  const field = partial ? 'partial' : 'full';
  const next = target[field] + count;
  if (!Number.isSafeInteger(next))
    throw new DownloadStatsError(
      'analytics_response',
      'Cloudflare returned counts too large to represent accurately.',
    );
  target[field] = next;
}

function summarize(raw, windows) {
  const dayMap = new Map(
    windows.map((window) => [window.date, { ...window, full: 0, partial: 0 }]),
  );
  const releases = new Map();
  const daily = new Map();
  const totals = { full: 0, partial: 0 };
  for (const entry of raw) {
    const identity = recognizeInstallerPath(entry.dimensions.clientRequestPath);
    if (!identity) continue;
    const day = entry.dimensions.date;
    const key = JSON.stringify(identity);
    const dailyKey = JSON.stringify([day, key]);
    if (!releases.has(key)) releases.set(key, { ...identity, full: 0, partial: 0 });
    if (!daily.has(dailyKey)) daily.set(dailyKey, { date: day, ...identity, full: 0, partial: 0 });
    for (const target of [totals, dayMap.get(day), releases.get(key), daily.get(dailyKey)])
      add(target, entry.count, entry.dimensions.edgeResponseStatus === 206);
  }
  return {
    days: [...dayMap.values()],
    releases: [...releases.values()],
    rows: [...daily.values()],
    totals,
  };
}

function windowsFor(from, to) {
  const windows = [];
  for (let start = from; start < to; ) {
    const end = Math.min(to, (Math.floor(start / DAY) + 1) * DAY);
    windows.push({ date: date(start), from: iso(start), to: iso(end) });
    start = end;
  }
  // At exactly midnight, today has no elapsed coverage yet, but is still shown.
  if (to % DAY === 0) windows.push({ date: date(to), from: iso(to), to: iso(to) });
  return windows;
}

export async function fetchDownloadReport({
  token,
  zoneId,
  days = 7,
  now = Date.now(),
  fetcher = fetch,
}) {
  validateOptions({ token, zoneId, days, now, fetcher });
  const reader = await createAnalyticsReader({ token, zoneId, now, fetcher });
  const { settings } = reader;
  const requestedFrom = Math.floor(now / DAY) * DAY - (days - 1) * DAY;
  const to = Math.floor(now / 1000) * 1000;
  const from = Math.max(requestedFrom, to - settings.notOlderThan * 1000);
  const maxWindow = Math.min(DAY, settings.maxDuration * 1000);
  const windows = windowsFor(from, to);
  const raw = [];
  for (const window of windows) {
    const end = Date.parse(window.to);
    for (let start = Date.parse(window.from); start < end; start += maxWindow)
      raw.push(...(await reader.read(start, Math.min(end, start + maxWindow))));
  }
  return {
    generatedAt: iso(now),
    from: iso(from),
    to: iso(to),
    host: 'dl.kerfdesk.com',
    measurement: 'estimated-download-requests',
    ...summarize(raw, windows),
    limitations: [
      'Counts estimate installer GET requests, not completed downloads, installations or unique people.',
      'HTTP 200 and 206 partial/range responses are separate; retries, bots and owner checks may contribute.',
      'Adaptive sampling can omit low-volume traffic; zero means no matching observations, not proven zero downloads.',
      'The current UTC day is provisional. History older than Cloudflare retention needs earlier saved reports.',
      'Only recognized installer paths on dl.kerfdesk.com are included; manifests, HEAD requests and other hosts are excluded.',
      'The legacy latest-installer alias has no recoverable version attribution and is labelled unknown.',
    ],
    coverage: {
      requestedDays: days,
      requestedFrom: iso(requestedFrom),
      from: iso(from),
      to: iso(to),
      clipped: from > requestedFrom,
      complete: true,
      queryCount: reader.queryCount(),
      sampled: raw.some((row) => row.avg.sampleInterval > 1),
      retentionSeconds: settings.notOlderThan,
      maxQuerySeconds: settings.maxDuration,
    },
  };
}
