# Karpathy Stage 4C - Lazy Import Retry

Finding: `KF-028`

Status: closure-proven.

## Root Cause

The trace and text loaders cached their first dynamic import promise in module-level variables:

- `src/core/trace/trace-image.ts` -> ImageTracer SVG-string path
- `src/core/trace/trace-to-paths.ts` -> ImageTracer tracedata path
- `src/core/text/text-to-polylines.ts` -> OpenType text path

If the first dynamic import rejected because a browser/worker could not fetch or evaluate the chunk, the rejected promise stayed cached for the whole session. Later calls reused the same rejection instead of retrying.

## Red Proof

Added failing tests before implementation:

- `traceImageToSvgString`: first mocked `imagetracerjs` import rejects, second call should retry and return SVG.
- `traceImageToColoredPaths`: first mocked `imagetracerjs` tracedata import rejects, second call should retry and return `[]`.
- `textToPolylines`: first mocked `opentype.js` import rejects, second call should retry and return an empty text render result.

Red command:

```text
corepack pnpm test src/core/trace/trace-image.test.ts src/core/trace/trace-to-paths.test.ts src/core/text/text-to-polylines.test.ts
```

Red result:

```text
3 failed, 42 passed
```

The failing assertions were the second-call `resolves` expectations; each still rejected with the first cached dynamic-import failure.

## Fix

Each lazy loader now clears its cached promise on rejection before rethrowing:

```text
.catch((error: unknown) => {
  cachedPromise = null;
  throw error;
})
```

This preserves successful import caching while allowing the next user action to retry after a transient chunk/network/evaluation failure.

## Verification

Focused green:

```text
corepack pnpm test src/core/trace/trace-image.test.ts src/core/trace/trace-to-paths.test.ts src/core/text/text-to-polylines.test.ts
```

Result:

```text
3 files, 45 tests passed
```

Broader trace/text suite:

```text
corepack pnpm test src/core/trace src/core/text
```

Result:

```text
19 files, 159 tests passed
```

Gates:

```text
corepack pnpm run typecheck
corepack pnpm run lint
git diff --check
```

Results:

- Typecheck passed.
- Lint passed with the known boundaries legacy selector warning.
- `git diff --check` passed.
