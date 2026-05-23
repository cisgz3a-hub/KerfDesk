/**
 * T1-124: regression test for the pure GRBL status-report parser
 * extracted from `_handleStatusReport`. First slice of the audit's
 * Sprint 4 "extract pure parsers first" sequence.
 *
 * Pre-T1-124 the parsing logic was inline in a 130-line method that
 * mixed parsing with side effects (state mutation, pause/resume
 * bookkeeping, job-abort gates, safe-state-at-connect verdict). This
 * test pins:
 *   1. The pure parser correctly recognizes every status word the
 *      runtime statusMap accepted (idle, run, hold, hold:0/1, alarm,
 *      home, check, door, door:0/1/2/3) — including the T1-115 door
 *      variants.
 *   2. MPos / WPos / FS / F field extraction with the same numeric
 *      coercion semantics as the inline parser (Number('') || 0
 *      collapses to 0; Z defaults to 0 when only x,y).
 *   3. Unrecognized words return machineStatus=null but preserve the
 *      stateWord for diagnostics.
 *   4. Reports with no parts return the empty result without
 *      throwing.
 *   5. Source-pin: GrblController imports + calls parseGrblStatusReport
 *      from _handleStatusReport, and the inline statusMap is gone.
 *
 * Run: npx tsx tests/grbl-status-report-parser.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGrblStatusReport } from '../src/controllers/grbl/GrblStatusReportParser';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T1-124 GRBL status-report parser ===\n');

// -------- 1. canonical status words --------
{
  const cases: Array<[string, string]> = [
    ['<Idle|MPos:0,0,0|FS:0,0>', 'idle'],
    ['<Run|MPos:0,0,0|FS:1000,500>', 'run'],
    ['<Jog|MPos:0,0,0|FS:1000,0>', 'jog'],
    ['<Hold|MPos:0,0,0|FS:0,0>', 'hold'],
    ['<Hold:0|MPos:0,0,0|FS:0,0>', 'hold'],
    ['<Hold:1|MPos:0,0,0|FS:0,0>', 'hold'],
    ['<Alarm|MPos:0,0,0|FS:0,0>', 'alarm'],
    ['<Home|MPos:0,0,0|FS:0,0>', 'homing'],
    ['<Check|MPos:0,0,0|FS:0,0>', 'check'],
    ['<Door|MPos:0,0,0|FS:0,0>', 'door'],
    ['<Door:0|MPos:0,0,0|FS:0,0>', 'door'],
    ['<Door:1|MPos:0,0,0|FS:0,0>', 'door'],
    ['<Door:2|MPos:0,0,0|FS:0,0>', 'door'],
    ['<Door:3|MPos:0,0,0|FS:0,0>', 'door'],
  ];
  for (const [raw, expected] of cases) {
    const r = parseGrblStatusReport(raw);
    assert(r.machineStatus === expected,
      `${raw} → machineStatus '${expected}' (got '${r.machineStatus}')`);
  }
}

// -------- 2. unrecognized status word: stateWord preserved, status null --------
{
  const r = parseGrblStatusReport('<Sleep|MPos:0,0,0|FS:0,0>');
  assert(r.stateWord === 'sleep',
    `unrecognized 'sleep' preserves stateWord (got '${r.stateWord}')`);
  assert(r.machineStatus === null,
    `unrecognized 'sleep' returns machineStatus=null`);
}

// -------- 3. MPos / WPos extraction --------
{
  const r = parseGrblStatusReport('<Idle|MPos:1.5,2.5,3.5|WPos:0.5,1.5,2.5|FS:0,0>');
  assert(r.mPos != null && r.mPos.x === 1.5 && r.mPos.y === 2.5 && r.mPos.z === 3.5,
    `MPos parsed (got ${JSON.stringify(r.mPos)})`);
  assert(r.wPos != null && r.wPos.x === 0.5 && r.wPos.y === 1.5 && r.wPos.z === 2.5,
    `WPos parsed (got ${JSON.stringify(r.wPos)})`);
}

// -------- 4. MPos with only x,y (z defaults to 0 — pre-T1-124 behavior) --------
{
  const r = parseGrblStatusReport('<Idle|MPos:10,20|FS:0,0>');
  assert(r.mPos != null && r.mPos.z === 0,
    `MPos with only x,y → z defaults to 0 (got z=${r.mPos?.z})`);
}

// -------- 4b. Malformed/non-finite coordinates are not trusted --------
{
  const r = parseGrblStatusReport('<Idle|MPos:bad,20,0|WPos:1,2,3|FS:0,0>');
  assert(r.mPos === null,
    `malformed MPos x -> mPos=null, not a trusted position (got ${JSON.stringify(r.mPos)})`);
  assert(r.wPos != null && r.wPos.x === 1,
    'valid WPos still parses when MPos is malformed');
}
{
  const r = parseGrblStatusReport('<Idle|MPos:10,20,0|WPos:1,NaN,3|FS:0,0>');
  assert(r.wPos === null,
    `malformed WPos y -> wPos=null, not a trusted position (got ${JSON.stringify(r.wPos)})`);
  assert(r.mPos != null && r.mPos.x === 10,
    'valid MPos still parses when WPos is malformed');
}

// -------- 5. FS field: feed + spindle, with NaN coerced to 0 --------
{
  const r = parseGrblStatusReport('<Run|FS:1500,500>');
  assert(r.feedRate === 1500, `FS feed = 1500 (got ${r.feedRate})`);
  assert(r.spindleSpeed === 500, `FS spindle = 500 (got ${r.spindleSpeed})`);
}
{
  const r = parseGrblStatusReport('<Run|FS:bogus,bogus>');
  assert(r.feedRate === 0, `FS unparseable → feed = 0 (preserves Number(...) || 0)`);
  assert(r.spindleSpeed === 0, 'FS unparseable → spindle = 0');
}

// -------- 6. Standalone F field without FS --------
{
  const r = parseGrblStatusReport('<Idle|F:850>');
  assert(r.feedRate === 850, `standalone F:850 parsed (got ${r.feedRate})`);
  assert(r.spindleSpeed === null,
    `standalone F: leaves spindleSpeed=null (FS is the only spindle source)`);
}

// -------- 7. Empty body returns empty shape --------
{
  const r = parseGrblStatusReport('<>');
  // The pre-T1-124 inline parser would early-return when parts.length
  // === 0, but `''.split('|')` actually yields `['']` so parts.length
  // is 1 with an empty stateWord. The new parser preserves that
  // semantic — stateWord is empty string, machineStatus is null.
  assert(r.stateWord === '', 'empty body → stateWord empty string');
  assert(r.machineStatus === null, 'empty body → machineStatus null');
  assert(r.mPos === null && r.wPos === null,
    'empty body → no positions');
}

// -------- 8. Fields with no colon are skipped --------
{
  const r = parseGrblStatusReport('<Idle|garbage|MPos:1,2,3>');
  assert(r.mPos != null && r.mPos.x === 1,
    'malformed pipe-section without colon does not derail MPos parsing');
}

// -------- 9. Case-insensitive status word matching (input has any case) --------
{
  const variants = ['<idle|FS:0,0>', '<IDLE|FS:0,0>', '<iDlE|FS:0,0>'];
  for (const raw of variants) {
    const r = parseGrblStatusReport(raw);
    assert(r.machineStatus === 'idle',
      `${raw} → idle (case-insensitive)`);
  }
}

// -------- 10. Source-level pins on the wiring --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const ctlSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/import \{ parseGrblStatusReport \} from '\.\/GrblStatusReportParser'/.test(ctlSrc),
    "GrblController imports parseGrblStatusReport from './GrblStatusReportParser'");
  assert(/T1-124/.test(ctlSrc),
    'GrblController carries T1-124 marker for the parser-extraction wiring');
  assert(/parseGrblStatusReport\(raw\)/.test(ctlSrc),
    '_handleStatusReport calls parseGrblStatusReport(raw)');
  // The inline statusMap is gone from GrblController (it lives in
  // the parser module now). Pin its absence so a future regression
  // doesn't quietly inline it again.
  assert(
    !/const statusMap: Record<string, MachineStatus> = \{\s*idle: 'idle'/.test(ctlSrc),
    'inline statusMap is gone from GrblController._handleStatusReport',
  );

  const parserSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblStatusReportParser.ts'),
    'utf-8',
  );
  assert(/T1-124/.test(parserSrc),
    'GrblStatusReportParser.ts carries T1-124 marker');
  assert(/export function parseGrblStatusReport/.test(parserSrc),
    'parseGrblStatusReport is exported');
  assert(/export interface ParsedGrblStatusReport/.test(parserSrc),
    'ParsedGrblStatusReport interface is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
