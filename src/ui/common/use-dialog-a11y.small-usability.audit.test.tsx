import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDialogA11y } from './use-dialog-a11y';

const roots: Root[] = [];

function Modal(props: { readonly close: () => void; readonly children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, props.close);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Audit modal" tabIndex={-1}>
      {props.children ?? <input aria-label="Draft" />}
    </div>
  );
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // Layout is not implemented by jsdom. Browser qualification is separate.
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.isConnected && !this.closest('[hidden]') ? this.parentElement : null;
  });
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function mount(children: JSX.Element) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(children));
  return host;
}

async function press(element: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  await act(async () => element.dispatchEvent(event));
  return event;
}

describe('small modal keyboard and focus audit', () => {
  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'does not discard a draft for an IME Escape (%j)',
    async (composition) => {
      const close = vi.fn();
      const host = await mount(<Modal close={close} />);
      const input = host.querySelector('input')!;
      input.value = 'Pending name';
      const event = await press(input, { key: 'Escape', ...composition });
      expect(close).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(input.value).toBe('Pending name');
      await press(input, { key: 'Escape' });
      expect(close).toHaveBeenCalledTimes(1);
    },
  );

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'does not replace IME Tab handling with a focus wrap (%j)',
    async (composition) => {
      const host = await mount(
        <Modal close={() => undefined}>
          <input aria-label="First" />
          <input aria-label="Last" />
        </Modal>,
      );
      const last = host.querySelector<HTMLInputElement>('[aria-label="Last"]')!;
      last.focus();
      const event = await press(last, { key: 'Tab', ...composition });
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(last);
    },
  );

  it('focuses the available action when opening with a disabled settings fieldset', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const host = await mount(
      <Modal close={() => undefined}>
        <fieldset disabled>
          <input aria-label="Unavailable setting" />
        </fieldset>
        <button type="button">Cancel</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(host.querySelector('button'));
  });

  it('Tab wraps to the first available control rather than a disabled fieldset child', async () => {
    const host = await mount(
      <Modal close={() => undefined}>
        <fieldset disabled>
          <input aria-label="Unavailable setting" />
        </fieldset>
        <button type="button">Cancel</button>
        <button type="button">Help</button>
      </Modal>,
    );
    const buttons = host.querySelectorAll('button');
    buttons[1]!.focus();
    await press(buttons[1]!, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it.each(['hidden', 'aria-hidden', 'inert'])(
    'initial focus and the Tab boundary skip a %s ancestor',
    async (attribute) => {
      const unavailable =
        attribute === 'hidden'
          ? { hidden: true }
          : attribute === 'aria-hidden'
            ? { 'aria-hidden': true }
            : { inert: '' };
      const host = await mount(
        <Modal close={() => undefined}>
          <div {...unavailable}>
            <input aria-label="Hidden setting" />
          </div>
          <input aria-label="Available setting" />
          <button type="button">Cancel</button>
        </Modal>,
      );
      const available = host.querySelector('[aria-label="Available setting"]')!;
      expect(document.activeElement).toBe(available);
      const last = host.querySelector('button')!;
      last.focus();
      await press(last, { key: 'Tab' });
      expect(document.activeElement).toBe(available);
    },
  );
});
