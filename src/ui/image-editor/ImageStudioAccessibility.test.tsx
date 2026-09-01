import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorPickerDialog } from './ColorPickerDialog';
import { createEditorTestBuffer } from './create-editor-test-buffer';
import { createSession } from './editor-session';
import { EditorToolStrip } from './EditorToolStrip';
import { ImageEditorTopBar } from './ImageEditorTopBar';
import { useImageEditorStore } from './image-editor-store';
import { ResizeDialogPanel } from './ResizeDialog';
import { useResizeDialogStore } from './resize-dialog-store';
import { TextDialog } from './TextDialog';
import { useTextDialogStore } from './text-dialog-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useResizeDialogStore.setState({ dialog: null });
  useTextDialogStore.setState({
    isOpen: false,
    dialogOwner: null,
    text: '',
    sizeDraft: '48',
    commitRequest: null,
    errorMessage: null,
  });
  useImageEditorStore.setState({ session: null, sessionOwner: null, transform: null });
  document.body.replaceChildren();
});

describe('Image Studio reachability', () => {
  it('wraps the session actions instead of clipping them at narrow width or high zoom', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const session = createSession('image', 'source.png', createEditorTestBuffer(2, 2), {
      minX: 0,
      minY: 0,
      maxX: 2,
      maxY: 2,
    });
    const action = (): void => undefined;
    await act(async () =>
      root.render(
        <ImageEditorTopBar
          session={session}
          isApplying={false}
          isHistoryOpen={false}
          onToggleHistory={action}
          actions={{
            undo: action,
            redo: action,
            revert: action,
            apply: action,
            applyAndTrace: action,
            close: action,
          }}
        />,
      ),
    );

    const bar = host.querySelector<HTMLElement>('[aria-label="Image Studio actions"]');
    expect(bar?.style.flexWrap).toBe('wrap');
    expect(bar?.querySelector('button[title^="Close"]')?.parentElement?.style.flexWrap).toBe(
      'wrap',
    );
    await act(async () => root.unmount());
  });

  it('scrolls the tool rail and gives the two-dimensional color pad keyboard control', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<EditorToolStrip />));

    const rail = host.querySelector<HTMLElement>('aside[aria-label="Image Studio tools"]');
    expect(rail?.style.overflowY).toBe('auto');
    const foreground = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Choose foreground color"]',
    );
    if (foreground === null) throw new Error('foreground control missing');
    await act(async () => foreground.click());

    const pad = host.querySelector<HTMLElement>('[aria-label="Saturation and brightness"]');
    if (pad === null) throw new Error('color pad missing');
    await pressKey(pad, 'ArrowRight');
    expect(pad.getAttribute('aria-valuenow')).toBe('1');
    await pressKey(pad, 'ArrowUp', true);
    expect(pad.getAttribute('aria-valuetext')).toContain('brightness 10%');
    const card = host.querySelector<HTMLElement>('[role="dialog"] > div');
    expect(card?.style.maxHeight).toContain('100vh');

    await act(async () => root.unmount());
  });

  it('traps and restores focus in the production Resize dialog', async () => {
    const mounted = mountWithOpener();
    useImageEditorStore.setState({
      session: createSession('resize-image', 'source.png', createEditorTestBuffer(2, 2), {
        minX: 0,
        minY: 0,
        maxX: 2,
        maxY: 2,
      }),
      transform: null,
    });
    useResizeDialogStore.getState().open('image-size');
    await act(async () => mounted.root.render(<ResizeDialogPanel />));

    const dialog = mounted.host.querySelector<HTMLElement>('[aria-label="Image Size"]');
    const width = mounted.host.querySelector<HTMLInputElement>('[aria-label="Width (px)"]');
    if (dialog === null || width === null) throw new Error('Resize dialog fixtures missing');
    expect(document.activeElement).toBe(width);
    const focusables = exposeFocusableChildren(dialog);
    const last = focusables.at(-1);
    if (last === undefined) throw new Error('Resize dialog focus controls missing');
    await act(async () => last.focus());
    await pressKey(dialog, 'Tab');
    expect(document.activeElement).toBe(width);

    await pressKey(dialog, 'Escape');
    expect(useResizeDialogStore.getState().dialog).toBeNull();
    expect(document.activeElement).toBe(mounted.opener);
    await act(async () => mounted.root.unmount());
  });

  it('lets the production Resize Cancel button keep native Enter semantics', async () => {
    const mounted = mountWithOpener();
    useImageEditorStore.setState({
      session: createSession('resize-cancel', 'source.png', createEditorTestBuffer(2, 2), {
        minX: 0,
        minY: 0,
        maxX: 2,
        maxY: 2,
      }),
      transform: null,
    });
    useResizeDialogStore.getState().open('image-size');
    useResizeDialogStore.getState().setWidthDraft('4');
    await act(async () => mounted.root.render(<ResizeDialogPanel />));
    const cancel = mounted.host.querySelector<HTMLButtonElement>('button[title^="Close without"]');
    if (cancel === null) throw new Error('Resize Cancel button missing');

    await pressKey(cancel, 'Enter');
    await act(async () => cancel.click());

    expect(useImageEditorStore.getState().session?.doc.width).toBe(2);
    expect(useResizeDialogStore.getState().dialog).toBeNull();
    await act(async () => mounted.root.unmount());
  });

  it('closes a blank Resize draft on Enter using the last valid size', async () => {
    const mounted = mountWithOpener();
    const session = createSession('resize-draft', 'source.png', createEditorTestBuffer(2, 2), {
      minX: 0,
      minY: 0,
      maxX: 2,
      maxY: 2,
    });
    useImageEditorStore.setState({ session, transform: null });
    useResizeDialogStore.getState().open('image-size');
    await act(async () => mounted.root.render(<ResizeDialogPanel />));
    const width = mounted.host.querySelector<HTMLInputElement>('[aria-label="Width (px)"]');
    if (width === null) throw new Error('Resize width field missing');

    await act(async () => {
      setInputValue(width, '');
      width.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    expect(width.value).toBe('');
    expect(width.getAttribute('aria-invalid')).toBe('true');

    await pressKey(width, 'Enter');
    expect(useImageEditorStore.getState().session).toBe(session);
    expect(useResizeDialogStore.getState().dialog).toBeNull();
    await act(async () => mounted.root.unmount());
  });

  it('traps and restores focus in the production Text dialog', async () => {
    const mounted = mountWithOpener();
    openTextDialog('Label');
    await act(async () => mounted.root.render(<TextDialog />));

    const dialog = mounted.host.querySelector<HTMLElement>('[aria-label="Add text"]');
    const text = mounted.host.querySelector<HTMLTextAreaElement>('[aria-label="Text content"]');
    if (dialog === null || text === null) throw new Error('Text dialog fixtures missing');
    expect(document.activeElement).toBe(text);
    const focusables = exposeFocusableChildren(dialog);
    const last = focusables.at(-1);
    if (last === undefined) throw new Error('Text dialog focus controls missing');
    last.focus();
    await pressKey(dialog, 'Tab');
    expect(document.activeElement).toBe(text);

    await pressKey(dialog, 'Escape');
    expect(useTextDialogStore.getState().isOpen).toBe(false);
    expect(document.activeElement).toBe(mounted.opener);
    await act(async () => mounted.root.unmount());
  });

  it('keeps a blank Text size draft visible until it is reconciled', async () => {
    const mounted = mountWithOpener();
    openTextDialog('Label');
    await act(async () => mounted.root.render(<TextDialog />));
    const size = mounted.host.querySelector<HTMLInputElement>('[aria-label="Text size in pixels"]');
    if (size === null) throw new Error('Text size field missing');

    await act(async () => {
      setInputValue(size, '');
      size.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });

    expect(size.value).toBe('');
    expect(size.getAttribute('aria-invalid')).toBe('true');

    await act(async () => size.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(size.value).toBe('48');
    expect(size.getAttribute('aria-invalid')).toBe('false');
    await act(async () => mounted.root.unmount());
  });

  it('announces exact Text raster failures inside the open dialog', async () => {
    const mounted = mountWithOpener();
    openTextDialog('Keep me');
    useTextDialogStore.setState({
      errorMessage: 'Could not add text: font bytes unavailable',
    });
    await act(async () => mounted.root.render(<TextDialog />));

    const alert = mounted.host.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toBe('Could not add text: font bytes unavailable');
    expect(
      mounted.host.querySelector<HTMLTextAreaElement>('[aria-label="Text content"]')?.value,
    ).toBe('Keep me');
    await act(async () => mounted.root.unmount());
  });

  it('traps and restores focus in the production Color Picker dialog', async () => {
    const mounted = mountWithOpener();
    await act(async () => mounted.root.render(<ColorPickerHarness />));

    const dialog = mounted.host.querySelector<HTMLElement>('[aria-label="Pick color"]');
    const pad = mounted.host.querySelector<HTMLElement>('[aria-label="Saturation and brightness"]');
    if (dialog === null || pad === null) throw new Error('Color Picker dialog fixtures missing');
    expect(document.activeElement).toBe(pad);
    const focusables = exposeFocusableChildren(dialog);
    const last = focusables.at(-1);
    if (last === undefined) throw new Error('Color Picker focus controls missing');
    last.focus();
    await pressKey(dialog, 'Tab');
    expect(document.activeElement).toBe(pad);

    await pressKey(dialog, 'Escape');
    expect(mounted.host.querySelector('[aria-label="Pick color"]')).toBeNull();
    expect(document.activeElement).toBe(mounted.opener);
    await act(async () => mounted.root.unmount());
  });

  it('lets the production Color Picker Cancel button keep native Enter semantics', async () => {
    const mounted = mountWithOpener();
    const onCommit = vi.fn();
    const onClose = vi.fn();
    await act(async () =>
      mounted.root.render(
        <ColorPickerDialog
          title="Keyboard color"
          initial={{ r: 0, g: 0, b: 0 }}
          onCommit={onCommit}
          onClose={onClose}
        />,
      ),
    );
    const cancel = mounted.host.querySelector<HTMLButtonElement>('button[title^="Close without"]');
    if (cancel === null) throw new Error('Color Picker Cancel button missing');

    await pressKey(cancel, 'Enter');
    await act(async () => cancel.click());

    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => mounted.root.unmount());
  });
});

