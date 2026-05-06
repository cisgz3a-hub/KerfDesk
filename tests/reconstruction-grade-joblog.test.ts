/**
 * T2-109: reconstruction-grade JobLog. Pre-T2-109 JobLog stored ~17
 * fields — missing app/system context, profile + $$ snapshot, full
 * fingerprint, frame state, preflight, gcode excerpt. Audit 5C
 * Critical 3 + Required Priority 3.
 *
 * Run: npx tsx tests/reconstruction-grade-joblog.test.ts
 */
import {
  buildJobLogReconstruction,
  buildGcodeExcerpt,
  hashGcodeText,
  findMissingReconstructionFields,
  type AppContext,
  type MachineContext,
  type PreflightContext,
} from '../src/core/job/ReconstructionGradeJobLog';
import { emptyCorrelationIds } from '../src/diagnostics/CorrelationIds';
import type { JobFingerprint } from '../src/core/job/JobFingerprint';
import type { FrameState } from '../src/app/FrameState';
import type { DeviceProfile } from '../src/core/devices/DeviceProfile';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-109 ReconstructionGradeJobLog ===\n');

const fingerprint: JobFingerprint = {
  sceneHash: 'abc',
  profileHash: 'def',
  materialHash: 'ghi',
  startMode: 'absolute',
  savedOriginHash: 'none',
  machineCapabilitiesHash: 'jkl',
  compileOptionsHash: 'mno',
};

const frameValid: FrameState = {
  status: 'valid',
  fingerprint: 'fp-1',
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
  mode: 'safe',
  completedAt: 1000,
};

const appCtx: AppContext = {
  version: '1.0.0',
  buildChannel: 'stable',
  platform: 'win32',
  electronVersion: '31.0.0',
};

const machineCtx: MachineContext = {
  controllerType: 'grbl',
  connectionType: 'web-serial',
  profileId: 'prof-1',
  profileSnapshot: { id: 'prof-1', name: 'Falcon A1 Pro' } as DeviceProfile,
};

const preflightCtx: PreflightContext = {
  blockers: [],
  warnings: [{ kind: 'low-power', severity: 'warning', message: 'Power < 30%' }],
  userConfirmedWarnings: true,
  readinessScore: 95,
};

