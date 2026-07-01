// RegistrationJigPanel — the persistent, NON-modal jig assistant pinned to the
// top-right of the canvas (ADR-057). Consolidates create-box, center-artwork, and
// the two-run output toggle into one switchable surface with a live "Next burn"
// status and built-in instructions. It never calls useRegisterModal, so canvas
// mouse handling and keyboard shortcuts keep working while it is open; it stays
// open until the operator closes it (toolbar toggle or the × here).

import { useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import {
  findRegistrationBoxes,
  hasRegistrationArtwork,
  registrationRunState,
  type RegistrationRunState,
} from '../../core/scene';
import { Button } from '../kit';
import { useStore } from '../state';
import { useUiStore, type FloatingPanelPosition } from '../state/ui-store';
import { RegistrationJigOutlineControls } from './RegistrationJigOutlineControls';

const PANEL_MARGIN_PX = 12;

type DragState = {
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startX: number;
  readonly startY: number;
};

type PanelPositionSetter = (next: FloatingPanelPosition) => void;

export function RegistrationJigPanel(): JSX.Element | null {
  const open = useUiStore((s) => s.registrationPanelOpen);
  const scene = useStore((s) => s.project.scene);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const centerInBox = useStore((s) => s.centerSelectionInRegistrationBox);
  const setOutput = useStore((s) => s.setRegistrationOutput);
  const close = useUiStore((s) => s.closeRegistrationPanel);
  const drag = useRegistrationPanelDrag();

  const boxes = findRegistrationBoxes(scene);
  const hasBox = boxes.length > 0;
  const hasArtwork = hasRegistrationArtwork(scene);
  const runState = registrationRunState(scene);
  const boxIds = new Set(boxes.map((b) => b.id));
  const canCenter =
    hasBox &&
    [selectedObjectId, ...additionalSelectedIds].some((id) => id !== null && !boxIds.has(id));

  if (!open) return null;
  return (
    <section
      aria-label="Registration jig"
      className="lf-chip"
      ref={drag.panelRef}
      style={drag.placementStyle}
    >
      <header style={headerStyle}>
        <strong
          aria-label="Move registration jig panel"
          role="button"
          tabIndex={0}
          title="Drag or use arrow keys to move this panel"
          style={dragHandleStyle}
          onPointerDown={drag.startDrag}
          onKeyDown={drag.nudgeWithKeyboard}
        >
          Registration Jig
        </strong>
        <Button variant="ghost" aria-label="Close registration jig panel" onClick={close}>
          ×
        </Button>
      </header>

      <NextBurnBanner state={runState} />

      <RegistrationJigOutlineControls />

      <Button
        onClick={centerInBox}
        disabled={!canCenter}
        title={
          canCenter
            ? 'Center the selected artwork in the jig outline'
            : 'Select your artwork first, then center it in the jig outline'
        }
      >
        Center artwork in outline
      </Button>

      <BurnRunToggle
        state={runState}
        disabled={!hasBox}
        artworkDisabled={!hasArtwork}
        onPick={setOutput}
      />

      <RegistrationJigHelp />
    </section>
  );
}

type PanelDragControls = {
  readonly panelRef: RefObject<HTMLElement>;
  readonly placementStyle: React.CSSProperties;
  readonly startDrag: (event: React.PointerEvent<HTMLElement>) => void;
  readonly nudgeWithKeyboard: (event: React.KeyboardEvent<HTMLElement>) => void;
};

function useRegistrationPanelDrag(): PanelDragControls {
  const position = useUiStore((s) => s.registrationPanelPosition);
  const setPosition = useUiStore((s) => s.setRegistrationPanelPosition);
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const placementStyle = useMemo<React.CSSProperties>(
    () =>
      position === null
        ? panelStyle
        : {
            ...panelStyle,
            left: position.x,
            top: position.y,
            right: 'auto',
          },
    [position],
  );

  usePanelPointerDragEffect(dragging, dragRef, panelRef, setDragging, setPosition);

  const startDrag = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    const panel = panelRef.current;
    const parent = panel === null ? null : panel.parentElement;
    if (panel === null || parent === null) return;
    const currentPosition = currentPanelPosition(panel, parent, position);
    dragRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: currentPosition.x,
      startY: currentPosition.y,
    };
    setPosition(currentPosition);
    setDragging(true);
    event.preventDefault();
    event.stopPropagation();
  };

  const nudgeWithKeyboard = (event: React.KeyboardEvent<HTMLElement>): void => {
    const delta = keyboardMoveDelta(event.key, event.shiftKey ? 1 : 10);
    if (delta === null) return;
    const panel = panelRef.current;
    const parent = panel === null ? null : panel.parentElement;
    if (panel === null || parent === null) return;
    const panelRect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const currentPosition = currentPanelPosition(panel, parent, position);
    setPosition(
      clampPanelPosition(
        currentPosition.x + delta.x,
        currentPosition.y + delta.y,
        parentRect,
        panelRect,
      ),
    );
    event.preventDefault();
    event.stopPropagation();
  };

  return { panelRef, placementStyle, startDrag, nudgeWithKeyboard };
}

