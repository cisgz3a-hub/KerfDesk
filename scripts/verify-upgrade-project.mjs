import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertRoundtrip, validateProject } from './installed-app-evidence.mjs';

export function validateUpgradeProject(bytes, previous) {
  const project = validateProject(bytes);
  assert.equal(project.device?.name, 'Upgrade retention fixture');
  assert.equal(project.device?.bedWidth, 321);
  assert.equal(project.device?.bedHeight, 234);
  if (previous) {
    assertRoundtrip(previous, project);
    assert.deepEqual(project.device, previous.device, 'Saved machine profile changed');
    assert.deepEqual(project.machine, previous.machine, 'Saved machine kind/configuration changed');
  }
  return project;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [current, previous, ...extra] = process.argv.slice(2);
  if (!current || extra.length) throw new Error('Expected current and optional previous project.');
  validateUpgradeProject(
    await readFile(current),
    previous ? validateUpgradeProject(await readFile(previous)) : undefined,
  );
  console.log('Saved artwork, geometry, workspace, job setup and machine profile verified.');
}
