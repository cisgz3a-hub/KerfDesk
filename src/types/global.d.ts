/**
 * T1-72: Vite-injected build-time app version.
 *
 * Defined in vite.config.ts from package.json.version. Code that can run
 * outside Vite, such as tsx tests, must guard with typeof before reading.
 */
declare const __APP_VERSION__: string;

/**
 * T1-112: Vite-injected build stamp (short git commit hash + ISO build
 * time). Rendered by `src/ui/components/BuildStamp.tsx` so testers can
 * read which commit is loaded directly off the canvas — primary defense
 * against the silent stale-deployment trap that masked T1-111. Falls back
 * to `'dev'` and the current ISO time when not in a git tree. Same
 * `typeof` guard rule as `__APP_VERSION__` for tsx tests.
 */
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;
