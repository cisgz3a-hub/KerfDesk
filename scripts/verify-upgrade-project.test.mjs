import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { FIXTURE_NAME } from './installed-app-evidence.mjs';
import { validateUpgradeProject } from './verify-upgrade-project.mjs';

const fixture = {
  schemaVersion: 12,
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
const encoded = (value) => Buffer.from(JSON.stringify(value));

test('installed project qualification matches the canonical writer schema before native execution', async () => {
  // This fixture also represents authenticated public 1.0.2 and 1.0.3 saves.
  // Require an explicit qualification update if the app's persistence format changes.
  const source = await readFile(new URL('../src/core/scene/project.ts', import.meta.url), 'utf8');
  const versions = [
    ...source.matchAll(/^export const PROJECT_SCHEMA_VERSION = (\d+) as const;$/gm),
  ];
  assert.equal(versions.length, 1, 'Canonical schema declaration changed; review qualification');
  assert.equal(Number(versions[0][1]), fixture.schemaVersion, 'Qualification schema is stale');
  assert.deepEqual(validateUpgradeProject(encoded(fixture)), fixture);
});

test('historical project qualification refuses legacy, future and malformed schema versions', () => {
  for (const schemaVersion of [8, 9, 10, 11, 13, '12', null, undefined]) {
    assert.throws(
      () => validateUpgradeProject(encoded({ ...fixture, schemaVersion })),
      /Expected current project schema/,
    );
  }
});

test('historical project qualification compares actual geometry, operations and machine configuration', () => {
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
