import { DESKTOP_LICENCE_WINDOW } from '../public/desktop-licence-window.mjs';

export { DESKTOP_LICENCE_WINDOW };

/**
 * The words for a licence state. Behind the licence window the desktop app has
 * no Free edition (ADR-623); while ADR-623 Amendment 3 holds the window off,
 * KerfDesk Free keeps working without a licence (ADR-540).
 */
export function licenceWindowText(behindWindow: string, free: string): string {
  return DESKTOP_LICENCE_WINDOW ? behindWindow : free;
}
