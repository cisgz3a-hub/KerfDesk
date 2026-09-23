import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { fileCommands } from '../commands/command-families';
import type { AppCommandContext } from '../commands/command-types';
import { Toolbar } from './Toolbar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The packaged desktop smoke (electron/native-smoke.ts) drives the real app
// by accessible name: it clicks "Import..." and "Save As...", opening
// "More commands" first when a command is not a primary toolbar button. That
// smoke runs weekly on a packaged build, so a relabel or a regrouping that
// hides one of these commands used to surface only there, a week later (it
// did: #797 moved Save As into More and the smoke went red). This pins the
// same contract in the fast suite, with the real command registry.

const SMOKE_COMMANDS = [
  ['Import...', 'importArtwork'],
  ['Save As...', 'saveProjectAs'],
] as const;

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('toolbar commands the packaged desktop smoke drives', () => {
  it.each(SMOKE_COMMANDS)(
    'reaches %s by accessible name, through More when it is not primary',
    async (label, handler) => {
      const calls: string[] = [];
      const context = new Proxy(
        {},
        {
          get: (_target, key) =>
            key === 'machineKind'
              ? 'laser'
              : () => {
                  calls.push(String(key));
                  return Promise.resolve(true);
                },
        },
      ) as AppCommandContext;
      await renderToolbar(fileCommands(context));

      const button = await smokeCommandButton(label);
      await act(async () => button.click());

      expect(calls).toContain(handler);
    },
  );
});

/** The smoke's own strategy (electron/native-smoke.ts), in test form. It
 * searches the whole document, as the smoke does: More may render its items
 * outside the toolbar element. */
async function smokeCommandButton(label: string): Promise<HTMLButtonElement> {
  const find = (name: string): HTMLButtonElement | undefined =>
    [...document.querySelectorAll('button')].find(
      (candidate) => candidate.getAttribute('aria-label') === name,
    );
  let match = find(label);
  if (match === undefined) {
    const more = find('More commands');
    if (more !== undefined) {
      await act(async () => more.click());
      match = find(label);
    }
  }
  if (match === undefined) throw new Error(`${label} button missing`);
  return match;
}

async function renderToolbar(commands: ReturnType<typeof fileCommands>): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<Toolbar commands={commands} machineKind="laser" />);
  });
  cleanup = async () => {
    if (root !== null) await act(async () => root?.unmount());
    host.remove();
  };
  return host;
}
