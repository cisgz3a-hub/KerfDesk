import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { win32 } from 'node:path';

export const FIXTURE_NAME = 'installed qualification artwork.svg';
export const FIXTURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24mm" height="18mm" viewBox="0 0 24 18"><path d="M2 3 L22 3 L22 15 L2 15 Z" fill="none" stroke="#123456" stroke-width="0.2"/></svg>\n`;
export const OWNER_FILE = '.kerfdesk-installer-qualification-owner.json';

export function parseArgs(argv) {
  const allowed = new Set([
    'executable',
    'output-root',
    'expected-profile',
    'phase',
    'project',
    'expected-version',
    'expected-commit',
  ]);
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    const value = argv[index + 1];
    if (!argv[index]?.startsWith('--') || !allowed.has(key) || !value || value.startsWith('--')) {
      throw new Error(`Invalid argument: ${argv[index] ?? '(missing)'}`);
    }
    if (Object.hasOwn(args, key)) throw new Error(`Duplicate argument: --${key}`);
    args[key] = value;
  }
  for (const key of ['executable', 'output-root', 'expected-profile', 'phase', 'project']) {
    if (!args[key]) throw new Error(`Required argument: --${key}`);
  }
  if (!['create', 'reopen'].includes(args.phase)) throw new Error('Phase must be create or reopen');
  for (const key of ['executable', 'output-root', 'expected-profile', 'project']) {
    if (!win32.isAbsolute(args[key]) || args[key].startsWith('\\\\')) {
      throw new Error(`--${key} must be an absolute local Windows path`);
    }
    args[key] = win32.resolve(args[key]);
  }
  if (!/\.exe$/i.test(args.executable)) throw new Error('Installed executable must be an .exe');
  if (!/\.lf2$/i.test(args.project)) throw new Error('Project must be an .lf2 file');
  if (args['expected-commit'] && !/^[a-f0-9]{7,40}$/i.test(args['expected-commit'])) {
    throw new Error('Expected commit must be a 7-40 character Git SHA');
  }
  return args;
}

export function assertHostedWindows(platform, env) {
  if (
    platform !== 'win32' ||
    env.GITHUB_ACTIONS !== 'true' ||
    env.RUNNER_ENVIRONMENT !== 'github-hosted'
  ) {
    throw new Error(
      'Installed app qualification runs only on a disposable GitHub-hosted Windows runner',
    );
  }
  if (!env.RUNNER_TEMP || !win32.isAbsolute(env.RUNNER_TEMP) || !env.GITHUB_RUN_ID) {
    throw new Error('Runner temporary directory and workflow run identity are required');
  }
}

export function sameWindowsPath(left, right) {
  return win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
}

export function assertInsideWindows(parent, candidate) {
  const relative = win32.relative(parent, candidate);
  if (!relative || relative === '..' || relative.startsWith('..\\') || win32.isAbsolute(relative)) {
    throw new Error(`Qualification path must be inside its owned parent: ${candidate}`);
  }
}

export function evidenceParents(env) {
  return [
    env.RUNNER_TEMP,
    ...(env.GITHUB_WORKSPACE
      ? [win32.join(env.GITHUB_WORKSPACE, 'artifacts', 'installed-qualification')]
      : []),
  ];
}

export function assertEvidencePath(candidate, parents) {
  if (
    !parents.some((parent) => {
      try {
        assertInsideWindows(parent, candidate);
        return true;
      } catch {
        return false;
      }
    })
  )
    throw new Error(
      'Evidence must be inside RUNNER_TEMP or GITHUB_WORKSPACE/artifacts/installed-qualification',
    );
}

export function assertPreflight(args, probe, env) {
  assertEvidencePath(args['output-root'], evidenceParents(env));
  assertInsideWindows(env.RUNNER_TEMP, args.executable);
  assertInsideWindows(env.RUNNER_TEMP, args.project);
  if (!sameWindowsPath(args['expected-profile'], win32.join(probe.appData, 'laserforge'))) {
    throw new Error('Expected profile differs from the normal installed app profile');
  }
  if (probe.existingProcesses.length)
    throw new Error('A KerfDesk/LaserForge process already exists');
  if (!probe.userInteractive || probe.sessionId === 0)
    throw new Error('Runner has no interactive desktop session');
}

