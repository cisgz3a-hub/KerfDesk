/**
 * T3-44: pin the multi-domain JobProgress shape and its conversion
 * helpers from the GRBL-shaped legacy `JobProgress`.
 *
 * Run: npx tsx tests/progress-model-multi-domain.test.ts
 */

import type { GrblLineStreamProgress } from '../src/controllers/ControllerInterface';
import {
  hasCountProgress,
  hasGrblHealth,
  isActivePhase,
  isTerminalPhase,
  makeDeviceReportedProgress,
  makeUploadProgress,
  toMultiDomainGrblProgress,
  type JobPhase,
  type MultiDomainJobProgress,
  type ProgressUnit,
} from '../src/controllers/JobProgressMultiDomain';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T3-44 multi-domain progress model ===\n');

const sampleGrblProgress: GrblLineStreamProgress = {
  percentComplete: 25,
  elapsedMs: 12_500,
  linesSent: 250,
  linesAcknowledged: 240,
  totalLines: 1000,
  bufferFill: 96,
  healthStatus: 'healthy',
  ackRateHz: 18.4,
  expectedAckRateHz: 20,
};

void (async () => {
  // 1. GRBL line-stream progress maps losslessly to multi-domain shape.
  {
    const md = toMultiDomainGrblProgress(sampleGrblProgress);

    assert(md.phase === 'streaming', 'GRBL: default phase is streaming');
    assert(md.percentComplete === 25, 'GRBL: percentComplete preserved');
    assert(md.elapsedMs === 12_500, 'GRBL: elapsedMs preserved');
    assert(md.unit === 'line', 'GRBL: unit is line');
    assert(md.sent === 250, 'GRBL: sent maps from linesSent');
    assert(md.acknowledged === 240, 'GRBL: acknowledged maps from linesAcknowledged');
    assert(md.total === 1000, 'GRBL: total maps from totalLines');
    assert(md.grblHealth !== undefined, 'GRBL: grblHealth populated');
    assert(md.grblHealth?.bufferFill === 96, 'GRBL: grblHealth.bufferFill preserved');
    assert(md.grblHealth?.healthStatus === 'healthy', 'GRBL: grblHealth.healthStatus preserved');
    assert(md.grblHealth?.ackRateHz === 18.4, 'GRBL: grblHealth.ackRateHz preserved');
    assert(md.grblHealth?.expectedAckRateHz === 20, 'GRBL: grblHealth.expectedAckRateHz preserved');
  }

  // 2. Phase override is respected.
  {
    const preparing = toMultiDomainGrblProgress(sampleGrblProgress, 'preparing');
    assert(preparing.phase === 'preparing', 'GRBL: explicit phase preparing respected');

    const complete = toMultiDomainGrblProgress(sampleGrblProgress, 'complete');
    assert(complete.phase === 'complete', 'GRBL: explicit phase complete respected');

    const paused = toMultiDomainGrblProgress(sampleGrblProgress, 'paused');
    assert(paused.phase === 'paused', 'GRBL: explicit phase paused respected');
  }

  // 3. Upload-phase byte progress.
  {
    const upload = makeUploadProgress({
      bytesSent: 250_000,
      totalBytes: 1_000_000,
      elapsedMs: 4_200,
    });

    assert(upload.phase === 'uploading', 'Upload: phase is uploading');
    assert(upload.unit === 'byte', 'Upload: unit is byte');
    assert(upload.sent === 250_000, 'Upload: sent preserved');
    assert(upload.total === 1_000_000, 'Upload: total preserved');
    assert(upload.percentComplete === 25, 'Upload: percentComplete computed (25%)');
    assert(upload.elapsedMs === 4_200, 'Upload: elapsedMs preserved');
    assert(upload.grblHealth === undefined, 'Upload: no grblHealth (byte controller)');
    assert(upload.acknowledged === undefined, 'Upload: no acknowledged (byte transport has no ack model here)');
  }

  // 4. Upload edge cases — clamping and zero-total guard.
  {
    const overSent = makeUploadProgress({ bytesSent: 1_500, totalBytes: 1_000, elapsedMs: 500 });
    assert(overSent.sent === 1_000, 'Upload: bytesSent > total clamps to total');
    assert(overSent.percentComplete === 100, 'Upload: clamped sent yields 100%');

    const negativeSent = makeUploadProgress({ bytesSent: -10, totalBytes: 1_000, elapsedMs: 0 });
    assert(negativeSent.sent === 0, 'Upload: negative bytesSent clamps to 0');
    assert(negativeSent.percentComplete === 0, 'Upload: zero sent yields 0%');

    const zeroTotal = makeUploadProgress({ bytesSent: 0, totalBytes: 0, elapsedMs: 0 });
    assert(zeroTotal.percentComplete === 0, 'Upload: zero total returns 0% (no NaN)');
    assert(zeroTotal.total === 0, 'Upload: zero total preserved');
  }

  // 5. Device-reported progress (Ruida-shape).
  {
    const dev = makeDeviceReportedProgress({
      percentComplete: 67,
      elapsedMs: 60_000,
    });

    assert(dev.phase === 'running', 'Device-reported: default phase running');
    assert(dev.unit === 'device-reported', 'Device-reported: unit is device-reported');
    assert(dev.percentComplete === 67, 'Device-reported: percentComplete preserved');
    assert(dev.elapsedMs === 60_000, 'Device-reported: elapsedMs preserved');
    assert(dev.sent === undefined, 'Device-reported: no host-side sent');
    assert(dev.total === undefined, 'Device-reported: no host-side total');
    assert(dev.grblHealth === undefined, 'Device-reported: no grblHealth');
  }

  // 6. Device-reported clamping.
  {
    const high = makeDeviceReportedProgress({ percentComplete: 150, elapsedMs: 0 });
    assert(high.percentComplete === 100, 'Device-reported: percentComplete > 100 clamps to 100');

    const low = makeDeviceReportedProgress({ percentComplete: -5, elapsedMs: 0 });
    assert(low.percentComplete === 0, 'Device-reported: negative percentComplete clamps to 0');

    const paused = makeDeviceReportedProgress({ percentComplete: 50, elapsedMs: 0, phase: 'paused' });
    assert(paused.phase === 'paused', 'Device-reported: explicit paused phase respected');

    const aborted = makeDeviceReportedProgress({ percentComplete: 50, elapsedMs: 0, phase: 'aborted' });
    assert(aborted.phase === 'aborted', 'Device-reported: explicit aborted phase respected');
  }

  // 7. Type-narrowing guards.
  {
    const grbl = toMultiDomainGrblProgress(sampleGrblProgress);
    const upload = makeUploadProgress({ bytesSent: 500, totalBytes: 1_000, elapsedMs: 100 });
    const dev = makeDeviceReportedProgress({ percentComplete: 30, elapsedMs: 0 });

    assert(hasGrblHealth(grbl), 'Guard: hasGrblHealth true for GRBL progress');
    assert(!hasGrblHealth(upload), 'Guard: hasGrblHealth false for upload progress');
    assert(!hasGrblHealth(dev), 'Guard: hasGrblHealth false for device-reported progress');

    assert(hasCountProgress(grbl), 'Guard: hasCountProgress true for line counts');
    assert(hasCountProgress(upload), 'Guard: hasCountProgress true for byte counts');
    assert(!hasCountProgress(dev), 'Guard: hasCountProgress false for device-reported progress');

    // Narrowed type usage compiles and runs.
    if (hasCountProgress(grbl)) {
      assert(grbl.sent + grbl.total >= 1000, 'Guard: hasCountProgress narrows sent/total to number');
    }
    if (hasGrblHealth(grbl)) {
      assert(grbl.grblHealth.bufferFill === 96, 'Guard: hasGrblHealth narrows grblHealth to defined');
    }
  }

  // 8. Phase classification helpers.
  {
    const activePhases: JobPhase[] = ['streaming', 'running', 'uploading'];
    for (const p of activePhases) {
      assert(isActivePhase(p), `isActivePhase(${p}) is true`);
      assert(!isTerminalPhase(p), `isTerminalPhase(${p}) is false`);
    }

    const inactivePhases: JobPhase[] = ['preparing', 'paused'];
    for (const p of inactivePhases) {
      assert(!isActivePhase(p), `isActivePhase(${p}) is false`);
      assert(!isTerminalPhase(p), `isTerminalPhase(${p}) is false`);
    }

    const terminalPhases: JobPhase[] = ['complete', 'aborted'];
    for (const p of terminalPhases) {
      assert(!isActivePhase(p), `isActivePhase(${p}) is false`);
      assert(isTerminalPhase(p), `isTerminalPhase(${p}) is true`);
    }
  }

  // 9. The exhaustive ProgressUnit union covers the four documented units.
  {
    const allUnits: ProgressUnit[] = ['line', 'byte', 'percent', 'device-reported'];
    assert(allUnits.length === 4, 'ProgressUnit union has four documented unit values');
  }

  // 10. Additive guarantee: a freshly constructed multi-domain record
  //     can be passed where the legacy emitter contract expects only
  //     `phase`, `percentComplete`, `elapsedMs` — proving the always-
  //     present fields are typed as such (not optional). This is a
  //     compile-time + runtime contract.
  {
    function readMandatory(p: MultiDomainJobProgress): { phase: JobPhase; percent: number; ms: number } {
      return { phase: p.phase, percent: p.percentComplete, ms: p.elapsedMs };
    }

    const grbl = toMultiDomainGrblProgress(sampleGrblProgress);
    const r = readMandatory(grbl);
    assert(r.phase === 'streaming', 'Mandatory fields: phase always readable');
    assert(typeof r.percent === 'number', 'Mandatory fields: percentComplete always readable');
    assert(typeof r.ms === 'number', 'Mandatory fields: elapsedMs always readable');
  }

  // 11. Source pin: the new module does not reach into emission paths
  //     yet — it must remain pure type plumbing in this slice so the
  //     existing `JobProgress` consumers (GrblController emission,
  //     MachineService relay, ConnectionPanel render) keep working
  //     unchanged. A regression that introduces emission migration in
  //     this module would break the additive-only guarantee documented
  //     in the file header.
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const moduleSrc = fs.readFileSync(
      path.resolve(here, '../src/controllers/JobProgressMultiDomain.ts'),
      'utf-8',
    );

    assert(
      !/from\s+['"].*GrblController['"]/.test(moduleSrc),
      'Source: JobProgressMultiDomain does not import from GrblController (additive-only)',
    );
    assert(
      !/from\s+['"].*MachineService['"]/.test(moduleSrc),
      'Source: JobProgressMultiDomain does not import from MachineService (additive-only)',
    );
    assert(
      /T3-44/.test(moduleSrc),
      'Source: T3-44 ticket marker present in module',
    );
    assert(
      /import\s+type\s+\{\s*GrblLineStreamProgress\s*\}/.test(moduleSrc),
      'Source: only type-imports the legacy progress shape (no runtime dependency)',
    );
  }

  console.log(`\nT3-44 multi-domain progress: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
