import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** One emitted JavaScript chunk, as `scripts/check-boot-bundle.mjs` reads it. */
export interface ReportedChunk {
  readonly name: string;
  readonly isEntry: boolean;
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
  /** npm packages with at least one module in this chunk. */
  readonly packages: readonly string[];
}

/**
 * Writes `<outDir>-chunks.json` beside the build (not into it, so it is never
 * deployed): every chunk's static and dynamic imports and the packages inside
 * it. The boot-bundle check (S9-P3-2) walks it to find what the first visit
 * downloads, and refuses worker-only packages there.
 */
export function bundleChunkReport(): Plugin {
  let reportPath = '';
  return {
    name: 'kerfdesk-bundle-chunk-report',
    apply: 'build',
    configResolved(config) {
      reportPath = `${resolve(config.root, config.build.outDir)}-chunks.json`;
    },
    writeBundle(_options, bundle) {
      const chunks: Record<string, ReportedChunk> = {};
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type !== 'chunk') continue;
        chunks[fileName] = {
          name: item.name,
          isEntry: item.isEntry,
          imports: item.imports,
          dynamicImports: item.dynamicImports,
          packages: packagesOf(item.moduleIds),
        };
      }
      writeFileSync(reportPath, `${JSON.stringify({ chunks }, null, 1)}\n`);
    },
  };
}

// pnpm nests a package as .pnpm/<name>@<version>/node_modules/<name>/…, so the
// package is the path segment after the last node_modules.
function packagesOf(moduleIds: readonly string[]): readonly string[] {
  const packages = new Set<string>();
  for (const id of moduleIds) {
    const path = id.replaceAll('\\', '/');
    const at = path.lastIndexOf('/node_modules/');
    if (at < 0) continue;
    const [scope, name] = path.slice(at + '/node_modules/'.length).split('/');
    if (scope === undefined) continue;
    packages.add(scope.startsWith('@') && name !== undefined ? `${scope}/${name}` : scope);
  }
  return [...packages].sort();
}
