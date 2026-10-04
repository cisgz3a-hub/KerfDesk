/** DOM-only controls and overlays shared by phone and portable MCP views. */
export class TouchView {
  watchImage() {
    this.listen(this.image, 'load', () => this.update());
    this.listen(this.image, 'error', () => this.update());
    const observer = new MutationObserver(() => this.update());
    observer.observe(this.image, { attributes: true, attributeFilter: ['src', 'hidden'] });
    this.listeners.push(() => observer.disconnect());
  }
  element(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  buildControls() {
    this.controls.classList.add('touch-controls');
    const tools = this.element('div', '', 'touch-modes');
    tools.setAttribute('role', 'group');
    tools.setAttribute('aria-label', 'Touch artwork tools');
    this.buttons = new Map();
    for (const [mode, label] of [
      ['pan', 'Pan'],
      ['select', 'Select'],
      ['move', 'Move'],
      ['resize', 'Resize'],
      ['brush', 'Brush'],
      ['rectangle', 'Rectangle'],
      ['ellipse', 'Ellipse'],
    ]) {
      const button = this.element('button', label);
      button.type = 'button';
      button.dataset.touchTool = mode;
      this.listen(button, 'click', () => {
        this.reset();
        this.mode = mode;
        this.update();
      });
      this.buttons.set(mode, button);
      tools.append(button);
    }
    this.hint = this.element('p', '', 'touch-hint muted');
    this.hint.setAttribute('role', 'status');
    this.confirm = this.element('div', '', 'touch-confirm');
    this.confirm.hidden = true;
    this.summary = this.element('p', '', 'touch-summary');
    this.summary.setAttribute('aria-live', 'polite');
    this.applyButton = this.element('button', 'Apply', 'touch-apply');
    this.cancelButton = this.element('button', 'Cancel');
    this.applyButton.type = this.cancelButton.type = 'button';
    this.listen(this.applyButton, 'click', () => this.apply());
    this.listen(this.cancelButton, 'click', () =>
      this.reset('Draft cancelled. Nothing was applied.'),
    );
    this.confirm.append(this.summary, this.applyButton, this.cancelButton);
    this.controls.replaceChildren(tools, this.hint);
    this.surface.insertAdjacentElement('afterend', this.confirm);
  }
  svg(tag, attributes, className) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    element.setAttribute('class', className);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    this.overlay.append(element);
  }
  paint() {
    const ready = this.readiness();
    this.overlay.replaceChildren();
    this.overlay.toggleAttribute('hidden', !ready.rect);
    if (!ready.rect) return;
    const rect = ready.rect,
      viewport = ready.preview.viewport;
    const surface = this.surface.getBoundingClientRect();
    Object.assign(this.overlay.style, {
      left: rect.left - surface.left + this.surface.scrollLeft - this.surface.clientLeft + 'px',
      top: rect.top - surface.top + this.surface.scrollTop - this.surface.clientTop + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
    });
    this.overlay.setAttribute(
      'viewBox',
      [viewport.xMm, viewport.yMm, viewport.widthMm, viewport.heightMm].join(' '),
    );
    const draft = this.draft;
    const box = draft
      ? this.geometry.draftBox(draft)
      : this.geometry.combined(ready.artwork, this.ids);
    if (box) this.paintBox(box, draft?.mode === 'ellipse', draft ? 'touch-ghost' : 'touch-outline');
    if (draft?.mode === 'brush')
      this.svg(
        'polyline',
        { points: draft.points.map((point) => point.xMm + ',' + point.yMm).join(' ') },
        'touch-stroke',
      );
    if (box && this.mode === 'resize')
      this.svg(
        'ellipse',
        {
          cx: box.xMm + box.widthMm,
          cy: box.yMm + box.heightMm,
          rx: (viewport.widthMm * 12) / rect.width,
          ry: (viewport.heightMm * 12) / rect.height,
        },
        'touch-handle',
      );
  }
  paintBox(box, ellipse, className) {
    if (ellipse)
      this.svg(
        'ellipse',
        {
          cx: box.xMm + box.widthMm / 2,
          cy: box.yMm + box.heightMm / 2,
          rx: box.widthMm / 2,
          ry: box.heightMm / 2,
        },
        className,
      );
    else
      this.svg(
        'rect',
        { x: box.xMm, y: box.yMm, width: box.widthMm, height: box.heightMm },
        className,
      );
  }
}
