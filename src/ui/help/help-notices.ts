// Help > About and Help > Safety & liability open as dialogs (ADR-707), asked
// for with a window event as the licence notice is (license-notice.ts), so the
// command layer needs no React state for them.

export type HelpNoticeKind = 'about' | 'safety';

export const HELP_NOTICE_EVENT = 'kerfdesk:help-notice';

export function openHelpNotice(kind: HelpNoticeKind): void {
  window.dispatchEvent(new CustomEvent<HelpNoticeKind>(HELP_NOTICE_EVENT, { detail: kind }));
}
