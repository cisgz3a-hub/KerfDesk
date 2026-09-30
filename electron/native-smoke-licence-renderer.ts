import type { NativeLicencePhase } from './native-smoke-licence-config.js';
import { RENDERER_SMOKE_SOURCE } from './native-smoke-renderer.js';

// Fixed UI actions only: no arbitrary script input, entitlement override or
// response substitution. The key exists only in this evaluated call's memory.
const QUALIFICATION_SOURCE = String.raw`async (phase, key) => {
  const smoke = await ${RENDERER_SMOKE_SOURCE};
  if (location.href !== 'app://app/index.html') throw new Error('Qualification requires the packaged app');
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
  const before = await status();
  let proAction = 'not-requested';
  if (phase === 'activate') {
    if (!isFree(before)) throw new Error('Activation qualification requires an initially Free profile');
    await openLicence();
    const input = await wait(() => document.getElementById('kerfdesk-licence-key'), 'Licence input missing');
    if (!(input instanceof HTMLInputElement) || input.type !== 'password') throw new Error('Licence input is not private');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, key);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const activate = await wait(() => { const b = button('Activate licence'); return b && !b.disabled ? b : null; }, 'Activation control unavailable');
    activate.click();
    key = '';
    await wait(async () => isDeveloper(await status()), 'Developer activation was not observed');
  } else if (phase === 'offline') {
    if (!isDeveloper(before)) throw new Error('Offline restart did not retain developer Pro');
  } else if (phase === 'deactivate') {
    if (!isFree(before)) {
      if (!isDeveloper(before) && before.deactivationPending !== true) throw new Error('Unexpected licence before cleanup');
      await openLicence();
      const release = await wait(() => button('Deactivate this device') || button('Retry device deactivation'), 'Deactivation control missing');
      release.click();
      await wait(async () => isFree(await status()), 'Device deactivation was not confirmed');
    }
  } else throw new Error('Unknown qualification phase');
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

export function nativeLicenceRendererSource(phase: NativeLicencePhase, key: string): string {
  return `(${QUALIFICATION_SOURCE})(${JSON.stringify(phase)}, ${JSON.stringify(key)})`;
}
