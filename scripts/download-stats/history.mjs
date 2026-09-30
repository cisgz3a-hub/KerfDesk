import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateHistory } from './history-validation.mjs';

export async function readHistory(path) {
  try {
    if ((await stat(path)).size > 20 * 1024 * 1024) throw new Error('History is too large');
    return validateHistory(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, days: [] };
    throw new Error('Saved download history could not be read. It has not been replaced.');
  }
}

/** Replace overlapping observations; polling never adds the same requests twice. */
export function mergeHistory(history, report) {
  const days = new Map(history.days.map((day) => [day.date, day]));
  for (const observed of report.days) {
    const old = days.get(observed.date);
    if (old && (observed.from > old.from || observed.to < old.to)) continue;
    days.set(observed.date, {
      ...observed,
      observedAt: report.generatedAt,
      rows: report.rows.filter((row) => row.date === observed.date),
    });
  }
  return validateHistory({
    schemaVersion: 1,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  });
}

export async function saveHistory(path, history) {
  const validated = validateHistory(history);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  const text = `${JSON.stringify(validated, null, 2)}\n`;
  if (Buffer.byteLength(text) > 20 * 1024 * 1024) throw new Error('History is too large');
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, path);
}

export function historySummary(history) {
  const totals = history.days.reduce(
    (sum, day) => ({ full: sum.full + day.full, partial: sum.partial + day.partial }),
    { full: 0, partial: 0 },
  );
  return { ...totals, observedDays: history.days.length, days: history.days };
}
