// Ctrl/Cmd+Alt+PageUp / PageDown jog Z one focus step (MCH-07; ADR-493
// Amendment 2). On a CNC that is the bit going down into the stock, so a Page
// key meant to scroll a list or the Artwork / Operations panel must scroll it
// and never move the machine (controller audit 2026-09-23, ui-panel-3). Bare
// PgUp / PgDn are LightBurn's draw-order keys and never move the machine
// (rolling audit v7 L8-P2-3). The oracle is whether a jog was requested and
// whether the browser's own scrolling was left alone.
//
// XY keyboard jog (LightBurn gap LBG-M07, ADR-493) uses LightBurn's Move-window
// keys. The oracle is the machine vector the key asks for: it must be the one
// the jog pad's matching arrow sends, for a front-left and a mirrored
// (rear-right) origin. Bare arrows, and the arrows a NumLock-off keypad sends,
// belong to the canvas nudge and must never move the machine (F104). Nor may
// the Home / PageUp / End / PageDown a NumLock-off keypad 7 / 9 / 1 / 3 sends:
// with NumLock on those keys jog XY, so read as Page keys they moved Z
// instead (controller audit v2, C8-P2-1; ADR-493 Amendment 1).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { jogAxisSignsForOrigin } from '../../core/devices/jog-direction';
import { useUiStore } from '../state/ui-store';
import type { JogVector } from './jog-control-policy';
import { installJogShortcuts, type XyJogStep } from './use-jog-shortcuts';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

// The Z jog chord: Ctrl+Alt (Cmd+Option on macOS) with a Page key.
const Z_CHORD = { ctrlKey: true, altKey: true } as const;

function pressOn(
  target: HTMLElement,
  key: string,
  init: KeyboardEventInit = Z_CHORD,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, ...init, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

const FRONT_LEFT: XyJogStep = {
  stepMm: 10,
  feed: 3000,
  signs: jogAxisSignsForOrigin('front-left'),
};
const REAR_RIGHT: XyJogStep = {
  stepMm: 10,
  feed: 3000,
  signs: jogAxisSignsForOrigin('rear-right'),
};

function install(
  options: {
    readonly focusDisabled?: boolean;
    readonly xyDisabled?: boolean;
    readonly xyStep?: XyJogStep;
  } = {},
): {
  readonly onFocusJog: ReturnType<typeof vi.fn>;
  readonly onXyJog: ReturnType<typeof vi.fn>;
  readonly uninstall: () => void;
} {
  const onFocusJog = vi.fn();
  const onXyJog = vi.fn();
  const uninstall = installJogShortcuts(window, {
    focusDisabled: () => options.focusDisabled ?? false,
    onFocusJog,
    xyDisabled: () => options.xyDisabled ?? false,
    xyStep: () => options.xyStep ?? FRONT_LEFT,
    onXyJog,
  });
  return { onFocusJog, onXyJog, uninstall };
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  useUiStore.setState({ modalDepth: 0 });
  document.body.replaceChildren();
});

