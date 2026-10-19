import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** The splash's first paint must include its timber, even on a cold launch. */
export function startupArtwork(): Plugin {
  let artwork = '';
  return {
    name: 'kerfdesk-startup-artwork',
    configResolved(config) {
      const bytes = readFileSync(resolve(config.publicDir, 'startup-craft.webp'));
      artwork = `data:image/webp;base64,${bytes.toString('base64')}`;
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // Keep one editable source image. Vite embeds it for dev, web and
        // packaged desktop, before processing asset URLs. No runtime JS or
        // separate request is needed to reveal the wood.
        return html.replace('src="/startup-craft.webp"', `src="${artwork}"`);
      },
    },
  };
}
