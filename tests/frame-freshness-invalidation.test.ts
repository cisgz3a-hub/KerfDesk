/**
 * T2-60: frame freshness invalidation key.
 *
 * The previous frame motion no longer represents what the laser will burn
 * when ANY of these change: startMode, savedOrigin numeric values,
 * active profile (different originCorner / bed size), bed dimensions
 * (live $130/$131 vs profile defaults), originCorner toggle, or
 * compiledTicketId. This test pins the key as a stable string from
 * those inputs and ensures every individual input change produces a
 * distinct key.
 *
 * The pure helper is wired into ConnectionPanelMain via a useEffect
 * that resets `hasFramed.current` and bumps `workflowVersion` whenever
 * the key changes from the previously-observed value (a source-level
 * pin in the test file ensures the wiring shape doesn't silently
 * regress).
 *
 * Run: npx tsx tests/frame-freshness-invalidation.test.ts
 */
import {
  computeFrameFreshnessKey,
  type FrameFreshnessInputs,
} from '../src/app/computeFrameFreshnessKey';

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

console.log('\n=== T2-60 frame freshness invalidation ===\n');

async function run(): Promise<void> {

const baseline: FrameFreshnessInputs = {
  startMode: 'absolute',
  savedOriginX: null,
  savedOriginY: null,
  profileId: 'falcon-a1-pro',
  bedWidth: 400,
  bedHeight: 400,
  originCorner: 'front-left',
  compiledTicketId: 't-1',
};

// 1. Same inputs → same key (deterministic)
{
  const k1 = computeFrameFreshnessKey(baseline);
  const k2 = computeFrameFreshnessKey({ ...baseline });
  assert(k1 === k2, 'identical inputs produce identical key');
}

// 2. startMode change → different key
{
  const k1 = computeFrameFreshnessKey(baseline);
  const k2 = computeFrameFreshnessKey({ ...baseline, startMode: 'current' });
  assert(k1 !== k2, 'startMode change → key change');
}

// 3. savedOrigin numeric change → different key
{
  const k1 = computeFrameFreshnessKey({ ...baseline, savedOriginX: 50, savedOriginY: 100 });
  const k2 = computeFrameFreshnessKey({ ...baseline, savedOriginX: 51, savedOriginY: 100 });
  assert(k1 !== k2, 'savedOriginX change → key change');
  const k3 = computeFrameFreshnessKey({ ...baseline, savedOriginX: 50, savedOriginY: 101 });
  assert(k1 !== k3, 'savedOriginY change → key change');
}

// 4. profileId change → different key
{
  const k1 = computeFrameFreshnessKey(baseline);
  const k2 = computeFrameFreshnessKey({ ...baseline, profileId: 'sculpfun-s9' });
  assert(k1 !== k2, 'profileId change → key change');
}

// 5. bedWidth / bedHeight change → different key
{
  const k1 = computeFrameFreshnessKey(baseline);
  const k2 = computeFrameFreshnessKey({ ...baseline, bedWidth: 300 });
  assert(k1 !== k2, 'bedWidth change → key change');
  const k3 = computeFrameFreshnessKey({ ...baseline, bedHeight: 300 });
  assert(k1 !== k3, 'bedHeight change → key change');
}

// 6. originCorner change → different key
{
  const k1 = computeFrameFreshnessKey(baseline);
  const k2 = computeFrameFreshnessKey({ ...baseline, originCorner: 'rear-left' });
  assert(k1 !== k2, 'originCorner change → key change');
}

// 7. compiledTicketId change → different key
{
  const k1 = computeFrameFreshnessKey(baseline);
  const k2 = computeFrameFreshnessKey({ ...baseline, compiledTicketId: 't-2' });
  assert(k1 !== k2, 'compiledTicketId change → key change');
}

// 8. Recompile producing same ticket id → no key change (stable cache hit)
{
  const k1 = computeFrameFreshnessKey(baseline);
  const k2 = computeFrameFreshnessKey({ ...baseline, compiledTicketId: 't-1' });
  assert(k1 === k2, 'same compiledTicketId → key unchanged (stable across re-renders)');
}

// 9. null savedOrigin produces stable key (no NaN/undefined leakage)
{
  const k1 = computeFrameFreshnessKey({ ...baseline, savedOriginX: null, savedOriginY: null });
  const k2 = computeFrameFreshnessKey({ ...baseline, savedOriginX: null, savedOriginY: null });
  assert(k1 === k2, 'null savedOrigin produces stable repeatable key');
  assert(typeof k1 === 'string' && k1.length > 0, 'key is a non-empty string');
}

// 10. Floating-point noise within 1µm does NOT bust the key
{
  const k1 = computeFrameFreshnessKey({ ...baseline, bedWidth: 400 });
  const k2 = computeFrameFreshnessKey({ ...baseline, bedWidth: 400.0000001 });
  assert(k1 === k2,
    'sub-µm floating-point noise on bedWidth does NOT change the key (FP-import resilience)');
}

// 11. NaN bedWidth coerces to a stable token (not Object Object / dynamic)
{
  const k1 = computeFrameFreshnessKey({ ...baseline, bedWidth: NaN });
  const k2 = computeFrameFreshnessKey({ ...baseline, bedWidth: NaN });
  assert(k1 === k2, 'NaN bedWidth produces stable key (no toString divergence)');
}

// 12. All four origin corners produce four distinct keys
{
  const corners = ['front-left', 'rear-left', 'front-right', 'rear-right'] as const;
  const keys = new Set(corners.map(c => computeFrameFreshnessKey({ ...baseline, originCorner: c })));
  assert(keys.size === 4, 'each of the four origin corners produces a distinct key');
}

// 13. Source-level pin: ConnectionPanelMain wires the helper + invalidation effect
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));

  const helperSrc = fs.readFileSync(
    path.resolve(here, '../src/app/computeFrameFreshnessKey.ts'),
    'utf-8',
  );
  assert(/T2-60/.test(helperSrc), 'T2-60 marker in computeFrameFreshnessKey.ts');
  assert(/export function computeFrameFreshnessKey/.test(helperSrc),
    'computeFrameFreshnessKey function exported');
  assert(/export interface FrameFreshnessInputs/.test(helperSrc),
    'FrameFreshnessInputs interface exported');

  const panelSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'),
    'utf-8',
  );
  assert(/T2-60/.test(panelSrc), 'T2-60 marker in ConnectionPanelMain.tsx');
  assert(/import \{ computeFrameFreshnessKey \}/.test(panelSrc),
    'computeFrameFreshnessKey imported in ConnectionPanelMain');
  assert(/const frameFreshnessKey = computeFrameFreshnessKey\(/.test(panelSrc),
    'frameFreshnessKey computed via helper');
  assert(/lastFrameKeyRef = useRef<string \| null>\(null\)/.test(panelSrc),
    'lastFrameKeyRef state declared');
  assert(/hasFramed\.current = false;[\s\S]{0,120}setWorkflowVersion/.test(panelSrc),
    'hasFramed reset + workflowVersion bump on key change');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
