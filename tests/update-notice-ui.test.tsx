/**
 * T3-5: renderer-visible auto-update channel.
 *
 * Run: npx tsx tests/update-notice-ui.test.tsx
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T3-5 update notice UI ===\n');

const ROOT = process.cwd();
const noticePath = resolve(ROOT, 'src/ui/components/UpdateNotice.tsx');
const appPath = resolve(ROOT, 'src/ui/components/App.tsx');

let noticeSrc = '';
try {
  noticeSrc = readFileSync(noticePath, 'utf-8');
} catch {
  noticeSrc = '';
}
const appSrc = readFileSync(appPath, 'utf-8');

assert(/T3-5/.test(noticeSrc), 'UpdateNotice carries T3-5 marker');
assert(/UpdateEventKind/.test(noticeSrc), 'update event kind union is declared');
assert(/window\.electronAPI\?\.updates/.test(noticeSrc), 'component reads optional Electron updates bridge');
assert(/updates\.onEvent/.test(noticeSrc), 'component subscribes to update events');
assert(/return unsubscribe/.test(noticeSrc), 'component cleans up update event subscription');
assert(/updates\.check\(\)/.test(noticeSrc), 'manual update check button calls updates.check()');
assert(/message\?: unknown/.test(noticeSrc),
  'failed update IPC result parser reads optional message');
assert(/maybe\.message/.test(noticeSrc) && /maybe\.reason/.test(noticeSrc),
  'failed update IPC result parser prefers detailed message over reason code');
assert(/updates\.install\(\{ jobRunning: isJobRunning \}\)/.test(noticeSrc), 'restart button passes job-running guard to install IPC');
assert(/kind: 'downloaded'/.test(noticeSrc), 'downloaded event maps to restart-ready state');
assert(/Restart to update/.test(noticeSrc), 'downloaded state offers restart action');
assert(/disabled: isJobRunning/.test(noticeSrc), 'restart action disables while a job is running');
assert(/Job running/.test(noticeSrc), 'job-running disabled state explains why restart is blocked');
assert(/download-progress/.test(noticeSrc), 'download-progress event is surfaced');
assert(/update-error/.test(noticeSrc), 'error state has a stable test id');

assert(/import \{ UpdateNotice \} from '\.\/UpdateNotice'/.test(appSrc), 'App imports UpdateNotice');
assert(/React\.createElement\(UpdateNotice/.test(appSrc), 'App renders UpdateNotice');
assert(/isJobRunning: grbl\.isJobRunning/.test(appSrc), 'App passes live job-running state into UpdateNotice');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
