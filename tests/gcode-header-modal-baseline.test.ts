/**
 * T3-20: generated G-code reasserts GRBL modal safety defaults.
 * Run: npx tsx tests/gcode-header-modal-baseline.test.ts
 */

import { createEmptyJob } from '../src/core/job/Job';
import { getOutputStrategy } from '../src/core/output/Output';
import '../src/core/output/GrblStrategy';

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

function indexOfLine(lines: string[], token: string): number {
  return lines.findIndex(line => line.startsWith(token));
}

function assertHeaderOrder(label: string, header: string, distanceMode: 'G90' | 'G91'): void {
  const lines = header.split(/\r?\n/);
  const g21 = indexOfLine(lines, 'G21 ');
  const g17 = indexOfLine(lines, 'G17 ');
  const mode = indexOfLine(lines, `${distanceMode} `);
  const g94 = indexOfLine(lines, 'G94 ');
  const m5 = indexOfLine(lines, 'M5 ');

  assert(g21 >= 0, `${label}: includes G21 mm mode`);
  assert(g17 >= 0, `${label}: includes G17 XY plane`);
  assert(mode >= 0, `${label}: includes ${distanceMode} distance mode`);
  assert(g94 >= 0, `${label}: includes G94 feed-per-minute mode`);
  assert(m5 >= 0, `${label}: includes M5 laser-off guard`);
  assert(
    g21 < g17 && g17 < mode && mode < g94 && g94 < m5,
    `${label}: modal baseline order is G21 -> G17 -> ${distanceMode} -> G94 -> M5`,
  );
}

console.log('\n=== gcode-header-modal-baseline ===\n');

const strategy = getOutputStrategy('grbl');
assert(strategy != null, 'GRBL strategy registered');

if (strategy) {
  const job = createEmptyJob('modal-baseline', 't3-20');
  job.metadata.objectCount = 1;
  job.metadata.layerCount = 1;

  assertHeaderOrder('bed/saved-origin header', strategy.encodeHeader(job, {
    startMode: 'absolute',
    clock: () => '2026-05-09T00:00:00.000Z',
  }), 'G90');

  assertHeaderOrder('laser-head header', strategy.encodeHeader(job, {
    startMode: 'current',
    clock: () => '2026-05-09T00:00:00.000Z',
  }), 'G91');

  const templatedHeader = strategy.encodeHeader(job, {
    startMode: 'absolute',
    gcodeHeaderTemplate: '; user template body',
    clock: () => '2026-05-09T00:00:00.000Z',
  });
  const templateIndex = templatedHeader.split(/\r?\n/).findIndex(line => line === '; user template body');
  const g94Index = indexOfLine(templatedHeader.split(/\r?\n/), 'G94 ');
  assert(g94Index >= 0 && templateIndex > g94Index, 'user template cannot remove or precede G94 baseline');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
