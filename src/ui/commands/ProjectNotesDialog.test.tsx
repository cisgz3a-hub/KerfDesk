import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectNotesDialog } from './ProjectNotesDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderDialog(
  props: {
    readonly notes?: string;
    readonly onApply?: (notes: string) => void;
    readonly onCancel?: () => void;
  } = {},
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <ProjectNotesDialog
        notes={props.notes ?? 'Start notes'}
        onCancel={props.onCancel ?? vi.fn()}
        onApply={props.onApply ?? vi.fn()}
      />,
    );
  });
  if (root === null) throw new Error('root did not mount');
  return { host, root };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ProjectNotesDialog', () => {
  it('edits project notes and submits the new text', async () => {
    const onApply = vi.fn();
    const { host, root } = await renderDialog({ notes: 'Old note', onApply });
    try {
      const textarea = host.querySelector('textarea');
      if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('textarea missing');
      await act(async () => {
        setTextareaValue(textarea, 'New note\nFocus 6 mm');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const save = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Save Notes'),
      );
      if (!(save instanceof HTMLButtonElement)) throw new Error('save button missing');
      await act(async () => {
        save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onApply).toHaveBeenCalledWith('New note\nFocus 6 mm');
    } finally {
      await act(async () => root.unmount());
    }
  });
});

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('textarea value setter missing');
  setter.call(textarea, value);
}
