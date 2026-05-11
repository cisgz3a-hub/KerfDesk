/**
 * T1-152: regression test for the WCS-consent classifier after
 * extraction from GrblController. The classifier was already pure +
 * exported as T1-117; this test pins the module move + verifies the
 * existing contracts haven't shifted.
 *
 * Run: npx tsx tests/grbl-wcs-consent-classifier.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyWcsConsentInputs,
  type WcsConsentVerdict,
} from '../src/controllers/grbl/GrblWcsConsentClassifier';
// Re-import via the GrblController public surface to verify the
// re-export still works for legacy import paths.
import {
  classifyWcsConsentInputs as classifyViaController,
} from '../src/controllers/grbl/GrblController';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T1-152 GRBL WCS consent classifier ===\n');

// -------- Public-surface re-export --------
{
  assert(classifyWcsConsentInputs === classifyViaController,
    'GrblController re-export is the same function reference');
}

// -------- verified-zero --------
{
  const r = classifyWcsConsentInputs({ x: 0, y: 0, z: 0 }, '0');
  assert(r.kind === 'verified-zero', 'G54=0,0,0 + $10=0 → verified-zero');
}

// -------- verified-zero within tolerance --------
{
  const r = classifyWcsConsentInputs({ x: 0.0001, y: 0.0001, z: 0 }, '0');
  assert(r.kind === 'verified-zero',
    'G54 within 0.0005 tolerance → verified-zero');
}

// -------- verified-nonzero (G54 != 0) --------
{
  const r = classifyWcsConsentInputs({ x: 10, y: 0, z: 0 }, '0');
  assert(r.kind === 'verified-nonzero', 'G54=10,0,0 → verified-nonzero');
  if (r.kind === 'verified-nonzero') {
    assert(r.g54?.x === 10, 'verdict carries g54');
    assert(r.statusMask === 0, 'verdict carries statusMask');
  }
}

// -------- verified-nonzero (statusMask != 0) --------
{
  const r = classifyWcsConsentInputs({ x: 0, y: 0, z: 0 }, '1');
  assert(r.kind === 'verified-nonzero', 'G54=0 + $10=1 → verified-nonzero');
}

// -------- unknown: missing G54 --------
{
  const r = classifyWcsConsentInputs(null, '0');
  assert(r.kind === 'unknown', 'null G54 → unknown');
  if (r.kind === 'unknown') {
    assert(r.reason === 'missing_g54',
      'reason = missing_g54 (G54 wins over status-mask gate)');
  }
}

// -------- unknown: malformed G54 (NaN) --------
{
  const r = classifyWcsConsentInputs({ x: NaN, y: 0, z: 0 }, '0');
  assert(r.kind === 'unknown' && r.reason === 'malformed_g54',
    'NaN x in G54 → malformed_g54');
}
{
  const r = classifyWcsConsentInputs({ x: 0, y: Infinity, z: 0 }, '0');
  assert(r.kind === 'unknown' && r.reason === 'malformed_g54',
    'Infinity y in G54 → malformed_g54');
}

// -------- unknown: missing status mask --------
{
  const r = classifyWcsConsentInputs({ x: 0, y: 0, z: 0 }, null);
  assert(r.kind === 'unknown' && r.reason === 'missing_status_mask',
    'null statusMask → missing_status_mask');
}

// -------- unknown: malformed status mask --------
{
  const r = classifyWcsConsentInputs({ x: 0, y: 0, z: 0 }, 'bogus');
  assert(r.kind === 'unknown' && r.reason === 'malformed_status_mask',
    'unparseable statusMask → malformed_status_mask');
}

// -------- G54-cause-first ranking when both reads are missing --------
{
  const r = classifyWcsConsentInputs(null, null);
  assert(r.kind === 'unknown' && r.reason === 'missing_g54',
    'both missing → missing_g54 wins (G54 is the larger risk source)');
}

// -------- Source-level pin: GrblController re-exports --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const ctrlSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/from '\.\/GrblWcsConsentClassifier'/.test(ctrlSrc),
    'GrblController imports from ./GrblWcsConsentClassifier');
  assert(/T1-152/.test(ctrlSrc),
    'GrblController carries T1-152 marker');
  assert(/export \{ classifyWcsConsentInputs \}/.test(ctrlSrc),
    'GrblController re-exports classifyWcsConsentInputs');
  // The inline classifier function is gone
  assert(!/^export function classifyWcsConsentInputs/m.test(ctrlSrc),
    'inline classifyWcsConsentInputs function definition is gone');

  const helperSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblWcsConsentClassifier.ts'),
    'utf-8',
  );
  assert(/T1-152/.test(helperSrc),
    'GrblWcsConsentClassifier carries T1-152 marker');
  assert(/export function classifyWcsConsentInputs/.test(helperSrc),
    'classifyWcsConsentInputs is exported from the helper');
  // Reason union still defined
  assert(/missing_g54.*malformed_g54.*missing_status_mask.*malformed_status_mask/s.test(helperSrc),
    'WcsUncertainReason union members present');
}

// Use the verdict type to make sure it's exported (compile-time check)
const _check: WcsConsentVerdict = { kind: 'verified-zero' };
void _check;

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
