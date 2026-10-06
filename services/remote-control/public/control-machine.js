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
let suspended = false;
let pageReading = false;

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
  q('review-first').addEventListener('click', () => {
    void loadReviewPage(0);
  });
  q('review-next').addEventListener('click', () => {
    void loadReviewPage(operation?.review?.pagination?.nextOffset);
  });
  q('jog-form').addEventListener('submit', (event) => event.preventDefault());
  for (const button of document.querySelectorAll('[data-jog-axis]'))
    button.addEventListener('click', () => {
      void jog(button);
    });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (!document.hidden && (visible || ownedWork())) void check();
  });
  window.addEventListener('pagehide', () => {
    suspended = true;
    clearTimeout(timer);
  });
  window.addEventListener('pageshow', () => {
    suspended = false;
    if ((visible || ownedWork()) && session?.online) void check();
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
      else if (ownedWork()) schedule();
    },
    reset,
    isBusy: () => loading || pageReading || ownedWork(),
  };
}

function reset() {
  generation++;
  pageReading = false;
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
function ownedWork() {
  return [...attempts.values()].some(
    (item) => item.admissionPending || item.uncertain || unfinished(item),
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
    pageReading,
  });
}

async function check() {
  if (loading || !session?.online || suspended || document.hidden) return;
  const before = generation,
    actionSequence = sequence;
  loading = true;
  render();
  try {
    const read = () => {
      if (!currentRead(before, actionSequence)) return;
      return readStatus(before, actionSequence);
    };
    if (environment.withRead) await environment.withRead(read);
    else await read();
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
function currentRead(before, actionSequence) {
  return (
    before === generation &&
    actionSequence === sequence &&
    session?.online &&
    !suspended &&
    !document.hidden
  );
}
async function readStatus(before, actionSequence) {
  const original = session?.client.id;
  const current = await environment.verifySession();
  if (!currentRead(before, actionSequence) || current?.client.id !== original) return;
  const value = await environment.command('get_machine_status');
  if (!currentRead(before, actionSequence)) return;
  if (!validStatus(value))
    throw new Error('Machine status is incomplete. Update the PC app and check again.');
  status = value;
  if (validOperation(value.operation)) {
    adoptOperation(value.operation);
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
    if (!currentRead(before, actionSequence)) return;
    const value = await environment.command('get_control_operation', {
      operationId: item.requestId,
    });
    if (!currentRead(before, actionSequence)) return;
    if (!validOperation(value?.operation) || value.operation.operationId !== item.requestId)
      throw new Error('The PC could not confirm the action. Check status.');
    confirm(value.operation);
    if (!validOperation(status?.operation) && item.sequence === sequence)
      adoptOperation(value.operation);
  }
}
function adoptOperation(value) {
  const previous = operation?.review,
    next = value.review;
  if (
    value.operationId === operation?.operationId &&
    sameReview(next, previous) &&
    typeof next.artworkShared === 'boolean' &&
    previous.pagination?.offset > 0
  )
    value = { ...value, review: previous };
  operation = value;
}
function sameReview(left, right) {
  if (!left || !right) return false;
  return (
    left.reviewId === right.reviewId &&
    left.revision === right.revision &&
    left.artworkShared === right.artworkShared
  );
}
function matchesReviewPage(value, original, offset) {
  const next = value?.operation;
  return (
    !!next &&
    next.operationId === original.operationId &&
    validReview(next.review) &&
    sameReview(next.review, original.review) &&
    sameReview(next.review, operation?.review) &&
    next.review.pagination?.offset === offset
  );
}
async function loadReviewPage(offset) {
  const original = operation;
  if (pageReading || !Number.isSafeInteger(offset) || offset < 0 || !reviewReady()) return;
  const before = generation,
    actionSequence = sequence,
    review = original.review;
  pageReading = true;
  render();
  try {
    const read = async () => {
      if (!currentRead(before, actionSequence)) return;
      const value = await environment.command('get_control_operation', {
        operationId: original.operationId,
        reviewPage: { reviewId: review.reviewId, offset },
      });
      if (!currentRead(before, actionSequence) || operation?.review?.reviewId !== review.reviewId)
        return;
      if (!matchesReviewPage(value, original, offset))
        throw new Error('The job review changed. Check status and review the current job.');
      operation = value.operation;
      message('');
    };
    // A pinned page is read-only. Keep status/permission refresh and Abort independent.
    await read();
  } catch (error) {
    if (currentRead(before, actionSequence)) {
      operation = null;
      message(error.message || 'Review page unavailable. Check status before Start.');
    }
  } finally {
    if (before === generation) pageReading = false;
    render();
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
  if ((visible || ownedWork()) && session?.online && !document.hidden && !suspended)
    timer = setTimeout(
      () => {
        void check();
      },
      Math.max(
        status ? 2000 : 5000,
        2000 * (1 + [...attempts.values()].filter(needsReceipt).length),
      ),
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
  if (name === 'start_job' && pageReading) return false;
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
