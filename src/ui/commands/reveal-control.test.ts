// "Show me" Connect on a K40, Moshiboard or Ruida profile (ADR-703 Amendment 1,
// code quality audit C2 D6-P2-3): the link's Connect lives in the closed
// Machine details popover, so the reveal opens it and lands on that Connect,
// not on the serial Connect a link profile leaves disabled.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControllerKind } from '../../core/devices';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { findRevealControl, MACHINE_DETAILS_OPENER } from './reveal-control';

function shown<T extends HTMLElement>(element: T): T {
  // jsdom lays nothing out; a rendered control has client rects.
  Object.defineProperty(element, 'getClientRects', { value: () => [{}] });
  return element;
}

function connectButton(label: string, disabled: boolean): HTMLButtonElement {
  const button = shown(document.createElement('button'));
  button.dataset['searchTarget'] = 'connect';
  button.disabled = disabled;
  button.textContent = label;
  return button;
}

/** The serial Connect (disabled on a link profile) and the details trigger,
 *  which renders the link panel's Connect when it opens. */
function toolbar(): { serial: HTMLButtonElement; opener: HTMLButtonElement } {
  const serial = connectButton('Connect', true);
  const opener = shown(document.createElement('button'));
  opener.dataset['searchOpener'] = MACHINE_DETAILS_OPENER;
  opener.setAttribute('aria-expanded', 'false');
  opener.addEventListener('click', () => {
    opener.setAttribute('aria-expanded', 'true');
    document.body.append(connectButton('Connect K40', false));
  });
  document.body.append(serial, opener);
  return { serial, opener };
}

function withController(controllerKind: ControllerKind): void {
  const project = useStore.getState().project;
  useStore.setState({ project: { ...project, device: { ...project.device, controllerKind } } });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  resetStore();
});

describe('findRevealControl', () => {
  it('opens Machine details on a K40 profile and lands on the link Connect', () => {
    withController('lihuiyu');
    const { opener } = toolbar();
    const done = vi.fn();
    findRevealControl('connect', 50, done);
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    vi.advanceTimersByTime(50);
    expect(done).toHaveBeenCalledWith(
      expect.objectContaining({ textContent: 'Connect K40', disabled: false }),
    );
  });

  it('leaves Machine details shut on a serial profile', () => {
    withController('grbl-v1.1');
    const { serial, opener } = toolbar();
    const done = vi.fn();
    findRevealControl('connect', 50, done);
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    expect(done).toHaveBeenCalledWith(serial);
  });

  it('prefers a visible, enabled copy of a control', () => {
    const hidden = document.createElement('button');
    hidden.dataset['searchTarget'] = 'frame-job';
    const disabled = connectButton('Frame', true);
    disabled.dataset['searchTarget'] = 'frame-job';
    const usable = connectButton('Frame', false);
    usable.dataset['searchTarget'] = 'frame-job';
    document.body.append(hidden, disabled, usable);
    const done = vi.fn();
    findRevealControl('frame-job', 50, done);
    expect(done).toHaveBeenCalledWith(usable);
  });
});
