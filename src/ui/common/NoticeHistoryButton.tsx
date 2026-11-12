// The status bar's Notices control (annoyance audit A5-P2-6, ADR-708): the
// warnings and errors this session has shown as toasts, newest first, so one
// that left the screen unread can be read again. It appears with the first
// notice and holds nothing across a reload.
//
// The list is a fixed box (the footer does not clip it) over the canvas's own
// space, beside the toasts, and it stops above the Live Motion popup: it never
// covers the rails or the Abort control (PROJECT.md non-negotiable 9), and the
// Live Motion popup stacks above it.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Icon } from '../kit/icons';
import { useNoticeHistory, type NoticeEntry } from '../state/notice-history';
import { liveMotionFloor } from './use-toast-placement';
import './notice-history.css';

export function NoticeHistoryButton(): JSX.Element | null {
  const notices = useNoticeHistory((s) => s.notices);
  const unseen = useNoticeHistory((s) => s.unseen);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // Emptied (Clear) while open: the control goes, so the list goes with it.
  useEffect(() => {
    if (notices.length === 0) setOpen(false);
  }, [notices.length]);

  const close = useCallback((restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  }, []);

  if (notices.length === 0) return null;
  const toggle = (): void => {
    if (!open) useNoticeHistory.getState().markNoticesSeen();
    setOpen(!open);
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="lf-btn lf-notice-history__button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title="Warnings and errors shown in this session, newest first. The list is cleared when the app reloads."
        onClick={toggle}
      >
        {unseen > 0 && !open ? `Notices (${unseen} new)` : 'Notices'}
      </button>
      {open && <NoticeHistoryPanel id={panelId} notices={notices} anchor={button} close={close} />}
    </>
  );
}

function NoticeHistoryPanel(props: {
  readonly id: string;
  readonly notices: ReadonlyArray<NoticeEntry>;
  readonly anchor: React.RefObject<HTMLButtonElement>;
  readonly close: (restoreFocus: boolean) => void;
}): JSX.Element {
  const { anchor, close } = props;
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(panelPlacement);

  useLayoutEffect(() => {
    const place = (): void => setStyle(panelPlacement());
    place();
    window.addEventListener('resize', place);
    return (): void => window.removeEventListener('resize', place);
  }, [props.notices.length]);

  // Notices that arrive while the list is open are being read.
  useEffect(() => {
    useNoticeHistory.getState().markNoticesSeen();
  }, [props.notices]);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel.current?.contains(target) === true) return;
      // The button's own click closes the list.
      if (anchor.current?.contains(target) === true) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return (): void => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchor, close]);

  return (
    <div
      ref={panel}
      id={props.id}
      className="lf-notice-history"
      style={style}
      role="region"
      aria-label="Notices from this session"
      tabIndex={-1}
      onKeyDown={(event) => {
        // Keys that scroll or leave this list stay here: they must not reach
        // the window's canvas nudge or machine shortcuts.
        if (LIST_KEYS.has(event.key)) event.stopPropagation();
        if (event.key === 'Escape') close(true);
      }}
    >
      <NoticeHistoryHeader close={close} />
      <ul className="lf-notice-history__list">
        {props.notices.map((notice) => (
          <NoticeRow key={notice.id} notice={notice} />
        ))}
      </ul>
    </div>
  );
}

function NoticeHistoryHeader(props: {
  readonly close: (restoreFocus: boolean) => void;
}): JSX.Element {
  return (
    <div className="lf-notice-history__header">
      <strong>Notices</strong>
      <span className="lf-notice-history__hint">This session, newest first</span>
      <button
        type="button"
        className="lf-btn"
        title="Empty this list. Nothing else changes."
        onClick={() => {
          useNoticeHistory.getState().clearNotices();
          props.close(true);
        }}
      >
        Clear
      </button>
      <button
        type="button"
        className="lf-notice-history__close"
        aria-label="Close notices"
        title="Close notices"
        onClick={() => props.close(true)}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

function NoticeRow({ notice }: { readonly notice: NoticeEntry }): JSX.Element {
  return (
    <li className={`lf-notice-history__item lf-notice-history__item--${notice.variant}`}>
      <span className="lf-notice-history__meta">
        <strong>{notice.variant === 'error' ? 'Error' : 'Warning'}</strong>
        {` · ${formatNoticeTime(notice.at)}`}
        {notice.count > 1 ? ` · shown ${notice.count} times` : ''}
      </span>
      <span className="lf-notice-history__message">{notice.message}</span>
      {notice.details === undefined ? null : (
        <ul className="lf-notice-history__details">
          {notice.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

const LIST_KEYS = new Set([
  'Escape',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  ' ',
]);

/** Hours and minutes on the operator's own clock. */
export function formatNoticeTime(at: number): string {
  const time = new Date(at);
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${two(time.getHours())}:${two(time.getMinutes())}`;
}

// Inside the canvas's space, at its right edge above the status bar, and above
// the Live Motion popup when one is up.
function panelPlacement(): CSSProperties {
  const gap = 12;
  const workspace = document
    .querySelector<HTMLElement>('[data-toast-workspace]')
    ?.getBoundingClientRect();
  if (workspace === undefined || workspace.width <= 0 || workspace.height <= 0) {
    return { right: gap, bottom: 40, width: 'min(380px, calc(100vw - 24px))', maxHeight: '50vh' };
  }
  const bottom = Math.max(
    gap,
    window.innerHeight - workspace.bottom + gap,
    liveMotionFloor(gap) ?? 0,
  );
  return {
    right: Math.max(gap, window.innerWidth - workspace.right + gap),
    bottom,
    width: Math.max(0, Math.min(380, workspace.width - gap * 2)),
    maxHeight: Math.max(0, Math.min(360, window.innerHeight - bottom - workspace.top - gap)),
  };
}
