import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { controller } from '../core/controller';
import {
  artworkBox,
  boxesIntersect,
  decodeScene,
  expandUnits,
  hitTest,
  selectionBox,
  thinStroke,
  type Box,
  type Point,
} from '../core/scene';
import { canEdit, store, type View } from '../core/store';
import { CanvasLayers } from './canvas-layers';
import { RAIL_INSET, clampScale, fitView, normalize, useContentBox } from './canvas-view';
import { useApp, useElementSize } from './hooks';

export { fitView, useContentBox } from './canvas-view';

const HIT_PX = 24;
const DRAG_START_PX = 6;
type Gesture =
  | { kind: 'pan'; start: Point; view: View }
  | { kind: 'pinch'; ids: [number, number]; distance: number; mid: Point; view: View }
  | { kind: 'move'; ids: string[]; start: Point; moved: boolean; tapId: string | null }
  | { kind: 'scale'; ids: string[]; from: Box; anchor: Point; sign: Point }
  | { kind: 'rotate'; ids: string[]; center: Point; startAngle: number }
  | { kind: 'box'; shape: 'rect' | 'ellipse'; start: Point }
  | { kind: 'pen'; points: Point[] }
  | { kind: 'marquee'; start: Point; current: Point; moved: boolean }
  | { kind: 'tap'; at: Point };

