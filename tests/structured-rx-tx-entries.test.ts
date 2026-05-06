/**
 * T2-113: structured RX/TX entries. Pre-T2-113 entries were flat
 * `{timestamp, type, message: string}` — every consumer regex-parsed
 * the message string. Audit 5C RX/TX classification.
 *
 * Run: npx tsx tests/structured-rx-tx-entries.test.ts
 */
import {
  classifyCommand,
  classifyResponse,
  buildTxEntry,
  buildRxEntry,
  fromLegacyEntry,
  RxTxCorrelator,
  type StructuredJobLogEntry,
} from '../src/app/StructuredRxTxEntry';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-113 Structured RX/TX entries ===\n');

void (async () => {

// 1. classifyCommand: motion
{
  for (const cmd of ['G0 X10', 'G1 X10 Y20', 'G2 X10 Y10 I5 J5', 'G3 X0 Y0 I5 J5']) {
    assert(classifyCommand(cmd) === 'motion', `'${cmd}' → motion`);
  }
}

// 2. classifyCommand: mcode
{
  for (const cmd of ['M3 S1000', 'M5', 'M30', 'M2']) {
    assert(classifyCommand(cmd) === 'mcode', `'${cmd}' → mcode`);
  }
}

// 3. classifyCommand: system
{
  for (const cmd of ['$$', '$#', '$G', '$H', '$X', '$30=1000', '$J=X10 F100']) {
    assert(classifyCommand(cmd) === 'system', `'${cmd}' → system`);
  }
}

// 4. classifyCommand: status query
{
  assert(classifyCommand('?') === 'status', `'?' → status`);
}

// 5. classifyCommand: realtime
{
  // Single-byte realtime commands
  for (const byte of ['!', '~', '\x18']) {
    assert(classifyCommand(byte) === 'realtime', `'${byte.charCodeAt(0).toString(16)}' (single byte) → realtime`);
  }
}

// 6. classifyCommand: comment
{
  assert(classifyCommand('; layer change') === 'comment', `';' → comment`);
  assert(classifyCommand('(parens)') === 'comment', `'(' → comment`);
}

// 7. classifyCommand: empty + unknown
{
  assert(classifyCommand('') === 'unknown', `empty → unknown`);
  assert(classifyCommand('   ') === 'unknown', `whitespace-only → unknown`);
}

// 8. classifyResponse: ok
{
  const r = classifyResponse('ok');
  assert(r.responseClass === 'ok', `'ok' → ok`);
}

// 9. classifyResponse: error with code
{
  const r = classifyResponse('error:9');
  assert(r.responseClass === 'error', `'error:9' → error`);
  assert(r.errorCode === 9, `errorCode=9`);
}

// 10. classifyResponse: alarm with code
{
  const r = classifyResponse('ALARM:1');
  assert(r.responseClass === 'alarm', `'ALARM:1' → alarm`);
  assert(r.alarmCode === 1, `alarmCode=1`);
}

// 11. classifyResponse: status report
{
  const r = classifyResponse('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  assert(r.responseClass === 'status', `'<...>' → status`);
}

// 12. classifyResponse: welcome
{
  const r = classifyResponse(`Grbl 1.1h ['$' for help]`);
  assert(r.responseClass === 'welcome', `'Grbl 1.1h' → welcome`);
}

// 13. classifyResponse: feedback
{
  for (const fb of ['[VER:1.1h:]', '[OPT:VL,15,128]', '[GC:G0 G54]', '[G54:0.000,0.000,0.000]']) {
    const r = classifyResponse(fb);
    assert(r.responseClass === 'feedback', `'${fb}' → feedback`);
  }
}

// 14. buildTxEntry: structured shape
{
  const e = buildTxEntry({ timestamp: 1000, raw: 'G1 X10 F100', source: 'job' });
  assert(e.type === 'sent', `type=sent`);
  assert(e.raw === 'G1 X10 F100', `raw preserved`);
  assert(e.classification?.direction === 'tx', `direction=tx`);
  assert(e.classification?.source === 'job', `source=job`);
  assert(e.classification?.commandType === 'motion', `commandType=motion`);
  assert(e.message === '→ G1 X10 F100', `legacy message derived`);
}

// 15. buildTxEntry: with bufferStateAfter
{
  const e = buildTxEntry({
    timestamp: 1000, raw: 'G0 X0', source: 'job',
    bufferStateAfter: { freeChars: 100, queueDepth: 5 },
  });
  assert(e.classification?.bufferStateAfter?.freeChars === 100, `freeChars carried`);
  assert(e.classification?.bufferStateAfter?.queueDepth === 5, `queueDepth carried`);
}

// 16. buildRxEntry: ok response
{
  const e = buildRxEntry({ timestamp: 2000, raw: 'ok' });
  assert(e.type === 'received', `type=received`);
  assert(e.classification?.direction === 'rx', `direction=rx`);
  assert(e.classification?.responseClass === 'ok', `responseClass=ok`);
  assert(e.message === '← ok', `legacy message derived`);
}

// 17. buildRxEntry: error with responseTo + controllerLineNumber
{
  const e = buildRxEntry({
    timestamp: 2000, raw: 'error:9',
    responseTo: 42, controllerLineNumber: 100,
  });
  assert(e.classification?.responseClass === 'error', `responseClass=error`);
  assert(e.classification?.errorCode === 9, `errorCode carried from raw`);
  assert(e.classification?.responseTo === 42, `responseTo carried`);
  assert(e.classification?.controllerLineNumber === 100, `controllerLineNumber carried`);
}

// 18. fromLegacyEntry: legacy 'sent' → structured tx
{
  const legacy = { timestamp: 1000, type: 'sent' as const, message: '→ G1 X10' };
  const s = fromLegacyEntry(legacy);
  assert(s.type === 'sent', `type=sent`);
  assert(s.raw === 'G1 X10', `'→' prefix stripped from raw`);
  assert(s.classification?.commandType === 'motion', `classified as motion`);
}

// 19. fromLegacyEntry: legacy 'received' → structured rx
{
  const legacy = { timestamp: 2000, type: 'received' as const, message: '← ok' };
  const s = fromLegacyEntry(legacy);
  assert(s.type === 'received', `type=received`);
  assert(s.raw === 'ok', `'←' prefix stripped`);
  assert(s.classification?.responseClass === 'ok', `classified as ok`);
}

// 20. fromLegacyEntry: legacy 'milestone' / 'error' / 'info' preserved as-is
{
  for (const t of ['milestone', 'error', 'warning', 'info'] as const) {
    const legacy = { timestamp: 0, type: t, message: 'x' };
    const s = fromLegacyEntry(legacy);
    assert(s.type === t, `${t}: type preserved`);
    assert(s.classification === undefined, `${t}: no classification (no rx/tx)`);
  }
}

// 21. RxTxCorrelator: ok pairs with last motion tx
{
  const c = new RxTxCorrelator();
  const tx0 = buildTxEntry({ timestamp: 100, raw: 'G0 X10', source: 'job' });
  c.recordTx(0, tx0);
  const tx1 = buildTxEntry({ timestamp: 200, raw: 'G1 X20 F100', source: 'job' });
  c.recordTx(1, tx1);
  // First ok pairs with first tx (FIFO)
  const rx0 = buildRxEntry({ timestamp: 300, raw: 'ok' });
  const responseTo = c.correlateRx(rx0);
  assert(responseTo === 0, `first ok pairs with tx index 0 (got ${responseTo})`);
  const rx1 = buildRxEntry({ timestamp: 400, raw: 'ok' });
  assert(c.correlateRx(rx1) === 1, `second ok pairs with tx index 1`);
  assert(c.pendingCount === 0, `no pending after 2 acks`);
}

// 22. RxTxCorrelator: status reports do NOT consume tx
{
  const c = new RxTxCorrelator();
  c.recordTx(0, buildTxEntry({ timestamp: 100, raw: 'G0 X10', source: 'job' }));
  const status = buildRxEntry({ timestamp: 200, raw: '<Idle|MPos:0,0,0>' });
  assert(c.correlateRx(status) === undefined,
    `status report doesn't correlate`);
  assert(c.pendingCount === 1, `tx still pending`);
  // The next ok still pairs with tx index 0
  assert(c.correlateRx(buildRxEntry({ timestamp: 300, raw: 'ok' })) === 0,
    `subsequent ok still pairs with tx 0`);
}

// 23. RxTxCorrelator: welcome / feedback don't consume tx
{
  const c = new RxTxCorrelator();
  c.recordTx(0, buildTxEntry({ timestamp: 100, raw: 'G0 X10', source: 'job' }));
  const welcome = buildRxEntry({ timestamp: 200, raw: `Grbl 1.1h ['$' for help]` });
  assert(c.correlateRx(welcome) === undefined,
    `welcome doesn't correlate`);
  const feedback = buildRxEntry({ timestamp: 250, raw: '[VER:1.1h:]' });
  assert(c.correlateRx(feedback) === undefined,
    `feedback doesn't correlate`);
  assert(c.pendingCount === 1, `tx still pending`);
}

// 24. RxTxCorrelator: error correlates (and consumes)
{
  const c = new RxTxCorrelator();
  c.recordTx(0, buildTxEntry({ timestamp: 100, raw: 'G0 X10', source: 'job' }));
  const err = buildRxEntry({ timestamp: 200, raw: 'error:9' });
  assert(c.correlateRx(err) === 0,
    `error pairs with the most-recent unmatched tx`);
}

// 25. RxTxCorrelator: comment + status TXes don't enter the correlation queue
{
  const c = new RxTxCorrelator();
  c.recordTx(0, buildTxEntry({ timestamp: 100, raw: '?', source: 'job' }));   // status query
  c.recordTx(1, buildTxEntry({ timestamp: 110, raw: '; comment', source: 'job' }));
  c.recordTx(2, buildTxEntry({ timestamp: 120, raw: 'G1 X10', source: 'job' }));
  // First ok should pair with the motion (tx index 2), since status/comment
  // don't enter the correlation queue.
  assert(c.correlateRx(buildRxEntry({ timestamp: 200, raw: 'ok' })) === 2,
    `comment + status TX skipped; ok pairs with motion (got tx 2)`);
}

// 26. RxTxCorrelator: reset clears pending
{
  const c = new RxTxCorrelator();
  c.recordTx(0, buildTxEntry({ timestamp: 100, raw: 'G0 X10', source: 'job' }));
  c.reset();
  assert(c.pendingCount === 0, `reset → 0 pending`);
}

// 27. End-to-end: realistic stream with TX/RX/status/error
{
  const c = new RxTxCorrelator();
  const entries: StructuredJobLogEntry[] = [];
  function addTx(raw: string): void {
    const e = buildTxEntry({ timestamp: entries.length, raw, source: 'job' });
    c.recordTx(entries.length, e);
    entries.push(e);
  }
  function addRx(raw: string): void {
    const e = buildRxEntry({
      timestamp: entries.length, raw, responseTo: c.correlateRx(buildRxEntry({ timestamp: 0, raw })),
    });
    entries.push(e);
  }
  addTx('G0 X0 Y0');
  addTx('M3 S1000');
  addRx('ok');                 // pairs with G0
  addRx('<Idle|MPos:0,0,0>');  // doesn't correlate
  addRx('ok');                 // pairs with M3
  addTx('G1 X10 F100');
  addRx('error:9');            // pairs with G1
  // Verify final classification:
  assert(entries[2].classification?.responseClass === 'ok', `entry 2 ok`);
  assert(entries[3].classification?.responseClass === 'status',
    `entry 3 status`);
  assert(entries[6].classification?.responseClass === 'error', `entry 6 error`);
  assert(entries[6].classification?.errorCode === 9, `entry 6 errorCode=9`);
}

// 28. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/StructuredRxTxEntry.ts'), 'utf-8');
  assert(/T2-113/.test(src), 'T2-113 marker in StructuredRxTxEntry.ts');
  for (const id of [
    'EntryDirection', 'EntrySource', 'CommandType', 'ResponseClassification',
    'EntryClassification', 'StructuredJobLogEntry',
    'classifyCommand', 'classifyResponse',
    'buildTxEntry', 'buildRxEntry', 'fromLegacyEntry',
    'RxTxCorrelator',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
