export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (isFormEditingTag(target.tagName)) return true;
  if (target.isContentEditable) return true;
  const editableAttr = target.getAttribute('contenteditable');
  if (editableAttr !== null && editableAttr !== 'false') return true;
  return target.getAttribute('role') === 'textbox';
}

export function isKeyboardActivationTarget(target: EventTarget | null): boolean {
  if (isEditableShortcutTarget(target)) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'BUTTON' || target.tagName === 'SELECT') return true;
  const role = target.getAttribute('role');
  return role === 'button' || role === 'checkbox' || role === 'radio' || role === 'switch';
}

function isFormEditingTag(tagName: string): boolean {
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}