export async function prepareProfile(args, env) {
  const profile = args['expected-profile'];
  const ownerPath = win32.join(profile, OWNER_FILE);
  const owner = { runId: env.GITHUB_RUN_ID, project: args.project };
  if (args.phase === 'create') {
    const entries = await fs.readdir(profile).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    if (entries.length) throw new Error('Create requires a fresh empty runner profile');
    await fs.mkdir(profile, { recursive: true });
    await fs.writeFile(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, { flag: 'wx' });
  } else {
    const actual = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
    if (actual.runId !== owner.runId || !sameWindowsPath(actual.project, owner.project)) {
      throw new Error('Reopen profile is not owned by this workflow/project');
    }
  }
  return owner;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function summarizeDialogResults(label, button, settled) {
  const outcomes = settled.map((result, index) => ({
    operation: index === 0 ? 'native-helper' : 'renderer-click',
    status: result.status,
    ...(result.status === 'rejected'
      ? { error: result.reason?.stack ?? result.reason?.message ?? String(result.reason) }
      : {}),
  }));
  const failures = outcomes.filter((result) => result.status === 'rejected');
  return {
    label,
    button,
    outcomes,
    failure: failures.length
      ? failures.map((result) => `${result.operation}: ${result.error}`).join('\n')
      : null,
  };
}

export function assertBuildMetadata(title, args) {
  const version = /^Version (.+)$/m.exec(title)?.[1];
  const commit = /^Commit (.+)$/m.exec(title)?.[1];
  if (!version || !commit || !/^[a-f0-9]{7,40}$/i.test(commit))
    throw new Error('Renderer build badge has no valid version/commit metadata');
  if (args['expected-version'] && version !== args['expected-version']) {
    throw new Error(
      `Renderer version ${version} differs from expected ${args['expected-version']}`,
    );
  }
  if (
    args['expected-commit'] &&
    !args['expected-commit'].toLowerCase().startsWith(commit.toLowerCase()) &&
    !commit.toLowerCase().startsWith(args['expected-commit'].toLowerCase())
  ) {
    throw new Error(`Renderer commit ${commit} differs from expected ${args['expected-commit']}`);
  }
  return { version, commit, badge: title };
}

export function validateProject(bytes) {
  const project = JSON.parse(bytes.toString('utf8'));
  assert.equal(project.schemaVersion, 8, 'Expected current project schema');
  assert.equal(
    project.scene?.objects?.length,
    1,
    'Fixture must produce exactly one artwork object',
  );
  const object = project.scene.objects[0];
  assert.equal(object.kind, 'imported-svg');
  assert.equal(object.source, FIXTURE_NAME, 'Imported source filename must survive');
  assert.ok(object.paths?.length > 0, 'Imported geometry is missing');
  const points = object.paths.flatMap((path) => path.polylines.flatMap((line) => line.points));
  assert.ok(points.length >= 4, 'Imported rectangle vertices are missing');
  assert.ok(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  const width =
    Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x));
  const height =
    Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y));
  assert.ok(
    Math.abs(width - 20) < 0.001 && Math.abs(height - 12) < 0.001,
    'Imported millimetre geometry changed',
  );
  assert.ok(project.scene.layers.length > 0, 'Imported operation/layer is missing');
  return project;
}

export function assertRoundtrip(before, after) {
  // Full persisted scene includes paths, transforms, operation bindings, layers and IDs.
  assert.deepEqual(after.scene, before.scene, 'Reopened artwork/operations changed during Save As');
  assert.deepEqual(after.workspace, before.workspace, 'Reopened workspace changed');
  assert.deepEqual(after.jobSetup, before.jobSetup, 'Reopened job setup changed');
}
