/**
 * T1-185 (internal audit F-034 + F-048): replace untyped `any` with
 * proper types where possible; document the `any` that bridges
 * incompatible DOM libraries.
 *
 * Three call sites the audit flagged:
 *
 *   1. `src/geometry/hit-test.ts:227` — `pathSegmentsToPoints(segments: any[])`.
 *      The discriminated `PathSegment` union from `SceneObject.ts`
 *      types every branch of the switch; `any[]` was lazy.
 *      → Typed as `readonly PathSegment[]`.
 *
 *   2. `src/import/svg/SvgUnitChoice.ts:110` — `let doc: any;`.
 *      The function only walks Document via `getElementsByTagName`
 *      and `getAttribute` (lib.dom + xmldom intersection), so a
 *      try-return pattern lets TS infer the success-path Document.
 *      → Replaced with an IIFE that returns null on parse failure
 *        and narrows `doc` to its inferred Document on success.
 *
 *   3. `src/import/svg/SvgParser.ts:96` — `let doc: any;`.
 *      Unlike SvgUnitChoice, this file passes `svgRoot` (an Element)
 *      to internal walkers (`collectUnsupportedFeatures`,
 *      `traverse`) typed against lib.dom Element. The xmldom Element
 *      from the test-environment DOMParser is structurally
 *      incompatible with lib.dom Element (lib.dom Element has
 *      `classList`/`clientHeight`/etc that xmldom omits). The `any`
 *      here documents that real type-system limitation — it's not a
 *      sloppy cast, it's a deliberate bridge between two DOM libs.
 *      → Kept as `any` with a doc comment. T1-234 removed the stale eslint-disable line because no-explicit-any is not enabled.
 *
 * Run: npx tsx tests/any-cast-cleanup.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));

console.log('\n=== T1-185 any-cast cleanup (audit F-034 + F-048) ===\n');

// -------- 1. hit-test.ts: pathSegmentsToPoints uses PathSegment[] --------
{
  const src = readFileSync(resolve(here, '../src/geometry/hit-test.ts'), 'utf-8');
  assert(/T1-185/.test(src), 'hit-test.ts carries T1-185 marker');
  assert(/audit F-034/.test(src), 'hit-test.ts cross-references audit F-034');
  assert(
    /pathSegmentsToPoints\(segments:\s*readonly PathSegment\[\]\)/.test(src),
    'pathSegmentsToPoints typed as `readonly PathSegment[]` (not any[])',
  );
  assert(
    /import\s*\{[\s\S]{0,200}type PathSegment[\s\S]{0,200}\}\s*from\s*['"]\.\.\/core\/scene\/SceneObject['"]/.test(src),
    'PathSegment type imported from SceneObject',
  );
  assert(
    !/pathSegmentsToPoints\(segments:\s*any\[\]\)/.test(src),
    'pre-T1-185 `segments: any[]` signature is gone',
  );
}

// -------- 2. SvgUnitChoice.ts: try-return pattern, no `let doc: any` --------
{
  const src = readFileSync(resolve(here, '../src/import/svg/SvgUnitChoice.ts'), 'utf-8');
  assert(/T1-185/.test(src), 'SvgUnitChoice.ts carries T1-185 marker');
  assert(/audit F-048/.test(src), 'SvgUnitChoice.ts cross-references audit F-048');
  // The pre-T1-185 `let doc: any;` is gone — strip line comments
  // first so the doc block's mention of the old line doesn't false-
  // positive the check.
  const srcNoLineComments = src
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n');
  assert(
    !/let doc:\s*any;/.test(srcNoLineComments),
    'pre-T1-185 `let doc: any;` is gone from SvgUnitChoice (executable code, not comment)',
  );
  // The IIFE pattern is present.
  assert(
    /const doc = \(\(\) => \{[\s\S]{0,400}new DOMParser\(\)\.parseFromString/.test(src),
    'SvgUnitChoice uses the try-return IIFE pattern with DOMParser',
  );
}

// -------- 3. SvgParser.ts: `any` kept but DOCUMENTED --------
{
  const src = readFileSync(resolve(here, '../src/import/svg/SvgParser.ts'), 'utf-8');
  assert(/T1-185/.test(src), 'SvgParser.ts carries T1-185 marker');
  assert(/audit F-048/.test(src), 'SvgParser.ts cross-references audit F-048');
  // The `any` remains documented, but T1-234 removed the unused
  // eslint-disable directive because no-explicit-any is not enabled.
  assert(
    !/eslint-disable-next-line @typescript-eslint\/no-explicit-any/.test(src),
    'SvgParser.ts no longer carries an unused no-explicit-any disable',
  );
  assert(
    /xmldom|@xmldom\/xmldom/.test(src),
    'SvgParser.ts comment names xmldom (the polyfill creating the conflict)',
  );
  assert(
    /classList|clientHeight/.test(src),
    'SvgParser.ts comment names a property the two Element types disagree on',
  );
  // The retained `any` still exists (intentionally).
  assert(
    /let doc:\s*any;/.test(src),
    'SvgParser.ts retains `let doc: any;` (deliberate bridge)',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
