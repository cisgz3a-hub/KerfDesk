import { renderMachine, validOperation, validReview, validStatus } from './control-machine-view.js';
import { $, number, safeText } from './control-model.js';

const q = (id) => $('#machine-' + id);
const terminal = new Set(['completed', 'cancelled', 'failed']);
const actions = {
  jog_machine: 'jog',
  frame_job: 'frame',
  review_machine_job: 'review',
  start_job: 'start',
  abort_job: 'abort',
};
const attempts = new Map();
let environment,
  session = null,
  status = null,
  operation = null;
let visible = false,
  loading = false,
  timer = null,
  generation = 0,
  sequence = 0;

export function bindMachine(options) {
  environment = options;
  q('check').addEventListener('click', () => {
    void check();
  });
  for (const [button, name] of [
    ['frame', 'frame_job'],
    ['review', 'review_machine_job'],
    ['abort', 'abort_job'],
  ])
    q(button).addEventListener('click', () => {
      void submit(name);
    });
  q('start').addEventListener('click', () => {
    void submit('start_job', { reviewId: operation?.review?.reviewId });
  });
  q('jog-form').addEventListener('submit', (event) => event.preventDefault());
  for (const button of document.querySelectorAll('[data-jog-axis]'))
    button.addEventListener('click', () => {
      void jog(button);
    });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (!document.hidden && visible) void check();
  });
  render();
  return {
    sessionChanged(value) {
      if (session?.client.scopes.includes('control') && !value?.client.scopes.includes('control'))
        reset();
      session = value;
      if (!value?.online) clearTimeout(timer);
      render();
    },
    setVisible(value) {
      visible = value;
      document.body.classList.toggle('machine-view', value);
      clearTimeout(timer);
      if (value && session?.online) void check();
    },
    reset,
  };
}

function reset() {
  generation++;
  clearTimeout(timer);
  status = operation = null;
  attempts.clear();
  message('');
  render();
}
function message(value) {
  q('message').textContent = safeText(value);
}
function canControl() {
  return (
    !!session?.online &&
    session.client.scopes.includes('control') &&
    status?.permissions?.canControl === true
  );
}
function inFlight(abort) {
  return [...attempts.values()].some((item) => item.abort === abort && item.admissionPending);
}
function uncertain() {
  return [...attempts.values()].some((item) => item.uncertain);
}
function unfinished(item) {
  return (
    item.receipt && !terminal.has(item.receipt.state) && item.receipt.state !== 'awaiting_review'
  );
}
function writable() {
  return (
    canControl() &&
    !inFlight(false) &&
    !inFlight(true) &&
    !uncertain() &&
    ![...attempts.values()].some(unfinished)
  );
}
function available(name) {
  return status?.availability?.[actions[name]]?.available === true;
}
function reviewReady() {
  return (
    validReview(operation?.review) &&
    operation.state === 'awaiting_review' &&
    operation.review.revision === status?.revision
  );
}
function render() {
  renderMachine({
    session,
    status,
    operation,
    pending: uncertain(),
    loading,
    submitting: inFlight(false),
    stopping: inFlight(true),
    canControl: canControl(),
    writable: writable(),
    reviewReady: reviewReady(),
  });
}

