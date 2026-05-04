/**
 * T1-63: warning confirmation dialog must include detail + fix per warning,
 * matching the blocker dialog format. Pre-T1-63 the user saw only the title
 * (e.g. "▲ High cut power") with no value, no consequence, and no
 * remediation — they pressed Start because the title didn't sound serious.
 *
 * Run: npx tsx tests/preflight-warning-confirm-includes-detail.test.ts
 */
import { confirmPreflightForJobStart } from '../src/core/preflight/confirmPreflightForJobStart';
import type { PreflightSummary } from '../src/core/preflight/Preflight';

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

console.log('\n=== T1-63 warning confirm includes detail/fix ===\n');

async function run(): Promise<void> {

function mkPreflight(opts: {
  blockers?: number;
  warnings?: { title: string; detail?: string; fix?: string }[];
}): PreflightSummary {
  const ws = (opts.warnings ?? []).map((w, i) => ({
    id: `w${i}`,
    severity: 'warning' as const,
    title: w.title,
    detail: w.detail ?? w.title,
    fix: w.fix,
    category: 'settings' as const,
  }));
  return {
    score: 80,
    issues: ws,
    blockers: opts.blockers ?? 0,
    warnings: ws.length,
    canStart: (opts.blockers ?? 0) === 0,
  };
}

// ── 1. Single warning with detail + fix → confirm message contains all three ──
{
  let confirmMsg = '';
  const showConfirm = async (_t: string, msg: string): Promise<boolean> => {
    confirmMsg = msg;
    return true;
  };
  const showAlert = async (): Promise<void> => {};
  const r = await confirmPreflightForJobStart(
    mkPreflight({
      warnings: [{
        title: 'High cut power (90%)',
        detail: 'Layer "Outline" uses 90% power. Diode lasers > 80% may overheat.',
        fix: 'Reduce power or add passes.',
      }],
    }),
    showAlert,
    showConfirm,
  );
  assert(r.confirmed, 'user clicked OK → confirmed:true');
  assert(confirmMsg.includes('▲ High cut power (90%)'), 'message includes title with ▲ marker');
  assert(confirmMsg.includes('Layer "Outline" uses 90% power'), 'message includes detail text');
  assert(confirmMsg.includes('Diode lasers > 80% may overheat'), 'message includes full detail body');
  assert(confirmMsg.includes('→ Reduce power or add passes'), 'message includes fix text with arrow');
}

// ── 2. Warning with detail equal to title → no detail-line duplication ──
{
  let confirmMsg = '';
  const showConfirm = async (_t: string, msg: string): Promise<boolean> => {
    confirmMsg = msg;
    return true;
  };
  const showAlert = async (): Promise<void> => {};
  await confirmPreflightForJobStart(
    mkPreflight({
      warnings: [{ title: 'Foo bar', detail: 'Foo bar', fix: 'baz' }],
    }),
    showAlert,
    showConfirm,
  );
  // Title rendered once; detail-line skipped because it duplicates the title.
  const titleHits = confirmMsg.match(/Foo bar/g);
  assert(
    titleHits?.length === 1,
    `detail==title is rendered once, not twice (got ${titleHits?.length} hits)`,
  );
  assert(/→ baz/.test(confirmMsg), 'fix line still rendered when detail collapses into title');
}

// ── 3. Warning with no fix → no arrow line, just title (+detail if distinct) ──
{
  let confirmMsg = '';
  const showConfirm = async (_t: string, msg: string): Promise<boolean> => {
    confirmMsg = msg;
    return true;
  };
  const showAlert = async (): Promise<void> => {};
  await confirmPreflightForJobStart(
    mkPreflight({
      warnings: [{ title: 'Layer X', detail: 'Some detail about Layer X' }],
    }),
    showAlert,
    showConfirm,
  );
  assert(/▲ Layer X/.test(confirmMsg), 'title rendered');
  assert(/Some detail about Layer X/.test(confirmMsg), 'detail rendered');
  assert(!/→/.test(confirmMsg), 'no arrow line when fix is absent');
}

// ── 4. Multiple warnings separated by double-newlines (readable) ──
{
  let confirmMsg = '';
  const showConfirm = async (_t: string, msg: string): Promise<boolean> => {
    confirmMsg = msg;
    return true;
  };
  const showAlert = async (): Promise<void> => {};
  await confirmPreflightForJobStart(
    mkPreflight({
      warnings: [
        { title: 'A', detail: 'a-detail', fix: 'a-fix' },
        { title: 'B', detail: 'b-detail', fix: 'b-fix' },
      ],
    }),
    showAlert,
    showConfirm,
  );
  // Each warning block separated by '\n\n' (blank line between).
  const aIdx = confirmMsg.indexOf('▲ A');
  const bIdx = confirmMsg.indexOf('▲ B');
  assert(aIdx >= 0 && bIdx > aIdx, 'both warnings present in stable order');
  // Between them there must be a blank line — at least two consecutive newlines.
  const between = confirmMsg.slice(aIdx, bIdx);
  assert(/\n\n/.test(between),
    'consecutive warnings separated by a blank line (\\n\\n) for readability');
}

// ── 5. User cancels (showConfirm returns false) → confirmed:false ──
{
  const showConfirm = async (): Promise<boolean> => false;
  const showAlert = async (): Promise<void> => {};
  const r = await confirmPreflightForJobStart(
    mkPreflight({ warnings: [{ title: 'x', detail: 'x', fix: 'y' }] }),
    showAlert,
    showConfirm,
  );
  assert(!r.confirmed, 'user clicked Cancel → confirmed:false');
}

// ── 6. No warnings → no dialog at all → confirmed:true ──
{
  let dialogShown = false;
  const showConfirm = async (): Promise<boolean> => {
    dialogShown = true;
    return true;
  };
  const showAlert = async (): Promise<void> => {};
  const r = await confirmPreflightForJobStart(
    mkPreflight({}),
    showAlert,
    showConfirm,
  );
  assert(r.confirmed, 'no warnings → confirmed:true');
  assert(!dialogShown, 'no warnings → no confirmation dialog rendered');
}

// ── 7. Source-level pin: T1-63 marker present in confirmPreflightForJobStart ──
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(here, '../src/core/preflight/confirmPreflightForJobStart.ts'),
    'utf-8',
  );
  assert(/T1-63/.test(src), 'T1-63 marker present');
  assert(/i\.detail && i\.detail !== i\.title/.test(src),
    'detail-equal-to-title de-duplication present');
  assert(
    /if \(i\.fix\) line \+=/.test(src) && /(→|→|\\u2192) \$\{i\.fix\}/.test(src),
    'fix line uses arrow prefix matching blocker-dialog convention',
  );
  // The pre-T1-63 single-line shape (just title) must be gone.
  assert(!/\.map\(i => `▲ \$\{i\.title\}`\)/.test(src),
    'OLD title-only map removed');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
