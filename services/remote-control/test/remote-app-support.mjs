import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { APP_CSP } from '../src/app-assets.ts';

export const ORIGIN = 'https://kerfdesk-phone-control.cisgz3a.workers.dev';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === 'string' && UUID.test(value);

export function launch() {
  return chromium.launch(
    process.env.KERFDESK_TEST_BROWSER === 'chromium' ? {} : { channel: 'chrome' },
  );
}

const bounds = { xMm: 10, yMm: 10, widthMm: 40, heightMm: 30 };
export function fixture(overrides = {}) {
  return {
    revision: 1,
    scopes: ['read', 'edit', 'control'],
    commands: [],
    socket: [],
    workspace: {
      mode: 'laser',
      name: 'Current workspace',
      dirty: true,
      selection: [],
      artwork: [
        {
          id: 'a1',
          type: 'shape',
          name: 'Rectangle',
          bounds,
          transformBounds: bounds,
          operationId: 'op1',
          visible: true,
          editable: true,
        },
      ],
      operations: [
        {
          id: 'op1',
          type: 'line',
          name: 'Cut',
          enabled: true,
          powerPercent: 30,
          speedMmPerMin: 1500,
          passes: 1,
          color: '#e53935',
          artworkCount: 1,
        },
      ],
      totalArtwork: 1,
      totalOperations: 1,
      truncated: false,
      history: { canUndo: true, canRedo: false },
      permissions: { canEdit: true, artworkSharingEnabled: true },
      capabilities: {
        touchEditing: true,
        groupTransformBounds: true,
        scene: true,
        designControl: true,
      },
      saved: { hasFile: false },
    },
    scene: {
      status: 'ready',
      bed: { widthMm: 300, heightMm: 200 },
      extent: bounds,
      toleranceMm: 0.01,
      objects: [
        {
          id: 'a1',
          kind: 'shape',
          unitId: 'a1',
          operationId: 'op1',
          editable: true,
          bounds,
          paths: [
            {
              color: '#e53935',
              fill: false,
              output: true,
              polylines: [{ closed: true, points: '1000,1000 4000,0 0,3000 -4000,0' }],
            },
          ],
        },
      ],
      images: [],
    },
    machine: {
      permissions: { canControl: true },
      mode: 'laser',
      connection: 'connected',
      controllerState: 'Idle',
      position: { space: 'work', xMm: 0, yMm: 0 },
      jog: { xySupported: true, zSupported: false, maxFeedMmPerMin: 6000, holdSupported: true },
      frame: { required: true, complete: false },
      job: { active: false, state: 'idle' },
      homing: 'unknown',
      camera: { available: false },
      motion: { kind: 'idle' },
      availability: {
        jog: { available: true },
        frame: { available: true },
        review: { available: true },
        start: { available: false, reason: 'Review first.' },
        abort: { available: true },
        connect: { available: false, reason: 'The machine is already connected.' },
        disconnect: { available: true },
        home: { available: true },
        origin: { available: true },
        pause: { available: false },
        resume: { available: false },
        hold: { available: true },
      },
    },
    ...overrides,
  };
}

const KIND = {
  jog_machine: 'jog',
  frame_job: 'frame',
  abort_job: 'abort',
  jog_hold_start: 'hold',
  jog_hold_stop: 'hold',
  home_machine: 'home',
  set_work_origin: 'origin',
  pause_job: 'pause',
  resume_job: 'resume',
};
/** One synthetic PC: reads return the fixture; writes bump the revision; machine actions settle. */
export function respond(state, name, args) {
  const revision = `r${state.revision}`;
  if (name === 'get_workspace') return { revision, ...state.workspace };
  if (name === 'get_workspace_scene') return { revision, ...state.scene };
  if (name === 'get_machine_status') return { revision, ...state.machine };
  if (name === 'list_fonts')
    return {
      revision,
      fonts: [{ id: 'Inter', name: 'Inter', geometry: 'outline', style: 'sans' }],
      total: 1,
      truncated: false,
    };
  if (name === 'list_material_recipes')
    return { revision, recipes: [], total: 0, truncated: false };
  if (name === 'wait_for_change')
    return new Promise((resolve) =>
      setTimeout(
        () => resolve({ revision, machineSeq: 0, changed: false, reason: 'timeout' }),
        400,
      ),
    );
  if (name === 'get_control_operation')
    return {
      revision,
      operation: {
        operationId: args.operationId,
        revision,
        kind: 'jog',
        state: 'completed',
        committed: true,
      },
    };
  if (Object.hasOwn(KIND, name) || name.endsWith('_job') || name.endsWith('_machine'))
    return {
      revision,
      operation: {
        operationId: args.requestId,
        revision,
        kind: KIND[name] ?? 'job',
        state: name === 'jog_hold_start' ? 'running' : 'completed',
        committed: true,
      },
    };
  if (name === 'set_selection') state.workspace.selection = args.artworkIds;
  else state.revision += 1;
  return {
    revision: `r${state.revision}`,
    changedArtworkIds: args.artworkIds ?? [],
    selection: state.workspace.selection,
    history: { canUndo: true, canRedo: false },
  };
}

