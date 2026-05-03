/**
 * T1-72: Vite-injected build-time app version.
 *
 * Defined in vite.config.ts from package.json.version. Code that can run
 * outside Vite, such as tsx tests, must guard with typeof before reading.
 */
declare const __APP_VERSION__: string;
