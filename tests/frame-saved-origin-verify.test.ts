/**
 * T1-41-followup: pin the saved-origin G54 verification on Frame Safe
 * and Frame Dot, matching the Start handler's behavior. Hardware
 * verification on a Falcon A1 Pro (2026-05-12) demonstrated that a
 * console `G10 L2 P1 X10 Y10` followed by Frame ran the head into the
 * wall — Frame was using the drifted G54 with no check. The original
 * T1-41 ticket explicitly deferred frame-time verify; this slice
 * closes the gap.
 *
 * Behavioral wiring lives in `ConnectionPanelMain.handleFrameSafe` /
 * `handleFrameDot`, which call a new `verifySavedOriginForFrame`
 * useCallback before the bounds-confirmation step. Source-pin
 * approach matches existing `tests/preflight-warning-confirm-includes-detail`
 * and other ConnectionPanelMain pins — mounting the full panel for a
 * behavioral test is disproportionate vs. the contract the source
 * pin guarantees.
 *
 * Run: npx tsx tests/frame-saved-origin-verify.test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;

function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  PASS ${m}`);
  } else {
    failed++;
    console.error(`  FAIL ${m}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const panelSrc = readFileSync(
  resolve(repoRoot, 'src/ui/components/ConnectionPanelMain.tsx'),
  'utf-8',
);

console.log('\n=== T1-41-followup: Frame saved-origin verification ===\n');

void (async () => {
  // 1. The new helper exists with the documented shape.
  {
    assert(
      /verifySavedOriginForFrame\s*=\s*useCallback\s*\(\s*async/.test(panelSrc),
      'Helper: verifySavedOriginForFrame declared as useCallback async',
    );
    assert(
      /T1-41-followup/.test(panelSrc),
      'Helper: T1-41-followup marker present',
    );
  }

  // 2. The helper short-circuits when startMode !== 'savedOrigin'.
  {
    assert(
      /verifySavedOriginForFrame[\s\S]{0,400}?if\s*\(startMode\s*!==\s*['"]savedOrigin['"]\)\s*return\s+true/.test(panelSrc),
      'Helper: returns true early when startMode !== savedOrigin',
    );
  }

  // 3. The helper uses the same getSnapshot + requestWorkOffsets +
  //    verifySavedOriginG54 chain the Start handler uses, so the two
  //    surfaces produce identical verdicts for the same machine
  //    state.
  {
    const helperBlock = panelSrc.match(
      /verifySavedOriginForFrame\s*=\s*useCallback\s*\(\s*async\s*\(\)\s*:\s*Promise<boolean>\s*=>\s*\{([\s\S]*?)^\s*\}\s*,\s*\[/m,
    );
    assert(helperBlock !== null, 'Helper body parses cleanly');
    if (helperBlock) {
      const body = helperBlock[1] ?? '';
      assert(/getSavedOriginG54Snapshot\(\)/.test(body), 'Helper: calls machineService.getSavedOriginG54Snapshot');
      assert(/requestWorkOffsets\(\)/.test(body), 'Helper: calls machineService.requestWorkOffsets');
      assert(/verifySavedOriginG54\(/.test(body), 'Helper: calls verifySavedOriginG54');
      assert(/describeSavedOriginDrift\(/.test(body), 'Helper: surfaces drift detail via describeSavedOriginDrift');
      assert(/showAlert\(/.test(body), 'Helper: shows alert on failure');
      assert(/return\s+false/.test(body), 'Helper: returns false on failure');
    }
  }

  // 4. handleFrameSafe calls the helper before confirmFrameBounds.
  //    Order matters: a drifted G54 surfaces as "saved origin
  //    invalid" not "off-bed bounds".
  {
    const fs = panelSrc.match(
      /const\s+handleFrameSafe\s*=\s*useCallback\s*\(\s*async[\s\S]*?\}\s*,\s*\[[^\]]*\]\)/,
    );
    assert(fs !== null, 'handleFrameSafe useCallback body parses');
    if (fs) {
      const body = fs[0];
      const verifyIdx = body.indexOf('verifySavedOriginForFrame()');
      const boundsIdx = body.indexOf('confirmFrameBounds()');
      assert(verifyIdx > 0, 'handleFrameSafe: calls verifySavedOriginForFrame()');
      assert(boundsIdx > 0, 'handleFrameSafe: calls confirmFrameBounds()');
      assert(verifyIdx < boundsIdx, 'handleFrameSafe: saved-origin verify runs BEFORE bounds confirmation');
    }
  }

  // 5. handleFrameDot has the same call site + ordering.
  {
    const fd = panelSrc.match(
      /const\s+handleFrameDot\s*=\s*useCallback\s*\(\s*async[\s\S]*?\}\s*,\s*\[[^\]]*\]\)/,
    );
    assert(fd !== null, 'handleFrameDot useCallback body parses');
    if (fd) {
      const body = fd[0];
      const verifyIdx = body.indexOf('verifySavedOriginForFrame()');
      const boundsIdx = body.indexOf('confirmFrameBounds()');
      assert(verifyIdx > 0, 'handleFrameDot: calls verifySavedOriginForFrame()');
      assert(boundsIdx > 0, 'handleFrameDot: calls confirmFrameBounds()');
      assert(verifyIdx < boundsIdx, 'handleFrameDot: saved-origin verify runs BEFORE bounds confirmation');
    }
  }

  // 6. Both handlers list verifySavedOriginForFrame in their
  //    useCallback dep arrays — exhaustive-deps would flag a missing
  //    closure capture. The deps array follows the useCallback body
  //    close `}, [...]` after the success-message `setMessages` call.
  {
    const safeDeps = panelSrc.match(
      /'✓ Frame \(Safe\) complete'[\s\S]*?\}\s*,\s*\[([^\]]+)\]\)/,
    );
    assert(safeDeps !== null && /verifySavedOriginForFrame/.test(safeDeps[1] ?? ''), 'handleFrameSafe deps include verifySavedOriginForFrame');

    const dotDeps = panelSrc.match(
      /'✓ Frame \(Laser Dot\) complete'[\s\S]*?\}\s*,\s*\[([^\]]+)\]\)/,
    );
    assert(dotDeps !== null && /verifySavedOriginForFrame/.test(dotDeps[1] ?? ''), 'handleFrameDot deps include verifySavedOriginForFrame');
  }

  // 7. Negative pin: the existing Start-handler block at the
  //    saved-origin verification site stays intact (regression
  //    against accidentally moving its logic into the helper and
  //    breaking Start). The Start handler still has its own
  //    `if (startMode === 'savedOrigin')` block that calls
  //    verifySavedOriginG54.
  {
    const startBlock = panelSrc.match(
      /T1-41:\s*verify saved-origin G54[\s\S]{0,1200}?verifySavedOriginG54\(/,
    );
    assert(startBlock !== null, 'Start handler: T1-41 saved-origin block still present');
  }

  // 8. The pure helper module (T1-41) is unchanged — `verifySavedOriginG54`
  //    + `describeSavedOriginDrift` exports are still in place. This
  //    pins the dependency surface the new Frame caller depends on.
  {
    const helperPure = readFileSync(
      resolve(repoRoot, 'src/app/savedOriginVerify.ts'),
      'utf-8',
    );
    assert(
      /export function verifySavedOriginG54/.test(helperPure),
      'savedOriginVerify.ts: verifySavedOriginG54 exported',
    );
    assert(
      /export function describeSavedOriginDrift/.test(helperPure),
      'savedOriginVerify.ts: describeSavedOriginDrift exported',
    );
  }

  console.log(`\nT1-41-followup: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
