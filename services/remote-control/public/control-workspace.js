import {
  $,
  fillOptions,
  renderPreview,
  safeText,
  selectedIds,
  validWorkspace,
} from './control-model.js';

export function assertWorkspace(value) {
  if (!validWorkspace(value))
    throw new Error('The workspace response is incomplete. Refresh on the PC.');
}
export function workspaceViewChanged(value, previous, force) {
  return (
    force ||
    value.revision !== previous?.revision ||
    value.permissions?.artworkSharingEnabled !== previous?.permissions?.artworkSharingEnabled
  );
}

export function renderWorkspace(value, canEdit) {
  if (!validWorkspace(value))
    throw new Error('The workspace response is incomplete. Refresh on the PC.');
  $('#workspace-name').textContent = safeText(value.name, 512) || 'Untitled workspace';
  $('#workspace-meta').textContent =
    `${value.mode === 'cnc' ? 'CNC' : 'Laser'} · ${value.totalArtwork} artwork · ${value.totalOperations} operations${value.dirty ? ' · Unsaved changes' : ''}`;
  const list = $('#artwork-list');
  list.replaceChildren();
  for (const item of value.artwork) list.append(artworkItem(item, value.selection, canEdit));
  if (!value.artwork.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = canEdit
      ? 'No artwork yet. Open Edit to add text or a rectangle.'
      : 'No artwork yet. Add artwork on the PC to see it here.';
    list.append(empty);
  }
  $('#truncated').hidden = !value.truncated;
  $('#truncated').textContent =
    'This page shows up to 200 items. Use the PC for the complete workspace.';
  fillOptions($('#operation-list'), value.mode === 'laser' ? value.operations : []);
  fillOptions(
    $('#text-artwork-list'),
    value.artwork.filter((item) => item.type === 'text'),
  );
  loadOperation(value);
  selectionFeedback(value, canEdit);
}

export function selectionFeedback(workspace, writable) {
  const ids = selectedIds();
  const selectedText = workspace?.artwork.find(
    (item) => item.id === ids[0] && item.type === 'text',
  );
  const summary = ids.length ? `${ids.length} selected` : 'No items selected';
  $('#selection-status').textContent = summary;
  $('#edit-selection-status').textContent =
    `${summary}. Choose items in Design before arranging them.`;
  $('#edit-selected-text').disabled =
    !writable ||
    ids.length !== 1 ||
    !selectedText ||
    workspace?.permissions?.artworkSharingEnabled === false;
}

function artworkItem(item, selection, canEdit) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = item.id;
  input.checked = selection.includes(item.id);
  input.disabled = !canEdit;
  const description = document.createElement('span');
  const title = document.createElement('span');
  title.className = 'item-title';
  title.textContent = safeText(item.name || item.type, 512);
  const info = document.createElement('span');
  info.className = 'item-description';
  const bounds = item.bounds;
  info.textContent =
    bounds && [bounds.widthMm, bounds.heightMm].every(Number.isFinite)
      ? `${safeText(item.type, 512)} · ${bounds.widthMm.toFixed(2)} × ${bounds.heightMm.toFixed(2)} mm`
      : safeText(item.type, 512);
  description.append(title, info);
  label.append(input, description);
  return label;
}

export function loadOperation(workspace) {
  const form = $('#operation-form');
  const item = workspace?.operations.find(
    (operation) => operation.id === form.elements.operationId.value,
  );
  for (const name of ['powerPercent', 'speedMmPerMin', 'passes'])
    form.elements[name].value = item?.[name] ?? '';
  form.elements.enabled.checked = item?.enabled ?? true;
}

