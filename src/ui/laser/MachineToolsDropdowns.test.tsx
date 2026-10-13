import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { MachineToolsDropdowns } from './MachineToolsDropdowns';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('Machine tool dropdowns', () => {
  it('opens one utility at a time, retains form drafts, and returns Escape to its trigger', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <MachineToolsDropdowns
            origin={<input aria-label="Saved position name" defaultValue="Corner" />}
            placement={<button type="button">Placement action</button>}
            console={(active) => (
              <div>
                <span>Console active: {String(active)}</span>
                <input aria-label="Command draft" />
              </div>
            )}
          />,
        ),
      );
      const trigger = (label: string): HTMLButtonElement => {
        const match = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
        if (!match) throw new Error(`Missing ${label}`);
        return match;
      };
      const dialog = (label: string): HTMLDivElement => {
        const match = document.getElementById(trigger(label).getAttribute('aria-controls') ?? '');
        if (!(match instanceof HTMLDivElement)) throw new Error(`Missing dialog ${label}`);
        return match;
      };
      expect(dialog('Console').hidden).toBe(true);
      await act(async () => trigger('Origin').click());
      const position = dialog('Origin').querySelector('input');
      if (!position) throw new Error('Missing position name');
      position.value = 'Front corner';
      await act(async () => trigger('Console').click());
      expect(dialog('Origin').hidden).toBe(true);
      expect(dialog('Console').hidden).toBe(false);
      expect(dialog('Console').textContent).toContain('Console active: true');
      await act(async () =>
        dialog('Console').dispatchEvent(
          new FocusEvent('focusout', { relatedTarget: null, bubbles: true }),
        ),
      );
      expect(dialog('Console').hidden).toBe(false);
      await act(async () =>
        dialog('Console').dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      );
      expect(document.activeElement).toBe(trigger('Console'));
      expect(dialog('Console').hidden).toBe(true);
      expect(dialog('Console').textContent).toContain('Console active: false');
      await act(async () => trigger('Origin').click());
      expect(dialog('Origin').querySelector('input')).toBe(position);
      expect(position.value).toBe('Front corner');
      await act(async () =>
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })),
      );
      expect(dialog('Origin').hidden).toBe(true);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
