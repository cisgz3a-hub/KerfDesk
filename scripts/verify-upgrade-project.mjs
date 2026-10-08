import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertRoundtrip, validateProject } from './installed-app-evidence.mjs';

export function validateUpgradeProject(bytes, previous, options) {
  const project = validateProject(bytes, options);
  assert.equal(project.device?.name, 'Upgrade retention fixture');
  assert.equal(project.device?.bedWidth, 321);
  assert.equal(project.device?.bedHeight, 234);
  if (previous) {
    validateProject(Buffer.from(JSON.stringify(previous)), options);
    assert.ok(project.schemaVersion >= previous.schemaVersion, 'Project schema downgrade refused');
    assertRoundtrip(previous, project);
    assert.deepEqual(project.device, previous.device, 'Saved machine profile changed');
    assert.deepEqual(project.machine, previous.machine, 'Saved machine kind/configuration changed');
  }
  return project;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [current, previous, ...extra] = process.argv.slice(2);
  if (!current || extra.length) throw new Error('Expected current and optional previous project.');
  // This CLI belongs to the authenticated historical upgrade lane. Accept only
  // its known schema contracts, including an unchanged 12-to-12 historical pair
  // and reviewed 12/13/14-to-15 migrations; the exported API remains current-strict by default.
  const options = { schemaMode: 'known-upgrade' };
  validateUpgradeProject(
    await readFile(current),
    previous ? validateUpgradeProject(await readFile(previous), undefined, options) : undefined,
    options,
  );
  console.log('Saved artwork, geometry, workspace, job setup and machine profile verified.');
}
