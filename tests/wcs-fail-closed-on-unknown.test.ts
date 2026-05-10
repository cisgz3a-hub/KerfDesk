/**
 * T1-117: WCS verification must fail closed when state is unknown.
 *
 * Pre-T1-117 `_emitWcsConsentNeeded` had:
 *
 *   const parsed = maskRaw != null ? parseInt(maskRaw, 10) : 0;
 *   const mask = Number.isFinite(parsed) ? parsed : 0;
 *   const g54IsZero = g54
 *     ? Math.abs(g54.x) < 0.0005 && Math.abs(g54.y) < 0.0005 && Math.abs(g54.z) < 0.0005
 *     : true;
 *
 * which conflated "verified zero" with "unknown, defaulted to zero":
 *   - missing $10 → mask=0
 *   - malformed $10 parse → mask=0
 *   - missing [G54:...] line (so _currentG54 stays null because
 *     _tryParseG54WcsLine only assigns when every coord is finite) →
 *     g54IsZero=true
 * combined → applyWcsNormalization() ran silently, rewriting G54 and
 * $10 the user may have wanted to preserve.
 *
 * Post-T1-117 the verification routes through
 * classifyWcsConsentInputs(g54, statusMaskRaw) which returns a
 * discriminated union: 'verified-zero' | 'verified-nonzero' |
 * 'unknown'. Only 'verified-zero' triggers auto-normalize. 'unknown'
 * sets `_placementUncertain = true` plus a specific
 * `WcsUncertainReason` accessible via getPlacementUncertainReason().
 *
 * Run: npx tsx tests/wcs-fail-closed-on-unknown.test.ts
 */
import { classifyWcsConsentInputs } from '../src/controllers/grbl/GrblController';

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

console.log('\n=== T1-117 classifyWcsConsentInputs: fail closed on unknown ===\n');

// -------- VERIFIED-ZERO: both reads explicit baseline --------
{
  const v = classifyWcsConsentInputs({ x: 0, y: 0, z: 0 }, '0');
  assert(v.kind === 'verified-zero',
    'G54=0,0,0 + $10="0" → verified-zero (auto-normalize allowed)');
}

// -------- VERIFIED-ZERO: tiny float jitter under tolerance --------
{
  const v = classifyWcsConsentInputs({ x: 0.0001, y: -0.0002, z: 0 }, '0');
  assert(v.kind === 'verified-zero',
    'G54 within 0.0005mm of zero counts as baseline');
}

// -------- VERIFIED-NONZERO: G54 has a real offset --------
{
  const v = classifyWcsConsentInputs({ x: 100, y: 50, z: 0 }, '0');
  assert(v.kind === 'verified-nonzero',
    'G54=(100,50,0) + $10=0 → verified-nonzero (consent prompt)');
  if (v.kind === 'verified-nonzero') {
    assert(v.g54?.x === 100 && v.g54?.y === 50,
      'verified-nonzero verdict carries the G54 payload');
    assert(v.statusMask === 0, 'verified-nonzero verdict carries the status mask');
  }
}

// -------- VERIFIED-NONZERO: $10 has a non-baseline mask --------
{
  const v = classifyWcsConsentInputs({ x: 0, y: 0, z: 0 }, '255');
  assert(v.kind === 'verified-nonzero',
    'G54=0,0,0 + $10=255 → verified-nonzero (consent prompt)');
  if (v.kind === 'verified-nonzero') {
    assert(v.statusMask === 255, 'verified-nonzero verdict carries the parsed mask');
  }
}

// -------- UNKNOWN: missing G54 line --------
{
  const v = classifyWcsConsentInputs(null, '0');
  assert(v.kind === 'unknown', 'g54 === null → unknown');
  if (v.kind === 'unknown') {
    assert(v.reason === 'missing_g54',
      `reason='missing_g54' (got '${v.reason}')`);
  }
}

