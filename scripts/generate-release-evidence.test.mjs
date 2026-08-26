import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateReleaseEvidence } from './generate-release-evidence.mjs';

test('emits deterministic checksums, SPDX inventory, and exact toolchain provenance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kerfdesk-release-evidence-'));
  const releaseDir = path.join(root, 'release');
  fs.mkdirSync(releaseDir);
  fs.writeFileSync(path.join(releaseDir, 'KerfDesk.exe'), 'fixture-installer');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ packageManager: 'pnpm@11.3.0' }),
  );
  fs.writeFileSync(
    path.join(root, 'dependencies.json'),
    JSON.stringify([
      {
        name: 'laserforge',
        version: '1.2.3',
        dependencies: { react: { name: 'react', version: '18.3.1' } },
      },
    ]),
  );
  const result = generateReleaseEvidence({
    releaseDir,
    version: '1.2.3',
    sourceSha: 'a'.repeat(40),
    dependencyJson: path.join(root, 'dependencies.json'),
    packageFile: path.join(root, 'package.json'),
    generatedAt: '2026-08-26T00:00:00.000Z',
  });
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.provenance.toolchain.pnpm, 'pnpm@11.3.0');
  assert.ok(result.sbom.packages.some((entry) => entry.name === 'react'));
  assert.match(
    fs.readFileSync(path.join(releaseDir, 'checksums.sha256'), 'utf8'),
    /^[0-9a-f]{64} {2}KerfDesk\.exe\n$/u,
  );
});
