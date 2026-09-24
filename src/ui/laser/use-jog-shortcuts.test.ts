// PageUp/PageDown jog Z one focus step (MCH-07). On a CNC that is the bit going
// down into the stock, so a Page key meant to scroll a list or the Artwork /
// Operations panel must scroll it and never move the machine (controller audit
// 2026-09-23, ui-panel-3). The oracle is whether a jog was requested and
// whether the browser's own scrolling was left alone.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { installJogShortcuts } from './use-jog-shortcuts';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function pressOn(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('PageUp/PageDown Z-focus jog', () => {
  it('jogs from a jog-pad button, as designed', () => {
    const onFocusJog = vi.fn();
    const uninstall = installJogShortcuts(window, { focusDisabled: () => false, onFocusJog });
    const host = mount('<div class="lf-jog-panel"><button type="button">Z-</button></div>');

    const event = pressOn(host.querySelector('button') as HTMLElement, 'PageDown');

    expect(onFocusJog).toHaveBeenCalledWith(-1);
    expect(event.defaultPrevented).toBe(true);
    uninstall();
  });

  it('leaves a focused scroll region scrolling', () => {
    const onFocusJog = vi.fn();
    const uninstall = installJogShortcuts(window, { focusDisabled: () => false, onFocusJog });
    const host = mount('<div role="tabpanel" tabindex="0">Operations</div>');

    const event = pressOn(host.querySelector('[role="tabpanel"]') as HTMLElement, 'PageDown');

    expect(onFocusJog).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    uninstall();
  });

  it('never moves the machine from inside the Artwork / Operations panel', () => {
    const onFocusJog = vi.fn();
    const uninstall = installJogShortcuts(window, { focusDisabled: () => false, onFocusJog });
    const host = mount(
      '<aside class="lf-artwork-panel"><button type="button">Edit settings</button></aside>',
    );

    pressOn(host.querySelector('button') as HTMLElement, 'PageDown');
    pressOn(host.querySelector('button') as HTMLElement, 'PageUp');

    expect(onFocusJog).not.toHaveBeenCalled();
    uninstall();
  });

  it('ignores a key a closer handler already consumed', () => {
    const onFocusJog = vi.fn();
    const uninstall = installJogShortcuts(window, { focusDisabled: () => false, onFocusJog });
    const host = mount('<div><button type="button">Other</button></div>');
    host.addEventListener('keydown', (event) => event.preventDefault());

    pressOn(host.querySelector('button') as HTMLElement, 'PageDown');

    expect(onFocusJog).not.toHaveBeenCalled();
    uninstall();
  });
});
