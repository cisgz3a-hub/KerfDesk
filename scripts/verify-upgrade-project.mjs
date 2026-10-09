import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { assertRoundtrip, validateProject } from './installed-app-evidence.mjs';

/** Read the writer belonging to the authenticated installed source, never execute it. */
export async function readUpgradeProjectSchema(
  sourceSha,
  root = fileURLToPath(new URL('../', import.meta.url)),
  execute = promisify(execFile),
) {
  assert.match(sourceSha ?? '', /^[a-f0-9]{40}$/u, 'Expected exact installed source SHA');
  const { stdout } = await execute('git', ['show', `${sourceSha}:src/core/scene/project.ts`], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 262_144,
  });
  const declarations = [
    ...stdout.matchAll(/^export const PROJECT_SCHEMA_VERSION = ([1-9]\d*) as const;\r?$/gmu),
  ];
  assert.equal(declarations.length, 1, 'Installed source must declare one project writer schema');
  const schemaVersion = Number(declarations[0][1]);
  assert.ok(Number.isSafeInteger(schemaVersion), 'Installed project writer schema is invalid');
  return schemaVersion;
}

export function validateUpgradeProject(bytes, previous, options) {
  const { expectedSchemaVersion, ...projectOptions } = options ?? {};
  const project = validateProject(bytes, projectOptions);
  if (expectedSchemaVersion !== undefined) {
    assert.ok(
      Number.isSafeInteger(expectedSchemaVersion) && expectedSchemaVersion > 0,
      'Expected installed project writer schema is invalid',
    );
    assert.equal(
      project.schemaVersion,
      expectedSchemaVersion,
      'Saved project schema differs from the authenticated installed writer',
    );
  }
  assert.equal(project.device?.name, 'Upgrade retention fixture');
  assert.equal(project.device?.bedWidth, 321);
  assert.equal(project.device?.bedHeight, 234);
  if (previous) {
    validateProject(Buffer.from(JSON.stringify(previous)), projectOptions);
    assert.ok(project.schemaVersion >= previous.schemaVersion, 'Project schema downgrade refused');
    assertRoundtrip(previous, project);
    assert.deepEqual(project.device, previous.device, 'Saved machine profile changed');
    assert.deepEqual(project.machine, previous.machine, 'Saved machine kind/configuration changed');
    assert.deepEqual(
      project.optimization,
      previous.optimization,
      'Saved optimization settings changed',
    );
    assert.deepEqual(
      project.parkedCncMachine,
      previous.parkedCncMachine,
      'Saved parked CNC machine configuration changed',
    );
    assert.deepEqual(
      canonicalUpgradeCncSetup(project, project.schemaVersion),
      canonicalUpgradeCncSetup(previous, project.schemaVersion),
      'Saved CNC machining setup changed',
    );
  }
  return project;
}

function canonicalUpgradeCncSetup(project, currentSchemaVersion) {
  if (project.cncSetup !== undefined) return project.cncSetup;
  // Schema 15's reader supplies the canonical empty setup for CNC/parked-CNC
  // projects whose older save omitted it. Compare those effective settings;
  // missing empty defaults do not erase any retained name, notes or fixtures.
  if (
    currentSchemaVersion < 15 ||
    (project.machine?.kind !== 'cnc' && project.parkedCncMachine?.kind !== 'cnc')
  )
    return undefined;
  return {
    id: 'cnc-setup-1',
    name: 'Setup 1',
    notes: '',
    wcs: 'G54',
    zDatum: 'stock-top',
    fixtures: [],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const hasExpectedSource = args[0] === '--expected-source';
  const sourceSha = hasExpectedSource ? args[1] : undefined;
  const [current, previous, ...extra] = hasExpectedSource ? args.slice(2) : args;
  if (!current || current.startsWith('--') || extra.length)
    throw new Error(
      'Expected optional --expected-source SHA, current and optional previous project.',
    );
  // This CLI belongs to the authenticated historical upgrade lane. Accept only
  // its known schema contracts, including unchanged historical pairs. The native
  // driver also supplies its installed source to require that phase's writer;
  // the exported API remains current-strict by default.
  const options = { schemaMode: 'known-upgrade' };
  const expectedSchemaVersion = hasExpectedSource
    ? await readUpgradeProjectSchema(sourceSha)
    : undefined;
  validateUpgradeProject(
    await readFile(current),
    previous ? validateUpgradeProject(await readFile(previous), undefined, options) : undefined,
    { ...options, expectedSchemaVersion },
  );
  console.log(
    'Saved artwork, geometry, workspace, job setup, machining setup, optimization and machine configuration verified.',
  );
}
