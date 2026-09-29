// Structural checks over the whole built website: every page is valid enough
// to ship, every internal link lands, and nothing needs more than the strict
// no-script Content Security Policy in _headers.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { attrValues, buildToTemp, builtPages, TEST_ORIGIN } from './helpers.mjs';

const site = buildToTemp({ siteUrl: TEST_ORIGIN });
const pages = builtPages(site.outDir);

function urlToFile(pathname) {
  if (pathname.endsWith('/')) return join(site.outDir, pathname, 'index.html');
  return join(site.outDir, pathname);
}

function idsOf(html) {
  return attrValues(html, '[a-z0-9]+', 'id');
}

describe('built website', () => {
  it('builds every registered page', () => {
    assert.ok(site.pages.length >= 10, `only ${site.pages.length} pages built`);
    assert.ok(existsSync(join(site.outDir, 'index.html')));
    assert.ok(existsSync(join(site.outDir, '404.html')));
  });

  it('gives every page a language, one h1, a unique title and a description', () => {
    const titles = new Set();
    for (const { file, html } of pages) {
      assert.match(html, /^<!doctype html>/, file);
      assert.match(html, /<html lang="en">/, file);
      assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${file} must have exactly one h1`);
      const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
      assert.ok(title, `${file} has no title`);
      assert.ok(!titles.has(title), `duplicate title ${title}`);
      titles.add(title);
      assert.match(html, /<meta name="description" content="[^"]{40,170}"/, file);
    }
  });

  it('ships no scripts, inline handlers or inline styles (CSP: no script, style-src self)', () => {
    for (const { file, html } of pages) {
      assert.doesNotMatch(html, /<script\b/i, file);
      assert.doesNotMatch(html, /\son[a-z]+="/i, file);
      assert.doesNotMatch(html, /\sstyle="/i, file);
      assert.doesNotMatch(html, /<style\b/i, file);
      assert.doesNotMatch(html, /javascript:/i, file);
    }
  });

  it('gives every image alt text and intrinsic dimensions', () => {
    for (const { file, html } of pages) {
      for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
        assert.match(img, /\salt="[^"]*"/, `${file}: ${img}`);
        assert.match(img, /\swidth="\d+"/, `${file}: ${img}`);
        assert.match(img, /\sheight="\d+"/, `${file}: ${img}`);
      }
    }
  });

  it('resolves every internal link, image and stylesheet to a built file', () => {
    for (const { file, html } of pages) {
      const refs = [
        ...attrValues(html, 'a', 'href'),
        ...attrValues(html, 'img', 'src'),
        ...attrValues(html, 'link', 'href'),
      ].filter((ref) => ref.startsWith('/'));
      for (const ref of refs) {
        const { pathname } = new URL(ref, TEST_ORIGIN);
        assert.ok(existsSync(urlToFile(pathname)), `${file} links to missing ${ref}`);
      }
    }
  });

  it('resolves every #fragment to an id on the target page', () => {
    for (const { file, html } of pages) {
      for (const href of attrValues(html, 'a', 'href').filter((ref) => ref.includes('#'))) {
        if (/^https?:/.test(href)) continue;
        const [path, fragment] = href.split('#');
        const targetHtml = path ? readFileSync(urlToFile(path), 'utf8') : html;
        assert.ok(idsOf(targetHtml).includes(fragment), `${file}: ${href} has no target`);
      }
    }
  });

  it('keeps ids unique on each page', () => {
    for (const { file, html } of pages) {
      const ids = idsOf(html);
      assert.equal(new Set(ids).size, ids.length, `${file} repeats an id`);
    }
  });

  it('links out only over https', () => {
    for (const { file, html } of pages) {
      for (const href of attrValues(html, 'a', 'href')) {
        assert.ok(!href.startsWith('http:'), `${file}: insecure link ${href}`);
      }
    }
  });

  it('writes canonical links, a sitemap and robots.txt for a known origin', () => {
    const home = readFileSync(join(site.outDir, 'index.html'), 'utf8');
    assert.match(home, new RegExp(`<link rel="canonical" href="${TEST_ORIGIN}/"`));
    const sitemap = readFileSync(join(site.outDir, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, new RegExp(`<loc>${TEST_ORIGIN}/features/</loc>`));
    assert.doesNotMatch(sitemap, /404/);
    const robots = readFileSync(join(site.outDir, 'robots.txt'), 'utf8');
    assert.match(robots, new RegExp(`Sitemap: ${TEST_ORIGIN}/sitemap.xml`));
  });

  it('omits absolute-URL metadata when no origin is configured', () => {
    const bare = buildToTemp();
    const home = readFileSync(join(bare.outDir, 'index.html'), 'utf8');
    assert.doesNotMatch(home, /rel="canonical"/);
    assert.doesNotMatch(home, /og:url/);
    assert.ok(!existsSync(join(bare.outDir, 'sitemap.xml')));
  });

  it('serves a strict no-script Content Security Policy and immutable assets', () => {
    const headers = readFileSync(join(site.outDir, '_headers'), 'utf8');
    assert.match(headers, /Content-Security-Policy: default-src 'none';/);
    assert.doesNotMatch(headers, /script-src/);
    assert.match(headers, /\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
  });

  it('keeps url() out of the stylesheet so every image stays a hashed <img>', () => {
    const css = readFileSync(fileURLToPath(new URL('../assets/site.css', import.meta.url)), 'utf8');
    assert.doesNotMatch(css, /url\(/);
  });
});
