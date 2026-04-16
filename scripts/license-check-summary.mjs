import { spawnSync } from 'node:child_process';
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

const r = spawnSync(
  process.execPath,
  [checkerBin, '--production', '--summary', `--onlyAllow=${ONLY_ALLOW}`],
  { stdio: 'inherit' },
);
process.exit(r.status === null ? 1 : r.status);
