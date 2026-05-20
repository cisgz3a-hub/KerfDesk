/**
 * F45-16-001: privileged app lifecycle IPC must be guarded by a main-process
 * active-job token, not renderer-supplied state alone.
 *
 * Run: npx tsx tests/electron-job-lifecycle-token.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

let passed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`ok - ${name}`);
    });
}

async function main(): Promise<void> {
  const guardPath = 'electron/jobLifecycleGuard.ts';
  assert(existsSync(guardPath), 'job lifecycle guard module exists');

  const guard = await import('../electron/jobLifecycleGuard');
  guard.resetJobLifecycleGuardForTests();

  await test('main-process lifecycle token blocks stale release and duplicate acquire', () => {
    const acquired = guard.acquireJobLifecycleToken('ticket-a');
    assert.equal(acquired.ok, true, 'first acquire succeeds');
    assert.equal(guard.hasActiveJobLifecycleToken(), true, 'active token is visible in main process');
    assert.equal(guard.canReleaseJobWakeLock(null), false, 'wake lock cannot be released without token while job active');
    assert.equal(guard.canReleaseJobWakeLock('wrong-token'), false, 'wake lock cannot be released with stale token');

    const duplicate = guard.acquireJobLifecycleToken('ticket-b');
    assert.equal(duplicate.ok, false, 'duplicate acquire is rejected while active');
    assert.equal(duplicate.reason, 'job-running', 'duplicate acquire reports job-running');

    const staleRelease = guard.releaseJobLifecycleToken('wrong-token');
    assert.equal(staleRelease.ok, false, 'stale release is rejected');
    assert.equal(guard.hasActiveJobLifecycleToken(), true, 'stale release leaves active job token intact');

    assert.equal(guard.canReleaseJobWakeLock(acquired.token), true, 'matching token may release wake lock');
    const release = guard.releaseJobLifecycleToken(acquired.token);
    assert.equal(release.ok, true, 'matching token releases lifecycle token');
    assert.equal(guard.hasActiveJobLifecycleToken(), false, 'active token is cleared after matching release');
  });

  const mainSource = readFileSync('electron/main.ts', 'utf8');
  const preloadSource = readFileSync('electron/preload.ts', 'utf8');
  const typesSource = readFileSync('src/types/web-serial.d.ts', 'utf8');
  const machineServiceSource = readFileSync('src/app/MachineService.ts', 'utf8');

  await test('Electron main IPC blocks quit/install using authoritative active-job token', () => {
    assert.match(mainSource, /job-lifecycle:acquire/, 'main registers lifecycle acquire IPC');
    assert.match(mainSource, /job-lifecycle:release/, 'main registers lifecycle release IPC');
    assert.match(mainSource, /hasActiveJobLifecycleToken\(\)/, 'main can query authoritative active-job token');
    assert.match(
      mainSource,
      /state\?\.jobRunning === true \|\| hasActiveJobLifecycleToken\(\) \|\| isJobWakeLockActive\(\)/,
      'update install is blocked by main-process active token, not only renderer state',
    );
    assert.match(
      mainSource,
      /ipcMain\.handle\('app:quit'[\s\S]*?hasActiveJobLifecycleToken\(\)[\s\S]*?reason: 'job-running'/,
      'app quit IPC refuses while a main-process active-job token exists',
    );
    assert.match(
      mainSource,
      /power:releaseJobWakeLock[\s\S]*?canReleaseJobWakeLock/,
      'wake-lock release consults the lifecycle token before clearing the lock',
    );
  });

  await test('preload and renderer types expose lifecycle token acquire/release', () => {
    assert.match(preloadSource, /acquireJobLifecycleToken: \(ticketId: string\) =>[\s\S]*job-lifecycle:acquire/, 'preload exposes lifecycle acquire');
    assert.match(preloadSource, /releaseJobLifecycleToken: \(token: string\) =>[\s\S]*job-lifecycle:release/, 'preload exposes lifecycle release');
    assert.match(preloadSource, /releaseJobWakeLock: \(token\?: string\) =>[\s\S]*power:releaseJobWakeLock/, 'preload release wake lock accepts token');
    assert.match(typesSource, /acquireJobLifecycleToken\?\(ticketId: string\): Promise/, 'ElectronAPI typing includes lifecycle acquire');
    assert.match(typesSource, /releaseJobLifecycleToken\?\(token: string\): Promise/, 'ElectronAPI typing includes lifecycle release');
    assert.match(typesSource, /releaseJobWakeLock\?\(token\?: string\): Promise/, 'ElectronAPI typing makes wake-lock release token-aware');
  });

  await test('MachineService owns lifecycle token around active job start/finalization', () => {
    assert.match(
      machineServiceSource,
      /acquireJobLifecycleToken\?: \(ticketId: string\) => Promise/,
      'MachineService reads lifecycle acquire API',
    );
    assert.match(
      machineServiceSource,
      /api\.acquireJobLifecycleToken\?\.\(ticketId\)/,
      'MachineService acquires main-process lifecycle token using the job ticket id',
    );
    assert.match(
      machineServiceSource,
      /releaseJobWakeLock\?\.\(token \?\? undefined\)/,
      'MachineService releases wake lock with the matching lifecycle token',
    );
    assert.match(
      machineServiceSource,
      /api\.releaseJobLifecycleToken\?\.\(token\)/,
      'MachineService releases main-process lifecycle token on job cleanup',
    );
    assert.match(
      machineServiceSource,
      /pre-stream lifecycle token/,
      'MachineService cleans up lifecycle token if pre-stream guard acquisition fails',
    );
  });

  console.log(`\n${passed} electron job lifecycle token tests passed`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