export function resetWorkspace() {
  for (const target of document.querySelectorAll(
    '#workspace-name,#workspace-meta,#artwork-list,#operation-list,#text-artwork-list,#details-list,#preview-bounds,#selection-status,#edit-selection-status',
  ))
    target.replaceChildren();
  $('#truncated').hidden = true;
  $('#workspace-preview').hidden = true;
  $('#workspace-preview').removeAttribute('src');
  $('#preview-message').textContent = 'Connect to your PC to view its workspace.';
  $('#text-editor').disabled = true;
  $('#text-editor').hidden = true;
  $('#text-edit-form').reset();
  loadOperation(null);
}

export function view(name) {
  document.body.dataset.panel = name === 'edit' ? 'artwork' : name;
  document.body.dataset.view = name === 'edit' ? 'artwork' : name;
  for (const panel of document.querySelectorAll('#workspace-area [data-panel]'))
    panel.hidden =
      panel.dataset.panel !== name &&
      !(name === 'edit' && panel.hasAttribute('data-design-canvas'));
  const historyTarget = name === 'edit' ? '#editor-history' : '#history-home';
  $(historyTarget).append($('#history-controls'));
  syncRetryVisibility();
  for (const tab of document.querySelectorAll('button[data-view]'))
    tab.setAttribute(
      'aria-pressed',
      String(tab.dataset.view === (name === 'edit' ? 'artwork' : name)),
    );
}
export function routeSetupHint() {
  const suggestedId = new URLSearchParams(location.search).get('deviceId');
  if (suggestedId && /^[0-9a-f-]{36}$/i.test(suggestedId))
    $('#pair-form').elements.deviceId.value = suggestedId;
  if (location.hash !== '#mcp') return;
  $('.intro a').href = 'https://kerfdesk.com/phone.html#mcp';
  view('details');
}

export function syncAccess({ session, workspace, busy, pendingEdit, admitted }) {
  const hasEditScope = !!session?.client.scopes.includes('edit');
  syncReadAccess(session, workspace, admitted, hasEditScope);
  syncSessionAccess(session, workspace, busy, pendingEdit, hasEditScope);
}
export function renderSession(value) {
  $('#connection').textContent = value
    ? value.online
      ? 'PC connected'
      : 'PC offline'
    : 'Not connected';
  $('#device-name').textContent = safeText(value?.deviceLabel, 64) || 'Connected computer';
  $('#pair-card').hidden = !!value;
  $('.intro').hidden = !!value;
  $('#workspace-area').hidden = !value;
  document.body.classList.toggle('workspace-connected', !!value);
}
function syncReadAccess(session, workspace, admitted, hasEditScope) {
  const unknown = hasEditScope && workspace?.permissions?.canEdit === undefined;
  $('#readonly-note').hidden = !session || admitted;
  $('#readonly-title').textContent = !session?.online
    ? 'PC offline'
    : unknown
      ? 'Update the PC app'
      : hasEditScope
        ? 'PC editing unavailable'
        : session.client.scopes.includes('control')
          ? 'Workspace editing off'
          : 'Viewing only';
  $('#readonly-message').textContent = readAccessMessage(session, unknown, hasEditScope);
  $('#editor-access-note').hidden = !session || admitted;
  $('#editor-access-note').textContent = $('#readonly-message').textContent;
}
function readAccessMessage(session, unknown, hasEditScope) {
  if (!session?.online) return 'Open KerfDesk on the PC, then refresh here to reconnect.';
  if (unknown)
    return 'The PC app cannot confirm editing access. Update KerfDesk on the PC, then refresh here.';
  if (hasEditScope)
    return 'The PC is not accepting design edits. Finish any open desktop dialog, check editing access on the PC, then refresh here.';
  return 'To add text, draw shapes or change artwork, pair again with Request editing permission selected and approve this phone on the PC.';
}
function syncSessionAccess(session, workspace, busy, pendingEdit, hasEditScope) {
  $('#edit-forms').hidden = !hasEditScope || workspace?.permissions?.canEdit !== true;
  $('#save-selection').hidden = !hasEditScope;
  $('#edit-selected-text').hidden = !hasEditScope;
  for (const button of document.querySelectorAll('#pair-form button, #disconnect, #refresh'))
    button.disabled = busy || !!document.documentElement.dataset.pairingBlocked;
  $('#retry-edit').disabled = busy || !session?.online;
  $('#editor-retry').disabled = busy || !session?.online;
  syncRetryVisibility(pendingEdit);
  $('#history-controls').hidden = !hasEditScope;
}
function syncRetryVisibility(pending = !$('#retry-edit').hidden || !$('#editor-retry').hidden) {
  const editing = !$('#editor-sheet').hidden;
  $('#retry-edit').hidden = !pending || editing;
  $('#editor-retry').hidden = !pending || !editing;
}

