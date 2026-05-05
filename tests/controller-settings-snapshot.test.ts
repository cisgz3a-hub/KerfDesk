/**
 * T2-110: capture controller settings ($$ + $I + $G + $#) before
 * each job. Pre-T2-110 the codebase parsed only $30 and $32 live;
 * the full settings dump was never persisted, so support couldn't
 * answer "what's your $32?" without asking the user. Audit 5C
 * Critical 7 + Required Priority 4.
 *
 * Run: npx tsx tests/controller-settings-snapshot.test.ts
 */
import {
  parseDollarDollar,
  parseWcsOffsets,
  buildControllerSettingsSnapshot,
  safetyRelevantValues,
} from '../src/diagnostics/ControllerSettingsSnapshot';

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

console.log('\n=== T2-110 ControllerSettingsSnapshot ===\n');

void (async () => {

// 1. parseDollarDollar: each setting line indexed by $N
{
  const text = '$30=1000\n$32=1\n$130=410.000\n$131=305.000\nok';
  const out = parseDollarDollar(text);
  assert(out['$30'] === '1000', `$30=1000 (got '${out['$30']}')`);
  assert(out['$32'] === '1', `$32=1 (got '${out['$32']}')`);
  assert(out['$130'] === '410.000', `$130=410.000 (got '${out['$130']}')`);
  assert(out['$131'] === '305.000', `$131=305.000 (got '${out['$131']}')`);
}

// 2. parseDollarDollar: empty input → empty record (no throw)
{
  assert(Object.keys(parseDollarDollar('')).length === 0, 'empty input → empty record');
  assert(Object.keys(parseDollarDollar('   ')).length === 0, 'whitespace-only → empty record');
}

// 3. parseDollarDollar: malformed lines silently skipped
{
  const out = parseDollarDollar('$30=1000\nthis is not a setting\nok\n$32=0');
  assert(out['$30'] === '1000' && out['$32'] === '0',
    `valid lines parsed; malformed silently skipped`);
  assert(Object.keys(out).length === 2,
    `exactly 2 settings parsed (got ${Object.keys(out).length})`);
}

// 4. parseDollarDollar: CRLF line endings handled
{
  const out = parseDollarDollar('$30=1000\r\n$32=1\r\n');
  assert(out['$30'] === '1000' && out['$32'] === '1', 'CRLF handled');
}

// 5. parseWcsOffsets: full GRBL response
{
  const text =
    '[G54:0.000,0.000,0.000]\n' +
    '[G55:100.000,50.000,0.000]\n' +
    '[G92:5.000,10.000,0.000]\n' +
    '[TLO:0.000]\n' +
    '[PRB:0.000,0.000,0.000:0]\n';
  const out = parseWcsOffsets(text);
  assert(out.G54?.x === 0 && out.G54?.y === 0,
    `G54 zero-zero (got ${JSON.stringify(out.G54)})`);
  assert(out.G55?.x === 100 && out.G55?.y === 50,
    `G55 100/50 (got ${JSON.stringify(out.G55)})`);
  assert(out.G92?.x === 5 && out.G92?.y === 10,
    `G92 5/10 (got ${JSON.stringify(out.G92)})`);
  assert(out.TLO?.x === 0, `TLO present (got ${JSON.stringify(out.TLO)})`);
  assert(out.PRB?.x === 0, `PRB present (got ${JSON.stringify(out.PRB)})`);
}

// 6. parseWcsOffsets: 3D coordinates retain z
{
  const text = '[G54:1.5,2.5,3.5]';
  const out = parseWcsOffsets(text);
  assert(out.G54?.x === 1.5 && out.G54?.y === 2.5 && out.G54?.z === 3.5,
    `3D G54 z-axis preserved (got ${JSON.stringify(out.G54)})`);
}

// 7. parseWcsOffsets: empty input → empty record
{
  assert(Object.keys(parseWcsOffsets('')).length === 0, 'empty $# → empty record');
}

// 8. parseWcsOffsets: malformed bracketed lines skipped
{
  const text = '[G54:0,0,0]\n[INVALID]\n[G55:not,a,number]\n[G56:1,2,3]';
  const out = parseWcsOffsets(text);
  assert(out.G54 != null, 'G54 parsed');
  assert(out.G56 != null, 'G56 parsed');
  assert(out.G55 == null, 'G55 with non-numbers skipped');
  assert(Object.keys(out).length === 2, `exactly 2 valid offsets (got ${Object.keys(out).length})`);
}

// 9. buildControllerSettingsSnapshot: all inputs populated
{
  const snap = buildControllerSettingsSnapshot({
    buildInfoRaw: '[VER:1.1h.20190825:]\n[OPT:VL,15,128]',
    parserStateRaw: '[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]',
    wcsOffsetsRaw: '[G54:0.0,0.0,0.0]',
    dollarDollarRaw: '$30=1000\n$32=1',
    capturedAt: '2026-05-05T00:00:00.000Z',
  });
  assert(snap.capturedAt === '2026-05-05T00:00:00.000Z',
    `capturedAt override applied (got ${snap.capturedAt})`);
  assert(snap.buildInfo?.includes('VER:1.1h') === true, 'buildInfo carried through');
  assert(snap.parserState?.includes('G54') === true, 'parserState carried through');
  assert(snap.wcsOffsets.G54?.x === 0, 'wcsOffsets parsed');
  assert(snap.settings['$30'] === '1000', 'settings parsed');
}

// 10. buildControllerSettingsSnapshot: null inputs left null/empty
{
  const snap = buildControllerSettingsSnapshot({
    buildInfoRaw: null,
    parserStateRaw: null,
    wcsOffsetsRaw: null,
    dollarDollarRaw: null,
    capturedAt: '2026-05-05T00:00:00.000Z',
  });
  assert(snap.buildInfo === null, 'null buildInfoRaw → buildInfo=null');
  assert(snap.parserState === null, 'null parserStateRaw → parserState=null');
  assert(Object.keys(snap.wcsOffsets).length === 0, 'null wcsOffsetsRaw → empty record');
  assert(Object.keys(snap.settings).length === 0, 'null dollarDollarRaw → empty record');
}

// 11. buildControllerSettingsSnapshot: empty-string raw treated as null
{
  const snap = buildControllerSettingsSnapshot({
    buildInfoRaw: '',
    parserStateRaw: '   ',
    wcsOffsetsRaw: null,
    dollarDollarRaw: null,
  });
  assert(snap.buildInfo === null, 'empty-string buildInfoRaw → null');
  assert(snap.parserState === null, 'whitespace-only parserStateRaw → null');
}

// 12. buildControllerSettingsSnapshot: independence — failure of one
//     query doesn't block others
{
  const snap = buildControllerSettingsSnapshot({
    buildInfoRaw: null,
    parserStateRaw: '[GC:G0 G54]',
    wcsOffsetsRaw: null,
    dollarDollarRaw: '$30=1000',
    capturedAt: '2026-05-05T00:00:00.000Z',
  });
  assert(snap.buildInfo === null && snap.parserState !== null && snap.settings['$30'] === '1000',
    'partial-success snapshot: each field independent');
}

// 13. buildControllerSettingsSnapshot: capturedAt defaults to now ISO
{
  const before = Date.now();
  const snap = buildControllerSettingsSnapshot({
    buildInfoRaw: null,
    parserStateRaw: null,
    wcsOffsetsRaw: null,
    dollarDollarRaw: null,
  });
  const after = Date.now();
  const t = Date.parse(snap.capturedAt);
  assert(t >= before && t <= after,
    `capturedAt default within [before, after] (got ${snap.capturedAt})`);
}

// 14. safetyRelevantValues: parses $30 / $32 / $130 / $131
{
  const snap = buildControllerSettingsSnapshot({
    buildInfoRaw: null,
    parserStateRaw: null,
    wcsOffsetsRaw: null,
    dollarDollarRaw: '$30=1000\n$32=1\n$130=410\n$131=305',
  });
  const v = safetyRelevantValues(snap);
  assert(v.maxSpindle === 1000, `maxSpindle=1000 (got ${v.maxSpindle})`);
  assert(v.laserMode === true, `laserMode=true (got ${v.laserMode})`);
  assert(v.bedWidth === 410, `bedWidth=410 (got ${v.bedWidth})`);
  assert(v.bedHeight === 305, `bedHeight=305 (got ${v.bedHeight})`);
}

// 15. safetyRelevantValues: missing fields → null
{
  const snap = buildControllerSettingsSnapshot({
    buildInfoRaw: null,
    parserStateRaw: null,
    wcsOffsetsRaw: null,
    dollarDollarRaw: '',
  });
  const v = safetyRelevantValues(snap);
  assert(v.maxSpindle === null, 'missing $30 → maxSpindle=null');
  assert(v.laserMode === null, 'missing $32 → laserMode=null');
  assert(v.bedWidth === null, 'missing $130 → bedWidth=null');
  assert(v.bedHeight === null, 'missing $131 → bedHeight=null');
}

// 16. safetyRelevantValues: $32=0 → laserMode=false
{
  const snap = buildControllerSettingsSnapshot({
    buildInfoRaw: null, parserStateRaw: null, wcsOffsetsRaw: null,
    dollarDollarRaw: '$32=0',
  });
  assert(safetyRelevantValues(snap).laserMode === false,
    `$32=0 → laserMode=false`);
}

// 17. Snapshot is JSON-serialisable round-trip
{
  const snap = buildControllerSettingsSnapshot({
    buildInfoRaw: '[VER:1.1h]',
    parserStateRaw: '[GC:G0]',
    wcsOffsetsRaw: '[G54:1.0,2.0,3.0]',
    dollarDollarRaw: '$30=500',
    capturedAt: '2026-05-05T00:00:00.000Z',
  });
  const round = JSON.parse(JSON.stringify(snap));
  assert(round.capturedAt === snap.capturedAt
      && round.settings['$30'] === '500'
      && round.wcsOffsets.G54.z === 3,
    'round-trip preserves snapshot');
}

// 18. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/diagnostics/ControllerSettingsSnapshot.ts'), 'utf-8');
  assert(/T2-110/.test(src), 'T2-110 marker in ControllerSettingsSnapshot.ts');
  for (const id of [
    'ControllerSettingsSnapshot', 'WcsOffset', 'parseDollarDollar',
    'parseWcsOffsets', 'buildControllerSettingsSnapshot', 'safetyRelevantValues',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
