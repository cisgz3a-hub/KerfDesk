import { fixtureState } from './phone-workspace-support.mjs';

const commands = new Set([
  'jog_machine',
  'frame_job',
  'review_machine_job',
  'start_job',
  'abort_job',
]);
export const REVIEW_ID = 'd0d3447c-78f0-4477-a2ee-d049388f1c33';
export const NEXT_REVIEW_ID = 'a43f2141-f886-40e6-b052-197836ad51ec';

/** Browser-only protocol fixture. No controller, native app or provider receives commands. */
export function machineFixture(scopes = ['read', 'control']) {
  const state = fixtureState();
  Object.assign(state, {
    scopes,
    motionWrites: 0,
    controlReceipts: new Map(),
    held: new Map(),
    hold: new Set(),
    drop: new Set(),
    unknownReceipts: new Set(),
    framed: false,
    running: false,
    motion: 'idle',
    controller: 'Idle',
    zSupported: false,
    latestOperation: null,
    nextReview: false,
    machineMalformed: false,
    legacyMachine: false,
  });
  state.machineCommand = async (name, args) => {
    if (name === 'get_machine_status') return { result: machineStatus(state) };
    if (name === 'get_control_operation')
      return { result: { revision: revision(state), operation: receipt(state, args.operationId) } };
    if (!commands.has(name)) return null;
    if (!state.scopes.includes('control')) return { status: 403, error: { code: 'forbidden' } };
    if (name !== 'abort_job' && args.expectedRevision !== revision(state))
      return { status: 409, error: { code: 'stale_revision' } };
    if (state.controlReceipts.has(args.requestId))
      return { result: { revision: revision(state), operation: receipt(state, args.requestId) } };
    state.motionWrites++;
    const operation = action(state, name, args);
    state.controlReceipts.set(args.requestId, operation);
    state.latestOperation = operation;
    state.afterAction?.(name, args, operation);
    const result = { revision: revision(state), operation: structuredClone(operation) };
    if (state.hold.has(name))
      return new Promise((resolve) => state.held.set(name, { resolve, result }));
    if (state.drop.delete(name)) return { drop: true };
    return { result };
  };
  return state;
}

function revision(state) {
  return `fixture-${state.revision}`;
}

export function machineStatus(state) {
  if (state.machineMalformed)
    return { revision: revision(state), permissions: { canControl: true } };
  const canControl = state.scopes.includes('control');
  const idle = !state.running && state.motion === 'idle';
  const controllerConnected = (state.controllerConnection ?? 'connected') === 'connected';
  const value = {
    revision: revision(state),
    permissions: { canControl },
    mode: 'laser',
    connection: state.controllerConnection ?? 'connected',
    controllerState: state.controller,
    position: {
      space: 'work',
      wcs: 'G54',
      xMm: 12.25,
      yMm: 18.5,
      ...(state.zSupported ? { zMm: -2 } : {}),
    },
    jog: { xySupported: true, zSupported: state.zSupported, maxFeedMmPerMin: 3000 },
    frame: { required: true, complete: state.framed },
    job: {
      active: state.running,
      state: state.running ? 'running' : 'idle',
      ...(state.running ? { progressPercent: 42 } : {}),
    },
    motion: { kind: state.motion },
    availability: Object.fromEntries(
      ['jog', 'frame', 'review', 'start', 'abort'].map((name) => [
        name,
        {
          available: canControl && controllerConnected && (name === 'abort' || idle),
          ...(idle ? {} : { reason: 'The machine is busy. Check current status.' }),
        },
      ]),
    ),
    ...(state.latestOperation ? { operation: structuredClone(state.latestOperation) } : {}),
  };
  if (state.legacyMachine) {
    delete value.permissions;
    delete value.availability;
  }
  if (state.noPositionSpace) delete value.position.space;
  if (state.noAvailability) delete value.availability;
  return value;
}

function receipt(state, id) {
  if (state.unknownReceipts.has(id) || !state.controlReceipts.has(id))
    return {
      operationId: id,
      kind: 'job',
      state: 'unknown',
      revision: revision(state),
      committed: null,
      message: 'The PC could not confirm this action.',
    };
  return structuredClone(state.controlReceipts.get(id));
}

function action(state, name, args) {
  const value = {
    operationId: args.requestId,
    kind:
      name === 'jog_machine'
        ? 'jog'
        : name === 'frame_job'
          ? 'frame'
          : name === 'abort_job'
            ? 'abort'
            : 'job',
    state: 'completed',
    revision: revision(state),
    committed: true,
  };
  if (name === 'frame_job') {
    value.state = 'preparing';
    value.committed = false;
    state.motion = 'frame';
  }
  if (name === 'review_machine_job') {
    value.state = 'awaiting_review';
    value.committed = false;
    value.review = review(state, REVIEW_ID);
  }
  if (name === 'start_job') {
    if (state.nextReview) {
      state.nextReview = false;
      value.state = 'awaiting_review';
      value.committed = false;
      value.review = review(state, NEXT_REVIEW_ID);
    } else {
      value.state = 'running';
      state.running = true;
      state.controller = 'Run';
    }
  }
  if (name === 'abort_job') {
    state.motion = 'idle';
    state.running = false;
    state.controller = 'Idle';
  }
  return value;
}

export function review(state, id = REVIEW_ID) {
  return {
    reviewId: id,
    revision: revision(state),
    mode: 'laser',
    stats: [{ label: 'Estimated time', value: '1m 30s', detail: 'Current prepared output' }],
    warnings: [{ code: 'fixture', message: '<img src=x onerror=alert(1)> literal warning' }],
    operations: [{ operationId: 'laser-1', summaries: ['Vector mark · 25% · 1000 mm/min'] }],
    acknowledgement: {
      kind: 'laser-unverified',
      prompt: 'The controller laser mode is unverified. Start with the reviewed setting?',
    },
    frame: { required: true, complete: true },
  };
}

export function completeFrame(state) {
  state.framed = true;
  state.motion = 'idle';
  state.controller = 'Idle';
  state.latestOperation.state = 'completed';
  state.latestOperation.committed = true;
  state.controlReceipts.set(
    state.latestOperation.operationId,
    structuredClone(state.latestOperation),
  );
}

export function release(state, name) {
  const held = state.held.get(name);
  if (!held) throw new Error('No held request: ' + name);
  state.held.delete(name);
  held.resolve(state.drop.delete(name) ? { drop: true } : { result: held.result });
}

export async function enterMachine(surface) {
  await surface.getByRole('button', { name: 'Machine', exact: true }).click();
  await surface.locator('#machine-position').filter({ hasText: 'Work position' }).waitFor();
  await surface.waitForFunction(
    () => globalThis.document.getElementById('machine-check').disabled === false,
  );
}

export async function checkMachine(surface) {
  await surface.locator('#machine-check').click();
  await surface.waitForFunction(
    () => globalThis.document.getElementById('machine-check').disabled === false,
  );
}

export async function machineIdle(surface) {
  await surface.waitForFunction(
    () =>
      globalThis.document.getElementById('machine-panel').getAttribute('aria-busy') === 'false' &&
      globalThis.document.getElementById('machine-check').disabled === false,
  );
}

export const motionCommands = (state) => state.commands.filter((entry) => commands.has(entry.name));

export async function noOverflow(surface) {
  return surface.evaluate(
    () =>
      globalThis.document.documentElement.scrollWidth <=
      globalThis.document.documentElement.clientWidth,
  );
}
