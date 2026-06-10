import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function cloudflareRedirectLines(): string[] {
  const redirectsPath = resolve(process.cwd(), 'public/_redirects');
  if (!existsSync(redirectsPath)) return [];
  return readFileSync(redirectsPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

describe('Cloudflare Pages routing', () => {
  it('does not rewrite missing hashed assets to the app shell', () => {
    const catchAllShellRewrite = cloudflareRedirectLines().find((line) =>
      /^\/\*\s+\/index\.html\s+200(?:\s|$)/.test(line),
    );

    expect(catchAllShellRewrite).toBeUndefined();
  });

  // LU35 (AUDIT-2026-06-10): with no 404.html, Cloudflare Pages enables an
  // IMPLICIT single-page-app fallback — every missing path (stale hashed
  // chunks after a redeploy, deep links) serves index.html with a 200, and
  // nosniff then refuses the HTML-as-module-script, leaving a permanently
  // blank page. A real 404.html disables the implicit fallback.
  it('ships a 404 page so Pages does not enable the implicit SPA fallback', () => {
    const notFoundPath = resolve(process.cwd(), 'public/404.html');
    expect(existsSync(notFoundPath)).toBe(true);
    const html = readFileSync(notFoundPath, 'utf8');
    expect(html).toContain('404');
    // Self-contained: a 404 page that references hashed bundle assets would
    // itself 404 after a redeploy.
    expect(html).not.toMatch(/src\s*=\s*["']\/assets\//);
  });
});
