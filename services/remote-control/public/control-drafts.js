import { $, selectedIds } from './control-model.js';

/** Unsent inputs stay local; a changed PC revision never silently rebases their authority. */
export function bindDrafts(getRevision) {
  return new Drafts(getRevision);
}
const currentForm = (value) =>
  typeof value === 'string' ? $(value.startsWith('#') ? value : '#' + value) : value;

class Drafts {
  changes = new Map();
  selectionRevision = null;
  selection = null;
  submittedForm = null;
  constructor(getRevision) {
    this.getRevision = getRevision;
    document.addEventListener('input', (event) => this.remember(event));
    document.addEventListener('change', (event) => this.remember(event));
  }
  remember(event) {
    const form = event.target.closest('#edit-forms form');
    if (form && !this.changes.has(form.id)) this.changes.set(form.id, this.getRevision());
    if (event.target.closest('#artwork-list')) {
      this.selectionRevision ??= this.getRevision();
      this.selection = selectedIds();
    }
  }
  conflict(form) {
    return this.changes.has(form.id) && this.changes.get(form.id) !== this.getRevision();
  }
  capture() {
    const values = [];
    for (const form of document.querySelectorAll('#edit-forms form')) {
      if (!this.changes.has(form.id)) continue;
      values.push([
        form,
        [...form.elements]
          .filter((item) => item.name)
          .map((item) => [item.name, item.value, item.checked]),
      ]);
    }
    const active = document.activeElement;
    const focus = active?.closest('#artwork-list') ? active.value : null;
    return () => {
      restoreFields(values);
      this.restoreSelection(focus);
    };
  }
  restoreSelection(focus) {
    if (this.selection)
      for (const input of document.querySelectorAll('#artwork-list input'))
        input.checked = this.selection.includes(input.value);
    if (focus)
      $('#artwork-list input[value="' + CSS.escape(focus) + '"]')?.focus({ preventScroll: true });
  }
  render() {
    const conflicts =
      [...this.changes.keys()].some((id) => this.conflict($('#' + id))) || this.selectionConflict();
    $('#draft-note').hidden = !conflicts;
    for (const form of document.querySelectorAll('#edit-forms form'))
      for (const button of form.querySelectorAll('button[type=submit],button:not([type])'))
        button.disabled ||= this.conflict(form);
    if (this.selectionConflict()) $('#save-selection').disabled = true;
  }
  selectionConflict() {
    return !!this.selectionRevision && this.selectionRevision !== this.getRevision();
  }
  dirty(form) {
    return this.changes.has(currentForm(form)?.id);
  }
  clean(form) {
    if (currentForm(form)) this.changes.delete(currentForm(form).id);
  }
  clearSelection() {
    this.selection = this.selectionRevision = null;
  }
  assertSelection() {
    if (this.selectionConflict())
      throw new Error(
        'The PC changed. Use its current selection or discard drafts before applying yours.',
      );
  }
  reset() {
    this.changes.clear();
    this.clearSelection();
    this.submittedForm = null;
  }
  submitted() {
    return this.submittedForm;
  }
  async submit(form, callback) {
    if (this.conflict(form))
      throw new Error(
        'The PC changed. Your draft is kept. Discard drafts and refresh before applying it.',
      );
    this.submittedForm = form;
    try {
      await callback();
      this.changes.delete(form.id);
    } finally {
      this.submittedForm = null;
    }
  }
}
function restoreFields(values) {
  for (const [form, fields] of values)
    for (const [name, value, checked] of fields) {
      const input = form.elements.namedItem(name);
      if (input) {
        input.value = value;
        input.checked = checked;
      }
    }
}
