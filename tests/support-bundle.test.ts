/**
 * T2-108: support bundle exporter (Phase 1 — assembly logic). Pre-
 * T2-108 there was no way to export a diagnostic package for support
 * — the workflow degraded to "screenshots + ask questions". Audit 5C
 * Critical 1 + Required Priority 2.
 *
 * Run: npx tsx tests/support-bundle.test.ts
 */
import {
  buildSupportBundle,
  defaultBundleInclusions,
  findLicenseKeyLeaks,
  type SupportBundleInputs,
} from '../src/diagnostics/SupportBundle';
import { buildRxEntry, buildTxEntry } from '../src/app/StructuredRxTxEntry';
import { emptyCorrelationIds, generateCorrelationId, resetCorrelationIdCounters } from '../src/diagnostics/CorrelationIds';

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

console.log('\n=== T2-108 Support bundle (Phase 1) ===\n');

function makeBaseInputs(): SupportBundleInputs {
  resetCorrelationIdCounters();
  return {
    appInfo: { version: '1.0.0', buildChannel: 'stable', electron: '31.0.0' },
    systemInfo: { platform: 'win32', arch: 'x64', locale: 'en-US' },
    correlationIds: emptyCorrelationIds(),
  };
}

void (async () => {

// 1. Default bundle: always-on files present
{
  const bundle = buildSupportBundle({
    inputs: makeBaseInputs(),
    bundleId: generateCorrelationId('bundle'),
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  for (const f of ['manifest.json', 'app-info.json', 'system-info.json', 'correlation-ids.json']) {
    assert(bundle.files[f] !== undefined, `'${f}' present in default bundle`);
  }
}

// 2. Manifest schema + bundleId + generatedAt + version
{
  const id = generateCorrelationId('bundle');
  const bundle = buildSupportBundle({
    inputs: makeBaseInputs(),
    bundleId: id,
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  assert(bundle.manifest.schemaVersion === 1, 'manifest.schemaVersion=1');
  assert(bundle.manifest.bundleId === id, 'manifest.bundleId set');
  assert(bundle.manifest.generatedAt === '2026-05-05T00:00:00.000Z',
    'manifest.generatedAt set');
  assert(bundle.manifest.appVersion === '1.0.0',
    'manifest.appVersion mirrors appInfo.version');
}

// 3. defaultBundleInclusions: opt-in fields are off
{
  const i = defaultBundleInclusions();
  assert(i.gcode === false && i.projectFile === false && i.images === false,
    'opt-in inclusions default to false');
  assert(i.jobLogs && i.errors && i.crashes
      && i.machineProfile && i.storage && i.correlation,
    'always-on inclusions default to true');
}

// 4. License key in input → ALWAYS redacted (defence-in-depth contract)
{
  const inputs = makeBaseInputs();
  inputs.errors = [
    {
      message: 'License A1B2C3D4-E5F6-7890-ABCD-1234567890EF was rejected',
      stack: 'Error: License A1B2C3D4-E5F6-7890-ABCD-1234567890EF\n  at validate',
    },
  ];
  const bundle = buildSupportBundle({
    inputs,
    bundleId: 'bundle_test',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  const leaks = findLicenseKeyLeaks(bundle);
  assert(leaks.length === 0,
    `0 files leak a license key (got ${leaks.length}: ${leaks.join(', ')})`);
  // Sanity: the redacted placeholder DID make it in
  const errorsContent = bundle.files['recent-errors.json'];
  assert(errorsContent.includes('[REDACTED:LICENSE]'),
    `error file contains the redaction placeholder`);
}

// 5. License key in app-info / system-info also redacted
{
  const inputs = makeBaseInputs();
  inputs.appInfo = {
    ...inputs.appInfo,
    // a fictitious leaked license inside app-info JSON
    electron: 'A1B2C3D4-E5F6-7890-ABCD-1234567890EF',
  };
  const bundle = buildSupportBundle({
    inputs,
    bundleId: 'bundle_test',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  assert(findLicenseKeyLeaks(bundle).length === 0,
    `app-info license key redacted`);
}

// 6. Project name redacted by default
{
  const inputs = makeBaseInputs();
  inputs.machineProfile = { name: 'My Top-Secret Customer Project Profile' };
  const bundle = buildSupportBundle({
    inputs,
    bundleId: 'bundle_test',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  const profile = bundle.files['machine-profile-snapshot.json'];
  assert(!profile.includes('Top-Secret'),
    `default redaction strips project name (got: '${profile}')`);
  assert(profile.includes('[REDACTED:PROJECT_NAME]'),
    `placeholder substituted`);
}

// 7. Job logs capped at MAX_JOB_LOGS (20)
{
  const inputs = makeBaseInputs();
  inputs.jobLogs = Array.from({ length: 50 }, (_, i) => ({ id: `job-${i}` }));
  const bundle = buildSupportBundle({
    inputs,
    bundleId: 'bundle_test',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  const logs = JSON.parse(bundle.files['recent-job-logs.json']);
  assert(logs.length === 20,
    `cap at 20 (got ${logs.length})`);
  // The LAST 20 should be retained (most recent)
  assert(logs[0].id === 'job-30',
    `last 20: starts at job-30 (got ${logs[0].id})`);
  assert(logs[19].id === 'job-49',
    `last 20: ends at job-49 (got ${logs[19].id})`);
}

// 8. Opt-in gcode: NOT included by default; included when opted in
{
  const inputs = makeBaseInputs();
  inputs.gcodeByJobId = { 'job-1': 'G0 X10 Y10\nG1 X100 F1000' };

  const off = buildSupportBundle({
    inputs,
    bundleId: 'b1',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  assert(off.files['gcode-job-1.txt'] === undefined,
    `gcode NOT included by default`);

  const on = buildSupportBundle({
    inputs,
    inclusions: { gcode: true },
    bundleId: 'b2',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  assert(on.files['gcode-job-1.txt'] !== undefined,
    `gcode included when opted in`);
  assert(on.files['gcode-job-1.txt'].includes('G0 X10 Y10'),
    `gcode content preserved`);
}

// 9. Opt-in gcode with license-key in comment: license still redacted
{
  const inputs = makeBaseInputs();
  inputs.gcodeByJobId = {
    'job-1': 'G0 X10 ; license A1B2C3D4-E5F6-7890-ABCD-1234567890EF\nG1 X100',
  };
  const bundle = buildSupportBundle({
    inputs,
    inclusions: { gcode: true },
    bundleId: 'b3',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  assert(findLicenseKeyLeaks(bundle).length === 0,
    `license key in gcode comment still redacted`);
  assert(bundle.files['gcode-job-1.txt'].includes('G0 X10'),
    `non-license g-code preserved`);
}

// 10. Opt-in projectFile: included when opted in; uses projectId as filename
{
  const inputs = makeBaseInputs();
  inputs.correlationIds = {
    ...inputs.correlationIds,
    projectId: 'project_abc',
  };
  inputs.projectFileJson = { name: 'My Project', objects: [] };
  const bundle = buildSupportBundle({
    inputs,
    inclusions: { projectFile: true },
    bundleId: 'b4',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  assert(bundle.files['project-project_abc.lf'] !== undefined,
    `project file uses projectId in name`);
  // When opted in, project names are NOT redacted (user is sharing the file)
  assert(bundle.files['project-project_abc.lf'].includes('My Project'),
    `opted-in project preserves name (got: '${bundle.files['project-project_abc.lf']}')`);
}

// 11. Opt-in images: summary includes IDs + sizes
{
  const inputs = makeBaseInputs();
  inputs.images = [
    { id: 'img-1', dataUri: 'data:image/png;base64,xxxxxxxxxx' },
    { id: 'img-2', dataUri: 'data:image/png;base64,yyyy' },
  ];
  const bundle = buildSupportBundle({
    inputs,
    inclusions: { images: true },
    bundleId: 'b5',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  assert(bundle.files['images-summary.json'] !== undefined,
    `images-summary.json present`);
  const summary = JSON.parse(bundle.files['images-summary.json']);
  assert(summary.length === 2 && summary[0].id === 'img-1',
    `summary lists both images`);
  assert(typeof summary[0].bytes === 'number' && summary[0].bytes > 0,
    `each entry has byte count`);
}

// 12. Always-on inclusions cannot be disabled to leak less than the schema
//     promises — they default to true and the user override flow surfaces
//     them through manifest.inclusions for support visibility
{
  const inputs = makeBaseInputs();
  inputs.crashes = [{ message: 'TypeError: foo' }];
  const bundle = buildSupportBundle({
    inputs,
    inclusions: { crashes: false },
    bundleId: 'b6',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  // Caller can disable crashes in inclusions; it's reflected in manifest
  assert(bundle.manifest.inclusions.crashes === false,
    `manifest reflects user choice`);
  assert(bundle.files['recent-crashes.json'] === undefined,
    `crashes file omitted when disabled`);
}

// 13. Manifest reflects redaction options
{
  const inputs = makeBaseInputs();
  const bundle = buildSupportBundle({
    inputs,
    bundleId: 'b7',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  // Default: redactProjectNames = true (we override the default-default)
  assert(bundle.manifest.redaction.redactProjectNames === true,
    `manifest.redaction.redactProjectNames=true by bundle default`);
  assert(bundle.manifest.redaction.redactLicenseKeys === true,
    `manifest.redaction.redactLicenseKeys=true (always)`);
}

// 14. Empty inputs → minimal bundle (no crash on missing fields)
{
  const bundle = buildSupportBundle({
    inputs: makeBaseInputs(),
    bundleId: 'b8',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  assert(bundle.files['recent-job-logs.json'] === undefined,
    `no jobLogs input → no recent-job-logs.json`);
  assert(bundle.files['recent-errors.json'] === undefined,
    `no errors input → no recent-errors.json`);
  // Always-present files are still there
  assert(bundle.files['manifest.json'] !== undefined, `manifest still emitted`);
}

// 15. correlation-ids.json includes all 7 fields
{
  const inputs = makeBaseInputs();
  inputs.correlationIds = {
    sessionId: 'session_x',
    projectId: 'project_y',
    compileId: 'compile_z',
    preflightId: 'preflight_a',
    frameId: 'frame_b',
    jobId: 'job_c',
    supportBundleId: 'bundle_d',
  };
  const bundle = buildSupportBundle({
    inputs,
    bundleId: 'b9',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  const ids = JSON.parse(bundle.files['correlation-ids.json']);
  for (const k of ['sessionId', 'projectId', 'compileId', 'preflightId', 'frameId', 'jobId', 'supportBundleId']) {
    assert(ids[k] !== undefined && ids[k] !== null,
      `correlation-ids.${k} present`);
  }
}

// 16. Controller evidence: structured transcript, safety ledger,
//     compile/preflight metadata, and opt-in emitted G-code survive
//     into the support bundle.
{
  const inputs = makeBaseInputs();
  inputs.correlationIds = {
    ...inputs.correlationIds,
    jobId: 'job-diagnostics',
    compileId: 'compile-diagnostics',
    preflightId: 'preflight-diagnostics',
  };
  inputs.jobLogs = [
    {
      id: 'job-diagnostics',
      entries: [
        buildTxEntry({
          timestamp: 100,
          raw: 'M4 S0',
          source: 'job',
          bufferStateAfter: { freeChars: 124, queueDepth: 1 },
        }),
        buildRxEntry({
          timestamp: 125,
          raw: 'ok',
          responseTo: 0,
          controllerLineNumber: 42,
          bufferStateAfter: { freeChars: 127, queueDepth: 0 },
        }),
      ],
    },
  ];
  inputs.machineEventLedger = {
    schemaVersion: 1,
    capturedAt: 150,
    entries: [
      { kind: 'safety-off', t: 145, stage: 'm5', message: 'post-fault safety off' },
    ],
  };
  inputs.compileMetadata = [
    {
      compileId: 'compile-diagnostics',
      outputUsesM4: true,
      gcodeSpoolLineCount: 1024,
    },
  ];
  inputs.preflightReports = [
    {
      id: 'preflight-diagnostics',
      issues: [
        {
          code: 'MACHINE_LASER_MODE_UNKNOWN',
          severity: 'error',
        },
      ],
    },
  ];
  inputs.gcodeByJobId = {
    'job-diagnostics': 'M4 S0\nG1 X1 S100\nM5',
  };

  const defaultBundle = buildSupportBundle({
    inputs,
    bundleId: 'b10',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  const logs = JSON.parse(defaultBundle.files['recent-job-logs.json']);
  assert(logs[0].entries[0].raw === 'M4 S0',
    'support bundle preserves structured TX raw command');
  assert(logs[0].entries[0].classification.commandType === 'mcode',
    'support bundle preserves TX command classification');
  assert(logs[0].entries[1].classification.controllerLineNumber === 42,
    'support bundle preserves RX controller line number');
  assert(logs[0].entries[1].classification.bufferStateAfter.freeChars === 127,
    'support bundle preserves RX buffer-state evidence');

  const ledger = JSON.parse(defaultBundle.files['machine-event-ledger.json']);
  assert(ledger.entries[0].kind === 'safety-off',
    'support bundle includes safety-off machine event evidence');
  assert(ledger.entries[0].stage === 'm5',
    'support bundle includes safety-off stage evidence');

  const compile = JSON.parse(defaultBundle.files['compile-metadata.json']);
  assert(compile[0].outputUsesM4 === true,
    'support bundle includes M4 output metadata');
  assert(compile[0].gcodeSpoolLineCount === 1024,
    'support bundle includes spool-size metadata');

  const preflight = JSON.parse(defaultBundle.files['preflight-reports.json']);
  assert(preflight[0].issues[0].code === 'MACHINE_LASER_MODE_UNKNOWN',
    'support bundle includes preflight safety issue evidence');
  assert(defaultBundle.files['gcode-job-diagnostics.txt'] === undefined,
    'emitted G-code stays opt-in even when transcript evidence is included');

  const optedInBundle = buildSupportBundle({
    inputs,
    inclusions: { gcode: true },
    bundleId: 'b11',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  assert(optedInBundle.files['gcode-job-diagnostics.txt'].includes('M4 S0'),
    'opt-in support bundle includes emitted G-code for replay');
}

// 17. Controller identifiers and secrets are redacted from support evidence.
{
  const inputs = makeBaseInputs();
  inputs.systemInfo = {
    platform: 'win32',
    arch: 'x64',
    locale: 'en-US',
  };
  const systemInfoWithPrivateFields = inputs.systemInfo as typeof inputs.systemInfo & Record<string, unknown>;
  systemInfoWithPrivateFields.userDataPath = 'C:\\Users\\Alice\\AppData\\Roaming\\LaserForge';
  systemInfoWithPrivateFields.operatorEmail = 'alice@example.com';
  inputs.machineProfile = {
    name: 'Customer Falcon',
    serialNumber: 'LF-FALCON-123456',
    macAddress: 'AA:BB:CC:DD:EE:FF',
    lanTarget: '192.168.1.42',
  };
  inputs.jobLogs = [
    {
      id: 'job-secret',
      entries: [
        buildTxEntry({
          timestamp: 100,
          raw: 'G1 X1 ; Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
          source: 'job',
        }),
      ],
    },
  ];
  inputs.storage = {
    apiKey: 'sk_live_1234567890abcdef1234567890abcdef',
    privateKey: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key-material\n-----END PRIVATE KEY-----',
  };
  inputs.gcodeByJobId = {
    'job-secret': [
      'G1 X100.0 Y50.0 F3000 ; token=sk_live_1234567890abcdef1234567890abcdef',
      'M4 S200 ; mac AA:BB:CC:DD:EE:FF serial LF-FALCON-123456',
    ].join('\n'),
  };

  const bundle = buildSupportBundle({
    inputs,
    inclusions: { gcode: true },
    bundleId: 'b12',
    generatedAt: '2026-05-05T00:00:00.000Z',
  });
  const allFiles = JSON.stringify(bundle.files);
  for (const raw of [
    'Alice',
    'alice@example.com',
    '192.168.1.42',
    'AA:BB:CC:DD:EE:FF',
    'LF-FALCON-123456',
    'abcdefghijklmnopqrstuvwxyz123456',
    'sk_live_',
    'not-a-real-key-material',
  ]) {
    assert(!allFiles.includes(raw), `support bundle redacts raw sensitive value '${raw}'`);
  }
  for (const placeholder of [
    '[REDACTED:PATH]', '[REDACTED:EMAIL]', '[REDACTED:IP]', '[REDACTED:MAC]',
    '[REDACTED:SERIAL]', '[REDACTED:TOKEN]', '[REDACTED:PRIVATE_KEY]',
  ]) {
    assert(allFiles.includes(placeholder), `support bundle contains ${placeholder}`);
  }
  assert(bundle.files['gcode-job-secret.txt'].includes('G1 X100.0 Y50.0 F3000'),
    'opted-in diagnostic G-code keeps motion commands after secret redaction');
  assert(bundle.files['gcode-job-secret.txt'].includes('M4 S200'),
    'opted-in diagnostic G-code keeps laser modal commands after secret redaction');
}

// 18. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/diagnostics/SupportBundle.ts'), 'utf-8');
  assert(/T2-108/.test(src), 'T2-108 marker in SupportBundle.ts');
  for (const id of [
    'SupportBundleManifest', 'SupportBundleInclusions', 'SupportBundleInputs',
    'SupportBundle', 'buildSupportBundle', 'defaultBundleInclusions',
    'findLicenseKeyLeaks',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  assert(/T2-115/.test(src), 'cites T2-115 redaction integration');
  assert(/T2-117/.test(src) || /CorrelationIds/.test(src),
    'integrates T2-117 correlation IDs');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
