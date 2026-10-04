import { pairingDeadline, rejectedMessage } from './pairing.js';
import { $, bindForm, continueToMcp, errorMessages, safeText } from './control-model.js';
import { bindEditors } from './control-edit.js';
import { bindMachine } from './control-machine.js';
import { bindDrafts } from './control-drafts.js';
import { bindWorkspaceLive, bindPreviewZoom, serialCommand } from './control-live.js';
import {
  createPreviewController,
  assertWorkspace,
  workspaceViewChanged,
  bindWorkspaceEvents,
  refreshDetails,
  renderWorkspace,
  resetWorkspace,
  selectionFeedback,
  syncAccess,
  syncEditorControls,
  renderSession,
  routeSetupHint,
} from './control-workspace.js';

let session = null;
let workspace = null;
let poll = null;
let busy = false;
let stale = false;
let pendingEdit = null;
let pairGeneration = 0;
let live = null;
const drafts = bindDrafts(() => workspace?.revision);
bindPreviewZoom();
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
  assertPairingReady();
  const clientId = session?.client.id;
  let response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: requestHeaders(body),
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
  assertResponseContext(path, generation, clientId);
  if (!response.ok) rejectResponse(response, data, path);
  return data;
}
function assertPairingReady() {
  if (document.documentElement.dataset.pairingBlocked)
    throw fault(
      'cancelled',
      'Open a clean phone control page using the KerfDesk link above, then paste a new code.',
    );
}
function requestHeaders(body) {
  const headers = body === undefined ? {} : { 'Content-Type': 'application/json' };
  if (body !== undefined && session?.csrf) headers['X-KerfDesk-CSRF'] = session.csrf;
  return headers;
}
function assertResponseContext(path, generation, clientId) {
  if (generation !== undefined && generation !== pairGeneration)
    throw fault('cancelled', errorMessages.cancelled);
  if (path === '/api/client/command' && clientId !== session?.client.id)
    throw fault('cancelled', errorMessages.cancelled);
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
    workspace.permissions?.canEdit === true
  );
}
function syncControls() {
  const admitted = canEdit();
  const writable = admitted && !busy && !stale && !pendingEdit;
  syncAccess({ session, workspace, busy, pendingEdit, admitted });
  for (const input of document.querySelectorAll('#artwork-list input')) input.disabled = !writable;
  for (const input of document.querySelectorAll(
    '#edit-forms input, #edit-forms select, #edit-forms textarea',
  ))
    input.disabled = !writable;
  for (const button of document.querySelectorAll(
    '#save-selection, #edit-forms button, #undo, #redo',
  ))
    button.disabled = !writable;
  syncEditorControls(workspace);
  selectionFeedback(workspace, writable);
  drafts.render();
}
function setSession(value) {
  const previousClient = session?.client?.id;
  if (!value || value.client.id !== previousClient) resetSessionWorkspace();
  session = value;
  machine.sessionChanged(value);
  renderSession(value);
  syncControls();
  if (value && value.client.id !== previousClient) live?.start();
  else if (!value) live?.stop();
}
function resetSessionWorkspace() {
  workspace = null;
  stale = false;
  pendingEdit = null;
  previews.reset();
  drafts.reset();
  for (const form of document.querySelectorAll('#edit-forms form')) form.reset();
  resetWorkspace();
  editors.reset();
  machine.reset();
}
async function command(name, args = {}, generation) {
  return (
    await api(
      '/api/client/command',
      { name, args },
      generation ?? (args.requestId ? undefined : pairGeneration),
    )
  ).result;
}
function applyWorkspace(value, force = false) {
  assertWorkspace(value);
  const changed = workspaceViewChanged(value, workspace, force);
  const restore = drafts.capture();
  workspace = value;
  stale = false;
  if (changed) {
    renderWorkspace(value, canEdit());
    restore();
  }
  previews.clearIfChanged(value);
  editors.workspaceChanged();
  syncControls();
}
async function refresh(generation = pairGeneration, full = true) {
  return live.withRead(() => refreshWorkspace(generation, full));
}
async function refreshWorkspace(generation, full) {
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
  applyWorkspace(value, true);
  await previews.refresh(generation, full);
  if (full) await refreshDetails(command, generation);
  live?.confirm();
  return true;
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
  if (name === 'set_selection') drafts.assertSelection();
  if (!canEdit() || stale || pendingEdit)
    throw fault('forbidden', 'Refresh a workspace with editing permission first.');
  pendingEdit = {
    name,
    args: { expectedRevision: workspace.revision, requestId: crypto.randomUUID(), ...args },
    clientId: session.client.id,
    formId: drafts.submitted()?.id,
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
    if (attempt.formId) drafts.clean(attempt.formId);
    if (attempt.name === 'set_selection') drafts.clearSelection();
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
const getWorkspace = () => workspace;
const editorOptions = { action, edit, command, drafts, getWorkspace, applyWorkspace };
editorOptions.command = serialCommand(() => live, command);
const editors = bindEditors(editorOptions);
const previews = createPreviewController({
  workspace: () => workspace,
  session: () => session,
  active: () => live.active(),
  blocked: () => busy || !!pendingEdit,
  command,
  apply: applyWorkspace,
  setFonts: editors.setFonts,
});
const machine = bindMachine({
  command,
  verifySession: async () => {
    const value = await api('/api/session');
    setSession(value.status === 'approved' ? value : null);
    if (value.status !== 'approved' || !value.online)
      throw new Error('The PC is offline or this connection is no longer approved.');
    return value;
  },
});
$('#artwork-list').addEventListener('change', syncControls);
live = bindWorkspaceLive({
  ready: () => !!session,
  blocked: () => busy || !!pendingEdit || machine.isBusy(),
  generation: () => pairGeneration,
  api,
  command,
  setSession,
  session: () => session,
  apply: applyWorkspace,
  previews,
});
window.addEventListener('pagehide', () => {
  pairGeneration++;
  clearTimeout(poll);
});
bindWorkspaceEvents({ live, machine, action, drafts, editors, refresh });
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
      requestedScopes: [
        'read',
        ...['edit', 'control'].filter((scope) => form.elements[scope].checked),
      ],
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
routeSetupHint();
if (document.documentElement.dataset.pairingBlocked) {
  notice(
    'Open a clean phone control page using the KerfDesk link above, then paste a new code.',
    true,
  );
  syncControls();
}
void action(async () => {
  const generation = pairGeneration;
  let admitted = false;
  try {
    const value = await api('/api/session', undefined, generation);
    if (value.status === 'approved') {
      admitted = true;
      setSession(value);
      if (!continueToMcp()) await refresh(generation);
    } else if (value.status === 'pending') {
      $('#pair-status').textContent = 'Waiting for approval on the PC…';
      await pairStatus(pairingDeadline(value.expiresInMs), pairGeneration);
    }
  } catch (error) {
    if (!session) setSession(null);
    if (admitted) notice(error.message, true);
  }
});
