import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '../kit/Dialog';

type ControlState = 'available' | 'removed' | 'disabled';
const roots: Root[] = [];

function Recovery(props: { readonly state: ControlState; readonly onClose?: () => void }) {
  return (
    <Dialog ariaLabel="Recovery" onClose={props.onClose ?? (() => undefined)}>
      <input aria-label="First" />
      <input aria-label="Second" />
      {props.state === 'removed' ? null : (
        <button type="button" disabled={props.state === 'disabled'}>
          Changing control
        </button>
      )}
    </Dialog>
  );
}

function Stack(props: {
  readonly lower: boolean;
  readonly upper: boolean;
  readonly state: ControlState;
}) {
  return (
    <>
      {props.lower ? <Recovery key="lower" state={props.state} /> : null}
      {props.upper ? (
        <Dialog key="upper" ariaLabel="Upper" onClose={() => undefined}>
          <input aria-label="Upper input" />
        </Dialog>
      ) : null}
    </>
  );
}

function PendingForm() {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      ariaLabel="Form"
      as="form"
      onClose={() => undefined}
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
      }}
    >
      <input aria-label="Form input" />
      <button type="submit" disabled={busy}>
        Submit
      </button>
    </Dialog>
  );
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout; native focus and tab order are qualified separately.
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.isConnected && !this.closest('[hidden]') ? this.parentElement : null;
  });
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
async function mount(element: JSX.Element) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(element));
  return root;
}
function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`Missing focus fixture: ${selector}`);
  return found;
}
async function focus(selector: string) {
  await act(async () => element(selector).focus());
}
async function escapeFromActive() {
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
}

describe('dialog focus recovery', () => {
  it.each(['removed', 'disabled'] as const)(
    'recovers a focused control that is %s',
    async (state) => {
      const root = await mount(<Recovery state="available" />);
      await focus('button');
      await act(async () => root.render(<Recovery state={state} />));
      expect(document.activeElement).toBe(element('[aria-label="First"]'));
    },
  );

  it('preserves deliberate focus through unrelated control removal and rerenders', async () => {
    const root = await mount(<Recovery state="available" />);
    await focus('button');
    await focus('[aria-label="Second"]');
    await act(async () => root.render(<Recovery state="removed" />));
    expect(document.activeElement).toBe(element('[aria-label="Second"]'));
  });

  it('uses the latest close callback when Escape originates from recovered focus', async () => {
    const original = vi.fn(),
      latest = vi.fn();
    const root = await mount(<Recovery state="available" onClose={original} />);
    await focus('button');
    await act(async () => root.render(<Recovery state="removed" onClose={latest} />));
    await escapeFromActive();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(original).not.toHaveBeenCalled();
  });

  it('retains normal form submission while recovering its newly disabled submit button', async () => {
    await mount(<PendingForm />);
    await focus('button');
    await act(async () => element('button').click());
    expect(element('button').matches(':disabled')).toBe(true);
    expect(document.activeElement).toBe(element('[aria-label="Form input"]'));
  });

  it('does not steal focus from a newer modal when the lower control disappears', async () => {
    const root = await mount(<Stack lower upper={false} state="available" />);
    await focus('button');
    await act(async () => root.render(<Stack lower upper state="available" />));
    await act(async () => root.render(<Stack lower upper state="removed" />));
    expect(document.activeElement).toBe(element('[aria-label="Upper input"]'));
  });

  it('does not restore the lower opener through a still-active upper modal', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const root = await mount(<Stack lower upper state="available" />);
    await act(async () => root.render(<Stack lower={false} upper state="available" />));
    expect(document.activeElement).toBe(element('[aria-label="Upper input"]'));
  });

  it('restores the lower control when the upper modal closes', async () => {
    const root = await mount(<Stack lower upper={false} state="available" />);
    await focus('[aria-label="Second"]');
    await act(async () => root.render(<Stack lower upper state="available" />));
    await act(async () => root.render(<Stack lower upper={false} state="available" />));
    expect(document.activeElement).toBe(element('[aria-label="Second"]'));
  });

  it('returns focus to the connected opener when the entire dialog is removed', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const root = await mount(<Recovery state="available" />);
    await focus('[role="dialog"] button');
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
  });

  it('does not attempt to focus an opener removed during the dialog lifetime', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const root = await mount(<Recovery state="available" />);
    const restore = vi.spyOn(opener, 'focus');
    opener.remove();
    await act(async () => root.render(null));
    expect(restore).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });
});
