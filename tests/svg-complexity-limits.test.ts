/**
 * T2-123: explicit complexity limits at SVG import. Pre-T2-123 the
 * parser had no node-count cap, no recursion-depth bound, no path-
 * token / segment cap, no polygon-point cap. A malicious SVG could
 * crash the renderer with deep nesting or a single mega-path.
 *
 * Audit 5D Critical 7 + Required Priority 7.
 *
 * Run: npx tsx tests/svg-complexity-limits.test.ts
 */
import {
  SVG_LIMITS,
  SvgImportLimitError,
  assertSvgLimit,
  bumpAndAssert,
  emptyParseContext,
  svgLimitErrorMessage,
  type SvgLimitKey,
} from '../src/import/svg/SvgComplexityLimits';

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

console.log('\n=== T2-123 SVG complexity limits ===\n');

void (async () => {

// 1. SVG_LIMITS: declared values match audit recommendations
{
  assert(SVG_LIMITS.MAX_BYTES === 25 * 1024 * 1024, `MAX_BYTES = 25 MB`);
  assert(SVG_LIMITS.MAX_NODES === 50_000, `MAX_NODES = 50000`);
  assert(SVG_LIMITS.MAX_DEPTH === 100, `MAX_DEPTH = 100`);
  assert(SVG_LIMITS.MAX_RENDERABLE === 10_000, `MAX_RENDERABLE = 10000`);
  assert(SVG_LIMITS.MAX_PATH_TOKENS === 200_000, `MAX_PATH_TOKENS = 200000`);
  assert(SVG_LIMITS.MAX_PATH_SEGMENTS === 100_000, `MAX_PATH_SEGMENTS = 100000`);
  assert(SVG_LIMITS.MAX_POLYGON_POINTS === 100_000, `MAX_POLYGON_POINTS = 100000`);
  assert(SVG_LIMITS.MAX_TRANSFORM_DEPTH === 50, `MAX_TRANSFORM_DEPTH = 50`);
}

// 2. assertSvgLimit: passes when observed ≤ limit
{
  let threw = false;
  try { assertSvgLimit('MAX_NODES', 50_000); } catch { threw = true; }
  assert(!threw, `MAX_NODES at exact limit (50000) does NOT throw`);
}

// 3. assertSvgLimit: throws when observed > limit
{
  let caught: unknown = null;
  try { assertSvgLimit('MAX_NODES', 50_001); } catch (e) { caught = e; }
  assert(caught instanceof SvgImportLimitError,
    `over-limit throws SvgImportLimitError`);
  if (caught instanceof SvgImportLimitError) {
    assert(caught.limit === 'MAX_NODES', `error.limit='MAX_NODES'`);
    assert(caught.observed === 50_001, `error.observed=50001`);
    assert(caught.maximum === 50_000, `error.maximum=50000`);
  }
}

// 4. SvgImportLimitError: name field + Error chain preserved
{
  const err = new SvgImportLimitError('MAX_DEPTH', 200);
  assert(err.name === 'SvgImportLimitError', `error.name set`);
  assert(err instanceof Error, `extends Error`);
  assert(err instanceof SvgImportLimitError, `instanceof SvgImportLimitError`);
  assert(err.message.includes('MAX_DEPTH') && err.message.includes('200') && err.message.includes('100'),
    `message includes limit name, observed, maximum`);
}

// 5. bumpAndAssert: returns incremented value when within bounds
{
  let n = 0;
  for (let i = 0; i < 5; i++) n = bumpAndAssert(n, 'MAX_NODES');
  assert(n === 5, `5 bumps → 5 (got ${n})`);
}

// 6. bumpAndAssert: throws on the bump that would exceed limit
{
  let caught: unknown = null;
  try {
    bumpAndAssert(SVG_LIMITS.MAX_DEPTH, 'MAX_DEPTH');
  } catch (e) { caught = e; }
  assert(caught instanceof SvgImportLimitError,
    `bump from limit (100) → 101 throws`);
  if (caught instanceof SvgImportLimitError) {
    assert(caught.observed === SVG_LIMITS.MAX_DEPTH + 1,
      `observed = limit + 1 (got ${caught.observed})`);
  }
}

// 7. emptyParseContext: all counters start at 0
{
  const ctx = emptyParseContext();
  assert(ctx.nodeCount === 0, 'nodeCount=0');
  assert(ctx.renderableCount === 0, 'renderableCount=0');
  assert(ctx.depth === 0, 'depth=0');
  assert(ctx.transformDepth === 0, 'transformDepth=0');
}

// 8. svgLimitErrorMessage: each limit kind produces a distinct message
{
  const limits: SvgLimitKey[] = [
    'MAX_BYTES', 'MAX_NODES', 'MAX_DEPTH', 'MAX_RENDERABLE',
    'MAX_PATH_TOKENS', 'MAX_PATH_SEGMENTS', 'MAX_POLYGON_POINTS', 'MAX_TRANSFORM_DEPTH',
  ];
  const msgs = new Set<string>();
  for (const limit of limits) {
    const err = new SvgImportLimitError(limit, SVG_LIMITS[limit] + 1);
    const msg = svgLimitErrorMessage(err);
    assert(msg.length > 0, `'${limit}': non-empty message`);
    msgs.add(msg);
  }
  assert(msgs.size === limits.length,
    `each limit has a distinct message (${msgs.size}/${limits.length})`);
}

// 9. svgLimitErrorMessage: includes formatted observed + maximum
{
  const err = new SvgImportLimitError('MAX_PATH_SEGMENTS', 1_247_000);
  const msg = svgLimitErrorMessage(err);
  assert(msg.includes('1,247,000') || msg.includes('1247000'),
    `message includes formatted observed (got '${msg}')`);
  assert(msg.includes('100,000') || msg.includes('100000'),
    `message includes formatted maximum`);
}

// 10. svgLimitErrorMessage: non-SvgImportLimitError fallback
{
  const generic = new Error('parse error');
  const msg = svgLimitErrorMessage(generic);
  assert(/unexpected/i.test(msg) || /Cannot import/i.test(msg),
    `non-limit error → generic 'cannot import' message (got '${msg}')`);
}

// 11. svgLimitErrorMessage: undefined / null safe
{
  const m1 = svgLimitErrorMessage(undefined);
  const m2 = svgLimitErrorMessage(null);
  assert(m1.length > 0 && m2.length > 0,
    `undefined/null inputs return a usable message`);
}

// 12. End-to-end: deep nesting simulation throws at MAX_DEPTH
{
  const ctx = emptyParseContext();
  let caught: unknown = null;
  try {
    for (let i = 0; i < SVG_LIMITS.MAX_DEPTH + 1; i++) {
      ctx.depth = bumpAndAssert(ctx.depth, 'MAX_DEPTH');
    }
  } catch (e) { caught = e; }
  assert(caught instanceof SvgImportLimitError,
    `MAX_DEPTH+1 bumps throws SvgImportLimitError`);
  if (caught instanceof SvgImportLimitError) {
    assert(caught.limit === 'MAX_DEPTH',
      `error.limit = 'MAX_DEPTH' (got '${caught.limit}')`);
  }
}

// 13. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/import/svg/SvgComplexityLimits.ts'), 'utf-8');
  assert(/T2-123/.test(src), 'T2-123 marker in SvgComplexityLimits.ts');
  for (const id of [
    'SVG_LIMITS', 'SvgImportLimitError', 'assertSvgLimit',
    'bumpAndAssert', 'emptyParseContext', 'svgLimitErrorMessage',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const k of [
    'MAX_BYTES', 'MAX_NODES', 'MAX_DEPTH', 'MAX_RENDERABLE',
    'MAX_PATH_TOKENS', 'MAX_PATH_SEGMENTS', 'MAX_POLYGON_POINTS', 'MAX_TRANSFORM_DEPTH',
  ]) {
    assert(src.includes(k), `limit '${k}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
