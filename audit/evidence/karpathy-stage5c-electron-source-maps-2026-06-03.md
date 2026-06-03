# Karpathy Stage 5C - Electron Source Maps

Finding: `KF-022`

## Root Cause

`electron/tsconfig.json` emitted source maps for the Electron main process, and `electron-builder.yml` packaged all of `dist-electron/**/*`. A reused build directory could therefore ship `main.js.map`, `serial-port-choice.js.map`, or other main-process maps in the Windows app.

## Red Proof

Command:

```text
corepack pnpm test electron/source-map-policy.test.ts
```

Result before fix:

```text
3 failed
- expected Electron tsconfig sourceMap true to be false
- missing !dist-electron/**/*.map packaging exclusion
- build:electron-main did not clean generated Electron output before tsc
```

Direct pre-fix artifact inspection also showed:

```text
dist-electron/main.js.map
dist-electron/serial-port-choice.js.map
dist-electron/trusted-renderer-policy.js.map
```

## Fix

- `electron/tsconfig.json` now sets `"sourceMap": false`.
- `electron-builder.yml` excludes `!dist-electron/**/*.map` as packaging defense in depth.
- `scripts/clean-electron-output.mjs` removes only `dist-electron` before compiling.
- `package.json` runs the cleaner before `tsc --project electron/tsconfig.json`.
- `electron/source-map-policy.test.ts` pins all three policy points.

## Verification

```text
corepack pnpm test electron/source-map-policy.test.ts
corepack pnpm test electron
corepack pnpm run build:electron-main
```

Passed. Final `dist-electron` contents:

```text
main.js
serial-port-choice.js
trusted-renderer-policy.js
```

Search proof:

```text
rg -n 'sourceMappingURL|\.js\.map$' dist-electron electron-builder.yml electron\tsconfig.json package.json
```

No matches.

Additional gates:

```text
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run lint:electron
corepack pnpm run format:check
git diff --check
```

All passed. `lint` still prints the known `eslint-plugin-boundaries` legacy selector warning and exits 0.

## Remaining Risk

This prevents Electron main-process maps from being emitted or packaged. It does not generate hidden maps for crash-symbolication; that can be added later if desktop crash reporting is introduced.
