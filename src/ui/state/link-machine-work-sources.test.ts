// @vitest-environment node
// Every controller-link store joins the app through connectLinkStore (ADR-705
// Amendments 6 and 7; C2 D4-P1-1, C2 verification E2-P3-2). The K40 store
// once merged without reporting, so a K40 job was invisible to Ctrl+., close,
// Update and the dialogs. The types make a connected store take link jobs
// (link-store-connection.test.ts); this finds every store that runs a Frame
// or Start job anywhere under src/ui, whatever its folder is called, and fails
// when one never connects, or when the registry lists a source no store uses.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LINK_MACHINE_SOURCES } from './link-machine-work';

const UI_DIR = join(process.cwd(), 'src', 'ui');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** A store that implements a Frame or Start taking a compiled job. */
const RUNS_JOBS = /^\s*(frame|start):\s*(async\s*)?\(\s*job\b/m;

describe('link machine-work sources', () => {
  it('connects every store that runs link jobs, under a source the registry lists', () => {
    const stores = sourceFiles(UI_DIR).filter((file) => RUNS_JOBS.test(readFileSync(file, 'utf8')));
    expect(stores.length).toBeGreaterThanOrEqual(3);
    const sources = stores.map((file) => {
      const source = /connectLinkStore\(\s*'([a-z-]+)'/.exec(readFileSync(file, 'utf8'));
      expect(source, `${relative(UI_DIR, file)} must call connectLinkStore`).not.toBeNull();
      return source?.[1];
    });
    expect([...sources].sort()).toEqual([...LINK_MACHINE_SOURCES].sort());
  });
});
