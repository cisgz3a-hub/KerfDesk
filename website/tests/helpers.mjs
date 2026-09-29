// Shared helpers for the website tests: build into a temp dir and read pages.

import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { buildSite } from '../build.mjs';

export const TEST_ORIGIN = 'https://www.example.com';

export function buildToTemp(options = {}) {
  const outDir = mkdtempSync(join(tmpdir(), 'kerfdesk-site-'));
  return buildSite({ outDir, ...options });
}

export function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

// [{ file: 'features/index.html', html }]
export function builtPages(outDir) {
  return [...walk(outDir)]
    .filter((path) => path.endsWith('.html'))
    .map((path) => ({
      file: relative(outDir, path).split(sep).join('/'),
      html: readFileSync(path, 'utf8'),
    }));
}

// Attribute values for every <tag ... attr="value"> in the document.
export function attrValues(html, tag, attr) {
  const tagPattern = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const attrPattern = new RegExp(`\\s${attr}="([^"]*)"`, 'i');
  return (html.match(tagPattern) ?? [])
    .map((element) => element.match(attrPattern)?.[1])
    .filter((value) => value !== undefined)
    .map((value) => value.replace(/&amp;/g, '&'));
}

export function textContent(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}
