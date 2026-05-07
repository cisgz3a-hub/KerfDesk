/**
 * T2-102 Layer 1: persistent failed-launch detection for rollback/safe mode.
 * Run: npx tsx tests/rollback-crash-loop-detection.test.ts
 */
export {};

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  beginStartupCrashLoopTracking,
  markStartupSuccessful,
  recordStartupCrash,
  startupCrashLoopStatePath,
} from '../electron/startupCrashLoop';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function rmrf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

void (async () => {
  console.log('\n=== T2-102 rollback crash-loop detection ===\n');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-crash-loop-'));
  try {
    const first = beginStartupCrashLoopTracking(root, 1000);
    assert(first.consecutiveFailures === 0, 'first boot starts with zero failures');
    assert(first.shouldEnterSafeMode === false, 'first boot does not enter safe mode');
    assert(fs.existsSync(startupCrashLoopStatePath(root)), 'state file is written on boot');

    const second = beginStartupCrashLoopTracking(root, 2000);
    assert(second.recoveredPreviousFailure === true, 'second boot recovers previous in-progress boot as failure');
    assert(second.consecutiveFailures === 1, 'second boot sees one failed launch');

    const third = beginStartupCrashLoopTracking(root, 3000);
    assert(third.consecutiveFailures === 2, 'third boot sees two failed launches');
    assert(third.shouldEnterSafeMode === false, 'threshold-1 does not enter safe mode');

    const fourth = beginStartupCrashLoopTracking(root, 4000);
    assert(fourth.consecutiveFailures === 3, 'fourth boot sees three failed launches');
    assert(fourth.shouldEnterSafeMode === true, 'three failed launches enters safe mode');

    markStartupSuccessful(root, 5000);
    const afterSuccess = beginStartupCrashLoopTracking(root, 6000);
    assert(afterSuccess.consecutiveFailures === 0, 'successful boot clears failure count');
    assert(afterSuccess.shouldEnterSafeMode === false, 'successful boot clears safe-mode trigger');

    recordStartupCrash(root, 'renderer crashed', 7000);
    const afterExplicitCrash = beginStartupCrashLoopTracking(root, 8000);
    assert(afterExplicitCrash.consecutiveFailures === 1, 'explicit crash record increments failure count');
    assert(afterExplicitCrash.lastFailureReason === 'renderer crashed', 'explicit crash reason persisted');
  } finally {
    rmrf(root);
  }

  {
    const mainSource = readFileSync(join(REPO_ROOT, 'electron', 'main.ts'), 'utf8');
    assert(/beginStartupCrashLoopTracking/.test(mainSource), 'main.ts records startup attempt on boot');
    assert(/markStartupSuccessful/.test(mainSource), 'main.ts marks startup successful after stable renderer load');
    assert(/recordStartupCrash/.test(mainSource), 'main.ts records startup/render crashes');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
