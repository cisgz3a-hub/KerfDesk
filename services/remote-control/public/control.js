const $ = (selector) => document.querySelector(selector);
const pairForm = $('#pair-form');
let session = null;
let workspace = null;
let poll = null;
let busy = false;
const errorMessages = {
  unavailable: 'The computer is offline. Open KerfDesk on your PC and refresh.',
  stale_revision: 'The workspace changed on your PC. Refresh before trying the edit again.',
  needs_pro: 'Choose a trial or licence in the desktop app to use this Pro feature.',
  unsupported_operation: 'This operation cannot be edited here. Use KerfDesk on your PC.',
  invalid_input: 'Check the values and try again.',
  cancelled: 'The request was cancelled or this connection was revoked.',
  failed: 'The change could not be completed. Refresh the workspace and try again.',
};
function notice(message, error = false) {
  const target = $('#notice');
  target.textContent = message;
  target.hidden = !message;
  target.dataset.kind = error ? 'error' : 'info';
}
async function api(path, body) {
  const headers = body === undefined ? {} : { 'Content-Type': 'application/json' };
  if (body !== undefined && session?.csrf) headers['X-KerfDesk-CSRF'] = session.csrf;
  let response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new Error(errorMessages.unavailable);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(errorMessages.failed);
  }
  if (!response.ok) rejectResponse(response, data);
  return data;
}
function rejectResponse(response, data) {
  if (response.status === 401) {
    session = null;
    showPairing();
  }
  if (response.status === 429) throw new Error('Too many requests. Wait a minute, then try again.');
  throw new Error(
    errorMessages[data.error?.code] ??
      (response.status === 403
        ? 'The pairing or permission is unavailable. Create a new code on the PC.'
        : errorMessages.failed),
  );
}
function showPairing() {
  $('#pair-card').hidden = false;
  $('#workspace-area').hidden = true;
  $('#connection').textContent = 'Not connected';
  workspace = null;
}
function view(name) {
  for (const panel of document.querySelectorAll('[data-panel]'))
    panel.hidden = panel.dataset.panel !== name;
  for (const tab of document.querySelectorAll('[data-view]'))
    tab.setAttribute('aria-pressed', String(tab.dataset.view === name));
}
function selectedIds() {
  return [...document.querySelectorAll('#artwork-list input:checked')].map((item) => item.value);
}
function number(form, name) {
  const value = form.elements.namedItem(name).value.trim();
  if (!value) throw new Error('Enter a value in each required number field.');
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Use a valid number.');
  return parsed;
}
function admission() {
  if (!workspace || !session?.client?.scopes.includes('edit'))
    throw new Error('Refresh a workspace with editing permission first.');
  return { expectedRevision: workspace.revision, requestId: crypto.randomUUID() };
}
async function command(name, args = {}) {
  return (await api('/api/client/command', { name, args })).result;
}
function renderWorkspace(value) {
  workspace = value;
  $('#workspace-name').textContent = value.name || 'Untitled workspace';
  $('#workspace-meta').textContent =
    `${value.mode === 'cnc' ? 'CNC' : 'Laser'} · ${value.totalArtwork} artwork · ${value.totalOperations} operations${value.dirty ? ' · Unsaved changes' : ''}`;
  const canEdit = session.client.scopes.includes('edit');
  $('#readonly-note').hidden = canEdit;
  $('#edit-forms').hidden = !canEdit;
  $('#save-selection').hidden = !canEdit;
  const list = $('#artwork-list');
  list.replaceChildren();
  for (const item of value.artwork) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = item.id;
    input.checked = value.selection.includes(item.id);
    input.disabled = !canEdit;
    const description = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'item-title';
    title.textContent = item.name || item.type;
    const info = document.createElement('span');
    info.className = 'item-description';
    info.textContent = item.bounds
      ? `${item.type} · ${item.bounds.widthMm.toFixed(2)} × ${item.bounds.heightMm.toFixed(2)} mm`
      : item.type;
    description.append(title, info);
    label.append(input, description);
    list.append(label);
  }
  if (!value.artwork.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'There is no artwork in this workspace yet.';
    list.append(empty);
  }
  $('#truncated').hidden = !value.truncated;
  $('#truncated').textContent =
    'This page shows up to 200 items. Use the PC for the complete workspace.';
  const operations = $('#operation-list');
  operations.replaceChildren();
  // The desktop validates actual operation support; the phone never modifies CNC settings.
  for (const item of value.mode === 'laser' ? value.operations : []) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name || item.type;
    operations.append(option);
  }
  $('#operation-form').querySelector('button').disabled = !operations.options.length;
  loadOperation();
}
function loadOperation() {
  const form = $('#operation-form');
  const item = workspace?.operations.find(
    (operation) => operation.id === form.elements.operationId.value,
  );
  for (const name of ['powerPercent', 'speedMmPerMin', 'passes'])
    form.elements[name].value = item?.[name] ?? '';
  form.elements.enabled.checked = item?.enabled ?? true;
}
function detail(title, text) {
  const item = document.createElement('div');
  item.className = 'detail';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const content = document.createElement('p');
  content.textContent = text;
  item.append(heading, content);
  $('#details-list').append(item);
}
async function refresh() {
  const current = await api('/api/session');
  if (current.status !== 'approved') {
    showPairing();
    return;
  }
  session = current;
  $('#connection').textContent = current.online ? 'PC connected' : 'PC offline';
  $('#device-name').textContent = current.deviceLabel;
  $('#pair-card').hidden = true;
  $('#workspace-area').hidden = false;
  if (!current.online) {
    notice(errorMessages.unavailable, true);
    return;
  }
  renderWorkspace(await command('get_workspace'));
  $('#details-list').replaceChildren();
  const status = await command('get_app_status');
  detail('Desktop app', `${status.app.name} ${status.app.version} · ${status.edition.mode}`);
  if (status.updates.available)
    detail(
      'Update available on the PC',
      `${status.updates.version ?? 'New version'}${status.updates.highlights?.length ? ': ' + status.updates.highlights.join(' · ') : ''}`,
    );
  const machine = (await command('get_machine')).machine;
  detail(
    'Machine profile',
    `${machine.name} · ${machine.bedWidthMm} × ${machine.bedHeightMm} mm${machine.controller ? ' · ' + machine.controller : ''}`,
  );
  const review = await command('review_job');
  detail(
    'Job review',
    `${review.status} · ${review.frame.complete ? 'Frame completed' : 'Frame required on the PC'}`,
  );
  for (const warning of review.warnings) detail('Job review warning', warning.message);
  const recipes = await command('list_material_recipes');
  detail(
    'Material recipes',
    recipes.recipes.length
      ? recipes.recipes.map((recipe) => recipe.name).join(' · ')
      : 'No saved recipes.',
  );
}
async function action(callback) {
  if (busy) return;
  busy = true;
  const controls = [
    ...document.querySelectorAll(
      '#pair-form button, #disconnect, #refresh, #save-selection, #edit-forms button',
    ),
  ];
  for (const button of controls) button.disabled = true;
  document.body.setAttribute('aria-busy', 'true');
  try {
    await callback();
  } catch (error) {
    notice(error.message || errorMessages.failed, true);
  } finally {
    busy = false;
    for (const button of controls) button.disabled = false;
    $('#operation-form').querySelector('button').disabled = !$('#operation-list').options.length;
    document.body.setAttribute('aria-busy', 'false');
  }
}
async function edit(name, args) {
  await command(name, { ...admission(), ...args });
  await refresh();
  notice('Updated on your computer.');
}
function bindForm(id, callback) {
  $(id).addEventListener('submit', (event) => {
    event.preventDefault();
    void action(() => callback(event.currentTarget));
  });
}
function continueToMcp() {
  const target = new URLSearchParams(location.search).get('continue');
  if (!target || target.length > 4096) return false;
  try {
    const parsed = new URL(target, location.origin);
    if (
      parsed.origin === location.origin &&
      parsed.pathname === '/authorize' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    ) {
      location.assign(parsed.href);
      return true;
    }
  } catch {
    /* Only an exact same-origin consent page is accepted. */
  }
  return false;
}
async function pairStatus(deadline) {
  try {
    const value = await api('/api/pair/status');
    if (value.status === 'approved') {
      session = value;
      clearTimeout(poll);
      poll = null;
      if (!continueToMcp()) await refresh();
      notice('This phone is approved.');
      return;
    }
    if (Date.now() >= deadline) throw new Error('Pairing expired. Create a new code on your PC.');
    $('#pair-status').textContent = value.online
      ? 'Waiting for your approval on the PC…'
      : 'The PC is offline. Reopen KerfDesk to finish approval.';
    poll = setTimeout(() => {
      void pairStatus(deadline);
    }, 2000);
  } catch (error) {
    notice(error.message, true);
    $('#pair-status').textContent = 'Pair again using a new code.';
    poll = null;
  }
}
bindForm('#pair-form', async (form) => {
  clearTimeout(poll);
  session = null;
  const deviceId = form.elements.deviceId.value.trim();
  const code = form.elements.code.value.trim();
  const clientLabel = form.elements.clientLabel.value.trim();
  if (new TextEncoder().encode(JSON.stringify(clientLabel)).byteLength > 66)
    throw new Error('Use a shorter phone name.');
  const result = await api('/api/pair/claim', {
    v: 1,
    deviceId,
    code,
    clientLabel,
    requestedScopes: form.elements.edit.checked ? ['read', 'edit'] : ['read'],
  });
  form.elements.code.value = '';
  notice('Approve this phone in KerfDesk on your PC.');
  await pairStatus(result.expiresAt);
});
bindForm('#text-form', (form) =>
  edit('add_text', {
    text: form.elements.text.value,
    ...Object.fromEntries(
      ['xMm', 'yMm', 'widthMm', 'fontSizeMm'].map((key) => [key, number(form, key)]),
    ),
  }),
);
bindForm('#rectangle-form', (form) =>
  edit(
    'add_rectangle',
    Object.fromEntries(
      ['xMm', 'yMm', 'widthMm', 'heightMm'].map((key) => [key, number(form, key)]),
    ),
  ),
);
bindForm('#move-form', (form) =>
  edit('transform_artwork', {
    artworkIds: selectedIds(),
    transform: { type: 'move', dxMm: number(form, 'dxMm'), dyMm: number(form, 'dyMm') },
  }),
);
bindForm('#rotate-form', (form) =>
  edit('transform_artwork', {
    artworkIds: selectedIds(),
    transform: { type: 'rotate', angleDeg: number(form, 'angleDeg') },
  }),
);
bindForm('#operation-form', (form) => {
  const patch = { enabled: form.elements.enabled.checked };
  for (const name of ['powerPercent', 'speedMmPerMin', 'passes'])
    if (form.elements[name].value.trim()) patch[name] = number(form, name);
  return edit('update_operation', { operationId: form.elements.operationId.value, patch });
});
$('#operation-list').addEventListener('change', loadOperation);
$('#save-selection').addEventListener('click', () => {
  void action(() => edit('set_selection', { artworkIds: selectedIds() }));
});
$('#refresh').addEventListener('click', () => {
  void action(async () => {
    await refresh();
    notice('Workspace refreshed.');
  });
});
$('#disconnect').addEventListener('click', () => {
  void action(async () => {
    await api('/api/client/revoke', {});
    session = null;
    showPairing();
    notice('This phone is disconnected.');
  });
});
for (const tab of document.querySelectorAll('[data-view]'))
  tab.addEventListener('click', () => view(tab.dataset.view));
const suggestedId = new URLSearchParams(location.search).get('deviceId');
if (suggestedId && /^[0-9a-f-]{36}$/i.test(suggestedId))
  pairForm.elements.deviceId.value = suggestedId;
void action(async () => {
  try {
    const value = await api('/api/session');
    if (value.status === 'approved') {
      session = value;
      if (!continueToMcp()) await refresh();
    } else if (value.status === 'pending') {
      $('#pair-status').textContent = 'Waiting for approval on the PC…';
      await pairStatus(Date.now() + 300_000);
    }
  } catch {
    showPairing();
  }
});
