/**
 * T2-50: typed `ControllerFault` model + `FaultQueue` dispatcher.
 * Pre-T2-50 the test surface had T2-13's transport-level injector
 * and ad-hoc `MockSerialPort` tools — narrow, ad-hoc, not
 * discoverable. Audit 3E Critical 6 + Required P0.
 *
 * Run: npx tsx tests/fault-injection-scenarios.test.ts
 */
import {
  FaultQueue,
  faultMatches,
  makeChaosRng,
  type ControllerFault,
} from './helpers/ControllerFault';

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

console.log('\n=== T2-50 ControllerFault + FaultQueue ===\n');

void (async () => {

// 1. inject + pending
{
  const q = new FaultQueue();
  const id = q.inject({ type: 'drop-ok', afterLine: 120 });
  assert(typeof id === 'number' && id > 0, `inject returns positive id (got ${id})`);
  assert(q.pending.length === 1, `1 pending after inject`);
}

// 2. consume removes fault from `pending`
{
  const q = new FaultQueue();
  const id = q.inject({ type: 'drop-ok', afterLine: 100 });
  q.consume(id);
  assert(q.pending.length === 0, `consumed → 0 pending`);
}

// 3. clear empties the queue
{
  const q = new FaultQueue();
  q.inject({ type: 'drop-ok', afterLine: 100 });
  q.inject({ type: 'baud-mismatch' });
  q.clear();
  assert(q.pending.length === 0, `clear → 0 pending`);
}

// 4. faultMatches: drop-ok on/before/after line trigger
{
  const f: ControllerFault = { type: 'drop-ok', afterLine: 120 };
  assert(!faultMatches(f, { lineNumber: 119 }),
    `drop-ok afterLine=120 vs line=119 → no match`);
  assert(faultMatches(f, { lineNumber: 120 }),
    `drop-ok afterLine=120 vs line=120 → match`);
  assert(faultMatches(f, { lineNumber: 200 }),
    `drop-ok afterLine=120 vs line=200 → match`);
}

// 5. faultMatches: inject-error string trigger
{
  const f: ControllerFault = { type: 'inject-error', code: 1, afterCommand: 'G1' };
  assert(faultMatches(f, { command: 'G1 X10 Y20 F100' }),
    `inject-error 'G1' vs 'G1 X10...' → match`);
  assert(!faultMatches(f, { command: 'G0 X0 Y0' }),
    `inject-error 'G1' vs 'G0...' → no match`);
}

// 6. faultMatches: inject-error regex trigger
{
  const f: ControllerFault = { type: 'inject-error', code: 9, afterCommand: /^M[35]/ };
  assert(faultMatches(f, { command: 'M3 S100' }), `regex matches 'M3 S100'`);
  assert(faultMatches(f, { command: 'M5' }), `regex matches 'M5'`);
  assert(!faultMatches(f, { command: 'G1 X10' }), `regex rejects 'G1 X10'`);
}

// 7. faultMatches: enter-alarm after-ms trigger
{
  const f: ControllerFault = { type: 'enter-alarm', alarmCode: 1, trigger: 'after-ms', param: 2500 };
  assert(!faultMatches(f, { nowMs: 2499 }), `before 2500ms: no match`);
  assert(faultMatches(f, { nowMs: 2500 }), `at 2500ms: match`);
  assert(faultMatches(f, { nowMs: 5000 }), `after 2500ms: match`);
}

// 8. faultMatches: enter-alarm on-realtime-byte
{
  const f: ControllerFault = { type: 'enter-alarm', alarmCode: 9, trigger: 'on-realtime-byte', param: '?' };
  assert(faultMatches(f, { realtimeByte: '?' }),
    `on-realtime-byte '?' matches`);
  assert(!faultMatches(f, { realtimeByte: '!' }),
    `on-realtime-byte '?' does not match '!'`);
}

// 9. faultMatches: disconnect with multiple triggers
{
  const f: ControllerFault = { type: 'disconnect', atMs: 5000, afterLine: 200 };
  assert(faultMatches(f, { nowMs: 5000 }), `disconnect on time trigger`);
  assert(faultMatches(f, { lineNumber: 200 }), `disconnect on line trigger`);
  assert(!faultMatches(f, { nowMs: 100 }), `disconnect: neither trigger met → no match`);
}

// 10. faultMatches: buffer-overflow / partial-write byte triggers
{
  const overflow: ControllerFault = { type: 'buffer-overflow', triggerAtBytes: 100 };
  assert(faultMatches(overflow, { bytesSent: 100 }), `overflow at exact threshold`);
  assert(!faultMatches(overflow, { bytesSent: 99 }), `overflow below threshold`);

  const partial: ControllerFault = { type: 'partial-write', dropAfterBytes: 50 };
  assert(faultMatches(partial, { bytesSent: 75 }), `partial-write past threshold`);
}

// 11. faultMatches: baud-mismatch + lifecycle faults are unconditional
{
  for (const type of ['baud-mismatch', 'stale-response-after-reconnect',
                      'reader-throws-mid-loop', 'writer-rejects-after-close'] as const) {
    const f = { type } as ControllerFault;
    assert(faultMatches(f, {}),
      `'${type}' lifecycle fault matches with empty context`);
  }
}

// 12. faultMatches: malformed-status only when emittingStatus
{
  const f: ControllerFault = { type: 'malformed-status', every: 5 };
  assert(faultMatches(f, { emittingStatus: true }),
    `malformed-status when emittingStatus=true`);
  assert(!faultMatches(f, { emittingStatus: false }),
    `malformed-status NOT when emittingStatus=false`);
}

// 13. queue.match: returns only matching faults
{
  const q = new FaultQueue();
  q.inject({ type: 'drop-ok', afterLine: 120 });
  q.inject({ type: 'inject-error', code: 1, afterCommand: 'G1' });
  q.inject({ type: 'baud-mismatch' });
  const matches = q.match({ lineNumber: 120, command: 'G0 X0' });
  // drop-ok matches (line 120), baud-mismatch matches (unconditional),
  // inject-error does NOT match (G0 != G1)
  assert(matches.length === 2,
    `2 of 3 faults match (got ${matches.length})`);
}

// 14. queue.matchOfType: filters by discriminant
{
  const q = new FaultQueue();
  q.inject({ type: 'drop-ok', afterLine: 0 });
  q.inject({ type: 'drop-ok', afterLine: 0 });
  q.inject({ type: 'baud-mismatch' });
  const drops = q.matchOfType({ lineNumber: 100 }, 'drop-ok');
  assert(drops.length === 2, `matchOfType('drop-ok') returns 2`);
  for (const d of drops) {
    assert(d.fault.type === 'drop-ok', `each entry has type='drop-ok'`);
  }
}

// 15. queue.match: consumed faults excluded
{
  const q = new FaultQueue();
  const id1 = q.inject({ type: 'drop-ok', afterLine: 0 });
  q.inject({ type: 'drop-ok', afterLine: 0 });
  q.consume(id1);
  const matches = q.match({ lineNumber: 100 });
  assert(matches.length === 1,
    `consumed fault excluded from match (got ${matches.length})`);
}

// 16. End-to-end scenario: composed faults at distinct triggers
{
  const q = new FaultQueue();
  q.inject({ type: 'enter-alarm', alarmCode: 1, trigger: 'after-ms', param: 2500 });
  q.inject({ type: 'disconnect', atMs: 3000 });

  // At 2400 ms: nothing fires
  assert(q.match({ nowMs: 2400 }).length === 0, `2400ms: 0 fires`);
  // At 2500 ms: alarm only
  const at2500 = q.match({ nowMs: 2500 });
  assert(at2500.length === 1 && at2500[0].fault.type === 'enter-alarm',
    `2500ms: alarm only`);
  // At 3000 ms: alarm AND disconnect
  const at3000 = q.match({ nowMs: 3000 });
  assert(at3000.length === 2,
    `3000ms: both alarm + disconnect (got ${at3000.length})`);
}

// 17. makeChaosRng: deterministic per seed
{
  const r1 = makeChaosRng(42);
  const r2 = makeChaosRng(42);
  for (let i = 0; i < 5; i++) {
    const a = r1();
    const b = r2();
    assert(a === b, `same seed → identical sequence (#${i}: ${a} === ${b})`);
  }
}

// 18. makeChaosRng: distinct seeds → distinct sequences (with high probability)
{
  const r1 = makeChaosRng(1);
  const r2 = makeChaosRng(2);
  let allSame = true;
  for (let i = 0; i < 5; i++) {
    if (r1() !== r2()) allSame = false;
  }
  assert(!allSame, `seed=1 and seed=2 produce different sequences`);
}

// 19. makeChaosRng: returns values in [0, 1)
{
  const r = makeChaosRng(123);
  for (let i = 0; i < 100; i++) {
    const v = r();
    if (v < 0 || v >= 1) {
      assert(false, `value out of range: ${v}`);
      break;
    }
  }
  assert(true, `100 values all in [0, 1)`);
}

// 20. Type-shape pin: the fault catalog covers the audit's named scenarios
{
  // This is a compile-time check, but we also assert the strings at
  // runtime by constructing each variant.
  const all: ControllerFault[] = [
    { type: 'drop-ok', afterLine: 1 },
    { type: 'slow-ack', latencyMs: 100 },
    { type: 'inject-error', code: 1 },
    { type: 'enter-alarm', alarmCode: 1, trigger: 'after-ms', param: 100 },
    { type: 'malformed-status' },
    { type: 'disconnect' },
    { type: 'buffer-overflow', triggerAtBytes: 1 },
    { type: 'partial-write', dropAfterBytes: 1 },
    { type: 'baud-mismatch' },
    { type: 'corrupt-settings-dump' },
    { type: 'stale-response-after-reconnect' },
    { type: 'reader-throws-mid-loop' },
    { type: 'writer-rejects-after-close' },
  ];
  assert(all.length === 13, `13 named fault variants (got ${all.length})`);
}

// 21. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, './helpers/ControllerFault.ts'), 'utf-8');
  assert(/T2-50/.test(src), 'T2-50 marker in ControllerFault.ts');
  for (const id of [
    'ControllerFault', 'FaultQueue', 'faultMatches',
    'makeChaosRng', 'SimulationContext',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const t of [
    "'drop-ok'", "'slow-ack'", "'inject-error'", "'enter-alarm'",
    "'malformed-status'", "'disconnect'", "'buffer-overflow'",
    "'partial-write'", "'baud-mismatch'", "'corrupt-settings-dump'",
    "'stale-response-after-reconnect'", "'reader-throws-mid-loop'",
    "'writer-rejects-after-close'",
  ]) {
    assert(src.includes(t), `fault type ${t} declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
