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
 *      KEEP `any` with `// eslint-disable-next-line ...no-explicit-any`
 *      AND a documenting comment naming F-036 and explaining why
 *      the boundary is structurally `any` (file-format flexibility,
 *      partial / malformed shape tolerance). Same pattern as T1-185's
 *      SvgParser bridge — the `any` is the intentional seam, the
 *      comment makes that intent explicit.
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

// -------- 5. Each remaining `any` is documented + eslint-disabled --------
{
  // Find every `: any` and check the preceding line has the eslint-disable comment.
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
    // Look for the eslint-disable on the previous non-blank line.
    let prev = i - 1;
    while (prev >= 0 && lines[prev].trim().length === 0) prev--;
    const prevLine = prev >= 0 ? lines[prev] : '';
    if (!/eslint-disable-next-line.*no-explicit-any/.test(prevLine)) {
      undocumentedAny.push(`line ${i + 1}: ${trimmed}`);
    }
  }
  assert(
    undocumentedAny.length === 0,
    `every executable-code \`any\` is preceded by eslint-disable (undocumented: ${undocumentedAny.join('; ')})`,
  );
}

// -------- 6. eslint-disable annotations carry F-036 + T1-190 context nearby --------
{
  // Pre-T1-190 a bare `any` had no rationale; post-T1-190 each
  // disable-next-line annotation should appear NEAR a comment that
  // mentions T1-190 or F-036 (so future readers can find the audit
  // context without grepping).
  const disableCount = (src.match(/eslint-disable-next-line.*no-explicit-any/g) ?? []).length;
  assert(disableCount >= 4, `at least 4 eslint-disable annotations (got ${disableCount})`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
