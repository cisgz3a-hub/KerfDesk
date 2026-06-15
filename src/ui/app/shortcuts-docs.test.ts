import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('WORKFLOW shortcut docs', () => {
  it('documents Ctrl/Cmd+Shift+E as Export and leaves Ctrl/Cmd+E for Ellipse', () => {
    const workflow = readFileSync(resolve(process.cwd(), 'WORKFLOW.md'), 'utf8');

    expect(workflow).toContain('`Cmd/Ctrl+Shift+E`');
    expect(workflow).toContain('`Cmd/Ctrl+E` - Ellipse');
    expect(workflow).not.toContain('`Cmd/Ctrl+E` - Save G-code');
    expect(workflow).not.toContain('`Cmd/Ctrl+E` — Save G-code');
  });
});
