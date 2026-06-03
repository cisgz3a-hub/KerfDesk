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
});
