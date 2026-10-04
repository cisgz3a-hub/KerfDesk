/** Exact preview-to-scene mapping. No drawing or document authority lives here. */
const finite = (value, max) => Number.isFinite(value) && Math.abs(value) <= max;
export function createTouchGeometry() {
  return new TouchGeometry();
}
export class TouchGeometry {
  sameRect(a, b) {
    return (
      !!a &&
      !!b &&
      ['left', 'top', 'width', 'height'].every((key) => Math.abs(a[key] - b[key]) < 0.01)
    );
  }
  validWorkspace(value) {
    return (
      !!value &&
      typeof value.revision === 'string' &&
      value.revision.length > 0 &&
      value.revision.length <= 200 &&
      Array.isArray(value.selection) &&
      value.selection.length <= 200 &&
      Array.isArray(value.artwork) &&
      value.artwork.length <= 200
    );
  }
  validBox(box, limit = 100_000, positive = false) {
    return (
      !!box &&
      finite(box.xMm, limit) &&
      finite(box.yMm, limit) &&
      finite(box.widthMm, limit) &&
      finite(box.heightMm, limit) &&
      box.widthMm >= 0 &&
      box.heightMm >= 0 &&
      (!positive || (box.widthMm > 0 && box.heightMm > 0))
    );
  }
  validViewport(box) {
    return (
      this.validBox(box, 200_000, true) &&
      finite(box.xMm + box.widthMm, 200_000) &&
      finite(box.yMm + box.heightMm, 200_000)
    );
  }
  currentImageRect(image, preview) {
    const source = 'data:image/png;base64,' + preview?.data;
    if (
      preview?.mimeType !== 'image/png' ||
      ![preview.widthPx, preview.heightPx].every(
        (value) => Number.isInteger(value) && value > 0 && value <= 1024,
      ) ||
      !image.complete ||
      image.naturalWidth !== preview.widthPx ||
      image.naturalHeight !== preview.heightPx ||
      image.getAttribute('src') !== source ||
      image.currentSrc !== source
    )
      return null;
    return this.imageRect(image);
  }
  imageRect(image) {
    const box = image.getBoundingClientRect();
    if (!image.naturalWidth || !image.naturalHeight || box.width <= 0 || box.height <= 0)
      return null;
    const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    return {
      left: box.left + (box.width - width) / 2,
      top: box.top + (box.height - height) / 2,
      width,
      height,
    };
  }
  point(event, rect, viewport) {
    if (!rect || !this.validViewport(viewport)) return null;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > 1 || y > 1) return null;
    const result = {
      xMm: viewport.xMm + x * viewport.widthMm,
      yMm: viewport.yMm + y * viewport.heightMm,
    };
    return finite(result.xMm, 100_000) && finite(result.yMm, 100_000) ? result : null;
  }
  boxBetween(a, b) {
    return {
      xMm: Math.min(a.xMm, b.xMm),
      yMm: Math.min(a.yMm, b.yMm),
      widthMm: Math.abs(a.xMm - b.xMm),
      heightMm: Math.abs(a.yMm - b.yMm),
    };
  }
  items(workspace) {
    if (!Array.isArray(workspace?.artwork) || workspace.artwork.length > 200) return [];
    return workspace.artwork.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        item.id.length > 0 &&
        item.id.length <= 128 &&
        item.visible === true &&
        item.editable === true &&
        this.validBox(item.bounds),
    );
  }
  combined(artwork, ids) {
    if (!ids.length || ids.length > 200) return null;
    const selected = ids.map((id) => artwork.find((item) => item.id === id));
    if (selected.some((item) => !item)) return null;
    const minX = Math.min(...selected.map((item) => item.bounds.xMm));
    const minY = Math.min(...selected.map((item) => item.bounds.yMm));
    const maxX = Math.max(...selected.map((item) => item.bounds.xMm + item.bounds.widthMm));
    const maxY = Math.max(...selected.map((item) => item.bounds.yMm + item.bounds.heightMm));
    const box = { xMm: minX, yMm: minY, widthMm: maxX - minX, heightMm: maxY - minY };
    return this.validBox(box) ? box : null;
  }
  contains(point, box, tolerance = { x: 0, y: 0 }) {
    return (
      !!box &&
      point.xMm >= box.xMm - tolerance.x &&
      point.xMm <= box.xMm + box.widthMm + tolerance.x &&
      point.yMm >= box.yMm - tolerance.y &&
      point.yMm <= box.yMm + box.heightMm + tolerance.y
    );
  }
  tolerance(rect, viewport, pixels = 7) {
    return {
      x: (viewport.widthMm * pixels) / rect.width,
      y: (viewport.heightMm * pixels) / rect.height,
    };
  }
  hit(point, artwork, rect, viewport) {
    const pad = this.tolerance(rect, viewport);
    return [...artwork].reverse().find((item) => this.contains(point, item.bounds, pad));
  }
  handle(point, box, rect, viewport) {
    const pad = this.tolerance(rect, viewport, 24);
    return (
      box &&
      Math.abs(point.xMm - box.xMm - box.widthMm) <= pad.x &&
      Math.abs(point.yMm - box.yMm - box.heightMm) <= pad.y
    );
  }
  mutation(draft) {
    if (draft.mode === 'select') return { name: 'set_selection', args: { artworkIds: draft.ids } };
    if (draft.mode === 'brush') {
      if (draft.overflow || draft.points.length < 2) return null;
      return { name: 'add_polyline', args: { pointsMm: draft.points, closed: false } };
    }
    if (draft.mode === 'rectangle' || draft.mode === 'ellipse') {
      const box = this.boxBetween(draft.start, draft.last);
      return this.validBox(box, 100_000, true) ? { name: 'add_' + draft.mode, args: box } : null;
    }
    return this.transformMutation(draft);
  }
  transformMutation(draft) {
    const transform =
      draft.mode === 'move'
        ? {
            type: 'move',
            dxMm: draft.last.xMm - draft.start.xMm,
            dyMm: draft.last.yMm - draft.start.yMm,
          }
        : {
            type: 'resize',
            widthMm: draft.bounds.widthMm + (draft.last.xMm - draft.start.xMm),
            heightMm: draft.bounds.heightMm + (draft.last.yMm - draft.start.yMm),
          };
    const dimensions =
      draft.mode === 'move'
        ? [transform.dxMm, transform.dyMm]
        : [transform.widthMm, transform.heightMm];
    if (
      !dimensions.every((value) => finite(value, 100_000)) ||
      (draft.mode === 'resize' && dimensions.some((value) => value <= 0)) ||
      (draft.mode === 'resize' &&
        transform.widthMm === draft.bounds.widthMm &&
        transform.heightMm === draft.bounds.heightMm) ||
      (draft.mode === 'move' && dimensions.every((value) => value === 0))
    )
      return null;
    if (!this.validBox(this.draftBox(draft))) return null;
    return { name: 'transform_artwork', args: { artworkIds: draft.ids, transform } };
  }
  draftBox(draft) {
    if (!draft || draft.mode === 'brush') return null;
    if (draft.mode === 'rectangle' || draft.mode === 'ellipse')
      return this.boxBetween(draft.start, draft.last);
    if (!draft.bounds) return null;
    if (draft.mode === 'move')
      return {
        ...draft.bounds,
        xMm: draft.bounds.xMm + draft.last.xMm - draft.start.xMm,
        yMm: draft.bounds.yMm + draft.last.yMm - draft.start.yMm,
      };
    if (draft.mode === 'resize')
      return {
        ...draft.bounds,
        widthMm: Math.max(0, draft.bounds.widthMm + (draft.last.xMm - draft.start.xMm)),
        heightMm: Math.max(0, draft.bounds.heightMm + (draft.last.yMm - draft.start.yMm)),
      };
    return draft.bounds;
  }
}
