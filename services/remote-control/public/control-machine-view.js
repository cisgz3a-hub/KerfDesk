import { $, safeText } from './control-model.js';
const q = (id) => $('#machine-' + id);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const states = new Set([
  'accepted',
  'preparing',
  'awaiting_review',
  'starting',
  'running',
  'completed',
  'cancelled',
  'failed',
  'unknown',
]);
let current;

export function renderMachine(value) {
  current = value;
  const { status, submitting } = current;
  q('state').textContent = stateLabel();
  q('access').textContent = accessLabel();
  renderPosition();
  q('frame-state').textContent = status?.frame?.complete
    ? 'Frame completed. Review the current job before Start.'
    : 'Frame this job before Start.';
  q('frame').textContent = status?.frame?.complete ? 'Frame again' : 'Frame job';
  q('panel').setAttribute('aria-busy', String(submitting));
  renderButtons();
  renderJog();
  renderReview();
}

function renderButtons() {
  const { writable, status, reviewReady } = current;
  readyButton('frame', writable);
  readyButton('review', writable && status?.frame?.complete);
  readyButton('start', writable && status?.frame?.complete && reviewReady);
  renderStop();
}
function renderStop() {
  const { loading, session, canControl, stopping, operation } = current;
  q('check').disabled = loading || !session?.online;
  readyButton('abort', canControl && !stopping);
  q('abort').textContent = ['preparing', 'awaiting_review'].includes(operation?.state)
    ? 'Cancel preparation'
    : 'Abort job';
}
function readyButton(name, allowed) {
  const hint = current.status?.availability?.[name];
  q(name).disabled = !allowed || hint?.available !== true;
  q(name).title = safeText(hint?.reason) || '';
}

function renderJog() {
  const { status, writable } = current;
  const jog = status?.jog ?? {};
  const hint = status?.availability?.jog ?? {};
  q('z').hidden = jog.zSupported !== true;
  for (const button of document.querySelectorAll('[data-jog-axis]')) {
    const supported = button.dataset.jogAxis === 'z' ? jog.zSupported : jog.xySupported;
    button.disabled = !writable || supported !== true || hint.available !== true;
    button.title = safeText(hint.reason);
  }
}

function stateLabel() {
  const { session, status, stopping, pending } = current;
  if (!session?.online) return session ? 'PC offline' : 'Not connected';
  if (!status) return 'Machine status unavailable';
  if (status.connection !== 'connected')
    return status.connection === 'connecting'
      ? 'Connecting to controller…'
      : 'Controller disconnected';
  if (stopping) return 'Abort requested — checking the PC…';
  if (pending) return 'Result not confirmed — check status';
  return activityLabel();
}

function activityLabel() {
  const { operation, status } = current;
  if (operation && operation.state === 'preparing')
    return operation.kind === 'frame' ? 'Preparing Frame…' : 'Preparing current job review…';
  if (operation && operation.state === 'awaiting_review') return 'Current job ready for review';
  if (status.motion.kind === 'frame') return 'Framing…';
  if (status.motion.kind === 'jog') return 'Jogging…';
  if (status.job.active) return jobLabel();
  return admittedLabel();
}
function admittedLabel() {
  const { operation, status } = current;
  if (operation?.state === 'starting') return 'Starting job…';
  if (operation?.state === 'accepted') return 'Request accepted — waiting for the PC';
  return safeText(status.controllerState, 128) || 'Controller state unknown';
}

function jobLabel() {
  const labels = {
    starting: 'Starting job…',
    running: 'Running',
    paused: 'Paused',
    tool_change: 'Waiting for tool change on the PC',
    unknown: 'Job state unknown',
  };
  const job = current.status.job;
  const progress = Number.isFinite(job.progressPercent)
    ? ` · ${job.progressPercent.toFixed(0)}%`
    : '';
  return (labels[job.state] || 'Job active') + progress;
}

