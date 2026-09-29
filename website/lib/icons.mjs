// Inline SVG icons from lucide-static (ISC), an existing KerfDesk dependency.
// Icons are decorative: they carry aria-hidden and never replace a text label.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { raw } from './html.mjs';

const require = createRequire(import.meta.url);
const ICON_DIR = join(dirname(require.resolve('lucide-static/package.json')), 'icons');
const cache = new Map();

function loadIcon(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Bad icon name: ${name}`);
  const source = readFileSync(join(ICON_DIR, `${name}.svg`), 'utf8');
  // Strip sizing from the root <svg> only: <rect> children need their own width/height.
  const rootTag = (tag) =>
    tag
      .replace(/\s(?:class|width|height)="[^"]*"/g, '')
      .replace('<svg', '<svg class="icon" aria-hidden="true" focusable="false"');
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg\b[^>]*>/, rootTag)
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

export function icon(name) {
  if (!cache.has(name)) cache.set(name, loadIcon(name));
  return raw(cache.get(name));
}
