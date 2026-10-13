import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('web favicon asset', () => {
  it('declares vector and bitmap favicons on every standalone browser page', () => {
    const pages = [
      'index.html',
      'public/download.html',
      'public/404.html',
      'public/support.html',
      'public/buy.html',
      'public/phone.html',
    ];

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
      expect(html).toContain('<meta name="theme-color" content="#101113" />');
    }
  });

  it('ships browser, touch, installed-app, and maskable icon assets', () => {
    for (const asset of [
      'favicon.svg',
      'app-icon.svg',
      'app-icon.ico',
      'app-icon.icns',
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

  it('provides correctly sized bitmaps and native Windows icon entries', () => {
    for (const [name, size] of [
      ['favicon-32x32.png', 32],
      ['apple-touch-icon.png', 180],
      ['app-icon-192x192.png', 192],
      ['app-icon-512x512.png', 512],
      ['app-icon-maskable-512x512.png', 512],
    ] as const) {
      const bytes = readFileSync(join(process.cwd(), 'public', name));
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      expect(bytes.readUInt32BE(16)).toBe(size);
      expect(bytes.readUInt32BE(20)).toBe(size);
    }
    const ico = readFileSync(join(process.cwd(), 'public/app-icon.ico'));
    expect(ico.readUInt16LE(2)).toBe(1);
    const sizes = [];
    for (let i = 0; i < ico.readUInt16LE(4); i++) {
      const at = 6 + i * 16;
      const size = ico[at] || 256;
      sizes.push(size);
      const offset = ico.readUInt32LE(at + 12);
      const png = ico.subarray(offset, offset + ico.readUInt32LE(at + 8));
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
    expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256]);
    const icns = readFileSync(join(process.cwd(), 'public/app-icon.icns'));
    expect(icns.subarray(0, 4).toString()).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
  });
});
