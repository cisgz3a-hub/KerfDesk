import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('desktop window readiness policy', () => {
  it('attaches the one-shot ready-to-show listener before renderer loading starts', () => {
    const source = readFileSync(join(process.cwd(), 'electron/main.ts'), 'utf8');
    const createWindow = source.slice(
      source.indexOf('async function createWindow'),
      source.indexOf('async function startCameraBridgeSafely'),
    );
    const listenerIndex = createWindow.indexOf("window.once('ready-to-show'");
    const loadIndex = createWindow.indexOf('await loadRenderer(window)');

    expect(listenerIndex).toBeGreaterThanOrEqual(0);
    expect(loadIndex).toBeGreaterThan(listenerIndex);
  });
});
