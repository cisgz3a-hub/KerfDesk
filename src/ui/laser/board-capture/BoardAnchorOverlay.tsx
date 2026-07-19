import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  findRegistrationBoxBounds,
  type BoardVerificationTarget,
  type CapturedBoardGeometry,
} from '../../../core/scene';
import { useStore } from '../../state';
import { useUiStore } from '../../state/ui-store';
import { computeView, type ViewTransform } from '../../workspace/view-transform';
import {
  boardAnchorOverlayHasCollision,
  boardAnchorOverlayHandles,
  scenePointToOverlayPosition,
  type BoardAnchorOverlayHandle,
} from './board-anchor-overlay-layout';

export type BoardAnchorOverlayProps = {
  readonly geometry: CapturedBoardGeometry;
  readonly activeTarget: BoardVerificationTarget | null;
  readonly disabled: boolean;
  readonly onSelect: (target: BoardVerificationTarget) => void;
};

export function BoardAnchorOverlay(props: BoardAnchorOverlayProps): JSX.Element {
  const scene = useStore((state) => state.project.scene);
  const bedWidth = useStore((state) => state.project.device.bedWidth);
  const bedHeight = useStore((state) => state.project.device.bedHeight);
  const zoomFactor = useUiStore((state) => state.zoomFactor);
  const panX = useUiStore((state) => state.panX);
  const panY = useUiStore((state) => state.panY);
  const [overlayRef, parentSize] = useParentElementSize();
  const bounds = useMemo(() => findRegistrationBoxBounds(scene), [scene]);
  const handles = useMemo(
    () => (bounds === null ? [] : boardAnchorOverlayHandles(props.geometry.kind, bounds)),
    [bounds, props.geometry.kind],
  );
  const view = useMemo(
    () =>
      parentSize === null
        ? null
        : computeView(parentSize.width, parentSize.height, bedWidth, bedHeight, {
            zoomFactor,
            panX,
            panY,
          }),
    [bedHeight, bedWidth, panX, panY, parentSize, zoomFactor],
  );
  const visibleHandles = useMemo(
    () => (view === null || boardAnchorOverlayHasCollision(handles, view) ? [] : handles),
    [handles, view],
  );

  return (
    <div ref={overlayRef} style={overlayStyle} role="group" aria-label="Board verification points">
      {view === null
        ? null
        : visibleHandles.map((handle) => (
            <BoardAnchorButton
              key={`${handle.target.kind}:${handle.target.anchor}`}
              handle={handle}
              view={view}
              active={sameTarget(handle.target, props.activeTarget)}
              disabled={props.disabled}
              onSelect={props.onSelect}
            />
          ))}
    </div>
  );
}

function BoardAnchorButton(props: {
  readonly handle: BoardAnchorOverlayHandle;
  readonly view: ViewTransform;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onSelect: (target: BoardVerificationTarget) => void;
}): JSX.Element {
  const position = scenePointToOverlayPosition(props.handle.scenePoint, props.view);
  return (
    <button
      type="button"
      aria-label={props.handle.label}
      aria-pressed={props.active}
      title={props.handle.label}
      disabled={props.disabled}
      data-board-anchor={props.handle.target.anchor}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        props.onSelect(props.handle.target);
      }}
      style={{
        ...anchorButtonStyle,
        ...position,
        ...(props.disabled ? disabledAnchorButtonStyle : {}),
      }}
    >
      <span aria-hidden="true" style={props.active ? activeMarkerStyle : markerStyle}>
        +
      </span>
    </button>
  );
}

function sameTarget(left: BoardVerificationTarget, right: BoardVerificationTarget | null): boolean {
  return right !== null && left.kind === right.kind && left.anchor === right.anchor;
}

type ElementSize = { readonly width: number; readonly height: number };

function useParentElementSize(): [React.RefObject<HTMLDivElement>, ElementSize | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ElementSize | null>(null);
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (parent === undefined || parent === null) return;
    const apply = (): void => {
      const rect = parent.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      setSize((current) =>
        current?.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
  zIndex: 4,
};

const anchorButtonStyle: React.CSSProperties = {
  position: 'absolute',
  width: 44,
  height: 44,
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  transform: 'translate(-50%, -50%)',
  border: 0,
  borderRadius: '50%',
  background: 'transparent',
  color: 'var(--lf-accent-fg)',
  cursor: 'pointer',
  pointerEvents: 'auto',
};

const disabledAnchorButtonStyle: React.CSSProperties = {
  cursor: 'not-allowed',
  opacity: 0.55,
};

const markerStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  display: 'grid',
  placeItems: 'center',
  boxSizing: 'border-box',
  border: '2px solid var(--lf-accent)',
  borderRadius: '50%',
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
  fontSize: 16,
  fontWeight: 700,
  lineHeight: 1,
};

const activeMarkerStyle: React.CSSProperties = {
  ...markerStyle,
  width: 24,
  height: 24,
  background: 'var(--lf-accent)',
  color: 'var(--lf-on-fill)',
  boxShadow: '0 0 0 3px var(--lf-accent-wash), var(--lf-shadow)',
};
