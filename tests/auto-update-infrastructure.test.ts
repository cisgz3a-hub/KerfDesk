/**
 * T2-101: Electron auto-update infrastructure contract.
 *
 * Run: npx tsx tests/auto-update-infrastructure.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
  }
}

console.log('\n=== T2-101 auto-update infrastructure ===\n');

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  build?: { publish?: Array<Record<string, string>> };
};
const main = fs.readFileSync(path.join(repoRoot, 'electron', 'main.ts'), 'utf8');
const preload = fs.readFileSync(path.join(repoRoot, 'electron', 'preload.ts'), 'utf8');
const types = fs.readFileSync(path.join(repoRoot, 'src', 'types', 'web-serial.d.ts'), 'utf8');

assert(typeof pkg.dependencies?.['electron-updater'] === 'string', 'electron-updater is a runtime dependency');
assert(pkg.build?.publish?.[0]?.provider === 'github', 'electron-builder publish provider is GitHub');
assert(pkg.build?.publish?.[0]?.owner === 'stolkjohannjohann-sudo', 'publish owner is configured');
assert(pkg.build?.publish?.[0]?.repo === 'LaserForge', 'publish repo is configured');

assert(/import \{ autoUpdater \} from 'electron-updater'/.test(main), 'main imports autoUpdater');
assert(/const UPDATE_CHECK_DELAY_MS = 30_000/.test(main), 'auto-update check is delayed after startup');
assert(/if \(isDev\) return/.test(main), 'update checks do not run in dev');
assert(/autoUpdater\.checkForUpdatesAndNotify\(\)/.test(main), 'main checks for updates through electron-updater');
assert(/autoUpdater\.on\('update-available'/.test(main), 'update-available is forwarded');
assert(/autoUpdater\.on\('update-downloaded'/.test(main), 'update-downloaded is forwarded');
assert(/autoUpdater\.on\('download-progress'/.test(main), 'download-progress is forwarded');
assert(/autoUpdater\.on\('error'/.test(main), 'update errors are caught and forwarded');
assert(/mainWindow\?\.webContents\.send\('update:event'/.test(main), 'update events go through a single renderer channel');
assert(/ipcMain\.handle\('update:check'/.test(main), 'manual update check IPC exists');
assert(/ipcMain\.handle\(\s*'update:install'/.test(main), 'install update IPC exists');
assert(/state\?\.jobRunning === true \|\| isJobWakeLockActive\(\)/.test(main), 'quitAndInstall is blocked while a job is running');
assert(/autoUpdater\.quitAndInstall\(\)/.test(main), 'install IPC calls quitAndInstall after guard');
assert(/scheduleAutoUpdateCheck\(\)/.test(main), 'startup schedules an update check');

assert(/updates:\s*\{[\s\S]*check: \(\) =>[\s\S]*update:check/.test(preload), 'preload exposes update check');
assert(/install: \(state\?: \{ jobRunning\?: boolean \}\) =>[\s\S]*update:install/.test(preload), 'preload exposes guarded install');
assert(/onEvent: \(handler: \(event: unknown\) => void\)/.test(preload), 'preload exposes update event subscription');
assert(/ipcRenderer\.on\('update:event'/.test(preload), 'preload subscribes to update event channel');
assert(/removeListener\('update:event'/.test(preload), 'preload returns an update unsubscribe');

assert(/updates\?: \{[\s\S]*check\(\): Promise<unknown>/.test(types), 'ElectronAPI typing includes update check');
assert(/install\(state\?: \{ jobRunning\?: boolean \}\): Promise<unknown>/.test(types), 'ElectronAPI typing includes guarded install');
assert(/onEvent\(handler: \(event: unknown\) => void\): \(\) => void/.test(types), 'ElectronAPI typing includes update event subscription');

console.log(`\nT2-101 auto-update infrastructure: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
