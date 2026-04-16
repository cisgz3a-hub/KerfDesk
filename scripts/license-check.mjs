import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ONLY_ALLOW } from './license-allowlist.mjs';

const checkerBin = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'node_modules',
  'license-checker-rseidelsohn',
  'bin',
  'license-checker-rseidelsohn.js',
);

/** --out avoids dumping the full dependency tree on every commit (checker still validates onlyAllow). */
const sink = path.join(os.tmpdir(), `laserforge-license-check-${process.pid}.json`);

const r = spawnSync(
  process.execPath,
  [checkerBin, '--production', `--onlyAllow=${ONLY_ALLOW}`, '--out', sink],
  { stdio: 'inherit' },
);
try {
  fs.unlinkSync(sink);
} catch {
  /* ignore */
}
process.exit(r.status === null ? 1 : r.status);
