# Karpathy Stage 1E Evidence - Electron Permission, Navigation, And Serial Trust

Date: 2026-06-03

## Finding

- `KF-021`: Electron serial/filesystem permissions were granted by permission name
  or device type only, without tying the request to the trusted LaserForge
  renderer origin or main frame. The Electron window also did not install
  explicit navigation or `window.open` guards.

## Red Proof

Command:

```powershell
corepack pnpm test electron/trusted-renderer-policy.test.ts
```

Initial result:

- Failed before the policy module existed: `Failed to resolve import
  "./trusted-renderer-policy"`.

After adding a skeletal policy that matched the previous unsafe behavior, the
same command failed with the intended behavior assertions:

- External navigation was allowed: expected `http://localhost:5174/...` to be
  denied.
- Permission checks from `https://evil.example` were allowed.
- Permission requests from subframes or untrusted URLs were allowed.
- Serial device permission for an untrusted origin was allowed.
- Renderer `window.open()` was allowed.
- `electron/main.ts` lacked trusted-origin permission and navigation wiring.

## Fix

- Added `electron/trusted-renderer-policy.ts`.
- Trusted renderer origins are limited to:
  - packaged app origin: `app://app`
  - configured `LASERFORGE_DEV_URL` origin, when valid.
- Permission checks now require:
  - permission is `serial` or starts with `fileSystem`
  - requesting origin is trusted
  - current `webContents` URL is trusted
  - embedding origin, when present, is trusted.
- Permission requests now additionally require `isMainFrame === true`.
- Serial device grants now require a trusted origin.
- Renderer navigation is blocked unless the target URL is trusted.
- Renderer-created windows are denied by default.
- `electron/main.ts` installs the navigation policy before loading the renderer.

## Green Verification

Commands:

```powershell
corepack pnpm test electron/trusted-renderer-policy.test.ts
corepack pnpm test electron/trusted-renderer-policy.test.ts electron/serial-port-choice.test.ts electron/csp-policy.test.ts
corepack pnpm run lint:electron
corepack pnpm run build:electron-main
corepack pnpm test src/ui/state/laser-store.test.ts src/ui/state/laser-line-handler.test.ts src/ui/state/autofocus-action.test.ts src/core/devices/machine-bounds.test.ts src/core/preflight/preflight.test.ts src/core/job/frame-preflight.test.ts src/core/job/job-origin.test.ts src/io/gcode/emit-gcode.test.ts src/ui/laser/start-job-readiness.test.ts src/ui/laser/JobControls.test.tsx src/ui/laser/LaserWindow.test.tsx src/platform/web/web-serial.test.ts electron/trusted-renderer-policy.test.ts electron/serial-port-choice.test.ts electron/csp-policy.test.ts
corepack pnpm run typecheck
corepack pnpm run lint
git diff --check
```

Results:

- `electron/trusted-renderer-policy.test.ts`: 6 tests passed.
- Electron focused tests: 3 files passed, 11 tests passed.
- `lint:electron`: passed.
- `build:electron-main`: passed.
- Combined Stage 1 focused suite: 15 files passed, 98 tests passed.
- `typecheck`: passed.
- Root `lint`: passed with the existing `boundaries/dependencies` v6 migration
  warning.
- `git diff --check`: passed.

## Remaining Hardware/Runtime Proof

- No physical device is required for this policy unit/build proof.
- A desktop smoke test should still be run before release: launch Electron with
  the packaged app origin and dev-server origin, confirm Web Serial still opens
  the explicit chooser, and confirm external navigation attempts are blocked.
