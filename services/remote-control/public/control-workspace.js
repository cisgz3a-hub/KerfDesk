import { $, fillOptions, safeText, validWorkspace } from './control-model.js';

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
    empty.textContent = 'There is no artwork in this workspace yet.';
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
    '#workspace-name,#workspace-meta,#artwork-list,#operation-list,#text-artwork-list,#details-list,#preview-bounds',
  ))
    target.replaceChildren();
  $('#truncated').hidden = true;
  $('#workspace-preview').hidden = true;
  $('#workspace-preview').removeAttribute('src');
  $('#preview-message').textContent = 'Connect to your PC to view its workspace.';
  $('#text-editor').disabled = true;
  $('#text-edit-form').reset();
  loadOperation(null);
}

export function view(name) {
  for (const panel of document.querySelectorAll('[data-panel]'))
    panel.hidden = panel.dataset.panel !== name;
  for (const tab of document.querySelectorAll('[data-view]'))
    tab.setAttribute('aria-pressed', String(tab.dataset.view === name));
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
