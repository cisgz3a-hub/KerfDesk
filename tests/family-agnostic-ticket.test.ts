/**
 * T2-29: controller-family-agnostic ticket schema. Pre-T2-29 the
 * ticket hardcoded G-code-only fields + controller type 'grbl';
 * the validation at MachineService.ts:349-355 was theatre.
 *
 * Run: npx tsx tests/family-agnostic-ticket.test.ts
 */
import {
  matchTicketToController,
  ticketFromGcodeLines,
  gcodeLinesFromTicket,
  gcodeTextFromTicket,
  outputByteSize,
  familyMatchUserMessage,
  type ControllerFamily,
  type OutputFormat,
  type ControllerOutput,
  type FamilyAgnosticTicket,
  type FamilyMatchResult,
} from '../src/core/job/FamilyAgnosticTicket';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-29 family-agnostic ticket ===\n');

void (async () => {

const baseTicket = (): FamilyAgnosticTicket => ({
  ticketId: 'tk1',
  sceneHash: 'sh1',
  profileHash: 'ph1',
  controllerFamily: 'grbl',
  outputFormat: 'gcode-lines',
  outputHash: 'oh1',
  output: { kind: 'gcode-lines', lines: ['G21', 'G90', 'M5', 'G0 X0 Y0'] },
  machinePlanBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  preflightHash: 'pf1',
  createdAt: 1700000000,
});

// 1. matchTicketToController: GRBL ticket + GRBL controller w/ gcode-lines support → ok
{
  const r = matchTicketToController({
    ticketFamily: 'grbl',
    ticketOutputFormat: 'gcode-lines',
    controllerFamily: 'grbl',
    controllerSupportedFormats: ['gcode-lines'],
  });
  assert(r.ok && r.kind === 'family-match', `GRBL+gcode-lines → match`);
}

// 2. Family mismatch: marlin ticket on grbl controller
{
  const r = matchTicketToController({
    ticketFamily: 'marlin',
    ticketOutputFormat: 'gcode-lines',
    controllerFamily: 'grbl',
    controllerSupportedFormats: ['gcode-lines'],
  });
  assert(!r.ok, `marlin/grbl → not ok`);
  if (!r.ok) {
    assert(r.kind === 'controller-family-mismatch', `kind=controller-family-mismatch`);
    assert(r.expected === 'marlin' && r.actual === 'grbl', `expected/actual reported`);
  }
}

// 3. Format not supported: job-upload ticket on serial controller
{
  const r = matchTicketToController({
    ticketFamily: 'falcon-wifi',
    ticketOutputFormat: 'job-upload',
    controllerFamily: 'falcon-wifi',
    controllerSupportedFormats: ['gcode-lines'],
  });
  assert(!r.ok, `family ok but format unsupported`);
  if (!r.ok) {
    assert(r.kind === 'output-format-not-supported-by-controller', `kind=output-format-not-supported`);
    assert(r.expected === 'job-upload', `expected=job-upload`);
    assert(r.actual === 'gcode-lines', `actual lists supported formats`);
  }
}

// 4. Multi-format support: controller supports both
{
  const r = matchTicketToController({
    ticketFamily: 'falcon-wifi',
    ticketOutputFormat: 'job-upload',
    controllerFamily: 'falcon-wifi',
    controllerSupportedFormats: ['gcode-lines', 'job-upload'],
  });
  assert(r.ok, `multi-format controller accepts ticket`);
}

// 5. Family check fires BEFORE format check
{
  // wrong family AND unsupported format — family-mismatch wins
  const r = matchTicketToController({
    ticketFamily: 'marlin',
    ticketOutputFormat: 'binary-stream',
    controllerFamily: 'grbl',
    controllerSupportedFormats: ['gcode-lines'],
  });
  if (!r.ok) {
    assert(r.kind === 'controller-family-mismatch', `family fires first`);
  } else assert(false, `expected !ok`);
}

// 6. unknown family
{
  const r = matchTicketToController({
    ticketFamily: 'unknown',
    ticketOutputFormat: 'gcode-lines',
    controllerFamily: 'grbl',
    controllerSupportedFormats: ['gcode-lines'],
  });
  assert(!r.ok, `unknown family does not match grbl`);
}

// 7. ticketFromGcodeLines: round-trips the basic shape
{
  const t = ticketFromGcodeLines({
    ticketId: 'tk2',
    sceneHash: 'sh',
    profileHash: 'ph',
    outputHash: 'oh',
    preflightHash: 'pf',
    gcodeLines: ['G21', 'G90'],
    controllerFamily: 'grbl',
    machinePlanBounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
    createdAt: 1700000001,
  });
  assert(t.ticketId === 'tk2', `ticketId set`);
  assert(t.controllerFamily === 'grbl', `family set`);
  assert(t.outputFormat === 'gcode-lines', `format=gcode-lines`);
  assert(t.output.kind === 'gcode-lines', `output.kind=gcode-lines`);
  if (t.output.kind === 'gcode-lines') {
    assert(t.output.lines.length === 2, `lines preserved`);
  }
}

// 8. gcodeLinesFromTicket on gcode-lines ticket
{
  const t = baseTicket();
  const lines = gcodeLinesFromTicket(t);
  assert(lines !== null && lines.length === 4, `lines extracted directly`);
}

// 9. gcodeLinesFromTicket on gcode-text ticket → split by \n
{
  const t: FamilyAgnosticTicket = {
    ...baseTicket(),
    outputFormat: 'gcode-text',
    output: { kind: 'gcode-text', text: 'G21\nG90\nM5' },
  };
  const lines = gcodeLinesFromTicket(t);
  assert(lines !== null && lines.length === 3, `text split to 3 lines`);
}

// 10. gcodeLinesFromTicket on binary-stream → null
{
  const t: FamilyAgnosticTicket = {
    ...baseTicket(),
    outputFormat: 'binary-stream',
    output: { kind: 'binary-stream', bytes: new Uint8Array([1, 2, 3]) },
  };
  assert(gcodeLinesFromTicket(t) === null, `binary → null (caller must branch)`);
}

// 11. gcodeLinesFromTicket on job-upload → null
{
  const t: FamilyAgnosticTicket = {
    ...baseTicket(),
    outputFormat: 'job-upload',
    output: { kind: 'job-upload', filename: 'job.gc', payload: new Uint8Array([1]) },
  };
  assert(gcodeLinesFromTicket(t) === null, `job-upload → null`);
}

// 12. gcodeTextFromTicket on gcode-lines → joined by \n
{
  const t = baseTicket();
  const text = gcodeTextFromTicket(t);
  assert(text === 'G21\nG90\nM5\nG0 X0 Y0', `lines joined with \\n`);
}

// 13. gcodeTextFromTicket on binary → null
{
  const t: FamilyAgnosticTicket = {
    ...baseTicket(),
    outputFormat: 'binary-stream',
    output: { kind: 'binary-stream', bytes: new Uint8Array([1, 2]) },
  };
  assert(gcodeTextFromTicket(t) === null, `binary text → null`);
}

// 14. outputByteSize: gcode-lines counts char + newline
{
  const out: ControllerOutput = { kind: 'gcode-lines', lines: ['G21', 'G90'] };
  // 'G21'(3) + 1 + 'G90'(3) + 1 = 8
  assert(outputByteSize(out) === 8, `gcode-lines byte size = 8`);
}

// 15. outputByteSize: gcode-text returns string length
{
  const out: ControllerOutput = { kind: 'gcode-text', text: 'hello' };
  assert(outputByteSize(out) === 5, `text byte size = 5`);
}

// 16. outputByteSize: binary-stream returns bytes.length
{
  const out: ControllerOutput = { kind: 'binary-stream', bytes: new Uint8Array(42) };
  assert(outputByteSize(out) === 42, `binary byte size = 42`);
}

// 17. outputByteSize: job-upload returns payload.length
{
  const out: ControllerOutput = { kind: 'job-upload', filename: 'a.gc', payload: new Uint8Array(100) };
  assert(outputByteSize(out) === 100, `job-upload byte size = 100`);
}

// 18. familyMatchUserMessage: ok → null
{
  const r: FamilyMatchResult = { ok: true, kind: 'family-match' };
  assert(familyMatchUserMessage(r) === null, `ok → null`);
}

// 19. familyMatchUserMessage: family mismatch names both
{
  const r: FamilyMatchResult = {
    ok: false, kind: 'controller-family-mismatch',
    expected: 'marlin', actual: 'grbl',
  };
  const msg = familyMatchUserMessage(r);
  assert(msg !== null && msg.includes('marlin') && msg.includes('grbl'),
    `message names both families`);
}

// 20. familyMatchUserMessage: format unsupported names format + supported list
{
  const r: FamilyMatchResult = {
    ok: false, kind: 'output-format-not-supported-by-controller',
    expected: 'job-upload', actual: 'gcode-lines',
  };
  const msg = familyMatchUserMessage(r);
  assert(msg !== null && msg.includes('job-upload') && msg.includes('gcode-lines'),
    `message names both`);
}

// 21. THE audit's headline cases
{
  // GRBL ticket + GRBL controller → accepts
  const a = matchTicketToController({
    ticketFamily: 'grbl',
    ticketOutputFormat: 'gcode-lines',
    controllerFamily: 'grbl',
    controllerSupportedFormats: ['gcode-lines'],
  });
  assert(a.ok, `audit case A: grbl/grbl → ok`);

  // Marlin-family ticket + GrblController → blocks
  const b = matchTicketToController({
    ticketFamily: 'marlin',
    ticketOutputFormat: 'gcode-lines',
    controllerFamily: 'grbl',
    controllerSupportedFormats: ['gcode-lines'],
  });
  if (!b.ok) {
    assert(b.kind === 'controller-family-mismatch', `audit case B: marlin/grbl → blocked`);
  } else assert(false, `expected !ok`);

  // GRBL ticket on a controller whose capabilities don't include the format
  const c = matchTicketToController({
    ticketFamily: 'grbl',
    ticketOutputFormat: 'gcode-text',
    controllerFamily: 'grbl',
    controllerSupportedFormats: ['gcode-lines'],
  });
  if (!c.ok) {
    assert(c.kind === 'output-format-not-supported-by-controller',
      `audit case C: capability gate works`);
  } else assert(false, `expected !ok`);
}

// 22. ticket round-trip: gcode-lines → text → lines preserves
{
  const lines = ['G21', 'G90', 'M5', 'G0 X10 Y20'];
  const t = ticketFromGcodeLines({
    ticketId: 'rt', sceneHash: 's', profileHash: 'p',
    outputHash: 'o', preflightHash: 'pf',
    gcodeLines: lines, controllerFamily: 'grbl',
    machinePlanBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    createdAt: 0,
  });
  const back = gcodeLinesFromTicket(t);
  assert(back !== null && back.length === lines.length, `length preserved`);
  if (back) {
    for (let i = 0; i < lines.length; i++) {
      assert(back[i] === lines[i], `line ${i} preserved`);
    }
  }
}

// 23. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/core/job/FamilyAgnosticTicket.ts'), 'utf-8');
  assert(/T2-29/.test(src), 'T2-29 marker');
  for (const id of [
    'ControllerFamily', 'OutputFormat', 'ControllerOutput',
    'FamilyAgnosticTicket', 'FamilyMatchKind', 'FamilyMatchResult',
    'matchTicketToController', 'ticketFromGcodeLines',
    'gcodeLinesFromTicket', 'gcodeTextFromTicket',
    'outputByteSize', 'familyMatchUserMessage',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const f of ['grbl', 'marlin', 'smoothie', 'falcon-wifi', 'unknown']) {
    assert(src.includes(`'${f}'`), `family '${f}' declared`);
  }
  for (const fmt of ['gcode-lines', 'gcode-text', 'binary-stream', 'job-upload']) {
    assert(src.includes(`'${fmt}'`), `format '${fmt}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