export function syncEditorControls(workspace) {
  const history = workspace?.history ?? {};
  const sharingOff = workspace?.permissions?.artworkSharingEnabled === false;
  $('#undo').disabled ||= !history.canUndo;
  $('#redo').disabled ||= !history.canRedo;
  $('#history-status').textContent =
    history.canUndo || history.canRedo
      ? 'Changes share the PC’s undo history.'
      : 'No changes to undo yet.';
  $('#operation-form button').disabled ||= !$('#operation-list').options.length;
  $('#load-text').disabled ||= !$('#text-artwork-list').options.length || sharingOff;
  $('#text-sharing-note').hidden = !sharingOff;
  syncShapeControls(workspace);
}
function syncShapeControls(workspace) {
  const ellipseAvailable = workspace?.capabilities?.touchEditing === true;
  $('#rectangle-form option[value="ellipse"]').disabled = !ellipseAvailable;
  $('#shape-availability').hidden = ellipseAvailable;
  $('#rectangle-form button').disabled ||=
    $('#rectangle-form').elements.shapeType.value === 'ellipse' && !ellipseAvailable;
}

export function bindWorkspaceEvents({ live, machine, action, drafts, editors, refresh }) {
  $('#live-updates').addEventListener('change', (event) => live.pause(!event.target.checked));
  $('#discard-drafts').addEventListener('click', () => {
    void action(async () => {
      drafts.reset();
      for (const form of document.querySelectorAll('#edit-forms form')) form.reset();
      editors.clearText();
      await refresh();
    });
  });
  for (const tab of document.querySelectorAll('button[data-view]'))
    tab.addEventListener('click', () => {
      view(tab.dataset.view);
      machine.setVisible(tab.dataset.view === 'machine');
      if (tab.dataset.view === 'artwork') void live.refresh();
    });
  for (const button of document.querySelectorAll('[data-editor-task]'))
    button.addEventListener('click', () => {
      view('edit');
      machine.setVisible(false);
      const task = $('#' + button.dataset.editorTask);
      task.open = true;
      task.querySelector('summary').focus({ preventScroll: true });
      task.scrollIntoView({ block: 'nearest' });
    });
  const closeEditor = () => {
    view('artwork');
    $('[data-view="edit"]').focus({ preventScroll: true });
  };
  $('#close-editor').addEventListener('click', closeEditor);
  $('#editor-sheet').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeEditor();
  });
}

