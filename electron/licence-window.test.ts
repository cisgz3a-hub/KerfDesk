// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DESKTOP_LICENCE_WINDOW, licenceWindowText } from './licence-window';
import { ERRORS, MESSAGES } from './licensing-messages';
import { createStartupSignals, servicesAlwaysAdmitted } from './licensing-startup-signals';

// ADR-623 Amendment 3: one setting decides whether a commercial desktop build
// opens behind its licence window. The main process follows it for its
// services and for what its messages promise.
describe('the desktop licence window setting', () => {
  it('starts desktop services with the app while the window is held off', () => {
    expect(servicesAlwaysAdmitted('commercial', false)).toBe(true);
    expect(servicesAlwaysAdmitted('commercial', true)).toBe(false);
    // A build without licensing never shows the window, whatever the setting.
    expect(servicesAlwaysAdmitted('free', true)).toBe(true);
    expect(servicesAlwaysAdmitted('commercial')).toBe(!DESKTOP_LICENCE_WINDOW);
  });

  it('keeps an always-admitted session admitted across renderers, as 1.0.20 ran the camera', () => {
    const signals = createStartupSignals(servicesAlwaysAdmitted('commercial', false));
    const seen: boolean[] = [];
    signals.admission.onChange((admitted) => seen.push(admitted));
    signals.admission.rendererOpening();
    signals.admission.rendererGone();
    expect(seen).toEqual([true]);
  });

  it('chooses the words for the setting in force', () => {
    expect(licenceWindowText('window', 'free')).toBe(DESKTOP_LICENCE_WINDOW ? 'window' : 'free');
  });

  it('tells a KerfDesk Free user that Free keeps working while the window is held off', () => {
    const free = !DESKTOP_LICENCE_WINDOW;
    for (const message of [
      ERRORS.get('trial_expired'),
      ERRORS.get('trial_already_used'),
      ERRORS.get('license_revoked'),
    ])
      expect(message?.includes('KerfDesk Free keeps working')).toBe(free);
    expect(MESSAGES.unreadable.includes('Everything else works')).toBe(free);
    expect(MESSAGES.unavailable.includes('Everything else works')).toBe(free);
  });
});
