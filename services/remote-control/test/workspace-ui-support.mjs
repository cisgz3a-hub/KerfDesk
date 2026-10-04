import { KERFDESK_WORKSPACE_UI_HTML } from '../../../electron/mcp/workspace-ui.ts';
import { UI_ORIGIN, fixtureState, idle, readResult } from './phone-workspace-support.mjs';

export async function appPage(browser, state = fixtureState()) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  const rpc = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.exposeFunction('fixtureRequest', async (message) => {
    rpc.push({ method: message.method, id: message.id, params: structuredClone(message.params) });
    if (message.method === 'ui/initialize')
      return {
        protocolVersion: state.protocolVersion ?? '2026-01-26',
        hostInfo: { name: 'Portable fixture', version: '1' },
        hostCapabilities: state.displayOnly ? {} : { serverTools: {} },
        hostContext: {},
      };
    if (message.method !== 'tools/call') return null;
    const { name, arguments: args } = message.params;
    state.commands.push({ name, args });
    if (state.revoked)
      return { isError: true, structuredContent: { error: { code: 'cancelled' } } };
    const result = readResult(state, name);
    if (result) return { structuredContent: result };
    if (!state.scopes.includes('edit'))
      return { isError: true, structuredContent: { error: { code: 'forbidden' } } };
    if (state.receipts.has(args.requestId))
      return { structuredContent: state.receipts.get(args.requestId) };
    if (args.expectedRevision !== `fixture-${state.revision}`)
      return { isError: true, structuredContent: { error: { code: 'stale_revision' } } };
    state.edits += 1;
    state.revision += 1;
    if (name === 'undo') state.history = { canUndo: false, canRedo: true };
    if (name === 'redo') state.history = { canUndo: true, canRedo: false };
    const changed = { revision: `fixture-${state.revision}` };
    state.receipts.set(args.requestId, changed);
    if (state.dropNextWrite) {
      state.dropNextWrite = false;
      return null;
    }
    return { structuredContent: changed };
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== UI_ORIGIN) return route.abort();
    if (url.pathname === '/widget')
      return route.fulfill({ contentType: 'text/html', body: KERFDESK_WORKSPACE_UI_HTML });
    if (url.pathname === '/host')
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body>
      <iframe id="widget" src="/widget" style="width:100%;height:760px;border:0"></iframe>
      <script>
      const frame = document.getElementById('widget');
      window.addEventListener('message', async (event) => {
        if (event.source !== frame.contentWindow || !event.data.id) return;
        const response = await window.fixtureRequest(event.data);
        if (response !== null) frame.contentWindow.postMessage({jsonrpc:'2.0',id:event.data.id,result:response},'*');
      });
      </script></body></html>`,
      });
    return route.abort();
  });
  await page.goto(UI_ORIGIN + '/host');
  const frame = page.frames().find((entry) => entry.url() === UI_ORIGIN + '/widget');
  await idle(frame);
  return { context, page, frame, state, rpc, errors };
}

export async function notification(page, result) {
  await page.evaluate((value) => {
    globalThis.document.getElementById('widget').contentWindow.postMessage(
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: { structuredContent: value },
      },
      '*',
    );
  }, result);
}
