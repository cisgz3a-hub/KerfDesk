import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shortcutFamilies } from '../common/shortcut-list';

describe('WORKFLOW shortcut docs', () => {
  it('documents Ctrl/Cmd+Shift+E as Export and leaves Ctrl/Cmd+E for Ellipse', () => {
    const workflow = readFileSync(resolve(process.cwd(), 'WORKFLOW.md'), 'utf8');

    expect(workflow).toContain('`Cmd/Ctrl+Shift+E`');
    expect(workflow).toContain('`Cmd/Ctrl+E` - Ellipse');
    expect(workflow).not.toContain('`Cmd/Ctrl+E` - Save G-code');
    expect(workflow).not.toContain('`Cmd/Ctrl+E` — Save G-code');
  });
});

describe('Shortcuts dialog completeness (UI-07)', () => {
  it('lists the shipped clipboard, group/ungroup, and convert-to-bitmap shortcuts', () => {
    const keys = shortcutFamilies('laser').flatMap((family) => family.rows.map((row) => row.keys));
    // These are wired in shortcuts.ts but used to be missing from the dialog.
    // Ungroup is Ctrl+U (CNV-02, with Ctrl+Shift+G kept as an alias).
    for (const chord of ['Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'Ctrl+G', 'Ctrl+U', 'Ctrl+Shift+B']) {
      expect(keys).toContain(chord);
    }
  });
});
