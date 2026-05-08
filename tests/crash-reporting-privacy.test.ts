/**
 * T3-6: crash reporting is opt-in, redacted, and wired at the renderer root.
 *
 * Run: npx tsx tests/crash-reporting-privacy.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildCrashReportPayload,
  createCrashReporter,
} from '../src/diagnostics/CrashReporter';

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

console.log('\n=== T3-6 crash reporting privacy ===\n');

const ROOT = process.cwd();
const mainSrc = readFileSync(resolve(ROOT, 'src/main.tsx'), 'utf-8');

const sensitive = {
  message: 'Crash in C:\\Users\\Alice\\Projects\\SecretCustomer\\job.lf from alice@example.com',
  stack: 'Error: boom\n    at C:\\Users\\Alice\\Projects\\SecretCustomer\\job.lf:12:4\n    at 192.168.0.10',
  componentStack: 'LaserPanel customer project SecretCustomer',
  capturedAt: '2026-05-07T00:00:00.000Z',
  projectName: 'SecretCustomer',
  license: '12345678-1234-1234-1234-123456789abc',
  imageData: new Uint8Array([1, 2, 3, 4]),
};

const payload = buildCrashReportPayload({
  source: 'renderer',
  appVersion: '1.0.0-test',
  controllerType: 'grbl',
  os: 'Windows 11',
  report: sensitive,
});
const json = JSON.stringify(payload);

assert(payload.source === 'renderer', 'payload records crash source');
assert(payload.appVersion === '1.0.0-test', 'payload includes app version');
assert(payload.controllerType === 'grbl', 'payload includes controller type');
assert(payload.os === 'Windows 11', 'payload includes OS string');
assert(/\[REDACTED:PATH\]/.test(json), 'file paths are redacted');
assert(/\[REDACTED:EMAIL\]/.test(json), 'email addresses are redacted');
assert(/\[REDACTED:IP\]/.test(json), 'IP addresses are redacted');
assert(/\[REDACTED:LICENSE\]/.test(json), 'license-like tokens are redacted');
assert(/\[REDACTED:PROJECT_NAME\]/.test(json), 'project names are redacted');
assert(/\[REDACTED:BINARY:4b\]/.test(json), 'binary/image payloads are redacted');
assert(!/Alice|alice@example|192\.168\.0\.10|SecretCustomer|12345678/.test(json), 'raw sensitive values do not remain');

async function run(): Promise<void> {
  const disabledReporter = createCrashReporter({
    dsn: '',
    appVersion: '1.0.0-test',
    source: 'renderer',
    transport: async () => {
      throw new Error('transport should not run without DSN');
    },
  });
  const disabledResult = await disabledReporter.report(sensitive);
  assert(disabledResult.ok === false && disabledResult.reason === 'disabled', 'reporter is disabled without DSN');

  const sent: unknown[] = [];
  const enabledReporter = createCrashReporter({
    dsn: 'https://example.invalid/crash',
    appVersion: '1.0.0-test',
    source: 'renderer',
    controllerType: () => 'grbl',
    os: () => 'Windows 11',
    transport: async (event) => {
      sent.push(event);
    },
  });
  const enabledResult = await enabledReporter.report(sensitive);
  assert(enabledResult.ok === true, 'reporter sends when DSN is configured');
  assert(sent.length === 1, 'transport receives exactly one redacted event');
  assert(!JSON.stringify(sent[0]).includes('SecretCustomer'), 'transport receives redacted project data');

  assert(/import \{ AppErrorBoundary \}/.test(mainSrc), 'main imports AppErrorBoundary');
  assert(/installGlobalErrorHandlers/.test(mainSrc), 'main installs global error handlers');
  assert(/createCrashReporter/.test(mainSrc), 'main creates crash reporter');
  assert(/VITE_LASERFORGE_CRASH_DSN/.test(mainSrc), 'main reads crash DSN from Vite environment');
  assert(/React\.createElement\(AppErrorBoundary/.test(mainSrc), 'App is wrapped by AppErrorBoundary');
  assert(/onCrash: crashReporter\.report/.test(mainSrc), 'error boundary reports crashes');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run();
