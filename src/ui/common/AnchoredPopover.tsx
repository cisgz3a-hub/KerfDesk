import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import './AnchoredPopover.css';

type PopoverProps = {
  readonly id: string;
  readonly label: string;
  readonly role: 'menu' | 'dialog';
  readonly anchorRef: RefObject<HTMLElement>;
  readonly className?: string;
  readonly children: ReactNode;
  readonly initialFocus?: string;
  readonly onClose: () => void;
  readonly onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

/** A nonmodal control popover, kept outside clipping toolbar/scroll containers. */
export function AnchoredPopover(props: PopoverProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 320 });
  const { anchorRef, onClose, initialFocus } = props;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (panel === null || anchor === null) return;
    const reposition = (): void => {
      const next = popoverPosition(anchor, panel);
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
  }, [anchorRef, onClose, initialFocus]);
  return createPortal(
    <div
      ref={panelRef}
      id={props.id}
      role={props.role}
      tabIndex={-1}
      aria-label={props.label}
      className={`lf-anchored-popover ${props.className ?? ''}`}
      style={position}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
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
    document.body,
  );
}

function popoverPosition(
  anchor: HTMLElement,
  panel: HTMLElement,
): {
  left: number;
  top: number;
  maxHeight: number;
} {
  const margin = 8;
  const gap = 5;
  const bounds = anchor.getBoundingClientRect();
  const viewport = window.visualViewport;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  const leftEdge = viewport?.offsetLeft ?? 0;
  const topEdge = viewport?.offsetTop ?? 0;
  const below = Math.max(0, topEdge + height - bounds.bottom - gap - margin);
  const above = Math.max(0, bounds.top - topEdge - gap - margin);
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
