import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import './AnchoredPopover.css';

type PopoverProps = {
  readonly id: string;
  readonly label: string;
  readonly role: 'menu' | 'dialog';
  readonly anchorRef: RefObject<HTMLElement>;
  /** Use spare space beside this group when a tall form would cover its controls. */
  readonly sideAnchorRef?: RefObject<HTMLElement>;
  readonly className?: string;
  readonly children: ReactNode;
  /** Retain form state while the popover is closed, without focus or listeners. */
  readonly open?: boolean;
  readonly initialFocus?: string;
  /** Stable opener for a modal whose control disappears with this popover. */
  readonly focusFallbackId?: string;
  /** Forms keep native Tab navigation inside, then dismiss when focus leaves. */
  readonly closeOnTab?: boolean;
  /** Keep controls inside their owning modal's focus boundary when needed. */
  readonly portalHost?: Element | null;
  readonly onClose: () => void;
  readonly onKeyDownCapture?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  readonly onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

/** A nonmodal control popover, kept outside clipping toolbar/scroll containers. */
function usePopoverPosition(
  props: PopoverProps,
  panelRef: RefObject<HTMLDivElement>,
): {
  readonly left: number;
  readonly top: number;
  readonly maxHeight: number;
} {
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 320 });
  const { anchorRef, sideAnchorRef, onClose, initialFocus } = props;
  const open = props.open !== false;
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (panel === null || anchor === null) return;
    const reposition = (): void => {
      const next = popoverPosition(anchor, panel, sideAnchorRef?.current);
      setPosition((previous) =>
        previous.left === next.left &&
        previous.top === next.top &&
        previous.maxHeight === next.maxHeight
          ? previous
          : next,
      );
    };
    const dismissOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (!panel.contains(event.target) && !anchor.contains(event.target)) onClose();
    };
    reposition();
    const firstFocus =
      initialFocus === 'last'
        ? [...panel.querySelectorAll<HTMLElement>('button:not(:disabled)')].at(-1)
        : panel.querySelector<HTMLElement>(initialFocus ?? 'button:not(:disabled)');
    (firstFocus ?? panel).focus();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reposition);
    observer?.observe(panel);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    document.addEventListener('pointerdown', dismissOutside);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
      document.removeEventListener('pointerdown', dismissOutside);
    };
  }, [anchorRef, sideAnchorRef, onClose, initialFocus, open, panelRef]);
  return position;
}

/** A nonmodal control popover, kept outside clipping toolbar/scroll containers. */
export function AnchoredPopover(props: PopoverProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(props, panelRef);
  const { anchorRef, onClose } = props;
  const open = props.open !== false;
  return createPortal(
    <div
      ref={panelRef}
      id={props.id}
      role={props.role}
      hidden={!open}
      tabIndex={-1}
      aria-label={props.label}
      className={`lf-anchored-popover ${props.className ?? ''}`}
      style={position}
      onKeyDownCapture={props.onKeyDownCapture}
      onFocusCapture={(event) => {
        if (props.focusFallbackId !== undefined && event.target instanceof HTMLElement) {
          event.target.dataset['dialogFocusFallback'] = props.focusFallbackId;
        }
      }}
      onBlur={(event) => {
        if (open && props.closeOnTab === false && focusLeftPopover(event, anchorRef.current))
          props.onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || (event.key === 'Tab' && props.closeOnTab !== false)) {
          if (event.key === 'Escape') event.preventDefault();
          event.stopPropagation();
          anchorRef.current?.focus();
          onClose();
          return;
        }
        props.onKeyDown?.(event);
      }}
    >
      {props.children}
    </div>,
    props.portalHost ?? document.body,
  );
}

function focusLeftPopover(
  event: React.FocusEvent<HTMLDivElement>,
  anchor: HTMLElement | null,
): boolean {
  const next = event.relatedTarget;
  // Disabling an async action's focused button blurs it with no next target.
  // Keep its dropdown mounted and visible for the dialog it is preparing.
  if (!(next instanceof Node)) {
    return !(event.target instanceof HTMLElement && event.target.matches(':disabled'));
  }
  return !event.currentTarget.contains(next) && !anchor?.contains(next);
}

function popoverPosition(
  anchor: HTMLElement,
  panel: HTMLElement,
  sideAnchor?: HTMLElement | null,
): {
  left: number;
  top: number;
  maxHeight: number;
} {
  const margin = 8;
  const gap = 5;
  const bounds = anchor.getBoundingClientRect();
  const { width, height, left: leftEdge, top: topEdge } = viewportBounds();
  const below = Math.max(0, topEdge + height - bounds.bottom - gap - margin);
  const above = Math.max(0, bounds.top - topEdge - gap - margin);
  const sideBounds = sideAnchor?.getBoundingClientRect();
  if (
    sideBounds &&
    panel.scrollHeight > below &&
    sideBounds.left - leftEdge >= panel.offsetWidth + margin + gap
  ) {
    const maxHeight = Math.max(0, height - 2 * margin);
    return {
      left: sideBounds.left - panel.offsetWidth - gap,
      top: Math.max(
        topEdge + margin,
        Math.min(bounds.top, topEdge + height - Math.min(panel.scrollHeight, maxHeight) - margin),
      ),
      maxHeight,
    };
  }
  const openAbove = panel.scrollHeight > below && above > below;
  const maxHeight = Math.max(0, openAbove ? above : below);
  const top = openAbove
    ? bounds.top - Math.min(panel.scrollHeight, maxHeight) - gap
    : bounds.bottom + gap;
  return {
    left: Math.max(
      leftEdge + margin,
      Math.min(bounds.left, leftEdge + width - panel.offsetWidth - margin),
    ),
    top: Math.max(topEdge + margin, top),
    maxHeight,
  };
}

function viewportBounds(): {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
} {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
  };
}

export function movePopoverFocus(event: React.KeyboardEvent<HTMLElement>, columns = 1): void {
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
  ];
  const index = buttons.findIndex((button) => button === document.activeElement);
  const next = focusIndex(event.key, index, buttons.length, columns);
  if (next === null) return;
  event.preventDefault();
  event.stopPropagation();
  buttons[next]?.focus();
}

function focusIndex(key: string, current: number, count: number, columns: number): number | null {
  if (count === 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const delta =
    key === 'ArrowDown'
      ? columns
      : key === 'ArrowUp'
        ? -columns
        : key === 'ArrowRight'
          ? 1
          : key === 'ArrowLeft'
            ? -1
            : 0;
  return delta === 0 ? null : (Math.max(0, current) + delta + count) % count;
}
