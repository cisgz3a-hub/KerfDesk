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