export function Canvas({ interactive = true }: { interactive?: boolean }) {
  const [wrap, size] = useElementSize<HTMLDivElement>();
  const scene = useApp((state) => state.scene);
  const workspace = useApp((state) => state.workspace);
  const selection = useApp((state) => state.selection);
  const view = useApp((state) => state.view);
  const tool = useApp((state) => state.tool);
  const draft = useApp((state) => state.draft);
  const preview = useApp((state) => state.preview);
  const highlight = useApp((state) => state.highlight);
  const editable = useApp(canEdit) && interactive;
  const content = useContentBox();
  const decoded = useMemo(() => decodeScene(scene), [scene]);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const lastTap = useRef(0);

  // Fit once, and once more when the bed size first arrives with the scene.
  const fittedBed = useRef(false);
  const bedKnown = scene?.bed !== undefined;
  useEffect(() => {
    if (size.width === 0) return;
    if (view !== null && interactive && (fittedBed.current || !bedKnown)) return;
    fittedBed.current = bedKnown;
    store.set({
      view: fitView(content, size.width, size.height, 28, interactive ? RAIL_INSET : 0),
    });
  }, [size.width, size.height, view === null, interactive, content, bedKnown]);

  const current = view ?? { x: 0, y: 0, scale: 1 };
  const toScene = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = wrap.current?.getBoundingClientRect();
      const v = store.get().view ?? current;
      return {
        x: v.x + (clientX - (rect?.left ?? 0)) / v.scale,
        y: v.y + (clientY - (rect?.top ?? 0)) / v.scale,
      };
    },
    [wrap, current],
  );
  const artwork = workspace?.artwork ?? [];
  const selBox = selectionBox(selection, artwork);

  const hit = (point: Point): string | null => {
    const tolerance = HIT_PX / current.scale / 2;
    if (decoded.length > 0 || (scene?.images?.length ?? 0) > 0)
      return hitTest(decoded, scene, point, tolerance);
    for (const item of [...artwork].reverse()) {
      const box = artworkBox(item);
      if (
        box !== null &&
        item.visible !== false &&
        point.x >= box.minX - tolerance &&
        point.x <= box.maxX + tolerance &&
        point.y >= box.minY - tolerance &&
        point.y <= box.maxY + tolerance
      )
        return item.id;
    }
    return null;
  };
  const handleAt = (point: Point): Gesture | null => {
    if (selBox === null || !editable) return null;
    // On a small selection the handles shrink so a drag on the shape itself still moves it.
    const sidePx = Math.min(selBox.maxX - selBox.minX, selBox.maxY - selBox.minY) * current.scale;
    const radius = Math.min(HIT_PX, Math.max(10, sidePx / 3)) / current.scale;
    const corners: [Point, Point][] = [
      [
        { x: selBox.minX, y: selBox.minY },
        { x: selBox.maxX, y: selBox.maxY },
      ],
      [
        { x: selBox.maxX, y: selBox.minY },
        { x: selBox.minX, y: selBox.maxY },
      ],
      [
        { x: selBox.maxX, y: selBox.maxY },
        { x: selBox.minX, y: selBox.minY },
      ],
      [
        { x: selBox.minX, y: selBox.maxY },
        { x: selBox.maxX, y: selBox.minY },
      ],
    ];
    for (const [corner, anchor] of corners)
      if (Math.hypot(point.x - corner.x, point.y - corner.y) <= radius)
        return {
          kind: 'scale',
          ids: selection,
          from: selBox,
          anchor,
          sign: { x: Math.sign(corner.x - anchor.x) || 1, y: Math.sign(corner.y - anchor.y) || 1 },
        };
    const rotate = { x: (selBox.minX + selBox.maxX) / 2, y: selBox.minY - 30 / current.scale };
    if (Math.hypot(point.x - rotate.x, point.y - rotate.y) <= radius) {
      const center = { x: (selBox.minX + selBox.maxX) / 2, y: (selBox.minY + selBox.maxY) / 2 };
      return {
        kind: 'rotate',
        ids: selection,
        center,
        startAngle: Math.atan2(point.y - center.y, point.x - center.x),
      };
    }
    return null;
  };

  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.entries()] as [[number, Point], [number, Point]];
      if (
        gesture.current?.kind === 'move' ||
        gesture.current?.kind === 'scale' ||
        gesture.current?.kind === 'rotate'
      )
        store.set({ preview: null });
      setMarquee(null);
      gesture.current = {
        kind: 'pinch',
        ids: [a[0], b[0]],
        distance: Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y),
        mid: { x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 },
        view: current,
      };
      return;
    }
    if (pointers.current.size > 2) return;
    const point = toScene(event.clientX, event.clientY);
    if (tool === 'pan' || event.button === 1) {
      gesture.current = {
        kind: 'pan',
        start: { x: event.clientX, y: event.clientY },
        view: current,
      };
      return;
    }
    if (!editable && tool !== 'select') {
      gesture.current = {
        kind: 'pan',
        start: { x: event.clientX, y: event.clientY },
        view: current,
      };
      return;
    }
    if (tool === 'rect' || tool === 'ellipse')
      gesture.current = { kind: 'box', shape: tool, start: point };
    else if (tool === 'pen') gesture.current = { kind: 'pen', points: [point] };
    else if (tool === 'text') gesture.current = { kind: 'tap', at: point };
    else {
      const handle = handleAt(point);
      if (handle !== null) {
        gesture.current = handle;
        return;
      }
      const id = hit(point);
      if (id === null) {
        gesture.current = { kind: 'marquee', start: point, current: point, moved: false };
        return;
      }
      const unit = expandUnits([id], scene);
      const ids = selection.includes(id) ? selection : unit;
      if (!selection.includes(id)) store.set({ selection: ids });
      gesture.current = { kind: 'move', ids, start: point, moved: false, tapId: id };
    }
  };

  const update = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    if (g === null) return;
    const point = toScene(event.clientX, event.clientY);
    switch (g.kind) {
      case 'pan':
        store.set({
          view: {
            ...g.view,
            x: g.view.x - (event.clientX - g.start.x) / g.view.scale,
            y: g.view.y - (event.clientY - g.start.y) / g.view.scale,
          },
        });
        break;
      case 'pinch': {
        const a = pointers.current.get(g.ids[0]);
        const b = pointers.current.get(g.ids[1]);
        if (a === undefined || b === undefined) return;
        const rect = wrap.current?.getBoundingClientRect();
        const left = rect?.left ?? 0;
        const top = rect?.top ?? 0;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const scale = clampScale(
          g.view.scale * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, g.distance)),
        );
        const anchor = {
          x: g.view.x + (g.mid.x - left) / g.view.scale,
          y: g.view.y + (g.mid.y - top) / g.view.scale,
        };
        store.set({
          view: {
            scale,
            x: anchor.x - (mid.x - left) / scale,
            y: anchor.y - (mid.y - top) / scale,
          },
        });
        break;
      }
      case 'move': {
        if (!editable) return;
        const dx = point.x - g.start.x;
        const dy = point.y - g.start.y;
        if (!g.moved && Math.hypot(dx, dy) * current.scale < DRAG_START_PX) return;
        g.moved = true;
        store.set({ preview: { kind: 'move', ids: g.ids, dx, dy } });
        break;
      }
      case 'scale': {
        const w = Math.max(1e-6, g.from.maxX - g.from.minX);
        const h = Math.max(1e-6, g.from.maxY - g.from.minY);
        const factor = Math.max(
          0.02,
          Math.max(
            ((point.x - g.anchor.x) * g.sign.x) / w,
            ((point.y - g.anchor.y) * g.sign.y) / h,
          ),
        );
        store.set({
          preview: {
            kind: 'scale',
            ids: g.ids,
            ox: g.anchor.x,
            oy: g.anchor.y,
            sx: factor,
            sy: factor,
          },
        });
        break;
      }
      case 'rotate': {
        let angle =
          ((Math.atan2(point.y - g.center.y, point.x - g.center.x) - g.startAngle) * 180) / Math.PI;
        if (event.shiftKey || Math.abs(angle % 15) < 2.5 || Math.abs(angle % 15) > 12.5)
          angle = Math.round(angle / 15) * 15;
        store.set({
          preview: { kind: 'rotate', ids: g.ids, cx: g.center.x, cy: g.center.y, angle },
        });
        break;
      }
      case 'box':
        store.set({
          draft: {
            kind: g.shape,
            x: Math.min(g.start.x, point.x),
            y: Math.min(g.start.y, point.y),
            width: Math.abs(point.x - g.start.x),
            height: Math.abs(point.y - g.start.y),
          },
        });
        break;
      case 'pen':
        g.points.push(point);
        store.set({ draft: { kind: 'pen', points: [...g.points] } });
        break;
      case 'marquee':
        g.current = point;
        if (
          !g.moved &&
          Math.hypot(point.x - g.start.x, point.y - g.start.y) * current.scale < DRAG_START_PX
        )
          return;
        g.moved = true;
        setMarquee({
          minX: Math.min(g.start.x, point.x),
          minY: Math.min(g.start.y, point.y),
          maxX: Math.max(g.start.x, point.x),
          maxY: Math.max(g.start.y, point.y),
        });
        break;
      case 'tap':
        break;
    }
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (g === null) return;
    if (g.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (cancelled) {
      if (g.kind !== 'box' && g.kind !== 'pen') store.set({ preview: null });
      setMarquee(null);
      return;
    }
    finish(g);
  };

  const finish = (g: Gesture) => {
    const p = store.get().preview;
    switch (g.kind) {
      case 'move':
        if (g.moved && p?.kind === 'move') {
          if (Math.hypot(p.dx, p.dy) > 0.01) void controller.move(g.ids, p.dx, p.dy);
          else store.set({ preview: null });
        } else {
          const tapped = g.tapId === null ? [] : expandUnits([g.tapId], scene);
          void controller.select(tapped);
        }
        break;
      case 'scale':
        if (p?.kind === 'scale') {
          const to = {
            minX: p.ox + (g.from.minX - p.ox) * p.sx,
            minY: p.oy + (g.from.minY - p.oy) * p.sy,
            maxX: p.ox + (g.from.maxX - p.ox) * p.sx,
            maxY: p.oy + (g.from.maxY - p.oy) * p.sy,
          };
          void controller.scale(g.ids, g.from, normalize(to));
        }
        break;
      case 'rotate':
        if (p?.kind === 'rotate' && Math.abs(p.angle) > 0.05)
          void controller.rotate(g.ids, p.angle);
        else store.set({ preview: null });
        break;
      case 'box': {
        const d = store.get().draft;
        if (d === null || d.kind === 'pen' || d.width < 0.5 || d.height < 0.5)
          store.set({ draft: null });
        break;
      }
      case 'pen': {
        const points = thinStroke(g.points, (0.5 / Math.max(0.2, current.scale)) * 2);
        store.set({ draft: points.length >= 2 ? { kind: 'pen', points } : null });
        break;
      }
      case 'marquee': {
        setMarquee(null);
        if (g.moved) {
          const area = {
            minX: Math.min(g.start.x, g.current.x),
            minY: Math.min(g.start.y, g.current.y),
            maxX: Math.max(g.start.x, g.current.x),
            maxY: Math.max(g.start.y, g.current.y),
          };
          const ids = artwork
            .filter(
              (item) =>
                item.editable !== false &&
                boxesIntersect(artworkBox(item) ?? area, area) &&
                artworkBox(item) !== null,
            )
            .map((item) => item.id);
          void controller.select(expandUnits(ids, scene));
        } else {
          const now = Date.now();
          if (now - lastTap.current < 320)
            store.set({
              view: fitView(content, size.width, size.height, 28, interactive ? RAIL_INSET : 0),
            });
          lastTap.current = now;
          if (selection.length > 0) void controller.select([]);
        }
        break;
      }
      case 'tap':
        store.set({ sheet: { kind: 'text', at: g.at } });
        break;
      default:
        break;
    }
  };

  const wheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const rect = wrap.current?.getBoundingClientRect();
    const px = event.clientX - (rect?.left ?? 0);
    const py = event.clientY - (rect?.top ?? 0);
    const scale = clampScale(current.scale * Math.exp(-event.deltaY * 0.0015));
    const anchor = { x: current.x + px / current.scale, y: current.y + py / current.scale };
    store.set({ view: { scale, x: anchor.x - px / scale, y: anchor.y - py / scale } });
  };

  const viewBox = `${current.x} ${current.y} ${Math.max(1, size.width) / current.scale} ${Math.max(1, size.height) / current.scale}`;
  const px = 1 / current.scale;

  return (
    <div
      ref={wrap}
      className={`canvas-wrap${tool === 'pan' ? ' pan' : ''}${['rect', 'ellipse', 'pen', 'text'].includes(tool) ? ' draw' : ''}`}
      onPointerDown={begin}
      onPointerMove={update}
      onPointerUp={(event) => end(event)}
      onPointerCancel={(event) => end(event, true)}
      onLostPointerCapture={(event) => {
        if (pointers.current.has(event.pointerId)) end(event, true);
      }}
      onWheel={wheel}
      aria-label="Design canvas"
      role="application"
    >
      <CanvasLayers
        viewBox={viewBox}
        px={px}
        scene={scene}
        decoded={decoded}
        artwork={artwork}
        selection={selection}
        selBox={selBox}
        editable={editable}
        marquee={marquee}
        preview={preview}
        draft={draft}
        highlight={highlight}
      />
    </div>
  );
}