export function createPreviewController(options) {
  return new PreviewController(options);
}
class PreviewController {
  revision = null;
  value = null;
  fontsLoaded = false;
  constructor(options) {
    this.options = options;
  }
  reset() {
    this.revision = null;
    this.value = null;
    this.fontsLoaded = false;
    this.options.changed?.();
  }
  current() {
    return this.value;
  }
  clearIfChanged(value) {
    if (value.permissions?.artworkSharingEnabled === false) {
      this.revision = null;
      this.value = null;
      renderPreview({ status: 'disabled', revision: value.revision }, value.revision);
    } else if (this.revision !== value.revision) {
      this.value = null;
      renderPreview(null, value.revision);
    }
    this.options.changed?.();
  }
  canDeliver(background) {
    return (
      !!this.options.session() &&
      (!background || (this.options.active() && !this.options.blocked()))
    );
  }
  needsPreview(force, background) {
    const value = this.options.workspace();
    if (value.permissions?.artworkSharingEnabled === false) return false;
    if (background && document.body.dataset.panel && document.body.dataset.panel !== 'artwork')
      return false;
    return force || this.revision !== value.revision;
  }
  async refresh(generation, force = false, background = false) {
    if (this.needsPreview(force, background)) await this.read(generation, background);
    if (!this.fontsLoaded) await this.loadFonts(generation);
  }
  async read(generation, background) {
    const revision = this.options.workspace().revision;
    const preview = await this.optionalRead('get_workspace_preview', generation);
    if (!this.canDeliver(background)) return;
    const latest = await this.options.command('get_workspace', {}, generation);
    if (!this.canDeliver(background)) return;
    this.options.apply(latest);
    if (latest.permissions?.artworkSharingEnabled === false || latest.revision !== revision) return;
    renderPreview(preview, latest.revision);
    this.value = !$('#workspace-preview').hidden ? preview : null;
    this.options.changed?.();
    if (
      preview?.revision === latest.revision &&
      ['ready', 'disabled', 'unavailable'].includes(preview.status)
    )
      this.revision = preview.revision;
  }
  async loadFonts(generation) {
    const fonts = await this.optionalRead('list_fonts', generation);
    if (!this.options.session()) return;
    this.options.setFonts(fonts);
    this.fontsLoaded = Array.isArray(fonts?.fonts);
  }
  async optionalRead(name, generation) {
    try {
      return await this.options.command(name, {}, generation);
    } catch (error) {
      if (!this.options.session() || ['cancelled', 'forbidden'].includes(error.code)) throw error;
      return null;
    }
  }
}

function detail(title, text) {
  const item = document.createElement('div');
  item.className = 'detail';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const content = document.createElement('p');
  content.textContent = safeText(text, 4096);
  item.append(heading, content);
  $('#details-list').append(item);
}

export async function refreshDetails(command, generation) {
  $('#details-list').replaceChildren();
  const status = await command('get_app_status', {}, generation);
  detail('Desktop app', `${status.app.name} ${status.app.version} · ${status.edition.mode}`);
  if (status.updates.available)
    detail(
      'Update available on the PC',
      `${status.updates.version ?? 'New version'}${status.updates.highlights?.length ? ': ' + status.updates.highlights.join(' · ') : ''}`,
    );
  const machine = (await command('get_machine', {}, generation)).machine;
  detail(
    'Machine profile',
    `${machine.name} · ${machine.bedWidthMm} × ${machine.bedHeightMm} mm${machine.controller ? ' · ' + machine.controller : ''}`,
  );
  const review = await command('review_job', {}, generation);
  detail(
    'Job review',
    `${review.status} · ${review.frame.complete ? 'Frame completed' : 'Frame required on the PC'}`,
  );
  if (review.summary) {
    const summary = review.summary;
    detail(
      'Workspace totals and prepared duration',
      `Workspace artwork: ${summary.artworkCount} · Workspace operations: ${summary.operationCount}${Number.isFinite(summary.estimatedSeconds) ? ' · Estimated ' + Math.ceil(summary.estimatedSeconds / 60) + ' min' : ''}`,
    );
    if (summary.bounds)
      detail(
        'Prepared output bounds',
        `${summary.bounds.widthMm.toFixed(2)} × ${summary.bounds.heightMm.toFixed(2)} mm · X ${summary.bounds.xMm.toFixed(2)}, Y ${summary.bounds.yMm.toFixed(2)}`,
      );
  }
  for (const warning of review.warnings.slice(0, 200))
    detail('Job review warning', warning.message);
  const recipes = await command('list_material_recipes', {}, generation);
  detail(
    'Material recipes',
    recipes.recipes.length
      ? recipes.recipes.map((recipe) => safeText(recipe.name, 512)).join(' · ')
      : 'No saved recipes.',
  );
}
