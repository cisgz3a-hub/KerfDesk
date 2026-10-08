import { readFile } from 'node:fs/promises';
import { build, transform } from 'esbuild';
import {
  fixtureState,
  phonePage,
  readResult,
  workspace,
  UI_ORIGIN,
  ONE_PIXEL_PNG,
  idle,
} from './phone-workspace-support.mjs';

/** Browser-only authoring fixture. No real app, relay, provider or controller is contacted. */
export function touchFixture() {
  const state = fixtureState();
  Object.assign(state, {
    creation: true,
    viewport: { xMm: -100, yMm: -100, widthMm: 400, heightMm: 400 },
    selected: ['rectangle-1'],
    artwork: [
      {
        id: 'rectangle-1',
        type: 'rectangle',
        visible: true,
        editable: true,
        bounds: { xMm: -20, yMm: 30, widthMm: 60, heightMm: 40 },
      },
      {
        id: 'hidden-1',
        type: 'rectangle',
        visible: false,
        editable: true,
        bounds: { xMm: -20, yMm: 30, widthMm: 60, heightMm: 40 },
      },
      {
        id: 'locked-1',
        type: 'rectangle',
        visible: true,
        editable: false,
        bounds: { xMm: -20, yMm: 30, widthMm: 60, heightMm: 40 },
      },
    ],
  });
  state.readHook = (name, args) => {
    if (args?.requestId) state.onWrite?.(name, args);
    const result = touchRead(state, name, args);
    return result ? { result } : null;
  };
  return state;
}
export function touchRead(state, name, args) {
  if (name === 'get_workspace') {
    const value = workspace(state);
    Object.assign(value, {
      mode: state.mode ?? 'laser',
      capabilities: { touchEditing: state.creation, groupTransformBounds: true },
      artwork: state.empty
        ? []
        : state.artwork.map((item) => ({
            ...item,
            ...(item.visible !== false && item.editable !== false && item.bounds
              ? { transformBounds: item.bounds }
              : {}),
          })),
      selection: state.empty ? [] : state.selected,
      totalArtwork: state.empty ? 0 : state.artwork.length,
    });
    if (state.legacy) delete value.capabilities;
    return value;
  }
  if (name === 'get_workspace_preview')
    return {
      revision: 'fixture-' + state.revision,
      status: state.sharing ? 'ready' : 'disabled',
      ...(state.sharing
        ? {
            preview: state.preview ?? {
              mimeType: 'image/png',
              data: ONE_PIXEL_PNG,
              widthPx: 1,
              heightPx: 1,
            },
            ...(state.noViewport ? {} : { viewport: state.viewport }),
          }
        : {}),
    };
  return readResult(state, name, args);
}
export async function compactTouchScript() {
  const modules = ['geometry', 'viewport', 'view', ''];
  let source = '';
  for (const suffix of modules)
    source +=
      (await readFile(
        new URL('../public/control-touch' + (suffix ? '-' + suffix : '') + '.js', import.meta.url),
        'utf8',
      )) + '\n';
  source = source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  source += '\nfunction bindMcpTouchCanvas(options){return bindTouchCanvas(options);}\n';
  return (await transform(source, { minifyWhitespace: true, target: 'es2022' })).code;
}
export async function touchExports() {
  const source = await readFile(
    new URL('../../../electron/mcp/workspace-touch-ui.ts', import.meta.url),
    'utf8',
  );
  return import('data:text/javascript,' + encodeURIComponent(source));
}
export async function loadTouch(browser, kind, state = touchFixture(), width = 390, options = {}) {
  const loaded =
    kind === 'phone'
      ? await phonePage(browser, state, width, { clock: true })
      : await touchAppPage(browser, state, width, options);
  if (kind === 'phone' && options.height)
    await loaded.page.setViewportSize({ width, height: options.height });
  loaded.surface = kind === 'phone' ? loaded.page : loaded.frame;
  loaded.image = kind === 'phone' ? '#workspace-preview' : '#preview';
  await loaded.surface.locator('[data-touch-tool=rectangle]').waitFor();
  if (state.sharing)
    await loaded.surface.waitForFunction(
      () => globalThis.document.querySelector('#preview-surface img').naturalWidth > 0,
    );
  return loaded;
}
async function touchAppPage(browser, state, width, options = {}) {
  const { outputFiles } = await build({
    entryPoints: [
      new URL('../../../electron/mcp/workspace-ui.ts', import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        '$1',
      ),
    ],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const { KERFDESK_WORKSPACE_UI_HTML } = await import(
    'data:text/javascript,' + encodeURIComponent(outputFiles[0].text)
  );
  const context = await browser.newContext({
    viewport: { width, height: options.height ?? 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.clock.install();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.exposeFunction('touchRequest', async (message) => {
    if (message.method === 'ui/initialize')
      return {
        protocolVersion: '2026-01-26',
        hostInfo: { name: 'Touch fixture', version: '1' },
        hostCapabilities: state.displayOnly ? {} : { serverTools: {} },
        hostContext: {},
      };
    if (message.method !== 'tools/call') return null;
    const { name, arguments: args } = message.params;
    state.commands.push({ name, args: structuredClone(args) });
    if (state.revoked)
      return { isError: true, structuredContent: { error: { code: 'cancelled' } } };
    const hooked = await state.readHook?.(name, args);
    if (hooked)
      return hooked.error
        ? { isError: true, structuredContent: { error: hooked.error } }
        : { structuredContent: hooked.result };
    if (!state.scopes.includes('edit'))
      return { isError: true, structuredContent: { error: { code: 'forbidden' } } };
    if (state.receipts.has(args.requestId))
      return { structuredContent: state.receipts.get(args.requestId) };
    if (args.expectedRevision !== 'fixture-' + state.revision)
      return { isError: true, structuredContent: { error: { code: 'stale_revision' } } };
    state.edits++;
    state.revision++;
    const result = { revision: 'fixture-' + state.revision };
    state.receipts.set(args.requestId, result);
    if (state.dropNextWrite) {
      state.dropNextWrite = false;
      return null;
    }
    return { structuredContent: result };
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== UI_ORIGIN) return route.abort();
    if (url.pathname === '/widget')
      return route.fulfill({ contentType: 'text/html', body: KERFDESK_WORKSPACE_UI_HTML });
    if (url.pathname === '/host')
      return route.fulfill({
        contentType: 'text/html',
        body:
          '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><iframe id="widget" src="/widget" style="width:100%;height:' +
          (options.height ?? 844) +
          'px;display:block;border:0"></iframe><script>const frame=document.getElementById("widget");window.addEventListener("message",async event=>{if(event.source!==frame.contentWindow||!event.data.id)return;const result=await window.touchRequest(event.data);if(result!==null)frame.contentWindow.postMessage({jsonrpc:"2.0",id:event.data.id,result},"*");});</script></body></html>',
      });
    return route.abort();
  });
  await page.goto(UI_ORIGIN + '/host');
  const frame = page.frames().find((value) => value.url() === UI_ORIGIN + '/widget');
  await idle(frame);
  return { context, page, frame, state, errors };
}
export async function scenePoint(loaded, xMm, yMm) {
  const viewport = loaded.state.viewport;
  const box = await loaded.surface.locator(loaded.image).boundingBox();
  const natural = await loaded.surface
    .locator(loaded.image)
    .evaluate((image) => ({ width: image.naturalWidth, height: image.naturalHeight }));
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const width = natural.width * scale,
    height = natural.height * scale;
  return {
    x: box.x + (box.width - width) / 2 + ((xMm - viewport.xMm) * width) / viewport.widthMm,
    y: box.y + (box.height - height) / 2 + ((yMm - viewport.yMm) * height) / viewport.heightMm,
  };
}
export async function drag(loaded, from, to, steps = 5) {
  await visibleCanvas(loaded);
  const a = await scenePoint(loaded, ...from),
    b = await scenePoint(loaded, ...to);
  await loaded.page.mouse.move(a.x, a.y);
  await loaded.page.mouse.down();
  await loaded.page.mouse.move(b.x, b.y, { steps });
  await loaded.page.mouse.up();
}
export async function choose(loaded, tool) {
  await loaded.surface.locator('[data-touch-tool=' + tool + ']').click();
}
export async function applyDraft(loaded) {
  await loaded.surface.locator('.touch-apply:not(:disabled)').click();
  await idle(loaded.surface);
}
export async function finger(loaded, points) {
  await visibleCanvas(loaded);
  const cdp = await loaded.context.newCDPSession(loaded.page);
  const first = await scenePoint(loaded, ...points[0]);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ id: 1, ...first }],
  });
  for (const coordinates of points.slice(1)) {
    const point = await scenePoint(loaded, ...coordinates);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ id: 1, ...point }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
export async function visibleCanvas(loaded) {
  await loaded.surface
    .locator('#preview-surface')
    .evaluate((surface) =>
      surface.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }),
    );
  await loaded.surface.evaluate(
    () => new Promise((resolve) => globalThis.requestAnimationFrame(resolve)),
  );
}
export const writes = (state) => state.commands.filter((value) => value.args.requestId);
export function writeAdmission(state) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Fixture edit was not admitted within 10 seconds.')),
      10000,
    );
    state.onWrite = () => {
      clearTimeout(timer);
      state.onWrite = null;
      resolve();
    };
  });
}
export async function notifyTouch(loaded, result) {
  await loaded.page.evaluate(
    (value) =>
      globalThis.document.getElementById('widget').contentWindow.postMessage(
        {
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: { structuredContent: value },
        },
        '*',
      ),
    result,
  );
}
