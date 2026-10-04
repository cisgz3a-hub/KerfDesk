import { pairingDeadline, rejectedMessage } from './pairing.js';
import { $, bindForm, renderPreview, safeText, validWorkspace } from './control-model.js';
import { bindEditors } from './control-edit.js';
import { refreshDetails, renderWorkspace, resetWorkspace, view } from './control-workspace.js';

const pairForm = $('#pair-form');
let session = null;
let workspace = null;
let poll = null;
let busy = false;
let stale = false;
let pendingEdit = null;
let fontsLoaded = false;
let pairGeneration = 0;
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
  target.textContent = safeText(message);
  target.hidden = !message;
  target.dataset.kind = error ? 'error' : 'info';
}
function fault(code, message, ambiguous = false) {
  return Object.assign(new Error(message), { code, ambiguous });
}
async function api(path, body, generation) {
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
    throw fault('unavailable', errorMessages.unavailable, true);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw fault('failed', errorMessages.failed, true);
  }
  if (generation !== undefined && generation !== pairGeneration)
    throw fault('cancelled', errorMessages.cancelled);
  if (!response.ok) rejectResponse(response, data, path);
  return data;
}
function rejectResponse(response, data, path) {
  if (response.status === 401) setSession(null);
  if (response.status === 429)
    throw fault('rate_limited', 'Too many requests. Wait a minute, then try again.');
  const code = response.status === 403 ? 'forbidden' : data?.error?.code;
  throw fault(
    code,
    errorMessages[code] ?? (response.status === 403 ? rejectedMessage(path) : errorMessages.failed),
    response.status >= 500,
  );
}
function canEdit() {
  return (
    !!workspace &&
    !!session?.online &&
    session.client.scopes.includes('edit') &&
    workspace.permissions?.canEdit !== false
  );
}
function syncControls() {
  const admitted = canEdit();
  const writable = admitted && !busy && !stale && !pendingEdit;
  $('#readonly-note').hidden = !session || admitted;
  for (const input of document.querySelectorAll('#artwork-list input')) input.disabled = !writable;
  for (const input of document.querySelectorAll(
    '#edit-forms input, #edit-forms select, #edit-forms textarea',
  ))
    input.disabled = !writable;
  for (const button of document.querySelectorAll(
    '#save-selection, #edit-forms button, #undo, #redo',
  ))
    button.disabled = !writable;
  syncEditorControls();
  syncSessionControls();
}
function syncEditorControls() {
  const history = workspace?.history ?? {};
  const sharingOff = workspace?.permissions?.artworkSharingEnabled === false;
  $('#undo').disabled ||= !history.canUndo;
  $('#redo').disabled ||= !history.canRedo;
  $('#operation-form button').disabled ||= !$('#operation-list').options.length;
  $('#load-text').disabled ||= !$('#text-artwork-list').options.length || sharingOff;
  $('#text-sharing-note').hidden = !sharingOff;
}
function syncSessionControls() {
  const hasEditScope = !!session?.client.scopes.includes('edit');
  $('#edit-forms').hidden = !hasEditScope || workspace?.permissions?.canEdit === false;
  $('#save-selection').hidden = !hasEditScope;
  for (const button of document.querySelectorAll('#pair-form button, #disconnect, #refresh'))
    button.disabled = busy;
  $('#retry-edit').hidden = !pendingEdit;
  $('#retry-edit').disabled = busy || !session?.online;
  $('#history-controls').hidden = !hasEditScope;
}
function setSession(value) {
  if (!value || value.client.id !== session?.client?.id) {
    workspace = null;
    stale = false;
    pendingEdit = null;
    fontsLoaded = false;
    resetWorkspace();
    editors.reset();
  }
  session = value;
  $('#connection').textContent = value
    ? value.online
      ? 'PC connected'
      : 'PC offline'
    : 'Not connected';
  $('#device-name').textContent = safeText(value?.deviceLabel, 64) || 'Connected computer';
  $('#pair-card').hidden = !!value;
  $('#workspace-area').hidden = !value;
  syncControls();
}
async function command(name, args = {}, generation) {
  return (await api('/api/client/command', { name, args }, generation)).result;
}
async function refresh(generation, full = true) {
  stale = true;
  const current = await api('/api/session', undefined, generation);
  if (current.status !== 'approved') {
    setSession(null);
    return false;
  }
  setSession(current);
  if (!current.online) {
    notice(errorMessages.unavailable, true);
    return false;
  }
  const value = await command('get_workspace', {}, generation);
  if (!validWorkspace(value))
    throw fault('failed', 'The workspace response is incomplete. Refresh on the PC.');
  workspace = value;
  stale = false;
  renderWorkspace(value, canEdit());
  editors.workspaceChanged();
  syncControls();
  await refreshPreview(generation);
  if (full) await refreshDetails(command, generation);
  return true;
}
async function refreshPreview(generation) {
  let preview;
  try {
    preview = await command('get_workspace_preview', {}, generation);
  } catch (error) {
    if (!session || error.code === 'cancelled' || error.code === 'forbidden') throw error;
  }
  renderPreview(preview, workspace?.revision);
  if (!fontsLoaded) {
    try {
      const fonts = await command('list_fonts', {}, generation);
      editors.setFonts(fonts);
      fontsLoaded = Array.isArray(fonts?.fonts);
    } catch (error) {
      if (!session || error.code === 'cancelled' || error.code === 'forbidden') throw error;
    }
  }
}
async function action(callback) {
  if (busy) return;
  busy = true;
  syncControls();
  document.body.setAttribute('aria-busy', 'true');
  try {
    await callback();
  } catch (error) {
    notice(error.message || errorMessages.failed, true);
  } finally {
    busy = false;
    syncControls();
    document.body.setAttribute('aria-busy', 'false');
  }
}
async function edit(name, args) {
  if (!canEdit() || stale || pendingEdit)
    throw fault('forbidden', 'Refresh a workspace with editing permission first.');
  pendingEdit = {
    name,
    args: { expectedRevision: workspace.revision, requestId: crypto.randomUUID(), ...args },
    clientId: session.client.id,
  };
  await performPendingEdit();
}
async function performPendingEdit() {
  const attempt = pendingEdit;
  if (!attempt) return;
  try {
    await verifyEditingClient(attempt);
    const result = await command(attempt.name, attempt.args);
    if (!result || typeof result.revision !== 'string')
      throw fault('failed', errorMessages.failed, true);
    pendingEdit = null;
  } catch (error) {
    editFailure(error, attempt);
  }
  if (await refresh(undefined, false)) notice('Updated on your computer.');
}
async function verifyEditingClient(attempt) {
  const current = await api('/api/session');
  if (current.status !== 'approved' || current.client.id !== attempt.clientId) {
    setSession(current.status === 'approved' ? current : null);
    throw fault('forbidden', 'The connection changed. Refresh before editing the new workspace.');
  }
  setSession(current);
  if (!canEdit())
    throw fault('forbidden', 'Editing permission is no longer available. Refresh or pair again.');
}
function editFailure(error, attempt) {
  if (error.ambiguous && session?.client.id === attempt.clientId)
    throw fault(
      'unavailable',
      'The result is uncertain. Retry the last request to check it safely; it will not make a second copy.',
      true,
    );
  pendingEdit = null;
  if (error.code === 'stale_revision') stale = true;
  if (error.code === 'forbidden' && session)
    setSession({ ...session, client: { ...session.client, scopes: ['read'] } });
  throw error;
}
const editors = bindEditors({ action, edit, command, getWorkspace: () => workspace });
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
function schedulePairStatus(deadline, generation) {
  poll = setTimeout(() => {
    if (generation !== pairGeneration) return;
    if (busy) schedulePairStatus(deadline, generation);
    else void action(() => pairStatus(deadline, generation));
  }, 2000);
}
async function pairStatus(deadline, generation) {
  if (generation !== pairGeneration) return;
  try {
    const value = await api('/api/pair/status', undefined, generation);
    if (value.status === 'approved') {
      setSession(value);
      clearTimeout(poll);
      poll = null;
      const refreshed = continueToMcp() || (await refresh(generation));
      if (generation === pairGeneration && refreshed) notice('This phone is approved.');
      return;
    }
    if (performance.now() >= deadline)
      throw new Error('Pairing expired. Create a new code on your PC.');
    $('#pair-status').textContent = value.online
      ? 'Waiting for your approval on the PC…'
      : 'The PC is offline. Reopen KerfDesk to finish approval.';
    schedulePairStatus(deadline, generation);
  } catch (error) {
    if (generation !== pairGeneration) return;
    notice(error.message, true);
    $('#pair-status').textContent = 'Pair again using a new code.';
    poll = null;
  }
}
bindForm('#pair-form', action, async (form) => {
  const generation = ++pairGeneration;
  clearTimeout(poll);
  setSession(null);
  const clientLabel = form.elements.clientLabel.value.trim();
  if (new TextEncoder().encode(JSON.stringify(clientLabel)).byteLength > 66)
    throw new Error('Use a shorter phone name.');
  const result = await api(
    '/api/pair/claim',
    {
      v: 1,
      deviceId: form.elements.deviceId.value.trim().toLowerCase(),
      code: form.elements.code.value.trim(),
      clientLabel,
      requestedScopes: form.elements.edit.checked ? ['read', 'edit'] : ['read'],
    },
    generation,
  );
  form.elements.code.value = '';
  notice('Approve this phone in KerfDesk on your PC.');
  await pairStatus(pairingDeadline(result.expiresInMs), generation);
});
$('#retry-edit').addEventListener('click', () => {
  void action(performPendingEdit);
});
$('#refresh').addEventListener('click', () => {
  void action(async () => {
    if (await refresh())
      notice(
        pendingEdit
          ? 'Workspace refreshed. Retry the last request to resolve its result.'
          : 'Workspace refreshed.',
      );
  });
});
$('#disconnect').addEventListener('click', () => {
  void action(async () => {
    pairGeneration++;
    clearTimeout(poll);
    poll = null;
    await api('/api/client/revoke', {});
    setSession(null);
    notice('This phone is disconnected.');
  });
});
for (const tab of document.querySelectorAll('[data-view]'))
  tab.addEventListener('click', () => view(tab.dataset.view));
const suggestedId = new URLSearchParams(location.search).get('deviceId');
if (suggestedId && /^[0-9a-f-]{36}$/i.test(suggestedId))
  pairForm.elements.deviceId.value = suggestedId;
void action(async () => {
  let admitted = false;
  try {
    const value = await api('/api/session');
    if (value.status === 'approved') {
      admitted = true;
      setSession(value);
      if (!continueToMcp()) await refresh();
    } else if (value.status === 'pending') {
      $('#pair-status').textContent = 'Waiting for approval on the PC…';
      await pairStatus(pairingDeadline(value.expiresInMs), pairGeneration);
    }
  } catch (error) {
    if (!session) setSession(null);
    if (admitted) notice(error.message, true);
  }
});
