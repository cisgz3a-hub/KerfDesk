import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '../kit/Dialog';
import { MODAL_REACHABLE_ATTRIBUTE } from './hide-outside-modal';
import { dialogTabStops } from './use-dialog-a11y';

// UX audit U7: the first-visit welcome dialog mounted behind the inert start-up
// splash with focus nowhere (U7-P2-2), and Job Review's Tab cycle skipped its
// warning summaries (U7-P2-3).

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.isConnected && this.closest('[hidden]') === null ? this.parentElement : null;
  });
  // jsdom focuses inside an inert tree; a browser does not.
  const focus = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions,
  ) {
    if (this.closest('[inert]') === null) focus.call(this, options);
  });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function Workspace(props: { readonly dialog: JSX.Element | null }): JSX.Element {
  return (
    <div className="lf-app-shell">
      <nav>
        <button type="button">Open...</button>
      </nav>
      <section aria-label="Live Motion" {...{ [MODAL_REACHABLE_ATTRIBUTE]: '' }}>
        <button type="button">ABORT JOB</button>
      </section>
      {props.dialog}
    </div>
  );
}

async function mount(node: JSX.Element, inert = false): Promise<HTMLElement> {
  const appRoot = document.createElement('div');
  appRoot.id = 'app-root';
  if (inert) appRoot.setAttribute('inert', '');
  document.body.appendChild(appRoot);
  await act(async () => {
    root = createRoot(appRoot);
    root.render(node);
  });
  return appRoot;
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function welcome(onClose: () => void): JSX.Element {
  return (
    <Dialog ariaLabel="Choose your KerfDesk workspace" initialFocus="surface" onClose={onClose}>
      <button type="button">Continue with Free</button>
      <button type="button">Download</button>
    </Dialog>
  );
}

describe('a dialog that mounts behind the start-up splash (U7-P2-2)', () => {
  it('takes focus when the splash releases the app', async () => {
    const appRoot = await mount(<Workspace dialog={welcome(() => undefined)} />, true);
    const dialog = appRoot.querySelector<HTMLElement>('[role="dialog"]');
    expect(document.activeElement).toBe(document.body);

    await act(async () => {
      appRoot.removeAttribute('inert');
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(dialog);
  });

  it('keeps Tab inside the dialog and closes on Escape when focus is on <body>', async () => {
    const onClose = vi.fn();
    await mount(<Workspace dialog={welcome(onClose)} />);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(document.activeElement).toBe(document.body);

    const tab = press(document.body, 'Tab');
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement?.textContent).toBe('Continue with Free');

    act(() => (document.activeElement as HTMLElement | null)?.blur());
    press(document.body, 'Tab', { shiftKey: true });
    expect(document.activeElement?.textContent).toBe('Download');

    act(() => (document.activeElement as HTMLElement | null)?.blur());
    press(document.body, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides the workspace from assistive technology but not the Live Motion bar', async () => {
    const appRoot = await mount(<Workspace dialog={welcome(() => undefined)} />);
    expect(appRoot.querySelector('nav')?.getAttribute('aria-hidden')).toBe('true');
    expect(appRoot.querySelector('[aria-label="Live Motion"]')?.hasAttribute('aria-hidden')).toBe(
      false,
    );
    expect(appRoot.querySelector('[role="dialog"]')?.hasAttribute('aria-hidden')).toBe(false);

    await act(async () => root?.render(<Workspace dialog={null} />));
    expect(appRoot.querySelector('nav')?.hasAttribute('aria-hidden')).toBe(false);
  });
});

describe('summary rows in a dialog Tab cycle (U7-P2-3)', () => {
  function review(): JSX.Element {
    return (
      <Dialog title="Job Review" initialFocus="surface" onClose={() => undefined}>
        <details>
          <summary>Operation uses uncalibrated defaults</summary>
          <p>Run a material test on scrap before burning final material.</p>
        </details>
        <details>
          <summary>Check the bed position at the machine</summary>
          <details>
            <summary>Hidden nested row</summary>
          </details>
        </details>
        <button type="button">Edit</button>
        <button type="button">Start job</button>
      </Dialog>
    );
  }

  it('reaches every warning summary, and Shift+Tab wraps to the first', async () => {
    const appRoot = await mount(<Workspace dialog={review()} />);
    const dialog = appRoot.querySelector<HTMLElement>('[role="dialog"]');
    expect(document.activeElement).toBe(dialog);
    // A summary inside a closed <details> is not rendered, so it is no stop.
    expect(dialogTabStops(dialog as HTMLElement).map((stop) => stop.textContent)).toEqual([
      'Operation uses uncalibrated defaults',
      'Check the bed position at the machine',
      'Edit',
      'Start job',
    ]);

    press(dialog as HTMLElement, 'Tab');
    expect(document.activeElement?.textContent).toBe('Operation uses uncalibrated defaults');

    // The browser walks between the edges; the trap wraps at them.
    act(() => appRoot.querySelectorAll<HTMLElement>('button')[3]?.focus());
    expect(document.activeElement?.textContent).toBe('Start job');
    press(document.activeElement as HTMLElement, 'Tab');
    expect(document.activeElement?.textContent).toBe('Operation uses uncalibrated defaults');

    press(document.activeElement as HTMLElement, 'Tab', { shiftKey: true });
    expect(document.activeElement?.textContent).toBe('Start job');
  });
});
