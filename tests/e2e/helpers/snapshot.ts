import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const snapshotDir = join(here, '..', 'snapshots');

export interface SnapshotResult {
  pass: boolean;
  message: string;
}

export function compareSnapshot(name: string, actual: string): SnapshotResult {
  if (!existsSync(snapshotDir)) mkdirSync(snapshotDir, { recursive: true });
  const path = join(snapshotDir, `${name}.gcode`);
  const update = process.env.UPDATE_SNAPSHOTS === '1';
  const hasSnapshot = existsSync(path);

  if (!hasSnapshot || update) {
    writeFileSync(path, actual, 'utf8');
    if (!hasSnapshot) return { pass: true, message: `[${name}] created snapshot` };
    return { pass: true, message: `[${name}] updated snapshot` };
  }

  const expected = readFileSync(path, 'utf8');
  if (actual === expected) {
    return { pass: true, message: `[${name}] snapshot matches` };
  }

  const aLines = actual.split('\n');
  const eLines = expected.split('\n');
  const max = Math.max(aLines.length, eLines.length);
  let firstDiff = -1;
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== eLines[i]) {
      firstDiff = i;
      break;
    }
  }

  const summary = firstDiff >= 0
    ? `line ${firstDiff + 1}:\n  expected: ${eLines[firstDiff] ?? '(missing)'}\n  actual:   ${aLines[firstDiff] ?? '(missing)'}`
    : `length differs (expected ${eLines.length}, actual ${aLines.length})`;

  return {
    pass: false,
    message: `[${name}] snapshot mismatch at ${summary}\n  Run UPDATE_SNAPSHOTS=1 npm test if this change is intentional.`,
  };
}
