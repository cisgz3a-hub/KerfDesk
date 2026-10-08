import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  FIXTURE_NAME,
  CURRENT_QUALIFICATION_PROJECT_SCHEMA,
  HISTORICAL_QUALIFICATION_PROJECT_SCHEMA,
} from './installed-app-evidence.mjs';
import { readUpgradeProjectSchema, validateUpgradeProject } from './verify-upgrade-project.mjs';

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

test('the authenticated installed writer fences each phase while keeping historical sources admissible', () => {
  for (const schemaVersion of [12, 14]) {
    const old = { ...historicalFixture, schemaVersion };
    assert.deepEqual(
      validateUpgradeProject(encoded(old), old, {
        ...knownUpgrade,
        expectedSchemaVersion: schemaVersion,
      }),
      old,
    );
    assert.deepEqual(
      validateUpgradeProject(encoded(fixture), old, {
        ...knownUpgrade,
        expectedSchemaVersion: CURRENT_QUALIFICATION_PROJECT_SCHEMA,
      }),
      fixture,
    );
    assert.throws(
      () =>
        validateUpgradeProject(encoded(old), old, {
          ...knownUpgrade,
          expectedSchemaVersion: CURRENT_QUALIFICATION_PROJECT_SCHEMA,
        }),
      /differs from the authenticated installed writer/,
    );
  }
  for (const expectedSchemaVersion of [0, 1.5, '15', null, NaN, Infinity])
    assert.throws(
      () =>
        validateUpgradeProject(encoded(fixture), undefined, {
          ...knownUpgrade,
          expectedSchemaVersion,
        }),
      /writer schema is invalid/,
    );
});

test('qualification retains admitted optimization and parked CNC values through schema migration', () => {
  const previous = {
    ...historicalFixture,
    schemaVersion: 14,
    optimization: {
      reduceTravelMoves: true,
      travelPolicy: 'nearest-neighbor',
      insideFirst: true,
      removeOverlappingLines: false,
      layerPriority: 'project-order',
      pathDirection: 'allow-reverse',
      startPoint: 'machine-origin',
      closedShapeStart: 'drawn',
    },
    parkedCncMachine: {
      kind: 'cnc',
      stock: { thicknessMm: 18, widthMm: 321, heightMm: 234, originOffset: { x: 2, y: 3 } },
      tools: [{ id: 'retained-tool', name: 'Retained tool', kind: 'end-mill', diameterMm: 3.175 }],
      toolId: 'retained-tool',
      params: { safeZMm: 12, spindleMaxRpm: 12000, spindleSpinupSec: 3, coolant: 'off' },
    },
  };
  const current = { ...previous, schemaVersion: CURRENT_QUALIFICATION_PROJECT_SCHEMA };
  const options = { ...knownUpgrade, expectedSchemaVersion: CURRENT_QUALIFICATION_PROJECT_SCHEMA };
  assert.deepEqual(validateUpgradeProject(encoded(current), previous, options), current);
  const changedOptimization = structuredClone(current);
  changedOptimization.optimization.insideFirst = false;
  assert.throws(
    () => validateUpgradeProject(encoded(changedOptimization), previous, options),
    /Saved optimization settings changed/,
  );
  const lostParked = structuredClone(current);
  delete lostParked.parkedCncMachine;
  assert.throws(
    () => validateUpgradeProject(encoded(lostParked), previous, options),
    /Saved parked CNC machine configuration changed/,
  );
  const changedParked = structuredClone(current);
  changedParked.parkedCncMachine.params.safeZMm = 1;
  assert.throws(
    () => validateUpgradeProject(encoded(changedParked), previous, options),
    /Saved parked CNC machine configuration changed/,
  );
});

test('schema discovery reads the exact installed source without evaluating it', async () => {
  const sourceSha = 'a'.repeat(40);
  for (const schemaVersion of [12, 14, CURRENT_QUALIFICATION_PROJECT_SCHEMA]) {
    const schema = await readUpgradeProjectSchema(
      sourceSha,
      '/review-root',
      async (file, args, options) => {
        assert.equal(file, 'git');
        assert.deepEqual(args, ['show', `${sourceSha}:src/core/scene/project.ts`]);
        assert.equal(options.cwd, '/review-root');
        assert.equal(options.windowsHide, true);
        return {
          stdout: `throw new Error('Never evaluate historical source');\r\nexport const PROJECT_SCHEMA_VERSION = ${schemaVersion} as const;\r\n`,
        };
      },
    );
    assert.equal(schema, schemaVersion);
  }
});

