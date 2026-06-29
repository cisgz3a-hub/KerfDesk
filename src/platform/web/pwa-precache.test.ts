import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('PWA precache coverage', () => {
  it('includes bundled text fonts in the offline app shell', () => {
    const viteConfig = readRepoFile('vite.config.ts');
    const fontLoader = readRepoFile('src/ui/text/font-loader.ts');
    const fontAssetExtensions = new Set(
      Array.from(fontLoader.matchAll(/from\s+['"][^'"]+\.([a-z0-9]+)\?url['"]/g), (match) =>
        match[1]?.toLowerCase(),
      ).filter((extension): extension is string => extension !== undefined),
    );
    const globPattern = viteConfig.match(/globPatterns:\s*\[\s*['"]([^'"]+)['"]\s*\]/)?.[1] ?? '';

    expect(fontAssetExtensions).toContain('ttf');
    for (const extension of fontAssetExtensions) {
      expect(globPattern).toContain(extension);
    }
  });
});

describe('web bundle policy', () => {
  it('keeps the large app regions split into precached production chunks', () => {
    const viteConfig = readRepoFile('vite.config.ts');

    expect(viteConfig).toContain('manualChunks');
    expect(viteConfig).toContain('/node_modules/react');
    expect(viteConfig).toContain('/node_modules/clipper2-ts');
    expect(viteConfig).toContain('/node_modules/dompurify');
    expect(viteConfig).toContain('/src/core/');
    expect(viteConfig).toContain('/src/io/');
    expect(viteConfig).toContain('/src/ui/laser/');
    expect(viteConfig).toContain('/src/ui/workspace/');
  });
});
