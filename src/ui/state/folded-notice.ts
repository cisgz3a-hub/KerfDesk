// One toast for one action. An import or a project open can have a result and
// half a dozen notes to go with it; pushed one by one, only the newest three
// showed and the first were never seen (annoyance audit A5-P2-6). Here they
// are one keyed toast (ADR-708, after ADR-687's fold for Save G-code):
//
// - the result is the first line;
// - up to three notes follow it in the open, one a line: what the stack of
//   three toasts used to show, so a warning that was in view stays in view;
// - any further notes fold under a last line that counts them, and open on a
//   click.
// Warnings and errors take the open lines before plain notes do, and among
// equals the later ones do: callers put what must stay in view last.
// The toast takes the most serious variant among its parts, so a result with
// a warning under it looks like a warning.

import { VISIBLE_TOASTS, type ToastOptions, type ToastVariant } from './toast-store';

export type Notice = {
  readonly message: string;
  readonly variant: ToastVariant;
  readonly details?: ReadonlyArray<string>;
};

export type FoldedNotice = {
  /** The result and the open notes, one a line. */
  readonly message: string;
  readonly variant: ToastVariant;
  readonly details?: ReadonlyArray<string>;
};

type PushToast = (message: string, variant?: ToastVariant, options?: ToastOptions) => void;

/** Notes shown in the open: as many as the stack shows toasts. */
const OPEN_NOTES = VISIBLE_TOASTS;

const SEVERITY: Readonly<Record<ToastVariant, number>> = {
  success: 0,
  info: 1,
  warning: 2,
  error: 3,
};

export function foldNotices(result: Notice, notes: ReadonlyArray<Notice>): FoldedNotice {
  const variant = [result, ...notes].reduce<ToastVariant>(
    (worst, notice) => (SEVERITY[notice.variant] > SEVERITY[worst] ? notice.variant : worst),
    result.variant,
  );
  const open = openNotes(notes);
  const folded = notes.filter((note) => !open.includes(note));
  // Warnings lead the fold; within a kind the caller's order stands.
  const ranked = [...folded].sort((a, b) => rank(b) - rank(a));
  const lines = [
    result.message,
    ...open.map((note) => note.message),
    ...(folded.length === 0 ? [] : [moreBelowLabel(folded)]),
  ];
  // The same line twice would be one line to read (and one list key).
  const details = [
    ...new Set([
      ...(result.details ?? []),
      ...open.flatMap((note) => note.details ?? []),
      ...ranked.flatMap((note) => [note.message, ...(note.details ?? [])]),
    ]),
  ];
  const message = lines.join('\n');
  return details.length === 0 ? { message, variant } : { message, variant, details };
}

/** Pushes the folded notice into `key`'s slot. */
export function pushFoldedNotice(
  pushToast: PushToast,
  key: string,
  result: Notice,
  notes: ReadonlyArray<Notice>,
): void {
  const folded = foldNotices(result, notes);
  pushToast(folded.message, folded.variant, {
    key,
    ...(folded.details === undefined ? {} : { details: folded.details }),
  });
}

/** Notes with no result of their own (a sheet switch, a restored autosave):
 * nothing for none, the note itself for one, `subject` over several. */
export function pushNoticeGroup(
  pushToast: PushToast,
  key: string,
  subject: string,
  notes: ReadonlyArray<Notice>,
): void {
  const [only, ...rest] = notes;
  if (only === undefined) return;
  if (rest.length === 0) pushFoldedNotice(pushToast, key, only, []);
  else pushFoldedNotice(pushToast, key, { message: subject, variant: 'info' }, notes);
}

// The notes that stay in the open, in the caller's order.
function openNotes(notes: ReadonlyArray<Notice>): ReadonlyArray<Notice> {
  if (notes.length <= OPEN_NOTES) return notes;
  const chosen = notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => rank(b.note) - rank(a.note) || b.index - a.index)
    .slice(0, OPEN_NOTES)
    .map((entry) => entry.note);
  return notes.filter((note) => chosen.includes(note));
}

function rank(notice: Notice): number {
  return SEVERITY[notice.variant] >= SEVERITY.warning ? 1 : 0;
}

function moreBelowLabel(folded: ReadonlyArray<Notice>): string {
  const warnings = folded.filter((note) => rank(note) === 1).length;
  const others = folded.length - warnings;
  const parts = [
    ...(warnings === 0 ? [] : [`${warnings} more warning${warnings === 1 ? '' : 's'}`]),
    ...(others === 0 ? [] : [`${others} more note${others === 1 ? '' : 's'}`]),
  ];
  return `${parts.join(' and ')} below.`;
}