function ColorPickerHarness(): JSX.Element | null {
  const [open, setOpen] = useState(true);
  return open ? (
    <ColorPickerDialog
      title="Pick color"
      initial={{ r: 0, g: 0, b: 0 }}
      onCommit={() => setOpen(false)}
      onClose={() => setOpen(false)}
    />
  ) : null;
}

function mountWithOpener(): {
  readonly opener: HTMLButtonElement;
  readonly host: HTMLDivElement;
  readonly root: ReturnType<typeof createRoot>;
} {
  const opener = document.createElement('button');
  opener.textContent = 'Open';
  const host = document.createElement('div');
  document.body.append(opener, host);
  opener.focus();
  return { opener, host, root: createRoot(host) };
}

function exposeFocusableChildren(dialog: HTMLElement): readonly HTMLElement[] {
  const focusables = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
  for (const focusable of focusables) {
    Object.defineProperty(focusable, 'offsetParent', { configurable: true, value: dialog });
  }
  return focusables;
}

async function pressKey(target: HTMLElement, key: string, shiftKey = false): Promise<void> {
  await act(async () =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })),
  );
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('native input value setter missing');
  setter.call(input, value);
}

function openTextDialog(text: string): void {
  useImageEditorStore.setState({
    session: createSession('text-dialog', 'source.png', createEditorTestBuffer(2, 2), {
      minX: 0,
      minY: 0,
      maxX: 2,
      maxY: 2,
    }),
    sessionOwner: null,
    transform: null,
  });
  useTextDialogStore.getState().open();
  useTextDialogStore.getState().setText(text);
}
