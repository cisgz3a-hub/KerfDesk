export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (isFormEditingTag(target.tagName)) return true;
  if (target.isContentEditable) return true;
  const editableAttr = target.getAttribute('contenteditable');
  if (editableAttr !== null && editableAttr !== 'false') return true;
  return target.getAttribute('role') === 'textbox';
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
 * shortcut that moves the machine must leave them to the browser: with the
 * Z-focus jog bound to PageUp/PageDown, scrolling the operations list drove a
 * CNC bit down into the stock (audit ui-panel-3).
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
