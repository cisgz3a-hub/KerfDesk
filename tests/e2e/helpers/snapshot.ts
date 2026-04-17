import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Snapshot matcher for text blobs.
 *
 * - If the snapshot file doesn't exist and UPDATE_SNAPSHOTS≠1, throws (CI failure).
 * - If it exists, compares actual vs stored. On mismatch, prints a diff and throws.
 * - With UPDATE_SNAPSHOTS=1, creates or overwrites the snapshot and returns.
 *
 * @param relativeSnapshotPath Path relative to tests/e2e/snapshots/,
 *   e.g. 'rectangle-cut.gcode'
 */
export function expectMatchesSnapshot(actual: string, relativeSnapshotPath: string): void {
  const snapshotsDir = resolve(__dirname, '..', 'snapshots');
  const snapshotPath = resolve(snapshotsDir, relativeSnapshotPath);

  if (!existsSync(snapshotsDir)) mkdirSync(snapshotsDir, { recursive: true });

  const updating = process.env.UPDATE_SNAPSHOTS === '1';

  if (!existsSync(snapshotPath)) {
    if (!updating) {
      throw new Error(
        [
          `Snapshot missing: ${relativeSnapshotPath}`,
          `Create it with: UPDATE_SNAPSHOTS=1 npm test`,
          `(PowerShell: $env:UPDATE_SNAPSHOTS='1'; npm test)`,
        ].join('\n'),
      );
    }
    writeFileSync(snapshotPath, actual, 'utf8');
    console.log(`  📸 Created snapshot: ${relativeSnapshotPath} (${actual.length} chars)`);
    return;
  }

  const expected = readFileSync(snapshotPath, 'utf8');

  if (actual === expected) {
    console.log(`  ✓ Snapshot match: ${relativeSnapshotPath}`);
    return;
  }

  if (updating) {
    writeFileSync(snapshotPath, actual, 'utf8');
    console.log(`  📸 Updated snapshot: ${relativeSnapshotPath}`);
    return;
  }

  const actualLines = actual.split('\n');
  const expectedLines = expected.split('\n');
  const maxLines = Math.max(actualLines.length, expectedLines.length);
  const diffs: string[] = [];
  for (let i = 0; i < maxLines; i++) {
    const a = actualLines[i] ?? '<missing>';
    const e = expectedLines[i] ?? '<missing>';
    if (a !== e) {
      diffs.push(`  line ${i + 1}:\n    expected: ${e}\n    actual:   ${a}`);
      if (diffs.length >= 10) {
        diffs.push(`  ... (more differences suppressed)`);
        break;
      }
    }
  }

  const msg = [
    `Snapshot mismatch: ${relativeSnapshotPath}`,
    `  expected length: ${expectedLines.length} lines`,
    `  actual length:   ${actualLines.length} lines`,
    '',
    ...diffs,
    '',
    `If this change is intentional, re-run with UPDATE_SNAPSHOTS=1 to bless:`,
    `  UPDATE_SNAPSHOTS=1 npm test`,
  ].join('\n');

  throw new Error(msg);
}
