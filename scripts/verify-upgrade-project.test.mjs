import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FIXTURE_NAME,
  CURRENT_QUALIFICATION_PROJECT_SCHEMA,
  HISTORICAL_QUALIFICATION_PROJECT_SCHEMA,
} from './installed-app-evidence.mjs';
import { validateUpgradeProject } from './verify-upgrade-project.mjs';

const historicalFixture = {
  schemaVersion: HISTORICAL_QUALIFICATION_PROJECT_SCHEMA,
  device: {
    name: 'Upgrade retention fixture',
    bedWidth: 321,
    bedHeight: 234,
    origin: 'front-left',
  },
  machine: { kind: 'laser' },
  workspace: { zoom: 1 },
  jobSetup: { startFrom: 'absolute' },
  scene: {
    objects: [
      {
        id: 'artwork-fixture',
        kind: 'imported-svg',
        source: FIXTURE_NAME,
        paths: [
          {
            polylines: [
              {
                points: [
                  { x: 0, y: 0 },
                  { x: 20, y: 0 },
                  { x: 20, y: 12 },
                  { x: 0, y: 12 },
                ],
              },
            ],
          },
        ],
      },
    ],
    layers: [{ id: 'line-fixture', mode: 'line' }],
  },
};
const fixture = { ...historicalFixture, schemaVersion: CURRENT_QUALIFICATION_PROJECT_SCHEMA };
const knownUpgrade = { schemaMode: 'known-upgrade' };
const encoded = (value) => Buffer.from(JSON.stringify(value));

test('installed project qualification matches the canonical writer schema before native execution', async () => {
  // Require an explicit current qualification update when the writer changes.
  // The public 1.0.2/1.0.3 contract remains separately represented as schema 12.
  const source = await readFile(new URL('../src/core/scene/project.ts', import.meta.url), 'utf8');
  const versions = [
    ...source.matchAll(/^export const PROJECT_SCHEMA_VERSION = (\d+) as const;$/gm),
  ];
  assert.equal(versions.length, 1, 'Canonical schema declaration changed; review qualification');
  assert.equal(Number(versions[0][1]), fixture.schemaVersion, 'Qualification schema is stale');
  assert.deepEqual(validateUpgradeProject(encoded(fixture)), fixture);
});

test('current project qualification refuses historical, future and malformed schema versions', () => {
  for (const schemaVersion of [8, 9, 10, 11, 12, 13, 14, 16, '14', '15', null, undefined]) {
    assert.throws(
      () => validateUpgradeProject(encoded({ ...fixture, schemaVersion })),
      /Expected current project schema/,
    );
  }
});

test('current project qualification compares actual geometry, operations and machine configuration', () => {
  assert.deepEqual(validateUpgradeProject(encoded(fixture), fixture), fixture);
  for (const mutate of [
    (value) => {
      value.device.bedWidth = 320;
    },
    (value) => {
      value.device.origin = 'rear-right';
    },
    (value) => {
      value.machine.kind = 'cnc';
    },
    (value) => {
      value.scene.objects[0].paths[0].polylines[0].points[1].x = 19;
    },
    (value) => {
      value.scene.layers[0].mode = 'fill';
    },
    (value) => {
      value.workspace.zoom = 2;
    },
    (value) => {
      value.jobSetup.startFrom = 'current';
    },
  ]) {
    const changed = structuredClone(fixture);
    mutate(changed);
    assert.throws(() => validateUpgradeProject(encoded(changed), fixture));
  }
});

test('the known upgrade contract accepts historical retention and current migration without rewriting old saves', () => {
  assert.equal(historicalFixture.schemaVersion, 12);
  assert.deepEqual(
    validateUpgradeProject(encoded(historicalFixture), undefined, knownUpgrade),
    historicalFixture,
  );
  assert.deepEqual(
    validateUpgradeProject(encoded(historicalFixture), historicalFixture, knownUpgrade),
    historicalFixture,
  );
  assert.deepEqual(
    validateUpgradeProject(encoded(fixture), historicalFixture, knownUpgrade),
    fixture,
  );
  assert.throws(
    () => validateUpgradeProject(encoded(fixture), historicalFixture),
    /Expected current project schema/,
  );
  assert.throws(
    () => validateUpgradeProject(encoded(historicalFixture), fixture, knownUpgrade),
    /schema downgrade/,
  );
});

test('known upgrade qualification keeps schema, scene and machine evidence strict', () => {
  for (const schemaVersion of [11, 16, '12', '13', '14', '15', null, undefined]) {
    assert.throws(
      () =>
        validateUpgradeProject(
          encoded({ ...historicalFixture, schemaVersion }),
          undefined,
          knownUpgrade,
        ),
      /Expected known upgrade project schema/,
    );
  }
  const moved = structuredClone(fixture);
  moved.scene.objects[0].paths[0].polylines[0].points.forEach((point) => {
    point.x += 1;
  });
  assert.throws(
    () => validateUpgradeProject(encoded(moved), historicalFixture, knownUpgrade),
    /artwork\/operations changed/,
  );
  const machine = { ...fixture, machine: { kind: 'cnc' } };
  assert.throws(
    () => validateUpgradeProject(encoded(machine), historicalFixture, knownUpgrade),
    /Saved machine/,
  );
});

test('known upgrade preserves schema 13/14 saves and verifies their migration to the current writer', () => {
  for (const schemaVersion of [13, 14]) {
    const previous = { ...historicalFixture, schemaVersion };
    assert.deepEqual(validateUpgradeProject(encoded(previous), previous, knownUpgrade), previous);
    assert.deepEqual(validateUpgradeProject(encoded(fixture), previous, knownUpgrade), fixture);
    assert.throws(
      () => validateUpgradeProject(encoded(previous)),
      /Expected current project schema/,
    );
    assert.throws(
      () => validateUpgradeProject(encoded(previous), fixture, knownUpgrade),
      /schema downgrade/,
    );
    const changed = structuredClone(fixture);
    changed.scene.layers[0].mode = 'fill';
    assert.throws(
      () => validateUpgradeProject(encoded(changed), previous, knownUpgrade),
      /artwork\/operations changed/,
    );
    const machine = { ...fixture, machine: { kind: 'cnc' } };
    assert.throws(
      () => validateUpgradeProject(encoded(machine), previous, knownUpgrade),
      /Saved machine/,
    );
  }
});