async function check() {
  if (loading || !session?.online) return;
  const before = generation,
    actionSequence = sequence;
  loading = true;
  render();
  try {
    await readStatus(before, actionSequence);
  } catch (error) {
    if (before !== generation || actionSequence !== sequence) return;
    status = null;
    message(error.message || 'Machine status unavailable. Check the PC.');
  } finally {
    loading = false;
    render();
    schedule();
  }
}
async function readStatus(before, actionSequence) {
  const original = session?.client.id;
  const current = await environment.verifySession();
  if (before !== generation || current?.client.id !== original) return;
  const value = await environment.command('get_machine_status');
  if (before !== generation || actionSequence !== sequence) return;
  if (!validStatus(value))
    throw new Error('Machine status is incomplete. Update the PC app and check again.');
  status = value;
  if (validOperation(value.operation)) {
    operation = value.operation;
    confirm(value.operation);
  }
  try {
    await readReceipts(before, actionSequence);
  } catch (error) {
    if (before === generation) message(error.message);
  }
  receiptMessage();
}
function receiptMessage() {
  if (uncertain()) message('Result not confirmed. Check status; no action will be sent again.');
  else if (operation?.message) message(operation.message);
}
async function readReceipts(before, actionSequence) {
  const unresolved = [...attempts.values()].filter((item) => needsReceipt(item));
  for (const item of unresolved) {
    const value = await environment.command('get_control_operation', {
      operationId: item.requestId,
    });
    if (before !== generation || actionSequence !== sequence) return;
    if (!validOperation(value?.operation) || value.operation.operationId !== item.requestId)
      throw new Error('The PC could not confirm the action. Check status.');
    confirm(value.operation);
    if (!validOperation(status?.operation) && item.sequence === sequence)
      operation = value.operation;
  }
}
function needsReceipt(item) {
  if (item.uncertain) return true;
  return unfinished(item) && item.requestId !== status?.operation?.operationId;
}
function confirm(value) {
  const item = attempts.get(value.operationId);
  if (!item) return;
  item.uncertain = value.state === 'unknown';
  item.receipt = value;
  if (!item.admissionPending && terminal.has(value.state)) attempts.delete(item.requestId);
}
function schedule() {
  clearTimeout(timer);
  if (visible && session?.online && !document.hidden)
    timer = setTimeout(
      () => {
        void check();
      },
      status ? 2000 : 5000,
    );
}
async function verifyControl(before) {
  const original = session?.client.id;
  const current = await environment.verifySession();
  if (current?.client.id !== original)
    message('The connection changed. Check status before controlling the new connection.');
  if (
    before !== generation ||
    current?.client.id !== original ||
    !current?.online ||
    !current.client.scopes.includes('control')
  )
    throw new Error('Machine control is no longer approved. Check access on the PC.');
}
async function jog(button) {
  if (!writable()) return;
  try {
    const form = q('jog-form');
    const args = {
      axis: button.dataset.jogAxis,
      direction: Number(button.dataset.jogDirection),
      distanceMm: number(form, 'distanceMm', 0.01, 100),
    };
    if (form.elements.feedMmPerMin.value.trim())
      args.feedMmPerMin = number(form, 'feedMmPerMin', 1, 100000);
    await submit('jog_machine', args);
  } catch (error) {
    message(error.message);
  }
}
function admitted(name, abort) {
  if (!available(name)) return false;
  if (abort) return canControl() && !inFlight(true);
  return writable() && (name !== 'start_job' || reviewReady());
}
async function submit(name, args = {}) {
  const abort = name === 'abort_job';
  if (!admitted(name, abort)) return;
  const before = generation,
    requestId = crypto.randomUUID();
  const item = { requestId, sequence: ++sequence, abort, admissionPending: true, uncertain: false };
  attempts.set(requestId, item);
  const request = { requestId, ...(abort ? {} : { expectedRevision: status.revision }), ...args };
  message(abort ? 'Sending Abort to the PC…' : 'Sending request to the PC…');
  render();
  try {
    await verifyControl(before);
    const value = await environment.command(name, request);
    if (before !== generation) return;
    acceptResult(value, item);
  } catch (error) {
    if (before === generation) failure(error, item);
  } finally {
    if (before === generation) {
      item.admissionPending = false;
      if (!item.uncertain && !unfinished(item)) attempts.delete(item.requestId);
      render();
      void check();
    }
  }
}
function acceptResult(value, item) {
  if (!validOperation(value?.operation) || value.operation.operationId !== item.requestId)
    throw Object.assign(new Error('The result was not confirmed. Check status.'), {
      ambiguous: true,
    });
  confirm(value.operation);
  if (item.sequence === sequence) {
    operation = value.operation;
    message('Request accepted. Checking the machine…');
  }
}
function failure(error, item) {
  if (error.ambiguous) item.uncertain = true;
  else attempts.delete(item.requestId);
  message(
    error.ambiguous
      ? 'Result not confirmed. Check status; no action will be sent again.'
      : error.message,
  );
}
