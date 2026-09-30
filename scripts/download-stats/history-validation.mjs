const DAY = 86_400_000;
const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const instant = (value) =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const rowKeys = ['date', 'version', 'platform', 'channel', 'full', 'partial'];
const countryRowKeys = [...rowKeys, 'country'];
const dayKeys = ['date', 'from', 'to', 'full', 'partial', 'observedAt', 'rows'];

function validRows(day) {
  if (!Array.isArray(day.rows) || day.rows.length > 10_000) return false;
  const seen = new Set();
  let full = 0;
  let partial = 0;
  for (const row of day.rows) {
    if (
      !(exact(row, rowKeys) || exact(row, countryRowKeys)) ||
      row.date !== day.date ||
      !validCount(row.full) ||
      !validCount(row.partial)
    )
      return false;
    if (
      'country' in row &&
      (typeof row.country !== 'string' || !/^(?:[A-Z]{2}|unknown)$/u.test(row.country))
    )
      return false;
    if (
      !['windows-x64', 'macos-x64', 'macos-arm64'].includes(row.platform) ||
      !['commercial', 'commercial-manual', 'preview', 'legacy-stable'].includes(row.channel)
    )
      return false;
    if (
      typeof row.version !== 'string' ||
      !/^(?:unknown|\d{1,16}\.\d{1,16}\.\d{1,16}(?:-preview\.\d{1,16})?)$/u.test(row.version)
    )
      return false;
    const key = `${row.version}/${row.platform}/${row.channel}/${row.country ?? 'unknown'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    full += row.full;
    partial += row.partial;
  }
  return validCount(full) && validCount(partial) && full === day.full && partial === day.partial;
}

/** A corrupt archive must be reported, never reinterpreted as trustworthy totals. */
export function validateHistory(history) {
  if (
    !exact(history, ['schemaVersion', 'days']) ||
    history.schemaVersion !== 1 ||
    !Array.isArray(history.days) ||
    history.days.length > 36_600
  )
    throw new Error('Invalid download history');
  const seen = new Set();
  let full = 0;
  let partial = 0;
  for (const day of history.days) {
    if (!exact(day, dayKeys) || !/^\d{4}-\d{2}-\d{2}$/u.test(day.date) || seen.has(day.date))
      throw new Error('Invalid download history');
    const midnight = Date.parse(`${day.date}T00:00:00.000Z`);
    if (
      !Number.isFinite(midnight) ||
      new Date(midnight).toISOString().slice(0, 10) !== day.date ||
      !instant(day.from) ||
      !instant(day.to) ||
      !instant(day.observedAt)
    )
      throw new Error('Invalid download history');
    if (
      Date.parse(day.from) < midnight ||
      Date.parse(day.to) > midnight + DAY ||
      day.from > day.to ||
      !validCount(day.full) ||
      !validCount(day.partial) ||
      !validRows(day)
    )
      throw new Error('Invalid download history');
    seen.add(day.date);
    full += day.full;
    partial += day.partial;
    if (!validCount(full) || !validCount(partial)) throw new Error('Invalid download history');
  }
  // Archives saved before country reporting cannot recover that dimension retroactively.
  return {
    ...history,
    days: history.days.map((day) => ({
      ...day,
      rows: day.rows.map((row) => ({ ...row, country: row.country ?? 'unknown' })),
    })),
  };
}