describe('Ctrl+Alt+PageUp/PageDown Z-focus jog', () => {
  it('jogs from a jog-pad button, as designed', () => {
    const { onFocusJog, onXyJog, uninstall } = install();
    cleanup = uninstall;
    const host = mount('<div class="lf-jog-panel"><button type="button">Z-</button></div>');

    const event = pressOn(host.querySelector('button') as HTMLElement, 'PageDown');

    expect(onFocusJog).toHaveBeenCalledWith(-1);
    expect(onXyJog).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves a focused scroll region scrolling', () => {
    const { onFocusJog, uninstall } = install();
    cleanup = uninstall;
    const host = mount('<div role="tabpanel" tabindex="0">Operations</div>');

    const event = pressOn(host.querySelector('[role="tabpanel"]') as HTMLElement, 'PageDown');

    expect(onFocusJog).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('never moves the machine from inside the Artwork panel', () => {
    const { onFocusJog, uninstall } = install();
    cleanup = uninstall;
    const host = mount(
      '<aside class="lf-artwork-panel"><button type="button">Edit settings</button></aside>',
    );

    pressOn(host.querySelector('button') as HTMLElement, 'PageDown');
    pressOn(host.querySelector('button') as HTMLElement, 'PageUp');

    expect(onFocusJog).not.toHaveBeenCalled();
  });

  it('ignores a key a closer handler already consumed', () => {
    const { onFocusJog, uninstall } = install();
    cleanup = uninstall;
    const host = mount('<div><button type="button">Other</button></div>');
    host.addEventListener('keydown', (event) => event.preventDefault());

    pressOn(host.querySelector('button') as HTMLElement, 'PageDown');

    expect(onFocusJog).not.toHaveBeenCalled();
  });

  it('still jogs Z with the XY keys installed, and a Page key never jogs XY', () => {
    const { onFocusJog, onXyJog, uninstall } = install();
    cleanup = uninstall;

    press({ key: 'PageUp', code: 'PageUp', ...Z_CHORD });

    expect(onFocusJog).toHaveBeenCalledWith(1);
    expect(onXyJog).not.toHaveBeenCalled();
  });

  it('jogs Z from Cmd+Option on macOS', () => {
    const { onFocusJog, uninstall } = install();
    cleanup = uninstall;

    press({ key: 'PageDown', code: 'PageDown', metaKey: true, altKey: true });

    expect(onFocusJog).toHaveBeenCalledWith(-1);
  });

  // LightBurn's PgUp / PgDn push the selection in draw order, and its Ctrl and
  // Alt chords restack and align: none of them may move the machine here.
  it.each([
    ['bare PageUp (Bring Forward)', { key: 'PageUp', code: 'PageUp' }],
    ['bare PageDown (Send Backward)', { key: 'PageDown', code: 'PageDown' }],
    ['Ctrl+PageUp (Bring to Front)', { key: 'PageUp', code: 'PageUp', ctrlKey: true }],
    ['Alt+PageDown (Align Center Y)', { key: 'PageDown', code: 'PageDown', altKey: true }],
    ['Shift+PageUp', { key: 'PageUp', code: 'PageUp', shiftKey: true }],
    ['Ctrl+Alt+Shift+PageDown', { key: 'PageDown', code: 'PageDown', ...Z_CHORD, shiftKey: true }],
  ] as ReadonlyArray<[string, KeyboardEventInit]>)('%s never jogs Z', (_name, init) => {
    const { onFocusJog, onXyJog, uninstall } = install();
    cleanup = uninstall;

    const event = press(init);

    expect(onFocusJog).not.toHaveBeenCalled();
    expect(onXyJog).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  // A browser names the keypad by code, by location, or both; either alone
  // must keep the key off the Z jog.
  it.each([
    ['NumLock-off Numpad 9 (sends PageUp)', numLockOff('9', 'PageUp')],
    ['NumLock-off Numpad 3 (sends PageDown)', numLockOff('3', 'PageDown')],
    ['a keypad PageDown named only by its code', { key: 'PageDown', code: 'Numpad3' }],
    [
      'a keypad PageUp named only by its location',
      { key: 'PageUp', code: '', location: KeyboardEvent.DOM_KEY_LOCATION_NUMPAD },
    ],
  ] as ReadonlyArray<[string, KeyboardEventInit]>)('%s never jogs Z, chord held', (_name, init) => {
    const { onFocusJog, onXyJog, uninstall } = install();
    cleanup = uninstall;

    const event = press({ ...init, ...Z_CHORD });

    expect(onFocusJog).not.toHaveBeenCalled();
    expect(onXyJog).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('keeps the dedicated PageDown key jogging Z', () => {
    const { onFocusJog, uninstall } = install();
    cleanup = uninstall;

    const event = press({
      key: 'PageDown',
      code: 'PageDown',
      location: KeyboardEvent.DOM_KEY_LOCATION_STANDARD,
      ...Z_CHORD,
    });

    expect(onFocusJog).toHaveBeenCalledWith(-1);
    expect(event.defaultPrevented).toBe(true);
  });
});

// LightBurn's Move window: Left = Alt+Ctrl+[, Right = Alt+Ctrl+], Up =
// Shift+Ctrl+], Down = Shift+Ctrl+[. Shift makes the key '{'/'}', and Ctrl+Alt
// is AltGr on many layouts, so only the physical code is stable.
const XY_KEYS: ReadonlyArray<{
  readonly name: string;
  readonly init: KeyboardEventInit;
  readonly frontLeft: JogVector;
  readonly rearRight: JogVector;
}> = [
  {
    name: 'Ctrl+Shift+] (up)',
    init: { key: '}', code: 'BracketRight', ctrlKey: true, shiftKey: true },
    frontLeft: { dy: 10, feed: 3000 },
    rearRight: { dy: -10, feed: 3000 },
  },
  {
    name: 'Cmd+Shift+[ (down)',
    init: { key: '{', code: 'BracketLeft', metaKey: true, shiftKey: true },
    frontLeft: { dy: -10, feed: 3000 },
    rearRight: { dy: 10, feed: 3000 },
  },
  {
    name: 'Ctrl+Alt+[ (left)',
    init: { key: '[', code: 'BracketLeft', ctrlKey: true, altKey: true },
    frontLeft: { dx: -10, feed: 3000 },
    rearRight: { dx: 10, feed: 3000 },
  },
  {
    name: 'Cmd+Option+] (right; Option changes the typed character)',
    init: { key: '‘', code: 'BracketRight', metaKey: true, altKey: true },
    frontLeft: { dx: 10, feed: 3000 },
    rearRight: { dx: -10, feed: 3000 },
  },
  {
    name: 'Numpad 8',
    init: numpad('8'),
    frontLeft: { dy: 10, feed: 3000 },
    rearRight: { dy: -10, feed: 3000 },
  },
  {
    name: 'Numpad 2',
    init: numpad('2'),
    frontLeft: { dy: -10, feed: 3000 },
    rearRight: { dy: 10, feed: 3000 },
  },
  {
    name: 'Numpad 4',
    init: numpad('4'),
    frontLeft: { dx: -10, feed: 3000 },
    rearRight: { dx: 10, feed: 3000 },
  },
  {
    name: 'Numpad 6',
    init: numpad('6'),
    frontLeft: { dx: 10, feed: 3000 },
    rearRight: { dx: -10, feed: 3000 },
  },
  {
    name: 'Numpad 7 (up-left)',
    init: numpad('7'),
    frontLeft: { dx: -10, dy: 10, feed: 3000 },
    rearRight: { dx: 10, dy: -10, feed: 3000 },
  },
  {
    name: 'Numpad 9 (up-right)',
    init: numpad('9'),
    frontLeft: { dx: 10, dy: 10, feed: 3000 },
    rearRight: { dx: -10, dy: -10, feed: 3000 },
  },
  {
    name: 'Numpad 1 (down-left)',
    init: numpad('1'),
    frontLeft: { dx: -10, dy: -10, feed: 3000 },
    rearRight: { dx: 10, dy: 10, feed: 3000 },
  },
  {
    name: 'Numpad 3 (down-right)',
    init: numpad('3'),
    frontLeft: { dx: 10, dy: -10, feed: 3000 },
    rearRight: { dx: -10, dy: 10, feed: 3000 },
  },
];

// A NumLock-on keypad sends the digit as the key and NumpadN as the code.
function numpad(digit: string): KeyboardEventInit {
  return { key: digit, code: `Numpad${digit}` };
}

// A NumLock-off keypad keeps NumpadN as the code and the keypad location, and
// sends the navigation key printed under the digit (W3C UI Events).
function numLockOff(digit: string, key: string): KeyboardEventInit {
  return { key, code: `Numpad${digit}`, location: KeyboardEvent.DOM_KEY_LOCATION_NUMPAD };
}

describe('keyboard XY jog (ADR-493)', () => {
  it.each(XY_KEYS)('$name jogs one step on a front-left machine', ({ init, frontLeft }) => {
    const { onXyJog, onFocusJog, uninstall } = install({ xyStep: FRONT_LEFT });
    cleanup = uninstall;

    const event = press(init);

    expect(onXyJog).toHaveBeenCalledTimes(1);
    expect(onXyJog).toHaveBeenCalledWith(frontLeft);
    expect(onFocusJog).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it.each(XY_KEYS)('$name keeps its physical direction on a rear-right machine', (row) => {
    const { onXyJog, uninstall } = install({ xyStep: REAR_RIGHT });
    cleanup = uninstall;

    press(row.init);

    expect(onXyJog).toHaveBeenCalledWith(row.rearRight);
  });

  it('uses the step and feed the pad reports at the moment of the key press', () => {
    const { onXyJog, uninstall } = install({ xyStep: { ...FRONT_LEFT, stepMm: 0.5, feed: 600 } });
    cleanup = uninstall;

    press(numpad('6'));

    expect(onXyJog).toHaveBeenCalledWith({ dx: 0.5, feed: 600 });
  });

  it.each([
    ['bare ArrowUp (canvas nudge)', { key: 'ArrowUp', code: 'ArrowUp' }],
    [
      'Shift+ArrowLeft (canvas nudge 10 mm)',
      { key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true },
    ],
    ['NumLock-off Numpad 8 (sends ArrowUp)', numLockOff('8', 'ArrowUp')],
    ['NumLock-off Numpad 4 (sends ArrowLeft)', numLockOff('4', 'ArrowLeft')],
    ['NumLock-off Numpad 7 (sends Home)', numLockOff('7', 'Home')],
    ['NumLock-off Numpad 9 (sends PageUp)', numLockOff('9', 'PageUp')],
    ['NumLock-off Numpad 1 (sends End)', numLockOff('1', 'End')],
    ['NumLock-off Numpad 3 (sends PageDown)', numLockOff('3', 'PageDown')],
    ['Numpad 5', numpad('5')],
    ['Ctrl+Numpad 8', { ...numpad('8'), ctrlKey: true }],
    ['top-row 8', { key: '8', code: 'Digit8' }],
    ['bare [ (image editor brush size)', { key: '[', code: 'BracketLeft' }],
    ['Ctrl+] without Alt or Shift', { key: ']', code: 'BracketRight', ctrlKey: true }],
    ['Alt+Shift+] without Ctrl', { key: '}', code: 'BracketRight', altKey: true, shiftKey: true }],
    [
      'Ctrl+Alt+Shift+[',
      { key: '{', code: 'BracketLeft', ctrlKey: true, altKey: true, shiftKey: true },
    ],
  ] as ReadonlyArray<[string, KeyboardEventInit]>)('%s never moves the machine', (_name, init) => {
    const { onXyJog, onFocusJog, uninstall } = install();
    cleanup = uninstall;

    const event = press(init);

    expect(onXyJog).not.toHaveBeenCalled();
    expect(onFocusJog).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('sends one step per press and ignores auto-repeat', () => {
    const { onXyJog, uninstall } = install();
    cleanup = uninstall;

    press(numpad('8'));
    press({ ...numpad('8'), repeat: true });
    press({ ...numpad('8'), repeat: true });

    expect(onXyJog).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the jog pad is disabled, and leaves the key alone', () => {
    const { onXyJog, uninstall } = install({ xyDisabled: true });
    cleanup = uninstall;

    const chord = press({ key: '}', code: 'BracketRight', ctrlKey: true, shiftKey: true });
    const keypad = press(numpad('4'));

    expect(onXyJog).not.toHaveBeenCalled();
    expect(chord.defaultPrevented).toBe(false);
    expect(keypad.defaultPrevented).toBe(false);
  });

  it('keeps XY and Z gates independent', () => {
    const { onXyJog, onFocusJog, uninstall } = install({ focusDisabled: true });
    cleanup = uninstall;

    press({ key: 'PageDown', code: 'PageDown', ...Z_CHORD });
    press(numpad('2'));

    expect(onFocusJog).not.toHaveBeenCalled();
    expect(onXyJog).toHaveBeenCalledWith({ dy: -10, feed: 3000 });
  });

  it('leaves typing in a text field alone', () => {
    const { onXyJog, uninstall } = install();
    cleanup = uninstall;
    const host = mount('<input type="text" aria-label="Width" /><textarea></textarea>');

    const typed = press(numpad('8'), host.querySelector('input') as HTMLElement);
    press(
      { key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true },
      host.querySelector('textarea') as HTMLElement,
    );

    expect(onXyJog).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
  });

  it('stands down while a modal (such as the image editor) owns the keyboard', () => {
    const { onXyJog, uninstall } = install();
    cleanup = uninstall;
    useUiStore.getState().registerModal();

    press({ key: '[', code: 'BracketLeft', ctrlKey: true, altKey: true });
    press(numpad('6'));

    expect(onXyJog).not.toHaveBeenCalled();
  });

  it('leaves a focused list its typeahead and a consumed key its handler', () => {
    const { onXyJog, uninstall } = install();
    cleanup = uninstall;
    const host = mount(
      '<div role="listbox" tabindex="0"></div><div id="closer"><button type="button"></button></div>',
    );
    const closer = host.querySelector('#closer') as HTMLElement;
    closer.addEventListener('keydown', (event) => event.preventDefault());

    press(numpad('8'), host.querySelector('[role="listbox"]') as HTMLElement);
    press(numpad('8'), closer.querySelector('button') as HTMLElement);

    expect(onXyJog).not.toHaveBeenCalled();
  });

  it('stops listening once uninstalled', () => {
    const { onXyJog, uninstall } = install();
    uninstall();

    press(numpad('8'));

    expect(onXyJog).not.toHaveBeenCalled();
  });
});
