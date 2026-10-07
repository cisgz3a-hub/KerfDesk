import {
  $,
  bindForm,
  createFontPickers,
  number,
  numbers,
  positive,
  selectedIds,
} from './control-model.js';
import { loadOperation, view } from './control-workspace.js';

function selection() {
  const artworkIds = selectedIds();
  if (!artworkIds.length) throw new Error('Select artwork in Design first.');
  return artworkIds;
}

function font(form) {
  return form.elements.fontId.value ? { fontId: form.elements.fontId.value } : {};
}

function textPatch(form, original) {
  const values = {
    text: form.elements.text.value,
    ...font(form),
    fontSizeMm: positive(form, 'fontSizeMm', 1000),
    alignment: form.elements.alignment.value,
    lineHeight: number(form, 'lineHeight', 0.1, 20),
    letterSpacing: number(form, 'letterSpacing', -1, 20),
  };
  const patch = Object.fromEntries(
    Object.entries(values).filter(([name, value]) => value !== original[name]),
  );
  if (!Object.keys(patch).length) throw new Error('There are no text changes to apply.');
  return patch;
}

function bindAuthoring(update, edit, getWorkspace) {
  bindShapeLabel();
  update('#text-form', (form) =>
    edit('add_text', {
      text: form.elements.text.value,
      ...font(form),
      ...numbers(form, ['xMm', 'yMm']),
      widthMm: positive(form, 'widthMm'),
      fontSizeMm: positive(form, 'fontSizeMm', 1000),
    }),
  );
  update('#rectangle-form', (form) => {
    const ellipse = form.elements.shapeType.value === 'ellipse';
    if (ellipse && getWorkspace()?.capabilities?.touchEditing !== true)
      throw new Error('Update KerfDesk on the PC and open a Laser workspace to add an ellipse.');
    return edit(ellipse ? 'add_ellipse' : 'add_rectangle', {
      ...numbers(form, ['xMm', 'yMm']),
      widthMm: positive(form, 'widthMm'),
      heightMm: positive(form, 'heightMm'),
    });
  });
  update('#move-form', (form) =>
    edit('transform_artwork', {
      artworkIds: selection(),
      transform: { type: 'move', dxMm: number(form, 'dxMm'), dyMm: number(form, 'dyMm') },
    }),
  );
  update('#rotate-form', (form) =>
    edit('transform_artwork', {
      artworkIds: selection(),
      transform: { type: 'rotate', angleDeg: number(form, 'angleDeg', -3600, 3600) },
    }),
  );
  update('#resize-form', (form) =>
    edit('transform_artwork', {
      artworkIds: selection(),
      transform: {
        type: 'resize',
        widthMm: positive(form, 'widthMm'),
        heightMm: positive(form, 'heightMm'),
      },
    }),
  );
  update('#arrange-form', (form) =>
    edit('arrange_artwork', {
      artworkIds: selection(),
      action: form.elements.action.value,
    }),
  );
}

function bindShapeLabel() {
  const form = $('#rectangle-form');
  form.elements.shapeType.addEventListener('change', () => {
    form.querySelector('button[type="submit"]').textContent =
      form.elements.shapeType.value === 'ellipse' ? 'Add ellipse' : 'Add rectangle';
  });
}

