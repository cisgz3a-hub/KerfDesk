# Karpathy Stage 4B - Image-Heavy Autosave Reliability

Finding: `KF-037`

Status: closure-proven for honest degradation and operator warning.

## Root Cause

Autosave serialized the whole project, including embedded raster image `dataUrl` bytes, into one `localStorage` record. `localStorage` quota/storage failures were caught and ignored inside `writeAutosave`, which returned `void`. The React hook therefore had no way to warn that recovery was no longer available.

This could mislead an operator into relying on autosave after importing large images even though no recoverable slot existed.

## Red Proof

Added failing tests before implementation:

- `src/ui/state/autosave.test.ts`
  - `writeAutosave(...)` with `localStorage.setItem` throwing `QuotaExceededError` must return `{ kind: 'failed', reason: 'quota' }`.
  - `startAutosaveLoop(...)` must call a failure callback when a dirty project cannot be autosaved.

- `src/ui/app/use-autosave.test.ts`
  - The app warning reporter must show one warning toast with manual-save guidance and must not spam repeated warnings.

Red command:

```text
corepack pnpm test src/ui/state/autosave.test.ts src/ui/app/use-autosave.test.ts
```

Red result after test isolation fix:

```text
3 failed, 12 passed
```

## Fix

Implemented structured autosave write results:

- `writeAutosave(...)` now returns:
  - `{ kind: 'ok', savedAt }`
  - `{ kind: 'unavailable', reason: 'storage-unavailable' }`
  - `{ kind: 'failed', reason: 'quota' | 'storage-error', error }`

- `startAutosaveLoop(...)` accepts `onWriteFailure` and calls it when a dirty autosave write fails.

- `useAutosave()` now creates a one-shot failure reporter and pushes:

```text
Autosave could not write this project. Save the .lf2 file manually; image-heavy projects can exceed browser storage.
```

The before-unload path also checks the structured result, though browser unload timing may not reliably display a toast. The interval path provides the practical visible warning during editing.

## Verification

Focused green:

```text
corepack pnpm test src/ui/state/autosave.test.ts src/ui/app/use-autosave.test.ts
```

Result:

```text
2 files, 15 tests passed
```

Related app/state suite:

```text
corepack pnpm test src/ui/state/autosave.test.ts src/ui/app/use-autosave.test.ts src/ui/app/file-actions.test.ts src/ui/app/import-toasts.test.ts src/ui/app/shortcuts.test.ts
```

Result:

```text
5 files, 37 tests passed
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

## Remaining Risk

This closes silent autosave failure. It does not move image-heavy autosave payloads out of `localStorage` into IndexedDB. A larger storage lane remains a future improvement if the user wants crash recovery for very large image projects instead of honest manual-save guidance.
