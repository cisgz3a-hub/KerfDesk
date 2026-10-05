import { createTouchGeometry } from './control-touch-geometry.js';
import { TouchView } from './control-touch-view.js';
import { CanvasViewport } from './control-touch-viewport.js';

/** A gesture is local until Apply. The owner supplies revision-fenced, idempotent edits. */
export function bindTouchCanvas(options) {
  return new TouchCanvas(options, createTouchGeometry());
}

export class TouchCanvas extends TouchView {
  mode = 'pan';
  draft = null;
  gesture = null;
  applying = false;
  epoch = 0;
  disposed = false;
  ids = [];
  listeners = [];
  constructor(options, geometry) {
    super();
    this.options = options;
    this.geometry = geometry;
    this.surface = options.surface;
    this.image = options.image;
    this.controls = options.controls;
    this.surface.classList.add('touch-surface');
    this.surface.tabIndex = 0;
    this.surface.setAttribute('aria-label', 'Artwork preview. Choose a touch tool to edit.');
    this.image.draggable = false;
    this.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.overlay.classList.add('touch-overlay');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.surface.append(this.overlay);
    this.buildControls();
    this.viewport = new CanvasViewport({
      surface: this.surface,
      image: this.image,
      listen: (...args) => this.listen(...args),
      changed: () => {
        this.syncDraft(this.readiness());
        this.paint();
      },
      cancelStroke: () => {
        if (this.gesture) this.reset('Stroke cancelled for navigation. Nothing was applied.', true);
      },
    });
    this.bindCanvasEvents();
    this.update();
  }
  listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    this.listeners.push(() => target.removeEventListener(type, callback, options));
  }
  readiness() {
    const workspace = this.options.getWorkspace();
    const preview = this.options.getPreview();
    if (!this.geometry.validWorkspace(workspace))
      return { reason: 'Connect to the PC to edit artwork.' };
    if (!this.options.canEdit()) return { reason: 'Editing needs approval on the PC.' };
    if (workspace.permissions?.artworkSharingEnabled !== true)
      return { reason: 'Enable artwork sharing on the PC to use touch editing.' };
    if (typeof workspace.capabilities?.touchEditing !== 'boolean')
      return { reason: 'Update KerfDesk on the PC to enable touch editing.' };
    const current = this.previewReadiness(workspace, preview);
    if (!current.rect) return current;
    return {
      workspace,
      preview,
      rect: current.rect,
      artwork: this.geometry.items(workspace),
    };
  }
  previewReadiness(workspace, preview) {
    if (
      preview?.status !== 'ready' ||
      preview.revision !== workspace.revision ||
      !this.geometry.validViewport(preview.viewport) ||
      this.image.hidden
    )
      return {
        reason: 'Waiting for the current PC preview. Touch editing needs its exact coordinates.',
      };
    const rect = this.geometry.currentImageRect(this.image, preview.preview);
    if (!rect)
      return {
        reason:
          this.image.complete && !this.image.naturalWidth
            ? 'The PC preview could not load. Refresh it before editing.'
            : 'Loading the current PC preview. Touch editing will be ready when it is visible.',
      };
    return { rect };
  }
  update() {
    if (this.disposed) return;
    this.viewport.sync(this.options.getPreview());
    const ready = this.readiness();
    if (
      this.draft &&
      (!ready.workspace ||
        ready.workspace.revision !== this.draft.revision ||
        this.draft.viewportKey !== JSON.stringify(ready.preview.viewport))
    )
      this.reset('The PC or access changed. The draft was cancelled; nothing was applied.');
    if (!this.draft && !this.applying)
      this.ids = ready.workspace
        ? ready.workspace.selection.filter((id) => ready.artwork.some((item) => item.id === id))
        : [];
    this.syncModes(ready);
    this.syncDraft(ready);
    this.paint();
  }
  syncModes(ready) {
    for (const [mode, button] of this.buttons) {
      const drawing = ['brush', 'rectangle', 'ellipse'].includes(mode);
      button.disabled =
        mode !== 'pan' &&
        (!ready.workspace ||
          this.options.blocked() ||
          this.applying ||
          (drawing && !ready.workspace.capabilities.touchEditing));
      button.setAttribute('aria-pressed', String(mode === this.mode));
    }
    this.surface.dataset.touchMode = this.mode;
    this.hint.textContent = ready.reason || this.modeHint(ready.workspace);
  }
  syncDraft(ready) {
    this.confirm.hidden = !this.draft;
    this.applyButton.disabled =
      !this.draft ||
      !!this.gesture ||
      !!this.viewport.navigation ||
      this.applying ||
      this.options.blocked() ||
      !ready.workspace ||
      !this.geometry.mutation(this.draft);
    this.cancelButton.disabled = this.applying;
    this.summary.textContent = this.draft ? this.draftSummary() : '';
  }
  modeHint(workspace) {
    const hints = {
      pan: 'Drag to pan. Pinch with two fingers to zoom in any tool.',
      select: 'Tap artwork to select it, then Apply. Selection uses its bounding box.',
      move: 'Drag selected artwork, then Apply. Arrow keys move by 1 mm; Shift uses 10 mm.',
      resize: 'Drag the blue lower-right handle, then Apply. The upper-left corner stays fixed.',
      brush: 'Draw one stroke, then Apply to add it to the PC design.',
      rectangle: 'Drag from one corner to the other, then Apply.',
      ellipse: 'Drag a box for the ellipse, then Apply.',
    };
    const limited = workspace.truncated
      ? ' Only the first 200 artwork items can be selected here.'
      : '';
    return (
      hints[this.mode] +
      limited +
      (!workspace.capabilities.touchEditing
        ? ' Drawing new artwork is available in a Laser workspace.'
        : '')
    );
  }
  draftSummary() {
    if (this.draft.overflow)
      return 'This stroke is too detailed. Cancel and draw a shorter stroke.';
    if (this.draft.mode === 'select')
      return this.draft.ids.length
        ? 'Select ' + this.draft.ids.length + ' artwork item on the PC?'
        : 'Clear the PC selection?';
    const box = this.geometry.draftBox(this.draft);
    const size = box
      ? ' · ' + box.widthMm.toFixed(2) + ' × ' + box.heightMm.toFixed(2) + ' mm'
      : '';
    return 'Draft ' + this.draft.mode + size + '. Apply sends one change to the PC.';
  }
  changeDraft(draft) {
    const before = this.hasDraft();
    this.draft = draft;
    this.update();
    if (before !== this.hasDraft()) this.options.onDraftChange?.(this.hasDraft());
  }
  pointerCanEdit(event) {
    return (
      !this.gesture &&
      (!this.draft || !this.geometry.mutation(this.draft)) &&
      event.isPrimary &&
      event.button === 0 &&
      this.mode !== 'pan' &&
      !this.applying &&
      !this.options.blocked()
    );
  }
  down(event) {
    if (this.viewport.down(event, this.mode === 'pan') || !this.pointerCanEdit(event)) return;
    const ready = this.readiness();
    if (!ready.workspace || !ready.rect) return;
    const start = this.geometry.point(event, ready.rect, ready.preview.viewport);
    if (!start) return;
    event.preventDefault();
    const draft = this.startDraft(start, ready);
    if (!draft) return;
    this.gesture = { id: event.pointerId, rect: ready.rect, viewport: ready.preview.viewport };
    try {
      this.surface.setPointerCapture(event.pointerId);
    } catch {
      this.gesture = null;
      return;
    }
    this.changeDraft(draft);
  }
  startDraft(start, ready) {
    const revision = ready.workspace.revision;
    let ids = this.ids;
    const hit = this.geometry.hit(start, ready.artwork, ready.rect, ready.preview.viewport);
    if (this.mode === 'select') ids = hit ? [hit.id] : [];
    if (
      this.mode === 'move' &&
      !this.geometry.contains(
        start,
        this.geometry.combined(ready.artwork, ids),
        this.geometry.tolerance(ready.rect, ready.preview.viewport),
      )
    )
      ids = hit ? [hit.id] : [];
    const bounds = this.geometry.combined(ready.artwork, ids);
    if (this.mode === 'move' && !bounds) return null;
    if (!this.canStart(ready, start, bounds)) return null;
    return {
      revision,
      viewportKey: JSON.stringify(ready.preview.viewport),
      mode: this.mode,
      ids,
      bounds,
      start,
      last: { ...start },
      points: [start],
    };
  }
  canStart(ready, start, bounds) {
    if (
      this.mode === 'resize' &&
      (!bounds ||
        bounds.widthMm <= 0 ||
        bounds.heightMm <= 0 ||
        !this.geometry.handle(start, bounds, ready.rect, ready.preview.viewport))
    )
      return false;
    return !(
      ['brush', 'rectangle', 'ellipse'].includes(this.mode) &&
      !ready.workspace.capabilities.touchEditing
    );
  }
  move(event) {
    if (this.viewport.move(event)) return;
    if (!this.gesture || event.pointerId !== this.gesture.id || !this.draft) return;
    event.preventDefault();
    if (!this.geometry.sameRect(this.geometry.imageRect(this.image), this.gesture.rect)) {
      this.reset('View moved. The draft was cancelled; draw or drag again.');
      return;
    }
    const point = this.geometry.point(event, this.gesture.rect, this.gesture.viewport);
    if (!point) {
      this.reset('Outside the editable preview. Draw or drag again.');
      return;
    }
    this.draft.last = point;
    if (this.draft.mode === 'brush') this.addBrushPoint(point);
    this.update();
  }
  addBrushPoint(point) {
    const last = this.draft.points.at(-1);
    const tolerance = this.geometry.tolerance(this.gesture.rect, this.gesture.viewport, 1);
    if (
      Math.abs(last.xMm - point.xMm) < tolerance.x &&
      Math.abs(last.yMm - point.yMm) < tolerance.y
    )
      return;
    if (this.draft.points.length >= 512) this.draft.overflow = true;
    else this.draft.points.push(point);
  }
  up(event) {
    if (this.viewport.up(event)) return;
    if (!this.gesture || event.pointerId !== this.gesture.id) return;
    this.move(event);
    if (!this.gesture) return;
    const id = this.gesture.id;
    this.gesture = null;
    if (this.surface.hasPointerCapture(id)) this.surface.releasePointerCapture(id);
    this.update();
  }
  cancelPointer(event) {
    if (this.gesture?.id === event.pointerId) {
      this.reset('Gesture cancelled. Nothing was applied.');
    } else if (this.viewport.pointers.has(event.pointerId)) {
      // Only local navigation ended; a finished scene-coordinate draft still belongs to the PC view.
      this.viewport.cancel();
      this.update();
    }
  }
  key(event) {
    if (event.key === 'Escape') {
      this.reset('Draft cancelled. Nothing was applied.');
      return;
    }
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!direction || this.mode !== 'move' || this.applying || this.options.blocked()) return;
    if (this.gesture || this.viewport.navigation) {
      event.preventDefault();
      return;
    }
    this.nudge(event, direction);
  }
  nudge(event, direction) {
    const ready = this.readiness();
    const bounds = ready.workspace && this.geometry.combined(ready.artwork, this.ids);
    if (!bounds) return;
    event.preventDefault();
    const start = { xMm: bounds.xMm, yMm: bounds.yMm };
    const draft = this.draft || {
      revision: ready.workspace.revision,
      viewportKey: JSON.stringify(ready.preview.viewport),
      mode: 'move',
      ids: [...this.ids],
      bounds,
      start,
      last: { ...start },
    };
    draft.last.xMm += direction[0] * (event.shiftKey ? 10 : 1);
    draft.last.yMm += direction[1] * (event.shiftKey ? 10 : 1);
    this.changeDraft(draft);
  }
  apply() {
    const draft = this.draft;
    const ready = this.readiness();
    if (
      !draft ||
      this.gesture ||
      this.viewport.navigation ||
      this.applying ||
      this.options.blocked() ||
      !ready.workspace
    )
      return;
    if (
      ready.workspace.revision !== draft.revision ||
      draft.viewportKey !== JSON.stringify(ready.preview.viewport)
    ) {
      this.reset('The PC changed. Draw or drag again.');
      return;
    }
    const mutation = this.geometry.mutation(draft);
    if (!mutation) return;
    const before = ++this.epoch;
    this.applying = true;
    this.draft = null;
    this.update();
    void this.options.action(async () => {
      try {
        await this.options.edit(mutation.name, mutation.args, draft.revision);
      } finally {
        this.applying = false;
        this.update();
        if (before === this.epoch) this.options.onDraftChange?.(this.hasDraft());
      }
    });
  }
  reset(reason, keepNavigation = false) {
    const before = this.hasDraft();
    this.epoch++;
    this.releaseGesture(keepNavigation);
    this.draft = null;
    this.overlay.replaceChildren();
    if (!this.disposed) this.update();
    if (reason && before) this.options.notice?.(reason);
    if (before !== this.hasDraft()) this.options.onDraftChange?.(this.hasDraft());
  }
  releaseGesture(keepNavigation) {
    const id = this.gesture?.id;
    this.gesture = null;
    if (!keepNavigation) this.viewport.cancel();
    if (id !== undefined && this.surface.hasPointerCapture(id))
      this.surface.releasePointerCapture(id);
  }
  hasDraft() {
    return !!this.draft || !!this.gesture || this.applying;
  }
  destroy() {
    this.reset();
    this.disposed = true;
    this.resize.disconnect();
    this.viewport.destroy();
    for (const remove of this.listeners) remove();
    this.overlay.remove();
    this.confirm.remove();
    this.controls.replaceChildren();
    this.surface.classList.remove('touch-surface');
    delete this.surface.dataset.touchMode;
  }
}
