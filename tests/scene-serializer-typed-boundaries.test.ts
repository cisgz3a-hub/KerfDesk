/**
 * T1-190 (internal audit F-036): SceneSerializer's `any` cluster
 * cleanup. The audit counted 10 `any` casts in SceneSerializer; T1-190
 * tightens the function-boundary types where possible AND documents
 * the remaining `any` as deliberate disk-shape ↔ in-memory-shape
 * boundary annotations.
 *
 * Cleanup categories:
 *
 *   1. `parseSceneEnvelope` return: `any` → `Record<string, unknown>`.
 *      Body uses `unknown` for the JSON.parse result and narrows via
 *      `typeof === 'object'` before casting to `Record<string, unknown>`.
 *
 *   2. `stripObjectCache` return: `any` → `Omit<SceneObject,
 *      '_bounds' | '_worldTransform'>`. Precise omit-type matches
 *      what the function actually returns.
 *
 *   3. Inline `(l: any)` / `(o: any)` map callbacks: cast the source
 *      through `unknown[]` first so the `any` annotation is the
 *      documented disk-shape boundary, not a sloppy widening.
 *
 *   4. `buildSceneFromParsedEnvelope`, `restoreLayerDefaults`,
 *      `restoreObjectDefaults`, `encodeImageBuffers`, `decodeImageBuffers`:
 *      KEEP `any` with documenting comments naming F-036 and explaining why
 *      the boundary is structurally `any` (file-format flexibility,
 *      partial / malformed shape tolerance). T1-234 removed the stale
 *      no-explicit-any disable comments because that rule is not enabled.
 *
 * Run: npx tsx tests/scene-serializer-typed-boundaries.test.ts
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

console.log('\n=== T1-190 SceneSerializer typed boundaries (audit F-036) ===\n');

const src = readFileSync(resolve(here, '../src/io/SceneSerializer.ts'), 'utf-8');

// -------- 1. T1-190 marker present --------
{
  assert(/T1-190/.test(src), 'SceneSerializer.ts carries T1-190 marker');
  assert(/audit F-036/.test(src), 'SceneSerializer.ts cross-references audit F-036');
}

// -------- 2. parseSceneEnvelope return is typed --------
{
  assert(
    /function parseSceneEnvelope\(json: string\): Record<string, unknown>/.test(src),
    'parseSceneEnvelope returns Record<string, unknown> (not any)',
  );
  assert(
    /let parsed: unknown;/.test(src),
    'JSON.parse result is typed as unknown',
  );
  assert(
    /const envelope = parsed as Record<string, unknown>;/.test(src),
    'envelope narrowed via cast after typeof check',
  );
}

// -------- 3. stripObjectCache return is typed --------
{
  assert(
    /function stripObjectCache\(obj: SceneObject\): Omit<SceneObject, '_bounds' \| '_worldTransform'>/.test(src),
    'stripObjectCache return typed as Omit<SceneObject, ...>',
  );
}

// -------- 4. Inline map callbacks cast through unknown[] --------
{
  assert(
    /\(s\.layers as unknown\[\]\)\.map\(\(l: any\)/.test(src),
    's.layers map callback casts through unknown[] before the any boundary',
  );
  assert(
    /\(s\.objects as unknown\[\]\)\.map\(\(o: any\)/.test(src),
    's.objects map callback casts through unknown[]',
  );
}

// -------- 5. Each remaining `any` is documented --------
{
  // Find every `: any` and check nearby comments still explain why the
  // boundary is intentional. T1-234 removes stale eslint disables, but it
  // does not remove the rationale that made the remaining any safe to keep.
  const lines = src.split('\n');
  const undocumentedAny: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match `: any` only in executable code (skip lines that are entirely a comment).
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (!/:\s*any(\b|<)/.test(line)) continue;
    // Skip lines where `any` is in a string literal.
    if (/['"`].*:\s*any.*['"`]/.test(line)) continue;
    const windowStart = Math.max(0, i - 12);
    const windowEnd = Math.min(lines.length, i + 3);
    const nearby = lines.slice(windowStart, windowEnd).join('\n');
    if (!/(T1-190|F-036|disk-shape|file-format|partial \/ malformed|unknown\[\])/.test(nearby)) {
      undocumentedAny.push(`line ${i + 1}: ${trimmed}`);
    }
  }
  assert(
    undocumentedAny.length === 0,
    `every executable-code \`any\` has nearby rationale (undocumented: ${undocumentedAny.join('; ')})`,
  );
}

// -------- 6. stale no-explicit-any disables are gone --------
{
  const disableCount = (src.match(/eslint-disable-next-line.*no-explicit-any/g) ?? []).length;
  assert(disableCount === 0, `no stale no-explicit-any disables remain (got ${disableCount})`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