function accessLabel() {
  const { session, status } = current;
  if (!session?.client.scopes.includes('control'))
    return 'Viewing machine status. To control it, pair again, request machine control and approve it on the PC.';
  if (status?.permissions?.canControl === undefined)
    return 'The PC app cannot confirm machine control. Update KerfDesk on the PC, then check status.';
  if (status.permissions.canControl && !status.availability)
    return 'The PC app cannot confirm action readiness. Update KerfDesk on the PC, then check status.';
  return status.permissions.canControl
    ? 'Machine control approved on the PC.'
    : 'Machine control is unavailable. Check approved access on the PC.';
}

function renderPosition() {
  const position = current.status?.position;
  if (position?.space !== 'work' || ![position.xMm, position.yMm].every(Number.isFinite)) {
    q('position').textContent = 'Work position unavailable.';
    return;
  }
  const wcs = /^G5[4-9]$/.test(position.wcs) ? ' (' + position.wcs + ')' : '';
  q('position').textContent =
    `Work position${wcs} · X ${position.xMm.toFixed(2)} · Y ${position.yMm.toFixed(2)}${Number.isFinite(position.zMm) ? ' · Z ' + position.zMm.toFixed(2) : ''} mm`;
}

export function validReview(value) {
  return (
    !!value &&
    uuid.test(value.reviewId) &&
    typeof value.revision === 'string' &&
    ['laser', 'cnc'].includes(value.mode) &&
    reviewArrays(value) &&
    ['laser-verified', 'laser-unverified', 'cnc'].includes(value.acknowledgement?.kind) &&
    value.frame?.complete === true
  );
}

function reviewArrays(value) {
  const bounded = (items, max) =>
    Array.isArray(items) &&
    items.length <= max &&
    items.every((item) => item && typeof item === 'object');
  return bounded(value.stats, 16) && bounded(value.warnings, 200) && bounded(value.operations, 200);
}

export function validOperation(value) {
  return (
    !!value &&
    uuid.test(value.operationId) &&
    ['jog', 'frame', 'job', 'abort'].includes(value.kind) &&
    states.has(value.state) &&
    typeof value.revision === 'string' &&
    (typeof value.committed === 'boolean' || value.committed === null)
  );
}

export function validStatus(value) {
  return (
    !!value &&
    typeof value.revision === 'string' &&
    value.revision.length > 0 &&
    value.revision.length <= 200 &&
    ['connected', 'disconnected', 'connecting'].includes(value.connection) &&
    typeof value.job?.active === 'boolean' &&
    ['idle', 'jog', 'frame', 'unknown'].includes(value.motion?.kind) &&
    typeof value.frame?.complete === 'boolean'
  );
}

function renderReview() {
  const ready = current.reviewReady;
  q('review-card').hidden = !ready;
  q('review-stats').replaceChildren();
  q('review-warnings').replaceChildren();
  q('review-operations').replaceChildren();
  q('acknowledgement').textContent = '';
  if (!ready) return;
  const review = current.operation.review;
  for (const item of review.stats)
    row(
      q('review-stats'),
      item.label,
      `${safeText(item.value)}${item.detail ? ' · ' + safeText(item.detail) : ''}`,
    );
  q('warning-count').textContent = `Warnings (${review.warnings.length})`;
  for (const warning of review.warnings) row(q('review-warnings'), 'Warning', warning.message);
  for (const item of review.operations)
    for (const summary of Array.isArray(item.summaries) ? item.summaries.slice(0, 20) : [])
      row(q('review-operations'), 'Operation', summary);
  q('acknowledgement').textContent =
    safeText(review.acknowledgement.prompt) ||
    (review.acknowledgement.kind === 'laser-verified'
      ? 'The current controller laser mode is verified.'
      : 'Confirm this current review before Start.');
}

function row(parent, title, content) {
  const item = document.createElement('div'),
    heading = document.createElement('strong'),
    body = document.createElement('p');
  item.className = 'detail';
  heading.textContent = safeText(title);
  body.textContent = safeText(content);
  item.append(heading, body);
  parent.append(item);
}
