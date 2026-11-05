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

  // Rolling audit v7 L8: LightBurn's flip, paste-in-place, draw-order and Move
  // Together keys, and Z jog off the bare Page keys (ADR-410 Amd 4, ADR-493 Amd 2,
  // ADR-499 Amd 2).
  it('lists the LightBurn keys and no longer the bindings they replaced', () => {
    const rows = shortcutFamilies('cnc').flatMap((family) => family.rows);
    const action = (keys: string): string | undefined =>
      rows.find((row) => row.keys === keys)?.action;
    const workflow = readFileSync(resolve(process.cwd(), 'WORKFLOW.md'), 'utf8');

    expect(action('Alt+V')).toBe('paste in place');
    expect(action('V or Ctrl+Shift+V')).toBe('flip vertical');
    expect(action('PgUp / PgDn')).toContain('draw order');
    expect(action('Alt+Shift+H')).toContain('Move H Together');
    expect(action('Ctrl+Alt+PgUp / Ctrl+Alt+PgDn')).toContain('jog Z');
    expect(rows.map((row) => row.keys)).not.toContain('PageUp/PageDown');
    expect(rows.map((row) => row.keys)).not.toContain('Ctrl+Shift+V');
    expect(workflow).toContain('`Alt+V` — Paste in Place');
    expect(workflow).toContain('`Cmd/Ctrl+Alt+PageUp` / `Cmd/Ctrl+Alt+PageDown` — Jog Z');
    expect(workflow).not.toContain('`PageUp` / `PageDown` — Jog Z');
    expect(workflow).not.toContain('Distribute horizontal / vertical spacing (ADR-499)');
  });

  it('documents Alt+T for Trace Image in the dialog and WORKFLOW', () => {
    const keys = shortcutFamilies('laser').flatMap((family) => family.rows.map((row) => row.keys));
    const workflow = readFileSync(resolve(process.cwd(), 'WORKFLOW.md'), 'utf8');

    expect(keys).toContain('Alt+T');
    expect(workflow).toContain('`Alt+T` - Trace Image');
  });

  it('lists the Alt colour peek (UX audit U3-P3-3)', () => {
    const rows = shortcutFamilies('laser').flatMap((family) => family.rows);
    expect(rows.find((row) => row.keys === 'Alt (hold)')?.action).toBe(
      'show every object in its operation colour',
    );
  });
});
