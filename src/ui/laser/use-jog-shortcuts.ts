import { useEffect } from 'react';
import type { JogAxisSigns } from '../../core/devices/jog-direction';
import { isEditableShortcutTarget, isScrollRegionTarget } from '../common/keyboard-targets';
import { isModalOpen, useUiStore } from '../state/ui-store';
import { stepJogVector, type JogVector } from './jog-control-policy';
import { keyboardJogDirection } from './jog-keyboard-map';

// Bare arrow keys are reserved for nudging the selected canvas object. They used
// to ALSO jog the machine, so with the rail connected and a shape selected one
// press both nudged the artwork and lurched the head across the bed (F104).
// Keyboard machine jog therefore uses keys the canvas never binds: PageUp /
// PageDown for Z focus, and LightBurn's Move-window keys for XY (ADR-483,
// jog-keyboard-map.ts): Ctrl/Cmd+Alt+[ / ] and Ctrl/Cmd+Shift+] / [, and the
// keypad digits with NumLock on.
const FOCUS_JOG_KEYS: Readonly<Record<string, 1 | -1>> = {
  PageUp: 1,
  PageDown: -1,
};

/** The jog pad's current step, feed, and origin signs, read at key time. */
export type XyJogStep = {
  readonly stepMm: number;
  readonly feed: number;
  readonly signs: JogAxisSigns;
};

type JogShortcutArgs = {
  readonly focusDisabled: () => boolean;
  readonly onFocusJog: (direction: 1 | -1) => void;
  readonly xyDisabled: () => boolean;
  readonly xyStep: () => XyJogStep;
  readonly onXyJog: (vector: JogVector) => void;
};

export function installJogShortcuts(target: Window, args: JogShortcutArgs): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isMachineJogCandidate(event)) return;
    const focusDirection = focusJogDirection(event);
    if (focusDirection !== undefined) {
      if (args.focusDisabled()) return;
      event.preventDefault();
      args.onFocusJog(focusDirection);
      return;
    }
    // XY keys are one step per press, like the jog pad's arrow click, and the
    // vector is built exactly as the arrow's (ADR-483): same physical
    // direction, origin signs, step, and clamped feed.
    const direction = keyboardJogDirection(event);
    if (direction === null || args.xyDisabled()) return;
    event.preventDefault();
    const { stepMm, feed, signs } = args.xyStep();
    args.onXyJog(stepJogVector(direction, stepMm, signs, feed));
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}

// One step per press (auto-repeat never streams jogs), and never while a
// modal owns the keyboard (the image editor's bare [ / ] resize its brush) or
// a text field is typing. A focused scroll region keeps its native Page-key
// scrolling and list typeahead, and a key a closer handler already consumed is
// not also a machine move.
function isMachineJogCandidate(event: KeyboardEvent): boolean {
  if (event.repeat || event.defaultPrevented) return false;
  if (isModalOpen(useUiStore.getState())) return false;
  return !isEditableShortcutTarget(event.target) && !isScrollRegionTarget(event.target);
}

function focusJogDirection(event: KeyboardEvent): 1 | -1 | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return undefined;
  return FOCUS_JOG_KEYS[event.key];
}

export function useJogShortcuts(args: {
  readonly focusDisabled: boolean;
  readonly onFocusJog: (direction: 1 | -1) => void;
  readonly xyDisabled: boolean;
  readonly xyStep: XyJogStep;
  readonly onXyJog: (vector: JogVector) => void;
}): void {
  const { focusDisabled, onFocusJog, xyDisabled, onXyJog } = args;
  const { stepMm, feed, signs } = args.xyStep;
  useEffect(
    () =>
      installJogShortcuts(window, {
        focusDisabled: () => focusDisabled,
        onFocusJog,
        xyDisabled: () => xyDisabled,
        xyStep: () => ({ stepMm, feed, signs }),
        onXyJog,
      }),
    [focusDisabled, onFocusJog, xyDisabled, onXyJog, stepMm, feed, signs],
  );
}