void (async () => {

// 1. hashGcodeText: stable + 8-char hex
{
  const a = hashGcodeText('G0 X0\nG1 X10');
  const b = hashGcodeText('G0 X0\nG1 X10');
  assert(a === b, `same input → same hash`);
  assert(/^[0-9a-f]{8}$/.test(a), `8-char hex (got '${a}')`);
}

// 2. hashGcodeText: different input → different hash
{
  assert(hashGcodeText('G0 X0') !== hashGcodeText('G0 X1'),
    `different inputs → different hashes`);
}

// 3. buildGcodeExcerpt: short file (< 100 lines) overlap dedupe
{
  const text = Array.from({ length: 30 }, (_, i) => `G0 X${i}`).join('\n');
  const e = buildGcodeExcerpt(text);
  assert(e.first50.length === 30, `first50 has all 30 lines (got ${e.first50.length})`);
  assert(e.last50.length === 0,
    `lines.length 30 < 50: last50 starts at line 30 (no overlap; got ${e.last50.length})`);
  assert(e.hash === hashGcodeText(text), `hash matches`);
}

// 4. buildGcodeExcerpt: long file
{
  const text = Array.from({ length: 1000 }, (_, i) => `G0 X${i}`).join('\n');
  const e = buildGcodeExcerpt(text);
  assert(e.first50.length === 50, `first50 has 50 lines`);
  assert(e.last50.length === 50, `last50 has 50 lines`);
  assert(e.first50[0] === 'G0 X0', `first50[0] is line 0`);
  assert(e.last50[49] === 'G0 X999', `last50[49] is line 999`);
}

// 5. buildJobLogReconstruction: assembles full structure
{
  const correlationIds = emptyCorrelationIds();
  const r = buildJobLogReconstruction({
    app: appCtx,
    machine: machineCtx,
    job: {
      ticketId: 'tkt-1',
      fingerprint,
      gcodeLineCount: 1000,
      outputBounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      startMode: 'absolute',
      savedOrigin: null,
      frameState: frameValid,
    },
    preflight: preflightCtx,
    correlationIds,
  });
  assert(r.app.version === '1.0.0', `app.version`);
  assert(r.machine.profileId === 'prof-1', `machine.profileId`);
  assert(r.job.ticketId === 'tkt-1', `job.ticketId`);
  assert(r.preflight.warnings.length === 1, `preflight warnings carried`);
  assert(r.correlationIds.sessionId === correlationIds.sessionId,
    `correlationIds.sessionId`);
}

// 6. buildJobLogReconstruction: gcodeText auto-builds excerpt
{
  const text = 'G0 X0\nG1 X10\nM5\nM2';
  const r = buildJobLogReconstruction({
    app: appCtx, machine: machineCtx,
    job: {
      ticketId: 't', fingerprint, gcodeLineCount: 4,
      outputBounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
      startMode: 'absolute', savedOrigin: null, frameState: frameValid,
    },
    preflight: preflightCtx,
    correlationIds: emptyCorrelationIds(),
    gcodeText: text,
  });
  assert(r.job.gcodeExcerpt != null, `gcodeExcerpt built`);
  assert(r.job.gcodeExcerpt?.hash === hashGcodeText(text), `excerpt.hash matches`);
  assert(r.job.gcodeExcerpt?.first50.length === 4, `first50 has all 4 lines`);
}

// 7. buildJobLogReconstruction: no gcodeText → no excerpt
{
  const r = buildJobLogReconstruction({
    app: appCtx, machine: machineCtx,
    job: {
      ticketId: 't', fingerprint, gcodeLineCount: 0,
      outputBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      startMode: 'absolute', savedOrigin: null, frameState: frameValid,
    },
    preflight: preflightCtx,
    correlationIds: emptyCorrelationIds(),
  });
  assert(r.job.gcodeExcerpt === undefined, `no gcodeText → undefined excerpt`);
}

// 8. findMissingReconstructionFields: clean → empty
{
  const r = buildJobLogReconstruction({
    app: appCtx, machine: machineCtx,
    job: {
      ticketId: 't', fingerprint, gcodeLineCount: 0,
      outputBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      startMode: 'absolute', savedOrigin: null, frameState: frameValid,
    },
    preflight: preflightCtx,
    correlationIds: emptyCorrelationIds(),
  });
  assert(findMissingReconstructionFields(r).length === 0,
    `clean reconstruction: 0 missing`);
}

// 9. findMissingReconstructionFields: lists missing critical fields
{
  const r = buildJobLogReconstruction({
    app: { ...appCtx, version: '' },
    machine: { ...machineCtx, profileId: '' },
    job: {
      ticketId: '', fingerprint, gcodeLineCount: 0,
      outputBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      startMode: 'absolute', savedOrigin: null, frameState: frameValid,
    },
    preflight: preflightCtx,
    correlationIds: { ...emptyCorrelationIds(), sessionId: '' },
  });
  const missing = findMissingReconstructionFields(r);
  assert(missing.includes('app.version'), `lists app.version`);
  assert(missing.includes('machine.profileId'), `lists machine.profileId`);
  assert(missing.includes('job.ticketId'), `lists job.ticketId`);
  assert(missing.includes('correlationIds.sessionId'), `lists correlationIds.sessionId`);
}

// 10. fingerprint preserved verbatim (not hashed/transformed)
{
  const r = buildJobLogReconstruction({
    app: appCtx, machine: machineCtx,
    job: {
      ticketId: 't', fingerprint, gcodeLineCount: 0,
      outputBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      startMode: 'absolute', savedOrigin: null, frameState: frameValid,
    },
    preflight: preflightCtx,
    correlationIds: emptyCorrelationIds(),
  });
  assert(r.job.fingerprint === fingerprint,
    `fingerprint embedded by reference`);
  assert(r.job.fingerprint.sceneHash === 'abc', `sceneHash carried`);
}

// 11. frameState preserved verbatim
{
  const r = buildJobLogReconstruction({
    app: appCtx, machine: machineCtx,
    job: {
      ticketId: 't', fingerprint, gcodeLineCount: 0,
      outputBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      startMode: 'absolute', savedOrigin: null, frameState: frameValid,
    },
    preflight: preflightCtx,
    correlationIds: emptyCorrelationIds(),
  });
  if (r.job.frameState.status === 'valid') {
    assert(r.job.frameState.fingerprint === 'fp-1',
      `frameState.fingerprint carried`);
  }
}

// 12. JSON-serialisable round-trip
{
  const r = buildJobLogReconstruction({
    app: appCtx, machine: machineCtx,
    job: {
      ticketId: 't', fingerprint, gcodeLineCount: 0,
      outputBounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      startMode: 'absolute', savedOrigin: null, frameState: frameValid,
    },
    preflight: preflightCtx,
    correlationIds: emptyCorrelationIds(),
    gcodeText: 'G0 X0\nM2',
  });
  const round = JSON.parse(JSON.stringify(r));
  assert(round.app.version === '1.0.0', `JSON round-trip preserves app.version`);
  assert(round.job.fingerprint.sceneHash === 'abc', `fingerprint round-trips`);
  assert(round.job.gcodeExcerpt.hash === hashGcodeText('G0 X0\nM2'),
    `excerpt hash round-trips`);
}

// 13. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/core/job/ReconstructionGradeJobLog.ts'), 'utf-8');
  assert(/T2-109/.test(src), 'T2-109 marker in ReconstructionGradeJobLog.ts');
  for (const id of [
    'AppContext', 'MachineContext', 'PreflightContext',
    'PreflightIssue', 'GcodeExcerpt', 'JobReconstructionContext',
    'JobLogReconstructionFields',
    'buildJobLogReconstruction', 'buildGcodeExcerpt', 'hashGcodeText',
    'findMissingReconstructionFields',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  // The deferred-followup signposts T2-71, T2-85, T2-86, T2-110, T2-117
  for (const ref of ['T2-71', 'T2-85', 'T2-86', 'T2-110', 'T2-117']) {
    assert(src.includes(ref), `cites ${ref}`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