test('schema discovery refuses missing, ambiguous and malformed writer declarations', async () => {
  for (const stdout of [
    '',
    'export const PROJECT_SCHEMA_VERSION = 14 as const;\nexport const PROJECT_SCHEMA_VERSION = 15 as const;\n',
    'export const PROJECT_SCHEMA_VERSION = 15.5 as const;\n',
    'export const PROJECT_SCHEMA_VERSION = "15" as const;\n',
    'export const PROJECT_SCHEMA_VERSION = 0 as const;\n',
    'export const PROJECT_SCHEMA_VERSION = 9007199254740992 as const;\n',
  ])
    await assert.rejects(
      readUpgradeProjectSchema('a'.repeat(40), '/review-root', async () => ({ stdout })),
      /writer schema/,
    );
  await assert.rejects(readUpgradeProjectSchema('main'), /exact installed source/);
  await assert.rejects(
    readUpgradeProjectSchema('a'.repeat(40), '/review-root', async () => {
      throw new Error('Historical source is missing from qualification checkout');
    }),
    /Historical source is missing/,
  );
});

test('the actual CLI fences the saved schema against each installed source in local Git history', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'kerfdesk-upgrade-writer-'));
  try {
    await mkdir(join(temp, 'scripts'));
    await mkdir(join(temp, 'src/core/scene'), { recursive: true });
    for (const name of ['verify-upgrade-project.mjs', 'installed-app-evidence.mjs'])
      await copyFile(new URL(`./${name}`, import.meta.url), join(temp, 'scripts', name));
    const script = join(temp, 'scripts', 'verify-upgrade-project.mjs');
    const git = (...args) => {
      const result = spawnSync(
        'git',
        [
          '-c',
          'user.name=Qualification fixture',
          '-c',
          'user.email=qualification@example.invalid',
          '-c',
          'commit.gpgSign=false',
          ...args,
        ],
        { cwd: temp, encoding: 'utf8' },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git('init', '--quiet');
    const sourceCommits = {};
    for (const schemaVersion of [14, CURRENT_QUALIFICATION_PROJECT_SCHEMA]) {
      await writeFile(
        join(temp, 'src/core/scene/project.ts'),
        `export const PROJECT_SCHEMA_VERSION = ${schemaVersion} as const;\n`,
      );
      git('add', '--', 'src/core/scene/project.ts');
      git('commit', '--quiet', '-m', `Writer schema ${schemaVersion}`);
      sourceCommits[schemaVersion] = git('rev-parse', 'HEAD');
    }
    const oldPath = join(temp, 'historical project.lf2');
    const currentPath = join(temp, 'current project.lf2');
    await writeFile(currentPath, encoded(fixture));
    const cli = (...args) => {
      const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
      assert.ifError(result.error);
      return result;
    };
    for (const schemaVersion of [12, 14]) {
      await writeFile(oldPath, encoded({ ...historicalFixture, schemaVersion }));
      const historical = cli(oldPath, oldPath);
      assert.equal(historical.status, 0, historical.stderr);
      const candidate = cli(
        '--expected-source',
        sourceCommits[CURRENT_QUALIFICATION_PROJECT_SCHEMA],
        currentPath,
        oldPath,
      );
      assert.equal(candidate.status, 0, candidate.stderr);
      const stale = cli(
        '--expected-source',
        sourceCommits[CURRENT_QUALIFICATION_PROJECT_SCHEMA],
        oldPath,
        oldPath,
      );
      assert.equal(stale.status, 1);
      assert.match(stale.stderr, /differs from the authenticated installed writer/);
    }
    const baseline = cli('--expected-source', sourceCommits[14], oldPath, oldPath);
    assert.equal(baseline.status, 0, baseline.stderr);
    const wrongBaselineWriter = cli('--expected-source', sourceCommits[14], currentPath, oldPath);
    assert.equal(wrongBaselineWriter.status, 1);
    assert.match(wrongBaselineWriter.stderr, /differs from the authenticated installed writer/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
