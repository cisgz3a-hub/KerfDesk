import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { createLayer } from '../../core/scene';
import { TutorialHost } from '../tutorials/TutorialHost';
import { useTutorialStore } from '../tutorials/tutorial-store';
import { CutSettingsDialog } from './CutSettingsDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('opens help for the draft cut mode without submitting or losing edits, and follows a store reset', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onApply = vi.fn();
  const onCancel = vi.fn();
  const original = createLayer({ id: 'tutorial-mode', color: '#000000' });
  const render = async (layer = original): Promise<void> => {
    await act(async () =>
      root.render(
        <>
          <CutSettingsDialog layer={layer} onApply={onApply} onCancel={onCancel} />
          <TutorialHost />
        </>,
      ),
    );
  };
  const field = <T extends HTMLElement>(selector: string): T => {
    const found = host.querySelector<T>(selector);
    if (found === null) throw new Error(`Missing field: ${selector}`);
    return found;
  };
  try {
    useTutorialStore.getState().closeTutorial();
    await render();
    const mode = field<HTMLSelectElement>('select[name="mode"]');
    const power = field<HTMLInputElement>('input[name="power"]');
    await act(async () => {
      power.value = '42';
      Simulate.change(power);
    });
    for (const [value, lesson] of [
      ['fill', 'laser-fill'],
      ['image', 'laser-image'],
      ['line', 'laser-cut'],
    ] as const) {
      await act(async () => {
        mode.value = value;
        Simulate.change(mode);
      });
      const tutorial = field<HTMLButtonElement>('[data-tutorial-id]');
      await act(async () => {
        tutorial.focus();
        tutorial.click();
        await import('../tutorials/TutorialCentre');
      });
      expect(useTutorialStore.getState().tutorialId).toBe(lesson);
      expect(onApply).not.toHaveBeenCalled();
      // Escape walks out a level at a time: lesson, then library, then closed.
      const escape = async (): Promise<void> => {
        await act(async () => {
          document.activeElement?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
          );
        });
      };
      await escape();
      expect(useTutorialStore.getState().tutorialId).toBeNull();
      expect(useTutorialStore.getState().isOpen).toBe(true);
      await escape();
      expect(useTutorialStore.getState().isOpen).toBe(false);
      expect(mode.value).toBe(value);
      expect(power.value).toBe('42');
      expect(document.activeElement).toBe(tutorial);
      expect(onCancel).not.toHaveBeenCalled();
    }
    await render({ ...original, mode: 'image', power: 25 });
    expect(field<HTMLSelectElement>('select[name="mode"]').value).toBe('image');
    expect(field<HTMLInputElement>('input[name="power"]').value).toBe('25');
    expect(field('[data-tutorial-id]').getAttribute('data-tutorial-id')).toBe('laser-image');
    expect(original.mode).toBe('line');
    expect(onApply).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      useTutorialStore.getState().closeTutorial();
      root.unmount();
    });
    host.remove();
  }
});
