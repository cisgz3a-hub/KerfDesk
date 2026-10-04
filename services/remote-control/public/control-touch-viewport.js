/** Local navigation only. The decoded, revision-matched PNG remains the coordinate authority. */
export class CanvasViewport {
  scale = 1;
  x = 0;
  y = 0;
  pointers = new Map();
  navigation = null;
  box = null;
  constructor({ surface, image, listen, changed, cancelStroke }) {
    Object.assign(this, { surface, image, changed, cancelStroke });
    for (const [id, step] of [
      ['zoom-in', 0.5],
      ['zoom-out', -0.5],
      ['zoom-fit', 0],
    ]) {
      const button = document.getElementById(id);
      if (button) listen(button, 'click', () => (step ? this.zoom(this.scale + step) : this.fit()));
    }
    this.value = document.getElementById('zoom-value');
    if (!this.value) {
      this.value = document.createElement('output');
      this.value.id = 'zoom-value';
      this.value.setAttribute('aria-label', 'Canvas zoom');
      document.getElementById('zoom-fit')?.insertAdjacentElement('afterend', this.value);
    }
    this.buildPanControls(listen);
    listen(
      surface,
      'wheel',
      (event) => {
        if (!this.box || image.hidden) return;
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          const point = this.local(event);
          this.zoom(this.scale * Math.exp(-event.deltaY * 0.008), point);
        } else {
          this.interrupt();
          this.x -= event.deltaX;
          this.y -= event.deltaY;
          this.render();
        }
      },
      { passive: false },
    );
    this.resize = new ResizeObserver(() => {
      this.sync(this.preview);
      this.changed();
    });
    this.resize.observe(surface);
  }
  sync(preview) {
    for (const id of ['zoom-in', 'zoom-out', 'zoom-fit']) {
      const button = document.getElementById(id);
      if (button) button.disabled = this.image.hidden || !this.image.naturalWidth;
    }
    for (const button of this.panButtons)
      button.disabled = this.image.hidden || !this.image.naturalWidth;
    if (!this.decoded(preview)) return;
    const width = this.surface.clientWidth,
      height = this.surface.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(width / this.image.naturalWidth, height / this.image.naturalHeight);
    const next = {
      width: this.image.naturalWidth * ratio,
      height: this.image.naturalHeight * ratio,
      surfaceWidth: width,
      surfaceHeight: height,
    };
    if (!this.box) {
      this.x = (width - next.width) / 2;
      this.y = (height - next.height) / 2;
    } else if (this.changedLayout(next, preview)) {
      if (this.navigation) this.cancel();
      this.keepSceneCentre(next, preview);
    }
    this.box = next;
    this.preview = preview;
    this.render(false);
  }
  decoded(preview) {
    return !(
      this.image.hidden ||
      preview?.status !== 'ready' ||
      !this.image.complete ||
      this.image.naturalWidth !== preview.preview?.widthPx ||
      this.image.naturalHeight !== preview.preview?.heightPx ||
      this.image.getAttribute('src') !== 'data:image/png;base64,' + preview.preview?.data
    );
  }
  buildPanControls(listen) {
    this.panControls = document.createElement('details');
    this.panControls.className = 'canvas-navigation';
    const summary = document.createElement('summary');
    summary.textContent = 'Pan controls';
    const group = document.createElement('div');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Pan the canvas without dragging');
    this.panButtons = [];
    for (const [name, dx, dy] of [
      ['Left', 64, 0],
      ['Up', 0, 64],
      ['Down', 0, -64],
      ['Right', -64, 0],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name;
      button.setAttribute('aria-label', 'Pan ' + name.toLowerCase());
      listen(button, 'click', () => {
        if (!this.box || this.image.hidden) return;
        this.interrupt();
        this.x += dx;
        this.y += dy;
        this.render();
      });
      group.append(button);
      this.panButtons.push(button);
    }
    this.panControls.append(summary, group);
    document
      .getElementById('zoom-fit')
      ?.closest('.preview-tools')
      ?.insertAdjacentElement('afterend', this.panControls);
  }
  hasSceneMapping(preview) {
    return [this.preview?.viewport, preview.viewport].every(
      (value) =>
        value &&
        ['xMm', 'yMm', 'widthMm', 'heightMm'].every((key) => Number.isFinite(value[key])) &&
        value.widthMm > 0 &&
        value.heightMm > 0,
    );
  }
  changedLayout(next, preview) {
    return (
      ['width', 'height', 'surfaceWidth', 'surfaceHeight'].some(
        (key) => next[key] !== this.box[key],
      ) || JSON.stringify(this.preview.viewport) !== JSON.stringify(preview.viewport)
    );
  }
  keepSceneCentre(next, preview) {
    const width = this.surface.clientWidth,
      height = this.surface.clientHeight;
    if (!this.hasSceneMapping(preview)) {
      const ratio = next.width / this.box.width;
      this.x = width / 2 - (this.box.surfaceWidth / 2 - this.x) * ratio;
      this.y = height / 2 - (this.box.surfaceHeight / 2 - this.y) * ratio;
      return;
    }
    // Keep the scene centre and physical scale across auto-fit and screen size changes.
    const old = this.preview.viewport;
    const pxPerMm = (this.box.width * this.scale) / old.widthMm;
    const centreX = old.xMm + (this.box.surfaceWidth / 2 - this.x) / pxPerMm;
    const centreY = old.yMm + (this.box.surfaceHeight / 2 - this.y) / pxPerMm;
    this.scale = Math.max(1, Math.min(8, (pxPerMm * preview.viewport.widthMm) / next.width));
    const nextRatio = (next.width * this.scale) / preview.viewport.widthMm;
    this.x = width / 2 - (centreX - preview.viewport.xMm) * nextRatio;
    this.y = height / 2 - (centreY - preview.viewport.yMm) * nextRatio;
  }
  local(event) {
    const rect = this.surface.getBoundingClientRect();
    return {
      x: event.clientX - rect.left - this.surface.clientLeft,
      y: event.clientY - rect.top - this.surface.clientTop,
    };
  }
  zoom(next, point = { x: this.surface.clientWidth / 2, y: this.surface.clientHeight / 2 }) {
    if (!this.box || this.image.hidden) return;
    this.interrupt();
    const value = Math.max(1, Math.min(8, next));
    const ratio = value / this.scale;
    this.x = point.x - (point.x - this.x) * ratio;
    this.y = point.y - (point.y - this.y) * ratio;
    this.scale = value;
    this.render();
  }
  fit() {
    if (!this.box || this.image.hidden) return;
    this.interrupt();
    this.scale = 1;
    this.x = (this.surface.clientWidth - this.box.width) / 2;
    this.y = (this.surface.clientHeight - this.box.height) / 2;
    this.render();
  }
  down(event, pan) {
    if (event.button !== 0 || !this.box || this.image.hidden) return false;
    this.pointers.set(event.pointerId, this.local(event));
    try {
      this.surface.setPointerCapture(event.pointerId);
    } catch {
      this.pointers.delete(event.pointerId);
      return false;
    }
    if (this.pointers.size > 1 || pan) {
      this.cancelStroke();
      for (const id of this.pointers.keys()) {
        try {
          this.surface.setPointerCapture(id);
        } catch {
          /* pointer may already have ended */
        }
      }
      this.beginNavigation();
      this.changed();
      event.preventDefault();
      return true;
    }
    return false;
  }
  beginNavigation() {
    const points = [...this.pointers.values()].slice(0, 2);
    const mid =
      points.length === 2
        ? {
            x: (points[0].x + points[1].x) / 2,
            y: (points[0].y + points[1].y) / 2,
          }
        : points[0];
    this.navigation = {
      mid,
      distance:
        points.length === 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0,
      scale: this.scale,
      x: this.x,
      y: this.y,
    };
  }
  move(event) {
    if (!this.pointers.has(event.pointerId)) return false;
    this.pointers.set(event.pointerId, this.local(event));
    if (!this.navigation) return false;
    event.preventDefault();
    const points = [...this.pointers.values()].slice(0, 2);
    const start = this.navigation;
    const mid =
      points.length === 2
        ? {
            x: (points[0].x + points[1].x) / 2,
            y: (points[0].y + points[1].y) / 2,
          }
        : points[0];
    const distance =
      points.length === 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
    this.scale = Math.max(
      1,
      Math.min(8, start.distance > 0 ? (start.scale * distance) / start.distance : start.scale),
    );
    const ratio = this.scale / start.scale;
    this.x = mid.x - (start.mid.x - start.x) * ratio;
    this.y = mid.y - (start.mid.y - start.y) * ratio;
    this.render();
    return true;
  }
  up(event) {
    const navigating = !!this.navigation;
    this.pointers.delete(event.pointerId);
    if (navigating && this.surface.hasPointerCapture(event.pointerId))
      this.surface.releasePointerCapture(event.pointerId);
    if (!this.pointers.size) this.navigation = null;
    else if (navigating) this.beginNavigation();
    if (navigating) this.changed();
    return navigating;
  }
  cancel() {
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    this.navigation = null;
    for (const id of ids)
      if (this.surface.hasPointerCapture(id)) this.surface.releasePointerCapture(id);
  }
  interrupt() {
    this.cancelStroke();
    this.cancel();
  }
  render(notify = true) {
    if (!this.box) return;
    const width = this.box.width * this.scale,
      height = this.box.height * this.scale;
    // Keep a useful part of the preview in reach even after a fast pan.
    const edge = 48;
    this.x = Math.max(edge - width, Math.min(this.surface.clientWidth - edge, this.x));
    this.y = Math.max(edge - height, Math.min(this.surface.clientHeight - edge, this.y));
    Object.assign(this.image.style, {
      width: width + 'px',
      height: height + 'px',
      left: this.x + 'px',
      top: this.y + 'px',
    });
    this.surface.dataset.canvasScale = String(this.scale);
    this.surface.dataset.canvasX = String(this.x);
    this.surface.dataset.canvasY = String(this.y);
    if (this.value) this.value.textContent = Math.round(this.scale * 100) + '%';
    if (notify) this.changed();
  }
  destroy() {
    this.cancel();
    this.resize.disconnect();
    this.panControls.remove();
  }
}