export function bindEditors({ action, edit, command, drafts, getWorkspace, applyWorkspace }) {
  const fonts = createFontPickers();
  let loadedTextId = null;
  let loadedRevision = null;
  let loadedText = null;
  const update = (id, callback) =>
    bindForm(id, action, (form) => drafts.submit(form, () => callback(form)));
  bindAuthoring(update, edit, getWorkspace);
  update('#text-edit-form', (form) => {
    if (
      loadedTextId !== $('#text-artwork-list').value ||
      loadedRevision !== getWorkspace()?.revision
    )
      throw new Error('Load this text from the PC before editing it.');
    return edit('update_text', { artworkId: loadedTextId, patch: textPatch(form, loadedText) });
  });
  bindOperation(update, edit);
  $('#operation-list').addEventListener('change', () => loadOperation(getWorkspace()));
  $('#text-artwork-list').addEventListener('change', clearText);
  bindTextAccess(action, loadText, clearText);
  $('#save-selection').addEventListener('click', () => {
    void action(() => edit('set_selection', { artworkIds: selectedIds() }));
  });
  for (const name of ['undo', 'redo'])
    $('#' + name).addEventListener('click', () => {
      void action(() => edit(name, {}));
    });

  function clearText() {
    drafts.clean('#text-edit-form');
    loadedTextId = null;
    loadedRevision = null;
    loadedText = null;
    $('#text-edit-form').reset();
    $('#text-editor').disabled = true;
    $('#text-editor').hidden = true;
    $('#text-source-controls').hidden = false;
    $('#change-text').hidden = true;
    $('#text-load-status').textContent = $('#text-artwork-list').options.length
      ? 'Choose text, then load it to make changes.'
      : 'No text yet. Open Add new text below, or add text on the PC.';
  }
  async function loadText() {
    const artworkId = $('#text-artwork-list').value;
    if (!artworkId) throw new Error('There is no editable text in this workspace.');
    const before = getWorkspace()?.revision;
    if (
      loadedTextId === artworkId &&
      (loadedRevision === before || drafts.dirty('#text-edit-form'))
    )
      return;
    const value = await readSharedText(command, artworkId, applyWorkspace);
    if (value.revision !== before || getWorkspace()?.revision !== before)
      throw new Error('The workspace changed. Refresh before loading the text again.');
    validateText(value, artworkId);
    const form = $('#text-edit-form');
    for (const name of ['text', 'fontSizeMm', 'alignment', 'lineHeight', 'letterSpacing'])
      form.elements[name].value = value[name];
    fonts.choose(form, value.fontId);
    loadedTextId = artworkId;
    loadedRevision = value.revision;
    loadedText = value;
    drafts.clean('#text-edit-form');
    $('#text-editor').disabled = false;
    $('#text-editor').hidden = false;
    $('#text-source-controls').hidden = true;
    $('#change-text').hidden = false;
    $('#text-load-status').textContent = 'Update text saves your changes on the PC.';
  }
  return {
    setFonts: (value) => fonts.set(value),
    clearText,
    reset() {
      clearText();
      fonts.set(null);
    },
    workspaceChanged() {
      if (shouldClearText(getWorkspace(), loadedRevision, drafts)) clearText();
    },
  };
}

async function readSharedText(command, artworkId, applyWorkspace) {
  const value = await command('get_text', { artworkId });
  const latest = await command('get_workspace');
  applyWorkspace(latest);
  if (latest.permissions?.artworkSharingEnabled === false)
    throw new Error('Artwork sharing is off on the PC. Enable it before loading text.');
  return value;
}

function shouldClearText(workspace, loadedRevision, drafts) {
  return (
    workspace?.permissions?.artworkSharingEnabled === false ||
    (loadedRevision !== workspace?.revision && !drafts.dirty('#text-edit-form'))
  );
}

function bindTextAccess(action, loadText, clearText) {
  async function read() {
    await action(loadText);
    if (!$('#text-editor').disabled) $('#text-edit-form [name=text]').focus();
  }
  $('#load-text').addEventListener('click', () => {
    void read();
  });
  $('#change-text').addEventListener('click', () => {
    clearText();
    $('#text-artwork-list').focus();
  });
  $('#edit-selected-text').addEventListener('click', () => {
    $('#text-artwork-list').value = selectedIds()[0] ?? '';
    $('#edit-text-task').open = true;
    view('edit');
    void read();
  });
  document.addEventListener(
    'invalid',
    (event) => {
      for (
        let details = event.target.closest('details');
        details;
        details = details.parentElement.closest('details')
      )
        details.open = true;
    },
    true,
  );
}

function validateText(value, artworkId) {
  if (
    value.artworkId !== artworkId ||
    typeof value.text !== 'string' ||
    value.text.length > 4096 ||
    typeof value.fontId !== 'string' ||
    value.fontId.length > 128 ||
    !['left', 'center', 'right'].includes(value.alignment) ||
    ![value.fontSizeMm, value.lineHeight, value.letterSpacing].every(Number.isFinite)
  )
    throw new Error('This text cannot be edited here. Use the PC.');
}

function bindOperation(update, edit) {
  update('#operation-form', (form) => {
    const patch = { enabled: form.elements.enabled.checked };
    if (form.elements.powerPercent.value.trim())
      patch.powerPercent = number(form, 'powerPercent', 0, 100);
    if (form.elements.speedMmPerMin.value.trim())
      patch.speedMmPerMin = positive(form, 'speedMmPerMin');
    if (form.elements.passes.value.trim()) {
      const passes = number(form, 'passes', 1, 1000);
      if (!Number.isInteger(passes)) throw new Error('Passes must be a whole number.');
      patch.passes = passes;
    }
    return edit('update_operation', { operationId: form.elements.operationId.value, patch });
  });
}
