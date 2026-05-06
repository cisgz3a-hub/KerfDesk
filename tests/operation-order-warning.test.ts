/**
 * T2-63: operation order preview with order warning. Pre-T2-63 the
 * operation-order display was a single label per layer; users could
 * not see cut-before-engrave risk before pressing Start.
 *
 * Run: npx tsx tests/operation-order-warning.test.ts
 */
import {
  analyzeOperationOrder,
  formatOperationRow,
  summaryLine,
  orderRequiresAcknowledgement,
  type OperationKind,
  type OperationRow,
  type OrderWarningKind,
} from '../src/app/OperationOrder';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-63 operation-order warning ===\n');

const row = (index: number, kind: OperationKind, layerName: string, opts: { power?: number; feed?: number; passes?: number } = {}): OperationRow => ({
  index, kind, layerName,
  powerPercent: opts.power ?? 50,
  feedRateMmPerMin: opts.feed ?? 1000,
  passes: opts.passes ?? 1,
});

void (async () => {

// 1. Engrave → Cut: no warning (audit's correct order)
{
  const a = analyzeOperationOrder([
    row(1, 'engrave', 'Text'),
    row(2, 'cut', 'Outline'),
  ]);
  assert(a.warnings.length === 0, `engrave→cut: 0 warnings`);
  assert(a.summaryOk, `summaryOk=true`);
}

// 2. Cut → Engrave: warning emitted (audit's headline)
{
  const a = analyzeOperationOrder([
    row(1, 'cut', 'Outline'),
    row(2, 'engrave', 'Text'),
  ]);
  assert(a.warnings.length === 1, `cut→engrave: 1 warning`);
  assert(a.warnings[0].kind === 'cut-before-engrave', `kind=cut-before-engrave`);
  assert(a.warnings[0].cutAtIndex === 1, `cutAtIndex=1`);
  assert(a.warnings[0].engraveAtIndex === 2, `engraveAtIndex=2`);
}

// 3. Score → Engrave → Cut: no warning
{
  const a = analyzeOperationOrder([
    row(1, 'score', 'Detail'),
    row(2, 'engrave', 'Text'),
    row(3, 'cut', 'Outline'),
  ]);
  assert(a.warnings.length === 0, `score→engrave→cut: 0 warnings`);
}

// 4. Single-layer of any mode: no warning
{
  for (const k of ['engrave', 'image', 'score', 'cut', 'travel-only'] as OperationKind[]) {
    const a = analyzeOperationOrder([row(1, k, 'Only')]);
    assert(a.warnings.length === 0, `single '${k}': no warning`);
  }
}

// 5. Cut → Image: warning kind cut-before-image
{
  const a = analyzeOperationOrder([
    row(1, 'cut', 'Outline'),
    row(2, 'image', 'Photo'),
  ]);
  assert(a.warnings.length === 1, `1 warning`);
  assert(a.warnings[0].kind === 'cut-before-image', `kind=cut-before-image`);
}

// 6. Cut → Score: warning kind cut-before-score
{
  const a = analyzeOperationOrder([
    row(1, 'cut', 'Outline'),
    row(2, 'score', 'Detail'),
  ]);
  assert(a.warnings[0].kind === 'cut-before-score', `kind=cut-before-score`);
}

// 7. Cut → Engrave → Image: 2 warnings
{
  const a = analyzeOperationOrder([
    row(1, 'cut', 'Outline'),
    row(2, 'engrave', 'Text'),
    row(3, 'image', 'Photo'),
  ]);
  assert(a.warnings.length === 2, `2 warnings (cut precedes 2 engrave-class ops)`);
  const kinds = new Set<OrderWarningKind>(a.warnings.map(w => w.kind));
  assert(kinds.has('cut-before-engrave') && kinds.has('cut-before-image'),
    `both warnings present`);
}

// 8. Cut → Travel-only → Engrave: warning still emitted (travel doesn't matter)
{
  const a = analyzeOperationOrder([
    row(1, 'cut', 'Outline'),
    row(2, 'travel-only', 'Move'),
    row(3, 'engrave', 'Text'),
  ]);
  assert(a.warnings.length === 1, `travel-only doesn't intercept`);
  assert(a.warnings[0].cutAtIndex === 1 && a.warnings[0].engraveAtIndex === 3,
    `indices preserved across travel`);
}

// 9. Cut → Cut → Engrave: 1 warning per offending cut
{
  const a = analyzeOperationOrder([
    row(1, 'cut', 'Inner'),
    row(2, 'cut', 'Outer'),
    row(3, 'engrave', 'Text'),
  ]);
  assert(a.warnings.length === 2, `2 cuts each before engrave → 2 warnings`);
}

// 10. Travel-only sandwich: no warning
{
  const a = analyzeOperationOrder([
    row(1, 'travel-only', 'A'),
    row(2, 'engrave', 'Text'),
    row(3, 'travel-only', 'B'),
    row(4, 'cut', 'Outline'),
    row(5, 'travel-only', 'C'),
  ]);
  assert(a.warnings.length === 0, `engrave→cut with travel padding: no warning`);
}

// 11. Empty rows: no warning, summaryOk
{
  const a = analyzeOperationOrder([]);
  assert(a.warnings.length === 0, `empty: 0 warnings`);
  assert(a.summaryOk, `empty: summaryOk`);
}

// 12. Warning message names both layer names + indices + verb
{
  const a = analyzeOperationOrder([
    row(1, 'cut', 'OuterOutline'),
    row(2, 'engrave', 'TextLayer'),
  ]);
  const msg = a.warnings[0].message;
  assert(msg.includes('OuterOutline'), `cut layer named`);
  assert(msg.includes('TextLayer'), `engrave layer named`);
  assert(msg.toLowerCase().includes('shift'), `mentions shift`);
}

// 13. formatOperationRow: includes index + kind + layer + power + feed
{
  const r = row(2, 'engrave', 'Text', { power: 20, feed: 3000 });
  const s = formatOperationRow(r);
  assert(s.startsWith('2.'), `1-based index`);
  assert(s.includes('Engrave'), `kind label`);
  assert(s.includes('Text'), `layer name`);
  assert(s.includes('20%'), `power`);
  assert(s.includes('3000'), `feed`);
}

// 14. formatOperationRow: passes shown when > 1
{
  const single = formatOperationRow(row(1, 'cut', 'A', { passes: 1 }));
  const multi = formatOperationRow(row(1, 'cut', 'A', { passes: 3 }));
  assert(!single.includes('passes'), `single pass: passes hidden`);
  assert(multi.includes('3 passes'), `multi-pass: shown`);
}

// 15. summaryLine: empty
{
  const a = analyzeOperationOrder([]);
  assert(summaryLine(a) === 'No operations to run.', `empty summary`);
}

// 16. summaryLine: clean engrave→cut
{
  const a = analyzeOperationOrder([
    row(1, 'engrave', 'Text'),
    row(2, 'cut', 'Outline'),
  ]);
  const s = summaryLine(a);
  assert(s.includes('correct') && s.includes('engrave before cut'),
    `correct-order summary`);
}

// 17. summaryLine: clean engrave-only
{
  const a = analyzeOperationOrder([row(1, 'engrave', 'A')]);
  assert(summaryLine(a) === 'Order looks correct.', `engrave-only summary`);
}

// 18. summaryLine: warnings count
{
  const a = analyzeOperationOrder([
    row(1, 'cut', 'O'),
    row(2, 'engrave', 'T'),
  ]);
  const s = summaryLine(a);
  assert(s.includes('1') && s.toLowerCase().includes('warning'),
    `warning count in summary`);
}

// 19. orderRequiresAcknowledgement: warnings → true
{
  const a = analyzeOperationOrder([row(1, 'cut', 'O'), row(2, 'engrave', 'T')]);
  assert(orderRequiresAcknowledgement(a), `warnings → ack required`);
}

// 20. orderRequiresAcknowledgement: clean → false
{
  const a = analyzeOperationOrder([row(1, 'engrave', 'T'), row(2, 'cut', 'O')]);
  assert(!orderRequiresAcknowledgement(a), `clean → no ack required`);
}

// 21. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/OperationOrder.ts'), 'utf-8');
  assert(/T2-63/.test(src), 'T2-63 marker');
  for (const id of [
    'OperationKind', 'OperationRow', 'OrderWarningKind', 'OrderWarning',
    'OrderAnalysis',
    'analyzeOperationOrder', 'formatOperationRow',
    'summaryLine', 'orderRequiresAcknowledgement',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const k of ['engrave', 'image', 'score', 'cut', 'travel-only']) {
    assert(src.includes(`'${k}'`), `kind '${k}' declared`);
  }
  for (const w of ['cut-before-engrave', 'cut-before-image', 'cut-before-score']) {
    assert(src.includes(`'${w}'`), `warning '${w}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
