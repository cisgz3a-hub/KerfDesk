import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** PDF.js resources stay local in dev, PWA and packaged builds. No CDN or eval. */
export function pdfResources(): Plugin {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('pdfjs-dist/package.json'));
  const fontRoot = join(dirname(fileURLToPath(import.meta.url)), '../src/ui/import/pdf-fonts');
  const resources = new Map<string, string>();
  for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
    for (const name of readdirSync(join(root, folder))) {
      // pdfjs-dist ships older GPL Liberation fonts. The app uses the
      // separately reviewed, unmodified OFL 2.1.5 distribution instead.
      if (folder === 'standard_fonts' && name.startsWith('Liberation')) continue;
      if (folder === 'standard_fonts' && name === 'LICENSE_LIBERATION') continue;
      // CSP permits the upstream JS codecs; it intentionally forbids WASM/eval.
      if (folder === 'wasm' && !name.endsWith('_nowasm_fallback.js') && !name.startsWith('LICENSE'))
        continue;
      resources.set('pdf-resources/' + folder + '/' + name, join(root, folder, name));
    }
  }
  for (const name of readdirSync(fontRoot)) {
    const published = name === 'LICENSE' ? 'LICENSE_LIBERATION_OFL' : name;
    resources.set('pdf-resources/standard_fonts/' + published, join(fontRoot, name));
  }
  return {
    name: 'kerfdesk-pdf-resources',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0]?.replace(/^\//, '') ?? '';
        const file = resources.get(path);
        if (file === undefined) {
          next();
          return;
        }
        response.setHeader(
          'Content-Type',
          path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream',
        );
        response.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [fileName, path] of resources) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(path) });
      }
    },
  };
}
