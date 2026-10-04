/** Portable MCP Apps resource. No network, credentials, dependencies or machine controls. */
export const KERFDESK_WORKSPACE_UI_URI = 'ui://kerfdesk/workspace/v1.html';
export const KERFDESK_WORKSPACE_UI_MIME = 'text/html;profile=mcp-app';
export const KERFDESK_WORKSPACE_UI_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KerfDesk workspace</title>
<style>
:root{font-family:system-ui,sans-serif;color-scheme:light dark;color:#172e29;background:#f7faf8}
*{box-sizing:border-box}body{margin:0;padding:20px}header,.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
header{justify-content:space-between}h1{font-size:20px;margin:0}p{line-height:1.5;overflow-wrap:anywhere}
.muted{font-size:13px;color:#4d665e}.preview{background:#fff;border:1px solid #ccdcd5;border-radius:14px;overflow:hidden}
img{width:100%;max-height:360px;object-fit:contain;display:block}button{font:inherit;min-height:44px;padding:10px 14px;border:1px solid #adc5b9;border-radius:10px;background:#d8f3e5;color:#163b2b;cursor:pointer}
button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible{outline:3px solid #257cb7;outline-offset:2px}
.actions{margin:12px 0}.items{display:grid;gap:8px;max-height:240px;overflow:auto;overscroll-behavior:contain}
label{display:flex;gap:10px;align-items:center;padding:10px;border:1px solid #ccdcd5;border-radius:10px;font-size:14px;overflow-wrap:anywhere}
input{width:20px;height:20px;flex-shrink:0;accent-color:#277f57}#message{font-size:13px;padding:10px;border-radius:10px;background:#e7f1eb}
#message[data-error=true]{background:#fbe5e8;color:#803140}[hidden]{display:none!important}
@media(prefers-color-scheme:dark){:root{color:#e4f2eb;background:#16241e}.muted{color:#b2c8bd}label,.preview{border-color:#3d5648}button{background:#254b36;color:#dff8e9;border-color:#456954}#message{background:#244132}}
</style></head><body>
<header><h1 id="title">KerfDesk workspace</h1><button id="refresh" type="button" disabled>Refresh</button></header>
<p id="summary" class="muted">Connecting to the host…</p>
<div class="preview"><img id="preview" alt="Artwork preview from KerfDesk on your PC" hidden></div>
<p id="preview-message" class="muted">Artwork previews and text sharing are controlled on the PC.</p>
<div class="actions"><button id="undo" type="button" disabled>Undo</button><button id="redo" type="button" disabled>Redo</button><button id="retry" type="button" hidden>Retry last request</button></div>
<div id="items" class="items" aria-label="Workspace artwork"></div>
<div class="actions"><button id="select" type="button" disabled>Use this selection</button></div>
<p id="message" role="status" aria-live="polite">Open KerfDesk on the paired computer. Frame and Start remain on the PC.</p>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const text = (value, max = 2048) => typeof value === 'string' ? value.slice(0, max) : '';
  let sequence = 0, workspace = null, connected = false, toolCallsAvailable = false, disposed = false, busy = false, pendingEdit = null, hostOrigin = '*';
  const requests = new Map();
  const errorText = {
    stale_revision: 'The workspace changed on the PC. Refresh, review it, then try again.',
    needs_pro: 'Choose a trial or licence on the PC to use this Pro feature.',
    cancelled: 'Access was revoked or the request was cancelled. Reconnect through the host.',
    forbidden: 'Editing permission is unavailable. Approve access on the PC and reconnect through the host.',
    invalid_input: 'The request could not be applied. Refresh the workspace and check your selection.',
  };
  function message(value, error = false) {
    $('message').textContent = text(value);
    $('message').dataset.error = String(error);
  }
  function send(value) { window.parent.postMessage(value, hostOrigin); }
  function request(method, params) {
    return new Promise((resolve, reject) => {
      if (disposed) { reject(new Error('This view is closed.')); return; }
      const id = ++sequence;
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(Object.assign(new Error('The host did not reply. Refresh or retry the last request.'), { ambiguous: true }));
      }, 30000);
      requests.set(id, { resolve, reject, timer });
      send({ jsonrpc: '2.0', id, method, params });
    });
  }
  function validMessage(event) {
    if (disposed) return false;
    if (event.source !== window.parent || window.parent === window) return false;
    if (hostOrigin !== '*' && event.origin !== hostOrigin) return false;
    const value = event.data;
    if (!value || value.jsonrpc !== '2.0' || typeof value !== 'object') return false;
    try { return JSON.stringify(value).length <= 262144; } catch { return false; }
  }
  window.addEventListener('message', (event) => {
    if (!validMessage(event)) return;
    const value = event.data;
    if (value.method === 'ui/resource-teardown' && (Number.isSafeInteger(value.id) || typeof value.id === 'string')) {
      teardown(value.id);
    } else if (typeof value.id === 'number') {
      const pending = requests.get(value.id);
      if (!pending || value.method) return;
      requests.delete(value.id); clearTimeout(pending.timer);
      if (hostOrigin === '*' && event.origin !== 'null') hostOrigin = event.origin;
      if (value.error) pending.reject(Object.assign(new Error('The host refused the request. Refresh or reconnect through the host.'), { code: 'host_refused' }));
      else pending.resolve(value.result);
    } else if (value.method === 'ui/notifications/tool-result') {
      try { update(value.params); } catch { clearWorkspace(); message('The tool result could not be displayed. Refresh the workspace.', true); }
    }
  });
  function teardown(id) {
    disposed = true; connected = false; toolCallsAvailable = false; pendingEdit = null;
    for (const pending of requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(Object.assign(new Error('This view was closed by the host.'), { code: 'cancelled' }));
    }
    requests.clear(); clearWorkspace();
    message('This view is closed. The desktop workspace stays on your PC.');
    send({ jsonrpc: '2.0', id, result: {} });
  }
  function unwrap(result) {
    if (!result || result.isError) {
      const code = result && result._meta && result._meta['mcp/www_authenticate'] ? 'forbidden' : result && result.structuredContent && result.structuredContent.error && result.structuredContent.error.code;
      throw Object.assign(new Error(errorText[code] || 'The desktop request failed. Refresh or reconnect through the host.'), { code });
    }
    const value = result.structuredContent;
    if (!value || typeof value !== 'object') throw new Error('The desktop response is incomplete. Refresh on the PC.');
    return value;
  }
  function update(result) {
    const value = unwrap(result);
    if (Array.isArray(value.artwork)) renderWorkspace(value);
    if (['ready', 'disabled', 'unavailable'].includes(value.status)) renderPreview(value);
    return value;
  }
  async function tool(name, args = {}) {
    if (!toolCallsAvailable) throw new Error('This host can display results but cannot call tools from this view. Ask the assistant to refresh the workspace.');
    return update(await request('tools/call', { name, arguments: args }));
  }
  function canEdit() { return !!workspace && !!workspace.permissions && workspace.permissions.canEdit === true; }
  function controls() {
    const enabled = connected && toolCallsAvailable && canEdit() && !busy && !pendingEdit;
    $('refresh').disabled = !connected || !toolCallsAvailable || busy;
    $('select').disabled = !enabled;
    const history = workspace && workspace.history || {};
    $('undo').disabled = !enabled || !history.canUndo;
    $('redo').disabled = !enabled || !history.canRedo;
    for (const input of $('items').querySelectorAll('input')) input.disabled = !enabled;
    $('retry').hidden = !pendingEdit;
    $('retry').disabled = busy || !connected || !toolCallsAvailable || !canEdit();
  }
  function renderWorkspace(value) {
    if (!validWorkspace(value))
      throw new Error('The workspace response is incomplete.');
    workspace = value;
    $('title').textContent = text(value.name, 512) || 'Untitled workspace';
    $('summary').textContent = String(value.totalArtwork) + ' artwork · ' + String(value.totalOperations) + ' operations · ' + (canEdit() ? 'Editing approved' : 'Viewing only');
    $('items').replaceChildren();
    for (const item of value.artwork) {
      if (!item || typeof item.id !== 'string' || item.id.length > 128) continue;
      const label = document.createElement('label'), input = document.createElement('input'), title = document.createElement('span');
      input.type = 'checkbox'; input.value = item.id; input.checked = value.selection.includes(item.id);
      title.textContent = text(item.name || item.type, 512) || 'Artwork';
      label.append(input, title); $('items').append(label);
    }
    if (!value.artwork.length) $('items').textContent = 'There is no artwork in this workspace yet.';
    $('preview').hidden = true; $('preview').removeAttribute('src');
    controls();
  }
  function validWorkspace(value) {
    const ids = (items) => Array.isArray(items) && items.length <= 200 && items.every((item) => item && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 128);
    return typeof value.revision === 'string' && value.revision.length > 0 && value.revision.length <= 200 && ids(value.artwork) && ids(value.operations) && Array.isArray(value.selection) && value.selection.length <= 200;
  }
  function clearWorkspace() {
    workspace = null; $('items').replaceChildren(); $('preview').hidden = true; $('preview').removeAttribute('src');
    $('title').textContent = 'KerfDesk workspace'; $('summary').textContent = 'Refresh the workspace through the host.'; controls();
  }
  function validImage(image) {
    if (!image || image.mimeType !== 'image/png' || ![image.widthPx, image.heightPx].every((size) => Number.isInteger(size) && size > 0 && size <= 1024)) return false;
    if (typeof image.data !== 'string' || image.data.length > 65536 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return false;
    try {
      const bytes = atob(image.data), size = (offset) => [0,1,2,3].reduce((n, i) => n * 256 + bytes.charCodeAt(offset + i), 0);
      return bytes.startsWith('\x89PNG\r\n\x1a\n') && bytes.slice(12,16) === 'IHDR' && size(16) === image.widthPx && size(20) === image.heightPx;
    } catch { return false; }
  }
  function renderPreview(value) {
    const image = $('preview'); image.hidden = true; image.removeAttribute('src');
    if (workspace && value.revision !== workspace.revision) { $('preview-message').textContent = 'Refresh to see the current workspace preview.'; return; }
    if (value.status === 'disabled') {
      $('preview-message').textContent = 'Sharing is off. On the PC enable “Share artwork previews and text with approved phones and MCP apps” in Settings → Phone & MCP.';
    } else if (value.status === 'ready' && validImage(value.preview)) {
      image.src = 'data:image/png;base64,' + value.preview.data; image.hidden = false;
      $('preview-message').textContent = 'Design preview, not a toolpath or live machine position. Refresh after changes on the PC.';
    } else $('preview-message').textContent = text(value.message) || 'Preview unavailable. Your artwork stays on the PC.';
  }
  async function refresh() {
    await tool('get_workspace');
    await tool('get_workspace_preview');
  }
  async function run(callback) {
    if (busy) return;
    busy = true; controls(); document.body.setAttribute('aria-busy', 'true');
    try { await callback(); }
    catch (error) {
      if (['host_refused', 'cancelled', 'forbidden'].includes(error.code)) {
        pendingEdit = null; clearWorkspace();
        $('summary').textContent = 'Access needs refreshing through the host.';
      }
      message(error.message, true);
    }
    finally { busy = false; controls(); document.body.setAttribute('aria-busy', 'false'); }
  }
  async function mutate(name, args) {
    if (!canEdit() || pendingEdit) return;
    pendingEdit = { name, args: { ...args, expectedRevision: workspace.revision, requestId: crypto.randomUUID() } };
    await retry();
  }
  async function retry() {
    if (!pendingEdit || !canEdit()) return;
    const attempt = pendingEdit;
    try { await tool(attempt.name, attempt.args); pendingEdit = null; }
    catch (error) {
      if (error.ambiguous) { message('The result is uncertain. Retry last request to check it safely without applying it twice.', true); return; }
      pendingEdit = null;
      if (workspace) workspace.permissions = { canEdit: false };
      throw error;
    }
    await refresh(); message('Updated on your computer.');
  }
  $('refresh').addEventListener('click', () => { void run(async () => { await refresh(); message('Workspace refreshed.'); }); });
  $('select').addEventListener('click', () => { void run(() => mutate('set_selection', { artworkIds: [...$('items').querySelectorAll('input:checked')].map((input) => input.value) })); });
  for (const name of ['undo', 'redo']) $(name).addEventListener('click', () => { void run(() => mutate(name, {})); });
  $('retry').addEventListener('click', () => { void run(retry); });
  void run(async () => {
    if (window.parent === window) throw new Error('Open this view in an MCP Apps compatible host.');
    const initialized = await request('ui/initialize', { appInfo: { name: 'kerfdesk-workspace', version: '1.0.0' }, appCapabilities: {}, protocolVersion: '2026-01-26' });
    if (!initialized || initialized.protocolVersion !== '2026-01-26') throw new Error('The host uses an unsupported UI protocol. The MCP tools remain available without this view.');
    connected = true;
    toolCallsAvailable = !!initialized.hostCapabilities && typeof initialized.hostCapabilities.serverTools === 'object' && initialized.hostCapabilities.serverTools !== null && !Array.isArray(initialized.hostCapabilities.serverTools);
    send({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
    if (toolCallsAvailable) { await refresh(); message('Connected to KerfDesk. Frame and Start remain on the PC.'); }
    else message('This host can display tool results. Ask the assistant to refresh or edit; this view cannot call tools.');
  });
})();
</script></body></html>`;
