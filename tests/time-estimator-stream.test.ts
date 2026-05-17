/**
 * T3-15: job-time estimation should be able to consume a replayable
 * G-code spool without requiring the legacy full `gcodeText` string.
 *
 * Run: npx tsx tests/time-estimator-stream.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateJobTime, estimateJobTimeFromChunks } from '../src/core/output/TimeEstimator';
import type { GcodeChunk } from '../src/core/output/GcodeStreaming';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

async function* chunks(): AsyncGenerator<GcodeChunk, void, void> {
  yield {
    lines: ['G21', 'G90', 'G0 X10 Y0 F5000'],
    cumulativeLineCount: 3,
    isLast: false,
  };
  yield {
    lines: ['G1 X20 Y0 F1200', 'G1 X20 Y10', 'G0 X0 Y0'],
    cumulativeLineCount: 6,
    isLast: true,
  };
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

async function main(): Promise<void> {
  console.log('\n=== T3-15 streaming time estimator ===\n');
  const gcode = [
    'G21',
    'G90',
    'G0 X10 Y0 F5000',
    'G1 X20 Y0 F1200',
    'G1 X20 Y10',
    'G0 X0 Y0',
  ].join('\n');
  const materialized = estimateJobTime(gcode);
  const streamed = await estimateJobTimeFromChunks(chunks());

  assert(approxEqual(streamed.totalSeconds, materialized.totalSeconds), 'stream totalSeconds matches materialized estimator');
  assert(approxEqual(streamed.cutTime, materialized.cutTime), 'stream cutTime matches materialized estimator');
  assert(approxEqual(streamed.travelTime, materialized.travelTime), 'stream travelTime matches materialized estimator');
  assert(approxEqual(streamed.totalDistance, materialized.totalDistance), 'stream totalDistance matches materialized estimator');
  assert(approxEqual(streamed.cutDistance, materialized.cutDistance), 'stream cutDistance matches materialized estimator');
  assert(streamed.formatted === materialized.formatted, 'stream formatted estimate matches materialized estimator');

  const here = dirname(fileURLToPath(import.meta.url));
  const estimatorSrc = readFileSync(resolve(here, '../src/core/output/TimeEstimator.ts'), 'utf-8');
  const machineSrc = readFileSync(resolve(here, '../src/app/MachineService.ts'), 'utf-8');
  assert(/export async function estimateJobTimeFromChunks/.test(estimatorSrc), 'estimateJobTimeFromChunks is exported');
  assert(
    !/ticket\.gcodeSpool[\s\S]*estimateJobTimeFromChunks\(ticket\.gcodeSpool\.open\(\)\)/.test(machineSrc),
    'MachineService does not replay spooled jobs only to estimate time before controller handoff',
  );
  assert(
    /function spooledJobTimeEstimateFromPlan\(ticket: ValidatedJobTicket\)[\s\S]*ticket\.machineTransform\.plan\.stats\.estimatedTimeSeconds/.test(machineSrc),
    'MachineService uses compile-time plan stats for spooled job-time labels',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
