import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('trace worker CSP', () => {
  it('allows the Vite trace worker URL scheme in web and Electron CSP', () => {
    for (const path of ['public/_headers', 'electron/main.ts']) {
      expect(readRepoFile(path), path).toContain("worker-src 'self' data: blob:");
    }
  });
});
