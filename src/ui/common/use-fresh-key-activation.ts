// Lets a focused button act only on a key press made for what it says now.
//
// Pause becomes Pausing… then Resume in one focused button (ADR-207 Amendment
// 2), and Frame job hands focus back as Frame again. Chromium clicks a focused
// button on every auto-repeated Enter keypress, so a held Enter paused a job
// and resumed it as soon as Resume showed (rolling audit v10 V8-P2-1). The
// button keeps focus; a held key just stops pressing it. An auto-repeat, a
// second key while one is down, and a Space released after the button changed
// meaning are cancelled before the browser turns them into a click. A mouse
// click is untouched.

import { useRef, type FocusEvent, type KeyboardEvent } from 'react';

export type ActivationPress = { readonly key: string; readonly meaning: string };

type KeyStep = { readonly held: ActivationPress | null; readonly cancel: boolean };
type KeyFacts = { readonly key: string; readonly repeat: boolean };

// The keys a browser turns into a button click: Enter on keydown/keypress,
// Space on keyup.
const ACTIVATION_KEYS: ReadonlySet<string> = new Set(['Enter', ' ']);

export function freshActivationKeyDown(
  held: ActivationPress | null,
  event: KeyFacts,
  meaning: string,
): KeyStep {
  if (!ACTIVATION_KEYS.has(event.key)) return { held, cancel: false };
  // Cancelling keydown stops the keypress, so Enter never clicks.
  if (event.repeat || held !== null) return { held, cancel: true };
  return { held: { key: event.key, meaning }, cancel: false };
}

export function freshActivationKeyUp(
  held: ActivationPress | null,
  event: KeyFacts,
  meaning: string,
): KeyStep {
  if (!ACTIVATION_KEYS.has(event.key)) return { held, cancel: false };
  if (held === null || held.key !== event.key) {
    // A Space whose press this button refused, or never saw, clicks nothing.
    return { held, cancel: event.key === ' ' };
  }
  // Space clicks on release: refuse it if the button now means something else.
  return { held: null, cancel: held.meaning !== meaning };
}

export type FreshKeyActivationHandlers = {
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onKeyUp: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onBlur: (event: FocusEvent<HTMLElement>) => void;
};

/** `meaning` names what a click does now (its label, and whether it is off). */
export function useFreshKeyActivation(meaning: string): FreshKeyActivationHandlers {
  const held = useRef<ActivationPress | null>(null);
  const apply = (event: KeyboardEvent<HTMLElement>, step: KeyStep): void => {
    held.current = step.held;
    if (step.cancel) event.preventDefault();
  };
  return {
    onKeyDown: (event) => apply(event, freshActivationKeyDown(held.current, event, meaning)),
    onKeyUp: (event) => apply(event, freshActivationKeyUp(held.current, event, meaning)),
    // A key released elsewhere (another window, focus moved) never comes back.
    onBlur: () => {
      held.current = null;
    },
  };
}
