import { act, useRef, useState } from 'react';
import { expect, it, vi } from 'vitest';
import { clickControl, control, mountControl } from '../image-editor/control-audit-test-support';
import { FontPicker } from './FontPicker';
import { useDialogA11y } from '../common/use-dialog-a11y';

vi.mock('./font-loader', () => ({
  cssFamilyForFont: (key: string) => `lf2-${key}`,
  ensureFontCss: async () => undefined,
}));

it('browses with arrows, Home and End, then returns focus without cancelling the text editor', async () => {
  const parentKey = vi.fn();
  const change = vi.fn();
  const host = await mountControl(
    <div onKeyDown={parentKey}>
      <FontPicker value="roboto-regular" onChange={change} />
    </div>,
  );
  await clickControl(host, 'Font');
  const menu = fontMenu(host);
  const search = menu.querySelector('input')!;
  const buttons = [...menu.querySelectorAll('[role="option"] button')];
  expect(document.activeElement).toBe(search);
  await key(search, 'ArrowDown');
  expect(document.activeElement).toBe(buttons[0]);
  await key(buttons[0]!, 'End');
  expect(document.activeElement).toBe(buttons.at(-1));
  await key(buttons.at(-1)!, 'Home');
  expect(document.activeElement).toBe(buttons[0]);
  await key(buttons[0]!, 'ArrowUp');
  expect(document.activeElement).toBe(buttons.at(-1));
  await key(buttons.at(-1)!, 'Escape');
  expect(menu.isConnected).toBe(false);
  expect(document.activeElement).toBe(control(host, 'Font'));
  expect(parentKey).not.toHaveBeenCalled();
  expect(change).not.toHaveBeenCalled();
});

it('searches font names, categories and project fonts; an empty result cannot change the font', async () => {
  const change = vi.fn();
  const host = await mountControl(
    <FontPicker
      value="roboto-regular"
      onChange={change}
      previewText={'My café\nSecond line'}
      embeddedFonts={[{ key: 'embedded-audit', fileName: 'My imported font.ttf', dataBase64: '' }]}
    />,
  );
  await clickControl(host, 'Font');
  const menu = fontMenu(host);
  const search = menu.querySelector('input')!;
  await searchFor(search, '  GREAT VIBES  ');
  expect(menu.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(menu.textContent).toContain('My café');
  expect(menu.textContent).not.toContain('Second line');
  await searchFor(search, 'project font');
  expect(menu.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(menu.textContent).toContain('My imported font.ttf');
  await searchFor(search, 'No such font');
  expect(menu.textContent).toContain('No fonts match your search.');
  await key(search, 'Enter');
  expect(change).not.toHaveBeenCalled();
  expect(menu.isConnected).toBe(true);
  await searchFor(search, 'Great Vibes');
  await key(search, 'Enter');
  expect(change).toHaveBeenCalledExactlyOnceWith('great-vibes-regular');
  expect(menu.isConnected).toBe(false);
  expect(document.activeElement).toBe(control(host, 'Font'));
});

it('IME confirmation and cancellation keep the chooser open without selecting a font', async () => {
  const change = vi.fn();
  const host = await mountControl(<FontPicker value="roboto-regular" onChange={change} />);
  await clickControl(host, 'Font');
  const menu = fontMenu(host);
  const search = menu.querySelector('input')!;
  await searchFor(search, 'Great Vibes');
  for (const keyName of ['Enter', 'Escape', 'ArrowDown', 'Tab']) {
    await key(search, keyName, { isComposing: true });
    expect(document.activeElement).toBe(search);
    expect(menu.isConnected).toBe(true);
  }
  await key(search, 'Enter', { keyCode: 229 });
  expect(menu.isConnected).toBe(true);
  expect(change).not.toHaveBeenCalled();
  await key(search, 'Enter');
  expect(change).toHaveBeenCalledExactlyOnceWith('great-vibes-regular');
});

it('keeps the font chooser inside its modal and retires it when the save owner disables editing', async () => {
  const change = vi.fn();
  let disable: (value: boolean) => void = () => undefined;
  function Harness() {
    const [disabled, setDisabled] = useState(false);
    disable = setDisabled;
    return (
      <div role="dialog" aria-modal="true" aria-label="Text editor">
        <fieldset disabled={disabled}>
          <FontPicker value="roboto-regular" onChange={change} disabled={disabled} />
        </fieldset>
      </div>
    );
  }
  const host = await mountControl(<Harness />);
  await clickControl(host, 'Font');
  const menu = fontMenu(host);
  expect(menu.parentElement).toBe(host.querySelector('[aria-modal="true"]'));
  await act(async () => disable(true));
  expect(menu.isConnected).toBe(false);
  expect(control(host, 'Font').disabled).toBe(true);
  await clickControl(host, 'Font');
  expect(control(host, 'Font').getAttribute('aria-expanded')).toBe('false');
  expect(change).not.toHaveBeenCalled();
  await act(async () => disable(false));
  await clickControl(host, 'Font');
  expect(fontMenu(host).isConnected).toBe(true);
});

it('Escape belongs to the open font chooser before the native modal listener', async () => {
  const closeModal = vi.fn();
  function Modal() {
    const ref = useRef<HTMLDivElement>(null);
    useDialogA11y(ref, closeModal);
    return (
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Text editor">
        <FontPicker value="roboto-regular" onChange={() => undefined} />
      </div>
    );
  }
  const host = await mountControl(<Modal />);
  await clickControl(host, 'Font');
  const menu = fontMenu(host);
  const search = menu.querySelector('input')!;
  await key(search, 'Escape', { isComposing: true });
  expect(menu.isConnected).toBe(true);
  await key(search, 'Escape');
  expect(menu.isConnected).toBe(false);
  expect(closeModal).not.toHaveBeenCalled();
  await clickControl(host, 'Font');
  await key(control(host, 'Font'), 'Escape');
  expect(control(host, 'Font').getAttribute('aria-expanded')).toBe('false');
  expect(closeModal).not.toHaveBeenCalled();
  await key(control(host, 'Font'), 'Escape');
  expect(closeModal).toHaveBeenCalledTimes(1);
});

function fontMenu(host: ParentNode): HTMLElement {
  const id = control(host, 'Font').getAttribute('aria-controls');
  const menu = id === null ? null : document.getElementById(id);
  if (menu === null) throw new Error('Font chooser missing');
  return menu;
}

async function key(target: Element, value: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, ...init }));
  });
}

async function searchFor(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