function usePanelPointerDragEffect(
  dragging: boolean,
  dragRef: MutableRefObject<DragState | null>,
  panelRef: RefObject<HTMLElement>,
  setDragging: (next: boolean) => void,
  setPosition: PanelPositionSetter,
): void {
  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (event: PointerEvent): void => {
      const drag = dragRef.current;
      const panel = panelRef.current;
      const parent = panel === null ? null : panel.parentElement;
      if (drag === null || panel === null || parent === null) return;
      setPosition(
        clampPanelPosition(
          drag.startX + event.clientX - drag.startClientX,
          drag.startY + event.clientY - drag.startClientY,
          parent.getBoundingClientRect(),
          panel.getBoundingClientRect(),
        ),
      );
    };
    const onPointerEnd = (): void => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd, { once: true });
    window.addEventListener('pointercancel', onPointerEnd, { once: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [dragging, dragRef, panelRef, setDragging, setPosition]);
}

function currentPanelPosition(
  panel: HTMLElement,
  parent: HTMLElement,
  position: FloatingPanelPosition | null,
): FloatingPanelPosition {
  if (position !== null) return position;
  const panelRect = panel.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  return clampPanelPosition(
    panelRect.left - parentRect.left,
    panelRect.top - parentRect.top,
    parentRect,
    panelRect,
  );
}

function keyboardMoveDelta(
  key: string,
  stepPx: number,
): { readonly x: number; readonly y: number } | null {
  switch (key) {
    case 'ArrowLeft':
      return { x: -stepPx, y: 0 };
    case 'ArrowRight':
      return { x: stepPx, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -stepPx };
    case 'ArrowDown':
      return { x: 0, y: stepPx };
    default:
      return null;
  }
}

function clampPanelPosition(
  x: number,
  y: number,
  parentRect: DOMRect,
  panelRect: DOMRect,
): FloatingPanelPosition {
  const maxX = Math.max(PANEL_MARGIN_PX, parentRect.width - panelRect.width - PANEL_MARGIN_PX);
  const maxY = Math.max(PANEL_MARGIN_PX, parentRect.height - panelRect.height - PANEL_MARGIN_PX);
  return {
    x: clamp(x, PANEL_MARGIN_PX, maxX),
    y: clamp(y, PANEL_MARGIN_PX, maxY),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function NextBurnBanner(props: { readonly state: RegistrationRunState }): JSX.Element {
  const banner = bannerFor(props.state);
  return (
    <div className={banner.className} role="status">
      {banner.text}
    </div>
  );
}

function bannerFor(state: RegistrationRunState): {
  readonly className: string;
  readonly text: string;
} {
  switch (state) {
    case 'none':
      return { className: 'lf-banner', text: 'Create a jig outline below to begin.' };
    case 'box':
      return {
        className: 'lf-banner lf-banner--info',
        text: '▶ Next Start burns: JIG outline (run 1)',
      };
    case 'artwork':
      return {
        className: 'lf-banner lf-banner--info',
        text: '▶ Next Start burns: your ARTWORK (run 2)',
      };
    case 'mixed':
      return {
        className: 'lf-banner lf-banner--warning',
        text: 'Pick a run below — Outline only or Artwork only.',
      };
  }
}

function BurnRunToggle(props: {
  readonly state: RegistrationRunState;
  readonly disabled: boolean;
  readonly artworkDisabled: boolean;
  readonly onPick: (scope: 'box' | 'artwork') => void;
}): JSX.Element {
  return (
    <div role="group" aria-label="Burn run" style={toggleRowStyle}>
      <span>Burn run:</span>
      <Button
        pressed={props.state === 'box'}
        disabled={props.disabled}
        onClick={() => props.onPick('box')}
      >
        Outline only
      </Button>
      <Button
        pressed={props.state === 'artwork'}
        disabled={props.disabled || props.artworkDisabled}
        title={props.artworkDisabled ? 'Add artwork before run 2.' : 'Burn artwork only'}
        onClick={() => props.onPick('artwork')}
      >
        Artwork only
      </Button>
    </div>
  );
}

function RegistrationJigHelp(): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <div style={helpStyle}>
      <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} How to use
      </Button>
      {open && (
        <ol style={helpListStyle}>
          <li>
            Pick Rectangle or Circle, set the size, and create the outline. Pick{' '}
            <strong>Outline only</strong>, then Start to burn the outline on scrap.
          </li>
          <li>Put your object inside the burned outline.</li>
          <li>
            Add your artwork, select it, then <strong>Center artwork in outline</strong>.
          </li>
          <li>
            Pick <strong>Artwork only</strong>, then Start to burn the art.
          </li>
          <li style={helpNoteStyle}>
            Drag the outline onto your material to move it; Remove outline deletes it. On a
            no-homing machine, Set Origin + Frame (Laser panel) first; a homing machine can burn
            straight from the outline's position.
          </li>
        </ol>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  width: 250,
  maxHeight: 'calc(100% - 24px)',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  boxShadow: 'var(--lf-shadow)',
  pointerEvents: 'auto',
  fontSize: 13,
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const dragHandleStyle: React.CSSProperties = {
  cursor: 'grab',
  touchAction: 'none',
  userSelect: 'none',
};
const toggleRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const helpStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const helpListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  display: 'grid',
  gap: 4,
  fontSize: 12,
};
const helpNoteStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  listStyle: 'none',
  marginLeft: -18,
};
