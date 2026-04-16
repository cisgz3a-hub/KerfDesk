import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const checkerBin = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'node_modules',
  'license-checker-rseidelsohn',
  'bin',
  'license-checker-rseidelsohn.js',
);

/** Full dependency listing for audits — no --onlyAllow so CSV is complete even when the gate fails. */
const r = spawnSync(
  process.execPath,
  [checkerBin, '--production', '--csv', '--out', 'licenses-report.csv'],
  { stdio: 'inherit' },
);
process.exit(r.status === null ? 1 : r.status);