// -------- UNKNOWN: malformed G54 (NaN coordinate) --------
// _tryParseG54WcsLine only assigns _currentG54 when every coord is
// finite, so a malformed [G54:bad,bad,bad] response leaves
// _currentG54 === null at the call site → 'missing_g54'. The
// 'malformed_g54' branch covers a defensive case where some other
// code path produces a partially-NaN object — pin it explicitly so
// the classifier remains correct if the parser changes.
{
  const v = classifyWcsConsentInputs({ x: NaN, y: 0, z: 0 }, '0');
  assert(v.kind === 'unknown', 'NaN G54 coord → unknown');
  if (v.kind === 'unknown') {
    assert(v.reason === 'malformed_g54',
      `reason='malformed_g54' (got '${v.reason}')`);
  }
}

{
  const v = classifyWcsConsentInputs({ x: 0, y: Infinity, z: 0 }, '0');
  assert(v.kind === 'unknown', 'Infinity G54 coord → unknown');
  if (v.kind === 'unknown') {
    assert(v.reason === 'malformed_g54', 'Infinity classified as malformed');
  }
}

// -------- UNKNOWN: missing $10 setting --------
{
  const v = classifyWcsConsentInputs({ x: 0, y: 0, z: 0 }, null);
  assert(v.kind === 'unknown', 'statusMaskRaw === null → unknown');
  if (v.kind === 'unknown') {
    assert(v.reason === 'missing_status_mask',
      `reason='missing_status_mask' (got '${v.reason}')`);
  }
}

// -------- UNKNOWN: malformed $10 parse --------
{
  const v = classifyWcsConsentInputs({ x: 0, y: 0, z: 0 }, 'bogus');
  assert(v.kind === 'unknown', 'malformed mask string → unknown');
  if (v.kind === 'unknown') {
    assert(v.reason === 'malformed_status_mask',
      `reason='malformed_status_mask' (got '${v.reason}')`);
  }
}

{
  const v = classifyWcsConsentInputs({ x: 0, y: 0, z: 0 }, '');
  assert(v.kind === 'unknown', 'empty mask string → unknown');
  if (v.kind === 'unknown') {
    assert(v.reason === 'malformed_status_mask',
      'empty string parses to NaN → malformed_status_mask');
  }
}

// -------- UNKNOWN: G54 missing wins over $10 missing --------
// The classifier surfaces the G54 cause first because that's the
// larger source of risk (missing G54 + verified-baseline mask still
// risks overwriting a workspace offset the user actually set).
{
  const v = classifyWcsConsentInputs(null, null);
  assert(v.kind === 'unknown' && v.reason === 'missing_g54',
    'when both reads are missing, G54 cause is reported first (it carries more risk)');
}

// -------- INTEGRATION: sticky $10 numeric strings parse --------
// GRBL emits $10 values like '0', '1', '255', '511'. Pin a few
// non-baseline integers to guard against future regex / parse drift.
{
  for (const raw of ['1', '15', '255', '511']) {
    const v = classifyWcsConsentInputs({ x: 0, y: 0, z: 0 }, raw);
    assert(v.kind === 'verified-nonzero' && v.statusMask === parseInt(raw, 10),
      `$10='${raw}' parses to ${parseInt(raw, 10)} via verified-nonzero`);
  }
}

// -------- Source-level pin --------
{
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const url = require('node:url') as typeof import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/T1-117/.test(src), 'GrblController.ts carries T1-117 marker');
  assert(/_lastPlacementUncertainReason/.test(src),
    '_lastPlacementUncertainReason field declared');
  assert(/getPlacementUncertainReason/.test(src),
    'getPlacementUncertainReason accessor declared');
  assert(/classifyWcsConsentInputs/.test(src),
    'classifyWcsConsentInputs exported');
  assert(
    !/g54IsZero = g54\s*\?\s*Math\.abs/.test(src),
    'pre-fix ternary `g54 ? <abs check> : true` is gone (replaced by classifier)',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
