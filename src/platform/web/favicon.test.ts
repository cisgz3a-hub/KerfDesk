import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('web favicon asset', () => {
  it('declares vector and bitmap favicons on every standalone browser page', () => {
    const pages = ['index.html', 'public/download.html', 'public/404.html'];

    for (const page of pages) {
      const html = readFileSync(join(process.cwd(), page), 'utf8');

      expect(html).toContain(
        '<link rel="icon" type="image/svg+xml" sizes="any" href="/favicon.svg" />',
      );
      expect(html).toContain(
        '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />',
      );
      expect(html).toContain(
        '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
      );
      expect(html).toContain('<meta name="theme-color" content="#111827" />');
    }
  });

  it('ships browser, touch, installed-app, and maskable icon assets', () => {
    for (const asset of [
      'favicon.svg',
      'favicon-32x32.png',
      'apple-touch-icon.png',
      'app-icon-192x192.png',
      'app-icon-512x512.png',
      'app-icon-maskable.svg',
      'app-icon-maskable-512x512.png',
    ]) {
      expect(existsSync(join(process.cwd(), 'public', asset))).toBe(true);
    }
  });
});
