/**
 * T2-77: async scene-revision guard prevents long-running scene
 * producers (trace, image import) from erasing user edits made during
 * the await. Pre-T2-77 the trace handler captured `scene` from React
 * closure and committed a `newScene` built from that stale capture
 * after potentially seconds of work — any edits in between vanished.
 *
 * The minimum-viable shape (this commit): refuse the commit when the
 * scene has changed identity, surfacing "scene changed — please retry"
 * via showAlert. The richer apply-to-current vs discard conflict
 * dialog is filed as T2-77-followup.
 *
 * Run: npx tsx tests/async-scene-producer-guards.test.ts
 */
import { captureSceneRevision, isSceneStale } from '../src/ui/hooks/asyncSceneGuard';
import { createScene } from '../src/core/scene/Scene';

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

console.log('\n=== T2-77 async scene-producer guards ===\n');

void (async () => {

// 1. Same scene reference → not stale
{
  const s = createScene(400, 300, 'A');
  const tok = captureSceneRevision(s);
  assert(!isSceneStale(tok, s),
    'identity match: not stale');
}

// 2. Different scene object → stale (the user committed a new scene
//    via the codebase's immutable replacement pattern)
{
  const a = createScene(400, 300, 'A');
  const b = createScene(400, 300, 'B');
  const tok = captureSceneRevision(a);
  assert(isSceneStale(tok, b),
    'different scene reference: stale');
}

// 3. Object with same content but different reference → stale
//    (we want identity-based comparison; the immutable mutation
//    pattern always produces a new object on real edits)
{
  const a = createScene(400, 300, 'A');
  const aClone = { ...a };
  const tok = captureSceneRevision(a);
  assert(isSceneStale(tok, aClone),
    'shallow-cloned scene: stale (identity-based check)');
}

// 4. Capture-then-mutate-then-capture-again: tokens differ
{
  const a = createScene(400, 300, 'A');
  const tok1 = captureSceneRevision(a);
  const b = { ...a };
  const tok2 = captureSceneRevision(b);
  assert(!isSceneStale(tok1, a) && !isSceneStale(tok2, b),
    'each token tracks its own captured scene');
  assert(isSceneStale(tok1, b) && isSceneStale(tok2, a),
    'tokens cross-check correctly (each stale against the other scene)');
}

// 5. Token carries the captured scene reference for debugging
{
  const a = createScene(400, 300, 'A');
  const tok = captureSceneRevision(a);
  assert(tok.scene === a,
    'token.scene === captured scene reference');
}

// 6. Source-level pin: PropertiesPanel uses the guard at the trace
//    boundary
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const helperSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/hooks/asyncSceneGuard.ts'),
    'utf-8',
  );
  assert(/T2-77/.test(helperSrc), 'T2-77 marker in asyncSceneGuard.ts');
  assert(/captureSceneRevision/.test(helperSrc) && /isSceneStale/.test(helperSrc),
    'helper exports both captureSceneRevision and isSceneStale');

  const panelSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/components/PropertiesPanel.tsx'),
    'utf-8',
  );
  assert(/T2-77/.test(panelSrc),
    'T2-77 marker in PropertiesPanel.tsx');
  assert(/captureSceneRevision\(sceneRef\.current\)/.test(panelSrc),
    'handleTrace captures sceneRef.current at start of async work');
  assert(/isSceneStale\(revisionAtStart, sceneRef\.current\)/.test(panelSrc),
    'handleTrace checks isSceneStale before committing');
  assert(/scene changed while the trace was running/i.test(panelSrc),
    'stale-scene path surfaces a clear user message');
}

// 7. Documents that importImageUnified is filed as follow-up (the
//    spec calls out trace + image import; this commit ships trace
//    only). The roadmap doc tracks the followup; we just sanity-check
//    that no other producer accidentally got the guard mid-flight.
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const importSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/hooks/useImport.ts'),
    'utf-8',
  );
  // Image import is intentionally NOT yet wired (T2-77-followup) —
  // pin that the helper isn't half-applied there.
  assert(!/captureSceneRevision/.test(importSrc),
    'useImport.ts does NOT yet use captureSceneRevision (filed as T2-77-followup)');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
