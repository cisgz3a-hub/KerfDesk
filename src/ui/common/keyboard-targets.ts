/**
 * Any form control, text field or not. The machine keys (jog, Start) keep this
 * broad rule: a focused slider, tick box or drop-down never moves the machine.
 * Design shortcuts ask `focusedControlOwnsKey` instead, which is per key.
 */
export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (isFormEditingTag(target.tagName)) return true;
  if (target.isContentEditable) return true;
  const editableAttr = target.getAttribute('contenteditable');
  if (editableAttr !== null && editableAttr !== 'false') return true;
  return target.getAttribute('role') === 'textbox';
}

// Inputs that hold no text. Every other input type (text, number, search,
// email, url, password, tel, the date and time kinds, and any type a browser
// does not know and so shows as text) is a field the user types into.
type NativeControlKind = 'select' | 'range' | 'radio' | 'checkbox' | 'push';
const PUSH_INPUT_TYPES: ReadonlySet<string> = new Set([
  'color',
  'button',
  'submit',
  'reset',
  'file',
  'image',
]);

function nativeControlKind(target: HTMLElement): NativeControlKind | null {
  if (target.tagName === 'SELECT') return 'select';
  if (target.tagName !== 'INPUT') return null;
  const type = (target as HTMLInputElement).type.toLowerCase();
  if (type === 'range' || type === 'radio' || type === 'checkbox') return type;
  return PUSH_INPUT_TYPES.has(type) ? 'push' : null;
}

/** A field the user types text into: its editing keys are never app shortcuts. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'TEXTAREA') return true;
  if (target.tagName === 'INPUT') return nativeControlKind(target) === null;
  if (target.tagName === 'SELECT') return false;
  if (target.isContentEditable) return true;
  const editableAttr = target.getAttribute('contenteditable');
  if (editableAttr !== null && editableAttr !== 'false') return true;
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'searchbox';
}

const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);
const ARROW_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
]);

type ShortcutKeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'> & {
  readonly target: EventTarget | null;
};

/**
 * Whether the focused control answers this key itself, so a design shortcut
 * must leave it alone. A text field owns every key. A control that holds no
 * text owns only the keys that work it: a slider its arrow and paging keys, a
 * drop-down those plus Enter, Space and the letters that jump to an option, a
 * radio button the arrows and Space, a tick box Space, a colour or file button
 * Enter and Space. Everything else passes, so Delete, Ctrl+Z, copy and paste
 * still work after a tick box, slider or drop-down was the last thing touched
 * (annoyance audit A4-P2-2).
 */
export function focusedControlOwnsKey(event: ShortcutKeyEvent): boolean {
  const target = event.target;
  if (isTextEntryTarget(target)) return true;
  if (!(target instanceof HTMLElement)) return false;
  const key = event.key;
  switch (nativeControlKind(target)) {
    case 'select':
      return NAVIGATION_KEYS.has(key) || isActivationKey(key) || isTypedCharacter(event);
    case 'range':
      return NAVIGATION_KEYS.has(key);
    case 'radio':
      return ARROW_KEYS.has(key) || key === ' ';
    case 'checkbox':
      return key === ' ';
    case 'push':
      return isActivationKey(key);
    case null:
      return false;
  }
}

function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ';
}

// A bare letter, digit or sign: a focused drop-down jumps to the option it starts.
function isTypedCharacter(event: ShortcutKeyEvent): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

const SCROLL_REGION_ROLES: ReadonlySet<string> = new Set([
  'tabpanel',
  'region',
  'log',
  'listbox',
  'grid',
  'tree',
  'tablist',
]);

/**
 * A focused scroll or list region, or anything inside the Artwork/Operations
 * panel. Page and arrow keys there mean "scroll this", so a window-level
 * shortcut that moves the machine must leave them to the browser: when the
 * Z-focus jog was bound to bare PageUp/PageDown, scrolling the operations list
 * drove a CNC bit down into the stock (audit ui-panel-3). The draw-order Page
 * keys leave them too (ADR-493 Amendment 2).
 */
export function isScrollRegionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('.lf-artwork-panel') !== null) return true;
  const role = target.getAttribute('role');
  return role !== null && SCROLL_REGION_ROLES.has(role);
}

// Widgets whose own arrow keys move within them (WAI-ARIA keyboard patterns).
const ARROW_KEY_WIDGET_ROLES: ReadonlySet<string> = new Set([
  ...SCROLL_REGION_ROLES,
  'tab',
  'radio',
  'radiogroup',
  'slider',
  'spinbutton',
  'scrollbar',
  'separator',
  'option',
  'treeitem',
  'gridcell',
  'row',
  'combobox',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
]);

/**
 * An arrow key that a focused widget answers itself: a tab strip switching tabs,
 * a slider, a radio group, a list or a menu. A window-level arrow binding such as
 * the selection nudge must leave it alone, or one key does two things. A plain
 * button is not such a widget, so bare arrows still nudge from it (ADR-493).
 */
export function isArrowKeyWidgetEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  // A native slider, radio button or drop-down has no role attribute to read.
  const native = nativeControlKind(target);
  if (native === 'range' || native === 'radio' || native === 'select') return true;
  const role = target.getAttribute('role');
  return role !== null && ARROW_KEY_WIDGET_ROLES.has(role);
}

export function isKeyboardActivationTarget(target: EventTarget | null): boolean {
  if (isEditableShortcutTarget(target)) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'BUTTON' || target.tagName === 'SELECT' || target.tagName === 'SUMMARY')
    return true;
  const role = target.getAttribute('role');
  return (
    role === 'button' ||
    role === 'checkbox' ||
    role === 'radio' ||
    role === 'separator' ||
    role === 'slider' ||
    role === 'switch'
  );
}

/**
 * Enter on a focused control (a button, link or menu item) activates that
 * control, so a window-level Enter binding such as finishing the pen must leave
 * it alone rather than swallow the activation.
 */
export function isEnterActivationTarget(target: EventTarget | null): boolean {
  if (isKeyboardActivationTarget(target)) return true;
  return (
    target instanceof HTMLElement && target.matches('a[href], [role^="menuitem"], [role="tab"]')
  );
}

function isFormEditingTag(tagName: string): boolean {
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}
