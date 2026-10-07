import { $, safeText } from './control-model.js';

/** One read-only refresh at a time. Hidden pages stop polling and refresh on return. */
export function serialCommand(getLive, command) {
  return (name, args) => getLive().withRead(() => command(name, args));
}
export function bindWorkspaceLive(options) {
  let live;
  const details = new DetailsController({ ...options, active: () => live.active() });
  live = bindLiveSync({
    ready: options.ready,
    blocked: options.blocked,
    refresh: async () => {
      const generation = options.generation();
      const current = await options.api('/api/session', undefined, generation);
      options.setSession(current.status === 'approved' ? current : null);
      if (!options.session()) return false;
      if (!current.online) throw new Error('PC offline');
      const value = await options.command('get_workspace', {}, generation);
      if (options.blocked() || !live.active()) return false;
      options.apply(value);
      await options.previews.refresh(generation, false, true);
      await details.refresh(generation, true);
      return !options.blocked() && live.active();
    },
    changed: (state) => {
      document.getElementById('live-status').textContent = liveMessage(state, options.session());
    },
  });
  live.details = details;
  return live;
}

/** These facts are display-only; machine Review and Start keep their own exact authority. */
class DetailsController {
  epoch = 0;
  readAt = -Infinity;
  constructor(options) {
    this.options = options;
    const resume = () => {
      if (this.visible()) this.shown();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('pagehide', () =>
      this.clear('Updates paused. Return to refresh details.'),
    );
  }
  visible() {
    return (
      document.body.dataset.panel === 'details' &&
      $('#details-list').closest('details').open &&
      !document.hidden
    );
  }
  clear(message = '') {
    this.epoch++;
    $('#details-list').replaceChildren();
    if (message) detail('Details status', message);
  }
  reset() {
    this.readAt = -Infinity;
    this.clear();
  }
  sessionChanged(value) {
    if (!value?.online) this.clear(value ? 'PC offline. Reconnect to refresh details.' : '');
  }
  shown() {
    this.readAt = -Infinity;
    if (!this.visible()) {
      this.clear();
      return;
    }
    this.clear(
      this.options.active()
        ? 'Refreshing from the PC…'
        : 'Automatic updates paused. Open Settings or use Refresh to check again.',
    );
  }
  workspaceChanged(value, previous) {
    if (
      value.revision !== previous?.revision ||
      value.permissions?.artworkSharingEnabled !== previous?.permissions?.artworkSharingEnabled
    )
      this.clear('PC workspace changed. Open Settings or wait for its next update.');
  }
  canDeliver(context, background) {
    const workspace = this.options.workspace();
    return (
      this.visible() &&
      this.epoch === context.epoch &&
      this.options.session()?.online === true &&
      this.options.session().client.id === context.clientId &&
      workspace?.revision === context.revision &&
      workspace.permissions?.artworkSharingEnabled === context.sharing &&
      (!background || (this.options.active() && !this.options.blocked()))
    );
  }
  canRead(background) {
    return (
      this.visible() &&
      !!this.options.session()?.online &&
      !!this.options.workspace() &&
      (!background || performance.now() - this.readAt >= 10_000)
    );
  }
  async refresh(generation, background = false) {
    if (!this.canRead(background)) return;
    this.clear('Refreshing from the PC…');
    const context = {
      epoch: this.epoch,
      clientId: this.options.session().client.id,
      revision: this.options.workspace().revision,
      sharing: this.options.workspace().permissions?.artworkSharingEnabled,
    };
    if (!this.canDeliver(context, background)) return;
    this.readAt = performance.now();
    try {
      await this.read(context, generation, background);
    } catch (error) {
      if (this.epoch === context.epoch)
        this.clear('Details unavailable. Refresh or wait for the next live update.');
      throw error;
    }
  }
  async read(context, generation, background) {
    const values = [];
    for (const name of ['get_app_status', 'get_machine', 'review_job', 'list_material_recipes']) {
      values.push(await this.options.command(name, {}, generation));
      if (!this.canDeliver(context, background)) return;
    }
    const current = await this.options.api('/api/session', undefined, generation);
    this.options.setSession(current.status === 'approved' ? current : null);
    if (!this.canDeliver(context, background)) return;
    // Sharing can change without retiring document authority while a read is in flight.
    const latest = await this.options.command('get_workspace', {}, generation);
    if (!this.canDeliver(context, background)) return;
    this.options.apply(latest);
    if (!this.canDeliver(context, background)) return;
    if (values.some((value) => value?.revision !== context.revision)) {
      this.clear('The PC changed during this read. Details will refresh on the next update.');
      return;
    }
    renderDetails(values, context.sharing === true, this.options.active());
  }
}

function detail(title, text) {
  const item = document.createElement('div');
  item.className = 'detail';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const content = document.createElement('p');
  content.textContent = safeText(text, 4096);
  item.append(heading, content);
  $('#details-list').append(item);
}

function renderDetails([status, machineResult, review, recipes], sharing, liveUpdates) {
  $('#details-list').replaceChildren();
  detail('Desktop app', `${status.app.name} ${status.app.version} · ${status.edition.mode}`);
  if (status.updates.available)
    detail(
      'Update available on the PC',
      `${status.updates.version ?? 'New version'}${status.updates.highlights?.length ? ': ' + status.updates.highlights.join(' · ') : ''}`,
    );
  const machine = machineResult.machine;
  detail(
    'Machine profile',
    `${machine.name} · ${machine.bedWidthMm} × ${machine.bedHeightMm} mm${machine.controller ? ' · ' + machine.controller : ''}`,
  );
  renderReview(review, sharing);
  detail(
    'Material recipes',
    recipes.recipes.length
      ? recipes.recipes.map((recipe) => safeText(recipe.name, 512)).join(' · ')
      : 'No saved recipes.',
  );
  detail(
    'Details updates',
    liveUpdates
      ? 'Checked with the PC. Live updates check about every 10 seconds while these details are open.'
      : 'Checked with the PC. Automatic updates are paused. Open Settings or use Refresh to check again.',
  );
}

function renderReview(review, sharing) {
  detail(
    'Job review',
    `${review.status} · ${review.frame.complete ? 'Frame completed' : 'Frame required on the PC'}`,
  );
  if (review.summary) {
    const summary = review.summary;
    detail(
      'Workspace totals and prepared duration',
      `Workspace artwork: ${summary.artworkCount} · Workspace operations: ${summary.operationCount}${Number.isFinite(summary.estimatedSeconds) ? ' · Estimated ' + Math.ceil(summary.estimatedSeconds / 60) + ' min' : ''}`,
    );
    if (summary.bounds)
      detail(
        'Prepared output bounds',
        `${summary.bounds.widthMm.toFixed(2)} × ${summary.bounds.heightMm.toFixed(2)} mm · X ${summary.bounds.xMm.toFixed(2)}, Y ${summary.bounds.yMm.toFixed(2)}`,
      );
  }
  for (const warning of review.warnings.slice(0, 200))
    detail('Job review warning', sharing ? warning.message : 'Review this warning on the PC.');
}
function liveMessage(state, session) {
  const labels = {
    paused: 'Updates paused',
    waiting: 'Updates waiting for the pending request',
    connecting: 'Connecting…',
  };
  if (labels[state]) return labels[state];
  if (state === 'live' && session?.online) return 'Live · PC changes appear automatically';
  return session ? 'PC offline · reconnecting…' : 'Not connected';
}
export function bindLiveSync({ ready, blocked, refresh, changed }) {
  return new LiveSync({ ready, blocked, refresh, changed });
}

class LiveSync {
  timer = null;
  running = false;
  enabled = true;
  stopped = true;
  suspended = false;
  failures = 0;
  epoch = 0;
  readTask = null;
  constructor(options) {
    this.options = options;
    document.addEventListener('visibilitychange', () => this.visibility());
    window.addEventListener('pageshow', () => {
      this.suspended = false;
      void this.refresh();
    });
    window.addEventListener('pagehide', () => {
      this.suspended = true;
      this.epoch++;
      clearTimeout(this.timer);
      this.options.changed('paused');
    });
  }
  active() {
    return !this.stopped && this.enabled && !this.suspended && !document.hidden;
  }
  start() {
    this.epoch++;
    this.stopped = false;
    this.options.changed(this.active() ? 'connecting' : 'paused');
    this.schedule();
  }
  stop() {
    this.epoch++;
    this.stopped = true;
    clearTimeout(this.timer);
    this.options.changed('disconnected');
  }
  confirm() {
    if (this.options.ready()) this.options.changed(this.active() ? 'live' : 'paused');
  }
  pause(value) {
    this.enabled = !value;
    this.visibility();
  }
  async withRead(callback) {
    while (this.readTask) await this.readTask.catch(() => {});
    const task = Promise.resolve().then(callback);
    this.readTask = task;
    try {
      return await task;
    } finally {
      if (this.readTask === task) this.readTask = null;
    }
  }
  visibility() {
    clearTimeout(this.timer);
    if (!this.active()) this.options.changed('paused');
    else void this.refresh();
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.active() && this.options.ready())
      this.timer = setTimeout(
        () => {
          void this.refresh();
        },
        this.failures ? 10_000 : 5_000,
      );
  }
  async refresh() {
    clearTimeout(this.timer);
    if (!this.active() || !this.options.ready()) return false;
    if (this.running || this.options.blocked()) {
      this.options.changed('waiting');
      this.schedule();
      return false;
    }
    const before = this.epoch;
    this.running = true;
    try {
      const result = await this.withRead(this.options.refresh);
      if (before !== this.epoch || !this.active()) return false;
      if (result !== false) {
        this.failures = 0;
        this.options.changed('live');
      }
    } catch {
      if (before === this.epoch && this.active()) {
        this.failures++;
        this.options.changed('disconnected');
      }
    } finally {
      this.running = false;
      if (before !== this.epoch) void this.refresh();
      else this.schedule();
    }
  }
}
