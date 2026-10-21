import type { NativeLicencePhase } from './native-smoke-licence-config.js';
import { DESKTOP_LICENCE_WINDOW } from './licence-window.js';
import { RENDERER_SMOKE_SOURCE, RENDERER_WORKSPACE_READY_SOURCE } from './native-smoke-renderer.js';

// Fixed UI actions only: no arbitrary script input, entitlement override or
// response substitution. The key exists only in this evaluated call's memory.
// With the licence window on, an unlicensed profile opens behind it (ADR-623), so
// activation enters the key there; the import/save smoke runs once the workspace
// is in. While ADR-623 Amendment 3 holds the window off, the profile opens in
// KerfDesk Free and activation uses Help > Licence, as before ADR-623.
const QUALIFICATION_SOURCE = String.raw`async (phase, key, licenceWindow) => {
  if (location.href !== 'app://app/index.html') throw new Error('Qualification requires the packaged app');
  if (!['activate', 'offline', 'deactivate'].includes(phase)) throw new Error('Unknown qualification phase');
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (read, message) => {
    for (let attempt = 0; attempt < 250; attempt += 1) {
      const result = await read();
      if (result) return result;
      await delay(100);
    }
    throw new Error(message);
  };
  const status = async () => {
    const response = await fetch('app://app/api/licensing/status', {
      method: 'GET', headers: { 'X-KerfDesk-Licensing': '1' }, cache: 'no-store', redirect: 'error',
    });
    if (!response.ok) throw new Error('Qualification could not read local licensing');
    const value = await response.json();
    return {
      channel: value.channel, state: value.state, edition: value.edition, tier: value.tier,
      perpetualUpdates: value.perpetualUpdates, accessExpiresAt: value.accessExpiresAt,
      updatesUntil: value.updatesUntil, deactivationPending: value.deactivationPending,
    };
  };
  const isDeveloper = (value) => value.channel === 'commercial' && value.state === 'ready' &&
    value.edition === 'pro' && value.tier === 'developer' && value.perpetualUpdates === true &&
    value.accessExpiresAt === null && value.updatesUntil === null && value.deactivationPending === false;
  const isFree = (value) => value.channel === 'commercial' && value.state === 'activation-required' &&
    value.edition === 'free' && value.tier === null && value.deactivationPending === false;
  const button = (label) => [...document.querySelectorAll('button')].find((item) =>
    item.getAttribute('aria-label') === label || item.textContent.trim() === label);
  const openLicence = async () => {
    const opener = await wait(() => document.querySelector('button[aria-label^="Edition:"]'), 'Edition control missing');
    opener.click();
    return wait(() => document.querySelector('[role="dialog"][aria-label="KerfDesk licence"]'), 'Licence panel missing');
  };
  // Observe licensing only once the renderer has opened: its workspace, or the
  // settled licence window that stands in its place.
  const opened = await ${RENDERER_WORKSPACE_READY_SOURCE};
  const before = await status();
  let proAction = 'not-requested';
  if (phase === 'activate') {
    if (!isFree(before)) throw new Error('Activation qualification requires an initially unlicensed profile');
    if (licenceWindow && opened !== 'licence-window') throw new Error('The workspace opened without the licence window');
    if (!licenceWindow && opened !== 'workspace') throw new Error('The licence window opened while it is held off');
    if (!licenceWindow) await openLicence();
    const input = await wait(() => document.getElementById('kerfdesk-licence-key'), 'Licence input missing');
    if (!(input instanceof HTMLInputElement)) throw new Error('Licence input missing');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, key);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const activate = await wait(() => { const b = button('Activate licence'); return b && !b.disabled ? b : null; }, 'Activation control unavailable');
    activate.click();
    key = '';
    await wait(async () => isDeveloper(await status()), 'Developer activation was not observed');
    if (!licenceWindow) button('Close licence settings')?.click();
  }
  const smoke = await ${RENDERER_SMOKE_SOURCE};
  if (phase === 'offline') {
    if (!isDeveloper(before)) throw new Error('Offline restart did not retain developer Pro');
  } else if (phase === 'deactivate' && !isFree(before)) {
    if (!isDeveloper(before) && before.deactivationPending !== true) throw new Error('Unexpected licence before cleanup');
    // A seat still signing out leaves the profile behind the licence window.
    if (smoke.licenceWindow !== true) await openLicence();
    const release = await wait(() => button('Deactivate this device') || button('Retry device deactivation'), 'Deactivation control missing');
    release.click();
    await wait(async () => isFree(await status()), 'Device deactivation was not confirmed');
  }
  if (phase !== 'deactivate') {
    await wait(() => button('Edition: Pro. Open licence settings'), 'Renderer did not unlock Pro');
    button('Close licence settings')?.click();
    const studio = await wait(() => button('Open Design Studio'), 'Design Studio command missing');
    studio.click();
    const dialog = await wait(() => document.querySelector('[role="dialog"][aria-label="Design Studio"]'), 'Pro Design Studio did not open');
    const close = dialog.querySelector('button[title^="Close the Studio"]');
    if (!(close instanceof HTMLButtonElement)) throw new Error('Design Studio close control missing');
    close.click();
    proAction = 'design-studio-opened';
  }
  const after = await status();
  return {
    ...smoke,
    licensing: { ...smoke.licensing, channel: after.channel, state: after.state,
      edition: after.edition, proEnabled: after.edition === 'pro' },
    licenceQualification: { phase, before, after, proAction },
  };
}`;

export function nativeLicenceRendererSource(
  phase: NativeLicencePhase,
  key: string,
  licenceWindow = DESKTOP_LICENCE_WINDOW,
): string {
  return `(${QUALIFICATION_SOURCE})(${JSON.stringify(phase)}, ${JSON.stringify(key)}, ${String(licenceWindow)})`;
}
