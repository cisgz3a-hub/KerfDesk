import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '../kit/Dialog';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import { MachineToolsDropdowns } from './MachineToolsDropdowns';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('Machine tool dropdowns', () => {
  it('waits for an inline modal to close before revealing a new probe reminder', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    useLaserStore.setState({ workZZeroEvidence: null });
    try {
      await act(async () =>
        root.render(
          <MachineToolsDropdowns
            origin={<span>Origin tools</span>}
            placement={<span>Placement tools</span>}
            console={() => <InlineModalConsole />}
          />,
        ),
      );
      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Console"]');
      if (!trigger) throw new Error('Missing console trigger');
      const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
      if (!panel) throw new Error('Missing console panel');
      const launch = panel.querySelector<HTMLButtonElement>('[data-open-console]');
      const draft = panel.querySelector<HTMLInputElement>('input[aria-label="Command draft"]');
      if (!launch || !draft) throw new Error('Missing console controls');
      await act(async () => trigger.click());
      draft.value = 'G0 X42';
      await act(async () => launch.click());
      const modal = panel.querySelector<HTMLElement>('[aria-modal="true"]');
      if (!modal) throw new Error('Missing expanded console dialog');
      expect(useUiStore.getState().modalDepth).toBe(1);
      await act(async () =>
        useLaserStore.setState({
          workZZeroEvidence: {
            source: 'probe',
            referenceEpoch: 1,
            probePlateRemoved: false,
          },
        }),
      );
      expect(panel.hidden).toBe(false);
      expect(modal.closest('[hidden]')).toBeNull();
      expect(document.activeElement).toBe(modal.querySelector('input'));
      const close = modal.querySelector<HTMLButtonElement>('button');
      if (!close) throw new Error('Missing expanded console close button');
      await act(async () => close.click());
      expect(useUiStore.getState().modalDepth).toBe(0);
      expect(panel.hidden).toBe(true);
      expect(document.activeElement).toBe(trigger);
      await act(async () => trigger.click());
      expect(panel.hidden).toBe(false);
      expect(panel.querySelector('input[aria-label="Command draft"]')).toBe(draft);
      expect(draft.value).toBe('G0 X42');
      await act(async () => launch.click());
      expect(panel.hidden).toBe(false);
      expect(panel.querySelector('[aria-modal="true"]')).not.toBeNull();
      expect(useUiStore.getState().modalDepth).toBe(1);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      useLaserStore.setState({ workZZeroEvidence: null });
    }
    expect(useUiStore.getState().modalDepth).toBe(0);
  });

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
                <button type="button" data-async-action>
                  Prepare preview
                </button>
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
      const shortcut = vi.fn();
      window.addEventListener('keydown', shortcut);
      try {
        await act(async () =>
          trigger('Origin').dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'ArrowDown',
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
        expect(shortcut).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('keydown', shortcut);
      }
      const position = dialog('Origin').querySelector('input');
      if (!position) throw new Error('Missing position name');
      position.value = 'Front corner';
      await act(async () => trigger('Console').click());
      expect(dialog('Origin').hidden).toBe(true);
      expect(dialog('Console').hidden).toBe(false);
      expect(dialog('Console').textContent).toContain('Console active: true');
      const preparing = dialog('Console').querySelector<HTMLButtonElement>('[data-async-action]');
      if (!preparing) throw new Error('Missing async action');
      preparing.disabled = true;
      await act(async () =>
        preparing.dispatchEvent(new FocusEvent('focusout', { relatedTarget: null, bubbles: true })),
      );
      expect(dialog('Console').hidden).toBe(false);
      for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
        await act(async () =>
          dialog('Console').dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Escape',
              bubbles: true,
              ...composition,
            }),
          ),
        );
        expect(dialog('Console').hidden).toBe(false);
      }
      await act(async () =>
        dialog('Console').dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      );
      expect(document.activeElement).toBe(trigger('Console'));
      expect(dialog('Console').hidden).toBe(true);
      expect(dialog('Console').textContent).toContain('Console active: false');
      await act(async () => trigger('Console').click());
      const command = dialog('Console').querySelector('input');
      if (!command) throw new Error('Missing command draft');
      await act(async () =>
        command.dispatchEvent(new FocusEvent('focusout', { relatedTarget: null, bubbles: true })),
      );
      expect(dialog('Console').hidden).toBe(true);
      await act(async () => trigger('Origin').click());
      expect(dialog('Origin').querySelector('input')).toBe(position);
      expect(position.value).toBe('Front corner');
      await act(async () =>
        useLaserStore.setState({
          workZZeroEvidence: {
            source: 'probe',
            referenceEpoch: 1,
            probePlateRemoved: false,
          },
        }),
      );
      expect(dialog('Origin').hidden).toBe(true);
      // The reminder dismisses the covering popup without preventing later inspection.
      await act(async () => trigger('Origin').click());
      expect(dialog('Origin').hidden).toBe(false);
      await act(async () =>
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })),
      );
      expect(dialog('Origin').hidden).toBe(true);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      useLaserStore.setState({ workZZeroEvidence: null });
    }
  });
});

function InlineModalConsole(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <input aria-label="Command draft" />
      <button type="button" data-open-console onClick={() => setOpen(true)}>
        Super console
      </button>
      {open && (
        <Dialog title="Expanded console" onClose={() => setOpen(false)}>
          <input aria-label="Expanded console search" />
          <button type="button" onClick={() => setOpen(false)}>
            Close expanded console
          </button>
        </Dialog>
      )}
    </>
  );
}
