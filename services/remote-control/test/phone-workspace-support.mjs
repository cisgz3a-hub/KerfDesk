import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const UI_ORIGIN = 'https://ui-fixture.test';
export const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/aRvsAAAAASUVORK5CYII=';
const publicRoot = new URL('../public/', import.meta.url);

export async function openTask(page, id) {
  const details = page.locator('#' + id);
  if ((await details.getAttribute('open')) === null)
    await details.locator(':scope > summary').click();
}

export async function visualState() {
  const state = fixtureState();
  const path = process.env.KERFDESK_MCP_PREVIEW_IMAGE;
  if (!path) return state;
  const png = await readFile(path);
  state.preview = {
    mimeType: 'image/png',
    data: png.toString('base64'),
    widthPx: png.readUInt32BE(16),
    heightPx: png.readUInt32BE(20),
  };
  state.visual = true;
  state.text.text = 'MCP controls';
  state.fonts[2].name = 'Handwritten Script';
  return state;
}

export function fixtureState() {
  return {
    clientId: 'client-fixture',
    scopes: ['read', 'edit'],
    online: true,
    revoked: false,
    revision: 1,
    edits: 0,
    commands: [],
    receipts: new Map(),
    dropNextWrite: false,
    sharing: true,
    preview: null,
    malformed: false,
    text: {
      artworkId: 'text-1',
      text: 'MCP test',
      fontId: 'sans',
      fontSizeMm: 10,
      alignment: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    fonts: [
      { id: 'sans', name: 'Clean Sans', geometry: 'outline', style: 'sans' },
      { id: 'serif', name: 'Classic Serif', geometry: 'outline', style: 'serif' },
      {
        id: 'script',
        name: 'Script <img src=x onerror=alert(1)>',
        geometry: 'outline',
        style: 'script',
      },
    ],
    history: { canUndo: true, canRedo: false },
  };
}

export function workspace(state) {
  const value = {
    revision: `fixture-${state.revision}`,
    name: 'Phone workspace fixture',
    mode: 'laser',
    dirty: true,
    selection: ['text-1'],
    totalArtwork: 2,
    totalOperations: 1,
    truncated: false,
    permissions: { canEdit: state.scopes.includes('edit'), artworkSharingEnabled: state.sharing },
    history: state.history,
    artwork: [
      {
        id: 'text-1',
        type: 'text',
        name: 'MCP test',
        bounds: { xMm: 20, yMm: 20, widthMm: 50, heightMm: 10 },
      },
      {
        id: 'rectangle-1',
        type: 'rectangle',
        name: '<script>literal artwork</script>',
        bounds: { xMm: 20, yMm: 40, widthMm: 50, heightMm: 20 },
      },
    ],
    operations: [
      {
        id: 'laser-1',
        name: 'Mark artwork',
        type: 'laser_vector',
        enabled: true,
        powerPercent: 25,
        speedMmPerMin: 1000,
        passes: 1,
      },
    ],
  };
  if (state.empty)
    Object.assign(value, {
      artwork: [],
      operations: [],
      selection: [],
      totalArtwork: 0,
      totalOperations: 0,
    });
  if (state.visual) {
    value.name = 'MCP controls';
    value.artwork[0].name = 'MCP controls';
    value.artwork[1].name = 'Rectangle';
  }
  if (state.oldDesktop) {
    delete value.permissions;
    delete value.history;
  }
  if (state.extraText) {
    value.artwork.push({ id: state.extraText.artworkId, type: 'text', name: state.extraText.text });
    value.totalArtwork += 1;
  }
  return value;
}

export function readResult(state, name, args = {}) {
  const revision = `fixture-${state.revision}`;
  if (name === 'get_workspace') return state.malformed ? { revision } : workspace(state);
  if (name === 'get_workspace_preview')
    return {
      revision,
      status: state.sharing ? 'ready' : 'disabled',
      ...(state.sharing
        ? {
            preview: state.preview ?? {
              mimeType: 'image/png',
              data: ONE_PIXEL_PNG,
              widthPx: 1,
              heightPx: 1,
            },
          }
        : {}),
    };
  if (name === 'list_fonts')
    return { revision, fonts: state.fonts, total: state.fonts.length, truncated: false };
  if (name === 'get_text')
    return {
      revision,
      ...(state.extraText && args.artworkId === state.extraText.artworkId
        ? state.extraText
        : state.text),
    };
  if (name === 'get_app_status')
    return {
      revision,
      app: { name: 'KerfDesk', version: 'fixture', platform: 'desktop' },
      edition: { mode: 'free' },
      updates: { available: false },
    };
  if (name === 'get_machine')
    return {
      revision,
      machine: {
        id: 'fixture-machine',
        name: 'Fixture profile',
        mode: 'laser',
        bedWidthMm: 300,
        bedHeightMm: 300,
      },
    };
  if (name === 'review_job')
    return {
      revision,
      status: 'ready',
      mode: 'laser',
      summary: {
        artworkCount: 2,
        operationCount: 1,
        estimatedSeconds: 90,
        bounds: { xMm: 20, yMm: 20, widthMm: 50, heightMm: 40 },
      },
      warnings: [
        {
          code: 'fixture',
          message: '<script>literal review warning</script>',
          severity: 'warning',
        },
      ],
      frame: { required: true, complete: false },
    };
  if (name === 'list_material_recipes')
    return { revision, recipes: [], total: 0, truncated: false };
  return null;
}

async function json(route, status, body) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function command(route, state) {
  const { name, args } = route.request().postDataJSON();
  state.commands.push({ name, args: structuredClone(args) });
  if (state.machineCommand) {
    const answer = await state.machineCommand(name, args);
    if (answer) {
      if (answer.drop) return route.abort('failed');
      return json(
        route,
        answer.status ?? 200,
        answer.error ? { error: answer.error } : { result: answer.result },
      );
    }
  }
  const result = readResult(state, name, args);
  if (result) return json(route, 200, { result });
  if (!state.scopes.includes('edit')) return json(route, 403, { error: { code: 'forbidden' } });
  if (state.receipts.has(args.requestId))
    return json(route, 200, { result: state.receipts.get(args.requestId) });
  if (args.expectedRevision !== `fixture-${state.revision}`)
    return json(route, 409, { error: { code: 'stale_revision' } });
  state.edits += 1;
  state.revision += 1;
  if (name === 'update_text') Object.assign(state.text, args.patch);
  if (name === 'undo') state.history = { canUndo: false, canRedo: true };
  if (name === 'redo') state.history = { canUndo: true, canRedo: false };
  const changed = { revision: `fixture-${state.revision}`, history: state.history };
  state.receipts.set(args.requestId, changed);
  if (state.dropNextWrite) {
    state.dropNextWrite = false;
    return route.abort('failed');
  }
  return json(route, 200, { result: changed });
}

export async function phonePage(browser, state = fixtureState(), width = 390) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== UI_ORIGIN) return route.abort();
    if (url.pathname === '/api/session') {
      if (state.revoked) return json(route, 401, { error: { code: 'unauthorized' } });
      return json(route, 200, {
        status: 'approved',
        deviceLabel: 'Fixture PC',
        online: state.online,
        csrf: 'fixture-csrf',
        client: { id: state.clientId, scopes: state.scopes },
      });
    }
    if (url.pathname === '/api/client/command') return command(route, state);
    if (url.pathname === '/api/client/revoke') {
      state.revoked = true;
      return json(route, 200, { ok: true });
    }
    const file = url.pathname === '/control' ? 'control.html' : url.pathname.slice(1);
    if (!/^control(?:-[a-z]+)*\.(?:html|js|css)$/.test(file) && file !== 'pairing.js')
      return route.abort();
    const type = file.endsWith('.js')
      ? 'text/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : 'text/html';
    await route.fulfill({
      status: 200,
      contentType: type,
      body: await readFile(new URL(file, publicRoot), 'utf8'),
    });
  });
  await page.goto(UI_ORIGIN + '/control');
  await idle(page);
  return { context, page, state, errors };
}

export async function idle(page) {
  await page.waitForFunction(() => globalThis.document.body.getAttribute('aria-busy') === 'false');
}

export async function capture(page, name) {
  const directory = process.env.KERFDESK_MCP_UI_EVIDENCE;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: false });
}
