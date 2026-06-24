import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('web favicon asset', () => {
  it('declares a public favicon so browser smoke does not request /favicon.ico', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const match = html.match(/<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="([^"]+)"/);

    expect(match?.[1]).toBe('/favicon.svg');
    expect(existsSync(join(process.cwd(), 'public', 'favicon.svg'))).toBe(true);
  });
});
