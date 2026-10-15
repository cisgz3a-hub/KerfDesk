import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  verifyObservationOwner,
  observationArguments,
  assertSameObservationOwner,
} from './packaged-observation-owner.mjs';

test('rejects missing, duplicate and ambiguous observation launch arguments', () => {
  for (const line of [
    '',
    'app.exe --user-data-dir=D:/temp',
    'app.exe --kerfdesk-native-smoke-interactive',
    'app.exe --kerfdesk-native-smoke-interactive --kerfdesk-native-smoke-user-data=a --kerfdesk-native-smoke-user-data=b --kerfdesk-native-smoke-result=c',
  ]) {
    assert.throws(() => observationArguments(line));
  }
  assert.deepEqual(
    observationArguments(
      'app.exe --kerfdesk-native-smoke-interactive "--kerfdesk-native-smoke-user-data=D:/space path" --kerfdesk-native-smoke-result=D:/result',
    ),
    { profile: 'D:/space path', result: 'D:/result' },
  );
});

test('validates actual OS ownership and native profile evidence before allowing observation', async () => {
  const root = await mkdtemp(resolve('output-owner-test-'));
  const oldAppData = process.env.APPDATA;
  try {
    const profile = join(root, 'isolated', 'profile');
    const isolation = join(root, 'isolated');
    const ordinary = join(root, 'roaming');
    await mkdir(profile, { recursive: true });
    await mkdir(ordinary);
    process.env.APPDATA = ordinary;
    const executable = join(root, 'KerfDesk.exe');
    const otherExe = join(root, 'Other.exe');
    await writeFile(executable, 'fixture');
    await writeFile(otherExe, 'fixture');
    const result = join(isolation, 'ready.json');
    const receipt = {
      mode: 'interactive-observation',
      isPackaged: true,
      isolated: true,
      readyToShow: true,
      userData: profile,
      sessionData: profile,
    };
    await writeFile(result, JSON.stringify(receipt));
    const identity = {
      pid: 123,
      executable,
      startedAt: new Date(Date.now() - 60000).toISOString(),
      commandLine: `"${executable}" --kerfdesk-native-smoke-interactive "--kerfdesk-native-smoke-user-data=${profile}" "--kerfdesk-native-smoke-result=${result}"`,
    };
    const options = {
      'expected-pid': 123,
      executable,
      'expected-profile': profile,
      'isolation-root': isolation,
    };
    const read = async () => identity;
    const accepted = await verifyObservationOwner(options, read);
    assert.equal(accepted.pid, 123);
    assertSameObservationOwner(accepted, await verifyObservationOwner(options, read));
    await assert.rejects(
      verifyObservationOwner({ ...options, executable: otherExe }, read),
      /executable mismatch/,
    );
    await assert.rejects(
      verifyObservationOwner({ ...options, 'expected-profile': ordinary }, read),
      /profile mismatch/,
    );
    await assert.rejects(
      verifyObservationOwner({ ...options, 'expected-profile': undefined }, read),
      /Absolute/,
    );
    await assert.rejects(
      verifyObservationOwner({ ...options, 'isolation-root': profile }, read),
      /inside isolation/,
    );
    await assert.rejects(
      verifyObservationOwner(options, async () => ({ ...identity, pid: 124 })),
      /identity/,
    );
    await assert.rejects(
      verifyObservationOwner(options, async () => ({
        ...identity,
        startedAt: new Date(Date.now() + 60000).toISOString(),
      })),
      /predates/,
    );
    assert.throws(
      () => assertSameObservationOwner(accepted, { ...accepted, startedAt: 'changed' }),
      /changed/,
    );
    await writeFile(result, JSON.stringify({ ...receipt, sessionData: ordinary }));
    await assert.rejects(verifyObservationOwner(options, read), /runtime profile mismatch/);
    await writeFile(result, JSON.stringify(receipt));
    // Even a path under the chosen evidence root cannot alias ordinary app data.
    const alias = join(isolation, 'alias');
    await symlink(ordinary, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const redirected = { ...identity, commandLine: identity.commandLine.replace(profile, alias) };
    await assert.rejects(
      verifyObservationOwner({ ...options, 'expected-profile': alias }, async () => redirected),
      /inside isolation|Ordinary/,
    );
    process.env.APPDATA = isolation;
    await assert.rejects(verifyObservationOwner(options, read), /Ordinary/);
  } finally {
    if (oldAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = oldAppData;
    await rm(root, { recursive: true, force: true });
  }
});
