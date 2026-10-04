import assert from 'node:assert/strict';
import { readResult, phonePage } from './phone-workspace-support.mjs';
import { appPage } from './workspace-ui-support.mjs';

/** Instrumented read-only browser fixture. No desktop, machine or provider is contacted. */
export function readWitness(state) {
  const holds = new Map();
  let active = 0,
    maximum = 0;
  state.readHook = async (name, args) => {
    const result = readResult(state, name, args);
    if (!result) return null;
    active++;
    maximum = Math.max(maximum, active);
    try {
      const held = holds.get(name);
      if (held && !held.admitted) {
        held.admitted = true;
        held.result = structuredClone(result);
        held.notify();
        await held.wait;
        return { result: held.result };
      }
      return { result };
    } finally {
      active--;
    }
  };
  return {
    hold(name) {
      let resolve, notify;
      const wait = new Promise((done) => {
        resolve = done;
      });
      const admitted = new Promise((done, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Read fixture did not receive ' + name + ' within 10 seconds.')),
          10000,
        );
        notify = () => {
          clearTimeout(timeout);
          done();
        };
      });
      const entry = { resolve, notify, wait, admitted: false };
      holds.set(name, entry);
      return {
        admitted,
        release() {
          holds.delete(name);
          resolve();
        },
      };
    },
    get active() {
      return active;
    },
    get maximum() {
      return maximum;
    },
  };
}

export async function loadLive(browser, kind, state, width = 390) {
  const loaded =
    kind === 'phone'
      ? await phonePage(browser, state, width, { clock: true })
      : await appPage(browser, state, width, { clock: true });
  loaded.surface = kind === 'phone' ? loaded.page : loaded.frame;
  loaded.image = kind === 'phone' ? '#workspace-preview' : '#preview';
  loaded.items = kind === 'phone' ? '#artwork-list' : '#items';
  return loaded;
}

export const count = (state, name) => state.commands.filter((item) => item.name === name).length;
export async function tick(loaded, ms = 5001) {
  await loaded.page.clock.runFor(ms);
  await loaded.surface
    .locator('#live-status')
    .filter({ hasText: /Live|paused|waiting|unavailable|offline|Not connected/ })
    .waitFor();
}
export async function lifecycle(surface, name) {
  await surface.evaluate(
    (value) => globalThis.dispatchEvent(new globalThis.PageTransitionEvent(value)),
    name,
  );
}
export async function visibility(surface, hidden) {
  await surface.evaluate((value) => {
    Object.defineProperty(globalThis.document, 'hidden', { configurable: true, value });
    globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange'));
  }, hidden);
}
export async function assertNoOverflow(surface) {
  assert.equal(
    await surface.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.document.documentElement.clientWidth,
    ),
    true,
  );
}
