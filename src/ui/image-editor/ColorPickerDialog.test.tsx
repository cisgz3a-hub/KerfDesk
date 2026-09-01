import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorPickerDialog } from './ColorPickerDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('ColorPickerDialog ink draft', () => {
  it.each(['', '-1', '101'])(
    'commits the last valid color instead of refusing invalid K%% draft %j',
    async (draft) => {
      const onCommit = vi.fn();
      const field = await renderPicker(onCommit);

      await setDraft(field, draft);
      expect(field.value).toBe(draft);
      expect(field.getAttribute('aria-invalid')).toBe('true');

      await pressEnter(field);
      expect(onCommit).toHaveBeenCalledOnce();
      expect(onCommit).toHaveBeenCalledWith({ r: 0, g: 0, b: 0 });

      await act(async () => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
      const restored = inkField();
      expect(restored.value).toBe('100');
      expect(restored.getAttribute('aria-invalid')).toBe('false');
      expect(onCommit).toHaveBeenCalledOnce();
    },
  );

  it('preserves valid K% input and commits it with Enter', async () => {
    const onCommit = vi.fn();
    const field = await renderPicker(onCommit);

    await setDraft(field, '50');
    expect(inkField().value).toBe('50');
    await pressEnter(inkField());

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith({ r: 128, g: 128, b: 128 });
  });
});

async function renderPicker(onCommit: (color: { r: number; g: number; b: number }) => void) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <ColorPickerDialog
        title="Draft color"
        initial={{ r: 0, g: 0, b: 0 }}
        onCommit={onCommit}
        onClose={() => undefined}
      />,
    ),
  );
  return inkField();
}

function inkField(): HTMLInputElement {
  const field = host?.querySelector<HTMLInputElement>('[aria-label="Ink percent"]') ?? null;
  if (field === null) throw new Error('Ink percent field missing');
  return field;
}

async function setDraft(field: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter === undefined) throw new Error('native input value setter missing');
    setter.call(field, value);
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}

async function pressEnter(field: HTMLInputElement): Promise<void> {
  await act(async () =>
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
}
