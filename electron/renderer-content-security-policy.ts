// The Content-Security-Policy main puts on every renderer response. The
// packaged app and `pnpm dev:desktop` (which loads the built bundle over
// app://) always get the production policy unchanged.
//
// LASERFORGE_DEV_URL, honoured only in an unpackaged app and only for a
// loopback address, loads the Vite dev server instead. Vite's React plugin
// injects one inline <script> (the React Refresh preamble) into its
// index.html, and every component module refuses to run without it, so under
// the production policy that window stayed blank (ADR-482). Only that dev mode
// adds 'unsafe-inline' to script-src.

export function rendererContentSecurityPolicy(policy: string, isDevServer: boolean): string {
  if (!isDevServer) return policy;
  return policy
    .split(';')
    .map((directive) => directive.trim())
    .map((directive) =>
      directive.startsWith('script-src ') ? `${directive} 'unsafe-inline'` : directive,
    )
    .join('; ');
}