/** Serves the built phone app under its real CSP and fakes the relay API and live socket. */
export async function phonePage(browser, state, { width = 390, paired = true } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 800 },
    serviceWorkers: 'block',
    hasTouch: true,
  });
  const page = await context.newPage();
  let approved = paired;
  let claimed = false;
  // Like the relay: a claimed phone stays pending until the PC approves it.
  state.approve = () => {
    approved = true;
  };
  page.on('pageerror', (error) => state.errors?.push(String(error)));
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/app/' || url.pathname.startsWith('/app/')) {
      const file = url.pathname === '/app/' ? 'index.html' : url.pathname.slice(5);
      const body = await readFile(new URL(`../public/app/${file}`, import.meta.url)).catch(
        () => null,
      );
      if (body === null) return route.fulfill({ status: 404 });
      const type = file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : file.endsWith('.html')
            ? 'text/html'
            : 'application/octet-stream';
      return route.fulfill({
        status: 200,
        body,
        headers: { 'Content-Type': type, 'Content-Security-Policy': APP_CSP },
      });
    }
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.pathname === '/api/session')
      return json(
        approved
          ? {
              status: 'approved',
              online: true,
              deviceLabel: 'Workshop PC',
              client: { id: 'c1', label: 'Test phone', scopes: state.scopes },
              csrf: 'csrf-token',
            }
          : claimed
            ? { status: 'pending', expiresInMs: 300000 }
            : { status: 'unavailable' },
      );
    if (url.pathname === '/api/pair/claim') {
      state.claim = JSON.parse(route.request().postData() ?? '{}');
      claimed = true;
      return json({ status: 'pending', expiresInMs: 300000 }, 202);
    }
    if (url.pathname === '/api/push/key') return json({ error: 'not_found' }, 404);
    if (url.pathname === '/api/client/command') {
      const { name, args } = JSON.parse(route.request().postData() ?? '{}');
      state.commands.push({ name, args, csrf: route.request().headers()['x-kerfdesk-csrf'] });
      return json({ result: await respond(state, name, args) });
    }
    return json({ error: 'not_found' }, 404);
  });
  await page.routeWebSocket(
    `wss://kerfdesk-phone-control.cisgz3a.workers.dev/api/client/socket`,
    (ws) => {
      state.ws = ws;
      ws.send(
        JSON.stringify({
          type: 'hello',
          online: true,
          revision: `r${state.revision}`,
          machineSeq: 0,
        }),
      );
      ws.onMessage((message) => state.socket.push(JSON.parse(String(message))));
    },
  );
  await page.goto(`${ORIGIN}/app/`);
  return { page, context };
}

export const writes = (state) => state.commands.filter((item) => isUuid(item.args?.requestId));

export async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

/** The generated single-file MCP App, as the server serves it. */
export async function mcpAppHtml() {
  const source = await readFile(
    new URL('../../../electron/mcp/workspace-app-ui.ts', import.meta.url),
    'utf8',
  );
  const literal = /KERFDESK_WORKSPACE_APP_HTML: string = (".*");\s*$/s.exec(source)?.[1];
  if (literal === undefined) throw new Error('Generated MCP App not found.');
  return JSON.parse(literal);
}
