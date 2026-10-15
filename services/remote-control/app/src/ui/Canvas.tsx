import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { controller } from '../core/controller';
import {
  artworkBox,
  marqueeSelection,
  selectableIds,
  selectUnits,
  decodeScene,
  hitTest,
  selectionBox,
  thinStroke,
  type Box,
  type Point,
} from '../core/scene';
import { canEdit, hasSelection, selectionComplete, store } from '../core/store';
import { CanvasLayers } from './canvas-layers';
import { handleAt, type Gesture } from './canvas-gesture-types';
import { useGestureLifecycle } from './canvas-gesture-lifecycle';
import { updateGesture } from './canvas-gesture-update';
import {
  RAIL_INSET,
  fitView,
  clampScale,
  normalize,
  useContentBox,
  useAutomaticFit,
} from './canvas-view';
import { useApp, useElementSize } from './hooks';

export { fitView, useContentBox } from './canvas-view';

const HIT_PX = 24;
export function Canvas({ interactive = true }: { interactive?: boolean }) {
  const [wrap, size] = useElementSize<HTMLDivElement>();
  const scene = useApp((state) => state.scene);
  const workspace = useApp((state) => state.workspace);
  const selection = useApp((state) => state.selection);
  const selectionMode = useApp((state) => state.selectionMode);
  const completeSelection = useApp(selectionComplete);
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
  const clearMarquee = useCallback(() => setMarquee(null), []);
  const { cancel, valid, remember, setView } = useGestureLifecycle(
    gesture,
    pointers,
    wrap,
    clearMarquee,
  );

  useAutomaticFit(size, view, interactive, content, scene?.bed !== undefined);

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
  const allowed = new Set(selectableIds(artwork, scene));
  const canTransform = editable && completeSelection && selection.every((id) => allowed.has(id));
  const selBox = selectionBox(selection, artwork);
  const displayedSelection = preview?.ids ?? selection;

  const hit = (point: Point): string | null => {
    const tolerance = HIT_PX / current.scale / 2;
    if (decoded.length > 0 || (scene?.images?.length ?? 0) > 0)
      return hitTest(
        decoded.filter((item) => allowed.has(item.source.id)),
        scene === null
          ? null
          : { ...scene, images: scene.images?.filter((item) => allowed.has(item.id)) },
        point,
        tolerance,
      );
    for (const item of [...artwork].reverse()) {
      const box = artworkBox(item);
      if (
        box !== null &&
        allowed.has(item.id) &&
        point.x >= box.minX - tolerance &&
        point.x <= box.maxX + tolerance &&
        point.y >= box.minY - tolerance &&
        point.y <= box.maxY + tolerance
      )
        return item.id;
    }
    return null;
  };
  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (event.pointerType === 'mouse' && event.button > 2) return;
    const toggle = event.shiftKey || event.ctrlKey || event.metaKey || selectionMode === 'toggle';
    event.currentTarget.focus({ preventScroll: true });
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    remember();
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.entries()] as [[number, Point], [number, Point]];
      store.set({
        preview: null,
        ...(gesture.current?.kind === 'box' || gesture.current?.kind === 'pen'
          ? { draft: null }
          : {}),
      });
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
    // Keep touch pointers registered so a second finger can still start navigation.
    if (tool === 'select' && event.button === 0 && toggle && !completeSelection) {
      gesture.current = null;
      store.toast('Clear the selection or select one item first.', 'info');
      return;
    }
    const point = toScene(event.clientX, event.clientY);
    if (tool === 'pan' || event.button === 1 || event.button === 2) {
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
      const handle =
        canTransform && !toggle ? handleAt(point, selBox, selection, current.scale) : null;
      if (handle !== null) {
        gesture.current = handle;
        return;
      }
      const id = hit(point);
      if (id === null) {
        gesture.current = {
          kind: 'marquee',
          start: point,
          current: point,
          moved: false,
          add: toggle,
          selected: selection,
        };
        return;
      }
      const unit = selectUnits([id], artwork, scene);
      const selected = completeSelection && unit.every((member) => selection.includes(member));
      const added = [...new Set([...selection, ...unit])];
      const ids = selected ? selection : toggle ? added : unit;
      const tapped = toggle
        ? selected
          ? selection.filter((member) => !unit.includes(member))
          : added
        : ids;
      gesture.current = { kind: 'move', ids, tapped, start: point, moved: false };
    }
  };

  const update = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    if (g === null) return;
    if (!valid()) {
      cancel();
      return;
    }
    const point = toScene(event.clientX, event.clientY);
    updateGesture(g, point, event, {
      editable:
        canTransform ||
        (g.kind === 'move' &&
          editable &&
          g.ids.length > 0 &&
          g.ids.every((id) => allowed.has(id) && !selection.includes(id))),
      scale: current.scale,
      pointers: pointers.current,
      rect: wrap.current?.getBoundingClientRect(),
      setView,
      setMarquee,
    });
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    if (cancelled || !valid()) {
      cancel();
      return;
    }
    update(event);
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (g === null) return;
    if (g.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    if (pointers.current.size > 0) return;
    gesture.current = null;
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
          void controller.select(g.tapped);
        }
        break;
      case 'scale':
        if (p?.kind === 'scale') {
          if (Math.abs(p.sx - 1) < 1e-6 && Math.abs(p.sy - 1) < 1e-6) {
            store.set({ preview: null });
            break;
          }
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
          const ids = marqueeSelection(g.start, g.current, artwork, scene);
          void controller.select(g.add ? [...new Set([...g.selected, ...ids])] : ids);
        } else {
          const now = Date.now();
          if (!g.add && now - lastTap.current < 320)
            store.set({
              view: fitView(content, size.width, size.height, 28, interactive ? RAIL_INSET : 0),
            });
          lastTap.current = now;
          if (!g.add && hasSelection(store.get())) void controller.select([]);
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
    cancel();
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
      onContextMenu={(event) => {
        if (interactive) event.preventDefault();
      }}
      aria-label="Design canvas"
      role="application"
      tabIndex={interactive ? 0 : -1}
    >
      <CanvasLayers
        viewBox={viewBox}
        px={px}
        scene={scene}
        decoded={decoded}
        artwork={artwork}
        selection={displayedSelection}
        selBox={selectionBox(displayedSelection, artwork)}
        editable={canTransform}
        marquee={marquee}
        marqueeCrossing={
          gesture.current?.kind === 'marquee' && gesture.current.current.x < gesture.current.start.x
        }
        preview={preview}
        draft={draft}
        highlight={highlight}
      />
    </div>
  );
}
