import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RENDERER_TERMS_AGREEMENT_SOURCE } from '../../../electron/native-smoke-renderer';
import { TERMS_AGREEMENT_KEY, readTermsAgreement } from './terms-agreement';
import { TermsAgreementGate } from './TermsAgreementGate';
import type * as GeneratedTerms from './terms-text.generated';

// The first-use agreement to the terms and machine safety (ADR-564), as it
// works once the owner has published the terms with their date.
vi.mock('./terms-text.generated', async (importOriginal) => ({
  ...(await importOriginal<typeof GeneratedTerms>()),
  TERMS_LAST_UPDATED: '12 October 2026',
}));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openApp(): Promise<void> {
  await act(async () =>
    root.render(
      <TermsAgreementGate>
        <span data-testid="workspace">workspace</span>
      </TermsAgreementGate>,
    ),
  );
}

async function reopenApp(): Promise<void> {
  await act(async () => root.unmount());
  root = createRoot(host);
  await openApp();
}

const workspace = () => host.querySelector('[data-testid="workspace"]');
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const boxes = () => [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (found === undefined) throw new Error(`${name} button missing`);
  return found;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}

describe('the first-use agreement', () => {
  it('holds the app back until both the terms and machine safety are ticked', async () => {
    await openApp();
    expect(workspace()).toBeNull();
    expect(dialog()?.textContent).toContain('Before you use KerfDesk');
    expect(dialog()?.textContent).toContain('version 1.0, 12 October 2026');
    expect(boxes()).toHaveLength(2);
    expect(button('Agree and continue').disabled).toBe(true);

    await click(boxes()[0]!);
    expect(button('Agree and continue').disabled).toBe(true);
    await click(boxes()[1]!);
    await click(button('Agree and continue'));

    expect(workspace()).not.toBeNull();
    expect(dialog()).toBeNull();
    expect(readTermsAgreement(localStorage)).toMatchObject({ version: '1.0' });
    await reopenApp();
    expect(dialog()).toBeNull();
    expect(workspace()).not.toBeNull();
  });

  it('shows the whole machine-safety section with its links, and links the terms and privacy notice', async () => {
    await openApp();
    const safety = document.querySelector('section[aria-labelledby="terms-safety-heading"]');
    expect(safety?.textContent).toContain('2. MACHINE SAFETY: PLEASE READ THIS CAREFULLY');
    expect(safety?.textContent).toContain('Never leave a running machine unattended.');
    expect(safety?.textContent).toContain('2.5 Your confirmation.');
    const links = [...(dialog()?.querySelectorAll<HTMLAnchorElement>('a') ?? [])].map(
      (a) => a.href,
    );
    expect(links).toEqual(
      expect.arrayContaining([
        'https://kerfdesk.com/terms/',
        'https://kerfdesk.com/privacy/',
        'https://kerfdesk.com/machines/',
      ]),
    );
  });

  it('cannot be dismissed with Escape', async () => {
    await openApp();
    await act(async () => {
      dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(dialog()).not.toBeNull();
    expect(workspace()).toBeNull();
  });

  it('is not asked by a browser that reports it is automated', async () => {
    // jsdom has no navigator.webdriver; automated Chromium reports true.
    Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => true });
    try {
      await openApp();
      expect(dialog()).toBeNull();
      expect(workspace()).not.toBeNull();
    } finally {
      Reflect.deleteProperty(navigator, 'webdriver');
    }
  });

  // Nothing can be running or unsaved before the app opens, so closing the
  // desktop window at this point closes it without the "controls unavailable"
  // warning that an unanswered close request brings up.
  it('answers the desktop close request while it holds the app back', async () => {
    await openApp();
    const respond = vi.fn();
    const request = new CustomEvent('kerfdesk:desktop-close', {
      cancelable: true,
      detail: { operation: 'prepare', requestId: 1, respond },
    });
    await act(async () => {
      window.dispatchEvent(request);
    });
    expect(request.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ status: 'ready', dirty: false }));
  });

  // The packaged desktop smoke (electron/native-smoke.ts) starts on a new
  // profile and must get past this step to import and save.
  it('lets the packaged smoke agree the way a new user does', async () => {
    await openApp();
    // The smoke drives the page the way a person does, with no act() around it.
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false);
    const agreeLikeTheSmoke = (0, eval)(RENDERER_TERMS_AGREEMENT_SOURCE) as (
      delay: (ms: number) => Promise<void>,
    ) => Promise<string>;
    const result = await agreeLikeTheSmoke(
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    );
    expect(result).toBe('agreed');
    expect(workspace()).not.toBeNull();
  });
});

describe('a later version that reduces rights', () => {
  beforeEach(() => {
    localStorage.setItem(
      TERMS_AGREEMENT_KEY,
      JSON.stringify({ version: '0.9', agreedAt: '2026-01-01T00:00:00.000Z' }),
    );
  });

  it('is offered over the open app, and keeping the earlier terms is remembered', async () => {
    await openApp();
    expect(workspace()).not.toBeNull();
    expect(dialog()?.textContent).toContain('Our terms have changed');
    await click(button('Keep my earlier terms'));
    expect(dialog()).toBeNull();
    expect(readTermsAgreement(localStorage)).toMatchObject({ version: '0.9', keptEarlier: '1.0' });
    await reopenApp();
    expect(dialog()).toBeNull();
  });

  it('records agreement to the new version', async () => {
    await openApp();
    await click(button('I agree to the new terms'));
    expect(dialog()).toBeNull();
    expect(readTermsAgreement(localStorage)).toMatchObject({ version: '1.0' });
    expect(readTermsAgreement(localStorage)?.keptEarlier).toBeUndefined();
  });
});
