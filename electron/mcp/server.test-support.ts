// Tool examples, a succeeding backend and the real SDK client shared by the MCP server suites.
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { type KerfDeskMcpBackend } from './backend.js';
import { type KerfDeskMcpCommand, MCP_CONTROL_COMMANDS } from './input-schemas.js';
import { createKerfDeskMcpServer } from './server.js';

export const writeAdmission = {
  expectedRevision: 'revision-1',
  requestId: '12345678-1234-4234-8234-123456789abc',
};

export const toolExamples: Record<KerfDeskMcpCommand, Record<string, unknown>> = {
  get_workspace: {},
  get_board: {},
  set_board_photo: {
    ...writeAdmission,
    mimeType: 'image/png',
    dataBase64: 'iVBORw0KGgo=',
  },
  place_on_board: {
    ...writeAdmission,
    artworkIds: ['art-1'],
    action: 'center',
  },
  get_machine: {},
  get_app_status: {},
  list_material_recipes: {},
  review_job: {},
  get_workspace_preview: {},
  list_fonts: {},
  get_text: { artworkId: 'art-1' },
  set_selection: { ...writeAdmission, artworkIds: ['art-1'] },
  add_text: { ...writeAdmission, xMm: 10, yMm: 20, widthMm: 30, text: 'Hello', fontSizeMm: 5 },
  add_rectangle: { ...writeAdmission, xMm: 10, yMm: 20, widthMm: 30, heightMm: 40 },
  add_ellipse: { ...writeAdmission, xMm: 10, yMm: 20, widthMm: 30, heightMm: 40 },
  add_polyline: {
    ...writeAdmission,
    pointsMm: [
      { xMm: 10, yMm: 20 },
      { xMm: 30, yMm: 40 },
    ],
    closed: false,
  },
  transform_artwork: {
    ...writeAdmission,
    artworkIds: ['art-1'],
    transform: { type: 'move', dxMm: -5, dyMm: 3 },
  },
  update_operation: { ...writeAdmission, operationId: 'op-1', patch: { powerPercent: 30 } },
  update_text: { ...writeAdmission, artworkId: 'art-1', patch: { text: 'Updated' } },
  arrange_artwork: { ...writeAdmission, artworkIds: ['art-1'], action: 'mirror_horizontal' },
  undo: { ...writeAdmission },
  redo: { ...writeAdmission },
  get_workspace_scene: {},
  wait_for_change: { sinceRevision: 'revision-1', timeoutMs: 0 },
  create_operation: { ...writeAdmission, color: '#ff0000', mode: 'fill', name: 'Fill' },
  assign_artwork_to_operation: { ...writeAdmission, artworkIds: ['art-1'], operationId: 'op-1' },
  reorder_operation: { ...writeAdmission, operationId: 'op-1', direction: 'up' },
  delete_operation: { ...writeAdmission, operationId: 'op-1' },
  apply_material_recipe: { ...writeAdmission, operationId: 'op-1', recipeId: 'recipe-1' },
  add_svg: { ...writeAdmission, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', xMm: 1 },
  import_file: {
    ...writeAdmission,
    fileName: 'logo.svg',
    mimeType: 'image/svg+xml',
    dataBase64: 'PHN2Zy8+',
  },
  save_project: { ...writeAdmission },
  apply_edits: {
    ...writeAdmission,
    edits: [
      { command: 'add_rectangle', args: { xMm: 1, yMm: 2, widthMm: 3, heightMm: 4 } },
      { command: 'arrange_artwork', args: { artworkIds: ['$0', 'art-1'], action: 'align_left' } },
    ],
  },
  get_machine_status: {},
  get_control_operation: { operationId: writeAdmission.requestId },
  jog_machine: { ...writeAdmission, axis: 'x', direction: 1, distanceMm: 1 },
  frame_job: { ...writeAdmission },
  review_machine_job: { ...writeAdmission },
  start_job: { ...writeAdmission, reviewId: writeAdmission.requestId },
  abort_job: { requestId: writeAdmission.requestId },
  connect_machine: { ...writeAdmission },
  disconnect_machine: { ...writeAdmission },
  home_machine: { ...writeAdmission },
  set_work_origin: { ...writeAdmission, axes: 'xy' },
  capture_board_point: { ...writeAdmission },
  finish_board: { ...writeAdmission },
  pause_job: { requestId: writeAdmission.requestId },
  resume_job: { requestId: writeAdmission.requestId },
  // Phone-only held jogs are never registered as MCP tools (ADR-585).
  jog_hold_start: { ...writeAdmission, axis: 'x', direction: 1 },
  jog_hold_stop: { requestId: writeAdmission.requestId, operationId: writeAdmission.requestId },
  get_camera_snapshot: {},
};
export const PHONE_ONLY = new Set(['jog_hold_start', 'jog_hold_stop']);
export const listedTools = Object.keys(toolExamples).filter((name) => !PHONE_ONLY.has(name));

export const bounds = { xMm: 10, yMm: 20, widthMm: 30, heightMm: 40 };
export const machineOperation = {
  revision: 'revision-1',
  operation: {
    operationId: writeAdmission.requestId,
    revision: 'revision-1',
    kind: 'job',
    state: 'accepted',
    committed: false,
  },
};
export const readyAction = { available: true };
export const readResults: Partial<Record<KerfDeskMcpCommand, Record<string, unknown>>> = {
  get_workspace: {
    revision: 'revision-1',
    mode: 'laser',
    name: 'Untitled',
    dirty: true,
    selection: ['art-1'],
    artwork: [{ id: 'art-1', type: 'rectangle', name: 'Rectangle', bounds, operationId: 'op-1' }],
    operations: [
      { id: 'op-1', type: 'line', enabled: true, powerPercent: 30, speedMmPerMin: 1500, passes: 1 },
    ],
    totalArtwork: 1,
    totalOperations: 1,
    truncated: false,
  },
  get_board: {
    revision: 'revision-1',
    panelOpen: false,
    committed: false,
    board: null,
  },
  get_machine: {
    revision: 'revision-1',
    machine: {
      id: 'machine-1',
      name: 'My laser',
      controller: 'grbl',
      mode: 'laser',
      bedWidthMm: 300,
      bedHeightMm: 200,
      units: 'mm',
    },
  },
  get_app_status: {
    revision: 'revision-1',
    app: { name: 'KerfDesk', version: '1.0.4', platform: 'desktop' },
    edition: { mode: 'free' },
    updates: { available: false },
  },
  list_material_recipes: {
    revision: 'revision-1',
    recipes: [
      {
        id: 'recipe-1',
        name: 'My measured recipe',
        powerPercent: 25,
        speedMmPerMin: 1200,
        passes: 1,
        notes: 'User saved values',
      },
    ],
    total: 1,
    truncated: false,
  },
  review_job: {
    revision: 'revision-1',
    status: 'ready',
    mode: 'laser',
    summary: { artworkCount: 1, operationCount: 1, estimatedSeconds: 12, bounds },
    warnings: [{ code: 'user-check', message: 'Review the material setup.', severity: 'warning' }],
    frame: { required: true, complete: false },
  },
  get_workspace_preview: { revision: 'revision-1', status: 'disabled' },
  list_fonts: {
    revision: 'revision-1',
    fonts: [{ id: 'Inter', name: 'Inter', geometry: 'outline', style: 'sans' }],
    total: 1,
    truncated: false,
  },
  get_text: {
    revision: 'revision-1',
    artworkId: 'art-1',
    text: 'Hello',
    fontId: 'Inter',
    fontSizeMm: 5,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
  },
  get_machine_status: {
    revision: 'revision-1',
    permissions: { canControl: true },
    mode: 'laser',
    connection: 'connected',
    controllerState: 'Idle',
    position: { space: 'work', xMm: 0, yMm: 0 },
    jog: { xySupported: true, zSupported: false, maxFeedMmPerMin: 3000 },
    frame: { required: true, complete: false },
    job: { active: false, state: 'idle' },
    motion: { kind: 'idle' },
    availability: {
      jog: readyAction,
      frame: readyAction,
      review: readyAction,
      start: { available: false },
      abort: readyAction,
    },
  },
  get_control_operation: machineOperation,
  get_workspace_scene: { revision: 'revision-1', status: 'disabled' },
  wait_for_change: { revision: 'revision-1', machineSeq: 3, changed: false, reason: 'timeout' },
  get_camera_snapshot: { revision: 'revision-1', status: 'disabled' },
};

export function successfulBackend(): KerfDeskMcpBackend {
  return {
    request: async (command) => {
      const special =
        command === 'set_board_photo'
          ? { revision: 'revision-2', status: 'delivered' }
          : command === 'place_on_board'
            ? {
                revision: 'revision-2',
                status: 'placed',
                action: 'center',
                artworkCount: 1,
              }
            : null;
      return structuredClone(
        special ??
          readResults[command as KerfDeskMcpCommand] ??
          (MCP_CONTROL_COMMANDS.has(command as KerfDeskMcpCommand)
            ? machineOperation
            : {
                revision: 'revision-2',
                changedArtworkIds: ['art-1'],
                selection: ['art-1'],
              }),
      );
    },
  };
}

const closers: Array<() => Promise<void>> = [];
/** Closes every client and server a test opened; run it after each test. */
export async function closeClients(): Promise<void> {
  for (const close of closers.splice(0).reverse()) await close();
}

/** Real SDK handshake and dispatch through the recommended dual-era serving entry. */
export async function connectedClient(
  backend: KerfDeskMcpBackend,
  modern = false,
  wireCalls?: Map<string, string | number>,
): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const send = clientTransport.send.bind(clientTransport);
  clientTransport.send = async (message, options) => {
    if (
      wireCalls &&
      'method' in message &&
      message.method === 'tools/call' &&
      'id' in message &&
      (typeof message.id === 'string' || typeof message.id === 'number') &&
      typeof message.params?.name === 'string'
    )
      wireCalls.set(message.params.name, message.id);
    await send(message, options);
  };
  const entry = serveStdio(() => createKerfDeskMcpServer(backend), { transport: serverTransport });
  const client = new Client(
    { name: 'kerfdesk-protocol-test', version: '1.0.0' },
    modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  );
  closers.push(async () => {
    await client.close();
    await entry.close();
  });
  await client.connect(clientTransport);
  return client;
}

export function responseText(result: CallToolResult): string {
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}
