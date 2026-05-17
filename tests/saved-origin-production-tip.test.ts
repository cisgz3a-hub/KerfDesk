/**
 * T3-19: production jobs should recommend Set Origin + saved zero point.
 *
 * Run: npx tsx tests/saved-origin-production-tip.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assertContract(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const root = process.cwd();
const panel = readFileSync(resolve(root, 'src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');
const docsPath = resolve(root, 'docs/PRODUCTION_RUNS.md');
const docs = existsSync(docsPath) ? readFileSync(docsPath, 'utf-8') : '';

console.log('\n=== T3-19 saved-origin production recommendation ===\n');

assertContract(existsSync(docsPath), 'production-run recommendation doc exists');
assertContract(
  /Production runs: prefer Set Origin \+ Use saved zero point/.test(docs),
  'doc states the saved-origin recommendation directly',
);
assertContract(
  /Start from laser head/.test(docs) && /quick one-off jobs/.test(docs),
  'doc keeps head/current mode positioned as useful for quick one-off work',
);
assertContract(
  /CURRENT_MODE_LONG_JOB_TIP_KEY/.test(panel),
  'ConnectionPanelMain declares a one-time current-mode long-job tip key',
);
assertContract(
  /const estimatedSecondsForTip =[\s\S]*estimateJobTime\(gcode\)\.totalSeconds[\s\S]*lastGcodeCompileResult\.machineTransform\.plan\.stats\.estimatedTimeSeconds[\s\S]*startMode === 'current' && \(estimatedSecondsForTip \?\? 0\) > 5 \* 60/.test(panel),
  'start job path detects current-mode jobs longer than five minutes from materialized G-code or spool-backed plan stats',
);
assertContract(
  /showAlert\(\s*'Production positioning tip'[\s\S]*Set Origin[\s\S]*Use saved zero point/.test(panel),
  'long current-mode jobs surface a saved-origin positioning tip',
);
assertContract(
  /localStorage\.getItem\(CURRENT_MODE_LONG_JOB_TIP_KEY\)/.test(panel)
  && /localStorage\.setItem\(CURRENT_MODE_LONG_JOB_TIP_KEY, 'true'\)/.test(panel),
  'tip is one-time through localStorage',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
