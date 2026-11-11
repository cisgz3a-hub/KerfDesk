import { afterEach, describe, expect, it } from 'vitest';
import {
  focusedControlOwnsKey,
  isArrowKeyWidgetEvent,
  isEditableShortcutTarget,
  isKeyboardActivationTarget,
  isTextEntryTarget,
} from './keyboard-targets';

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const element of mounted.splice(0)) element.remove();
});

function element(tag: string, attributes: Readonly<Record<string, string>> = {}): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  document.body.appendChild(node);
  mounted.push(node);
  return node;
}

function input(type?: string): HTMLElement {
  return element('input', type === undefined ? {} : { type });
}

function owns(
  target: HTMLElement,
  key: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
): boolean {
  return focusedControlOwnsKey({
    target,
    key,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    altKey: modifiers.altKey ?? false,
  });
}

describe('isTextEntryTarget', () => {
  it.each(['text', 'number', 'search', 'email', 'url', 'password', 'tel', 'date', 'time'])(
    'counts an input of type %s as a text field',
    (type) => {
      expect(isTextEntryTarget(input(type))).toBe(true);
    },
  );

  it('counts an input with no type, or a type the browser does not know, as a text field', () => {
    expect(isTextEntryTarget(input())).toBe(true);
    expect(isTextEntryTarget(input('not-a-real-type'))).toBe(true);
  });

  it('counts a text area, an editable element and a textbox role', () => {
    expect(isTextEntryTarget(element('textarea'))).toBe(true);
    expect(isTextEntryTarget(element('div', { contenteditable: 'true' }))).toBe(true);
    expect(isTextEntryTarget(element('div', { contenteditable: '' }))).toBe(true);
    expect(isTextEntryTarget(element('div', { role: 'textbox' }))).toBe(true);
    expect(isTextEntryTarget(element('div', { role: 'searchbox' }))).toBe(true);
  });

  it.each(['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file', 'image'])(
    'does not count an input of type %s',
    (type) => {
      expect(isTextEntryTarget(input(type))).toBe(false);
    },
  );

  it('does not count a drop-down, a button, plain content or nothing at all', () => {
    expect(isTextEntryTarget(element('select'))).toBe(false);
    expect(isTextEntryTarget(element('button'))).toBe(false);
    expect(isTextEntryTarget(element('div', { contenteditable: 'false' }))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

describe('focusedControlOwnsKey', () => {
  it('gives a text field every key', () => {
    const field = input('number');
    for (const key of ['Delete', 'Backspace', 'ArrowLeft', 'Escape', 'a', 'Enter']) {
      expect(owns(field, key)).toBe(true);
    }
    expect(owns(field, 'z', { ctrlKey: true })).toBe(true);
  });

  it('gives a slider its arrow and paging keys, with any modifier', () => {
    const slider = input('range');
    for (const key of ['ArrowLeft', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(owns(slider, key)).toBe(true);
    }
    expect(owns(slider, 'ArrowLeft', { ctrlKey: true })).toBe(true);
    expect(owns(slider, 'ArrowLeft', { altKey: true })).toBe(true);
    for (const key of ['Delete', 'Backspace', 'Escape', 'h', ' ', 'Enter']) {
      expect(owns(slider, key)).toBe(false);
    }
    expect(owns(slider, 'z', { ctrlKey: true })).toBe(false);
  });

  it('gives a drop-down its arrows, Enter, Space and the letters that jump to an option', () => {
    const select = element('select');
    for (const key of ['ArrowDown', 'Home', 'PageDown', 'Enter', ' ', 't', '5', '.', '-']) {
      expect(owns(select, key)).toBe(true);
    }
    expect(owns(select, 'ArrowDown', { altKey: true })).toBe(true);
    for (const key of ['Delete', 'Backspace', 'Escape', 'F12']) {
      expect(owns(select, key)).toBe(false);
    }
    expect(owns(select, 'z', { ctrlKey: true })).toBe(false);
    expect(owns(select, 'c', { metaKey: true })).toBe(false);
    expect(owns(select, 'm', { altKey: true })).toBe(false);
  });

  it('gives a radio button its arrows and Space, and a tick box only Space', () => {
    const radio = input('radio');
    expect(owns(radio, 'ArrowDown')).toBe(true);
    expect(owns(radio, ' ')).toBe(true);
    expect(owns(radio, 'Home')).toBe(false);
    expect(owns(radio, 'Delete')).toBe(false);
    const checkbox = input('checkbox');
    expect(owns(checkbox, ' ')).toBe(true);
    for (const key of ['ArrowLeft', 'Delete', 'Enter', 'h', 'Escape']) {
      expect(owns(checkbox, key)).toBe(false);
    }
  });

  it('gives a colour, file or button input Enter and Space', () => {
    for (const type of ['color', 'file', 'button', 'submit', 'reset', 'image']) {
      const push = input(type);
      expect(owns(push, 'Enter')).toBe(true);
      expect(owns(push, ' ')).toBe(true);
      expect(owns(push, 'Delete')).toBe(false);
      expect(owns(push, 'ArrowLeft')).toBe(false);
    }
  });

  it('owns nothing for a button, the page body or no target', () => {
    expect(owns(element('button'), 'Delete')).toBe(false);
    expect(owns(document.body, 'Delete')).toBe(false);
    expect(
      focusedControlOwnsKey({
        target: null,
        key: 'Delete',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      }),
    ).toBe(false);
  });
});

describe('the machine keys keep the broad rule', () => {
  // use-jog-shortcuts.ts and use-job-shortcuts.ts ask these: a focused form
  // control of any kind must never let a key through to the machine.
  it.each(['checkbox', 'radio', 'range', 'color', 'text', 'number'])(
    'an input of type %s is still an editable and activation target',
    (type) => {
      expect(isEditableShortcutTarget(input(type))).toBe(true);
      expect(isKeyboardActivationTarget(input(type))).toBe(true);
    },
  );

  it('a drop-down and a text area are still editable targets', () => {
    expect(isEditableShortcutTarget(element('select'))).toBe(true);
    expect(isEditableShortcutTarget(element('textarea'))).toBe(true);
  });
});

describe('isArrowKeyWidgetEvent', () => {
  function arrowOn(target: HTMLElement): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });
    Object.defineProperty(event, 'target', { value: target, configurable: true });
    return event;
  }

  it('reads a native slider, radio button and drop-down as arrow-key widgets', () => {
    expect(isArrowKeyWidgetEvent(arrowOn(input('range')))).toBe(true);
    expect(isArrowKeyWidgetEvent(arrowOn(input('radio')))).toBe(true);
    expect(isArrowKeyWidgetEvent(arrowOn(element('select')))).toBe(true);
  });

  it('does not read a tick box or a plain button as one', () => {
    expect(isArrowKeyWidgetEvent(arrowOn(input('checkbox')))).toBe(false);
    expect(isArrowKeyWidgetEvent(arrowOn(element('button')))).toBe(false);
  });
});
