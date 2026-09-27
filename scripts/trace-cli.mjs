#!/usr/bin/env node
// kerfdesk-trace: the headless trace command (ADR-477). The tracer is
// TypeScript source shared with the app, so this launcher loads
// scripts/trace-cli.ts through Vite's SSR module loader (a dev dependency) with
// no project config: no bundle step, and the code that runs is the app's.
// Run `pnpm trace --help` or `node scripts/trace-cli.mjs --help`.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let server;
try {
  const { createServer } = await import('vite');
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const cli = await server.ssrLoadModule(join(root, 'scripts', 'trace-cli.ts'));
  process.exitCode = await cli.main(process.argv.slice(2));
} catch (error) {
  const detail = process.env.KERFDESK_TRACE_DEBUG ? error?.stack : error?.message;
  process.stderr.write(`kerfdesk-trace: ${detail ?? String(error)}\n`);
  process.exitCode = 1;
} finally {
  await server?.close();
}
