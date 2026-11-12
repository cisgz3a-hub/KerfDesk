// @vitest-environment node
// Every controller-link store reports its work to the app-wide registry
// (ADR-705 Amendment 6, code quality audit C2 D4-P1-1). The K40 store merged
// beside the registry without reporting, so a K40 job was invisible to Ctrl+.,
// close, Update and the dialogs. This reads each link store's source and fails
// when one does not report under a source the registry lists, or when the
// registry lists a source no store reports.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LINK_MACHINE_SOURCES } from './link-machine-work';

const STATE_DIR = join(process.cwd(), 'src', 'ui', 'state');

/** The link store files: <dir>/<dir>-store.ts for each *-usb or *-network folder. */
function linkStoreFiles(): string[] {
  return readdirSync(STATE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /-(usb|network)$/.test(entry.name))
    .map((entry) => join(STATE_DIR, entry.name, `${entry.name}-store.ts`));
}

describe('link machine-work sources', () => {
  it('has a reporting store for every listed source, and a listed source for every store', () => {
    const files = linkStoreFiles();
    expect(files.length).toBeGreaterThanOrEqual(3);
    const reported = files.map((file) => {
      const source = /reportLinkMachineWork\(\s*'([a-z-]+)'/.exec(readFileSync(file, 'utf8'));
      expect(source, `${file} must call reportLinkMachineWork`).not.toBeNull();
      return source?.[1];
    });
    expect([...reported].sort()).toEqual([...LINK_MACHINE_SOURCES].sort());
  });
});
