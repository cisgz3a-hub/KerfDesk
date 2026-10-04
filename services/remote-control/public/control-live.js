/** One read-only refresh at a time. Hidden pages stop polling and refresh on return. */
export function serialCommand(getLive, command) {
  return (name, args) => getLive().withRead(() => command(name, args));
}
export function bindWorkspaceLive(options) {
  let live;
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
      return !options.blocked() && live.active();
    },
    changed: (state) => {
      document.getElementById('live-status').textContent = liveMessage(state, options.session());
    },
  });
  return live;
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

export function bindPreviewZoom() {
  const surface = document.getElementById('preview-surface');
  const image = document.getElementById('workspace-preview');
  let scale = 1;
  function zoom(next) {
    scale = Math.min(3, Math.max(1, next));
    image.style.width = scale * 100 + '%';
    surface.classList.toggle('preview-zoomed', scale > 1);
    if (scale === 1) {
      surface.scrollLeft = 0;
      surface.scrollTop = 0;
    }
  }
  for (const [id, step] of [
    ['zoom-in', 0.5],
    ['zoom-out', -0.5],
    ['zoom-fit', 0],
  ])
    document.getElementById(id).addEventListener('click', () => zoom(step ? scale + step : 1));
  new MutationObserver(() => {
    for (const button of document.querySelectorAll('.preview-tools button'))
      button.disabled = image.hidden;
    if (image.hidden) zoom(1);
  }).observe(image, { attributes: true, attributeFilter: ['hidden'] });
}
