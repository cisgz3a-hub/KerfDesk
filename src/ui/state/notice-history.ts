// Notice history — the warnings and errors this session has shown as toasts,
// so one that left the screen unread can be read again from the status bar
// (annoyance audit A5-P2-6, ADR-708). Held in memory only: a reload clears it,
// nothing is persisted and no setting governs it.
//
// The same notice said again is one row with a count, not a new row: ten jog
// clicks past the bed edge are one line, newest first.

import { create } from 'zustand';

export type NoticeVariant = 'warning' | 'error';

export type NoticeEntry = {
  readonly id: number;
  readonly message: string;
  readonly variant: NoticeVariant;
  readonly details?: ReadonlyArray<string>;
  /** When it was last shown, in epoch milliseconds. */
  readonly at: number;
  /** How many times this session showed it. */
  readonly count: number;
};

export type NoticeInput = {
  readonly message: string;
  readonly variant: NoticeVariant;
  readonly details?: ReadonlyArray<string>;
};

/** Enough for a long session's worth of distinct notices; older rows drop off. */
export const NOTICE_HISTORY_LIMIT = 50;

type NoticeHistoryState = {
  /** Newest first. */
  readonly notices: ReadonlyArray<NoticeEntry>;
  /** Notices shown since the list was last opened. */
  readonly unseen: number;
  readonly recordNotice: (notice: NoticeInput) => void;
  readonly markNoticesSeen: () => void;
  readonly clearNotices: () => void;
};

let nextId = 1;

export const useNoticeHistory = create<NoticeHistoryState>((set) => ({
  notices: [],
  unseen: 0,
  recordNotice: (notice) =>
    set((state) => {
      const repeat = state.notices.find((entry) => sameNotice(entry, notice));
      const entry: NoticeEntry = {
        id: repeat?.id ?? nextId++,
        message: notice.message,
        variant: notice.variant,
        ...(notice.details === undefined || notice.details.length === 0
          ? {}
          : { details: notice.details }),
        at: Date.now(),
        count: (repeat?.count ?? 0) + 1,
      };
      const others = state.notices.filter((existing) => existing !== repeat);
      return {
        notices: [entry, ...others].slice(0, NOTICE_HISTORY_LIMIT),
        // A repeat of a row already read is not news.
        unseen: repeat === undefined ? state.unseen + 1 : state.unseen,
      };
    }),
  markNoticesSeen: () => set((state) => (state.unseen === 0 ? state : { unseen: 0 })),
  clearNotices: () => set({ notices: [], unseen: 0 }),
}));

function sameNotice(entry: NoticeEntry, notice: NoticeInput): boolean {
  return (
    entry.variant === notice.variant &&
    entry.message === notice.message &&
    (entry.details ?? []).join('\n') === (notice.details ?? []).join('\n')
  );
}
