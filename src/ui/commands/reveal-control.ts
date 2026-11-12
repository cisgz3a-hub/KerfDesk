// Finds and focuses the control a search result or a guide step points at.
// Frame and Start also sit in the docked job bar, so a visible, enabled copy
// wins. A K40, Moshiboard or Ruida link's Connect sits in the Machine details
// popover, which renders nothing while closed: when the profile drives such a
// link, "Show me" opens the popover first (ADR-703 Amendment 1, code quality
// audit C2 D6-P2-3).

import { selectControllerDriver } from '../../core/controllers';
import { useStore } from '../state';

/** The trigger that opens Machine details carries this attribute. */
export const MACHINE_DETAILS_OPENER = 'machine-details';

const OPEN_RETRIES = 15;

export type RevealOutcome = (control: HTMLElement | null) => void;

/** Calls `done` with the control to focus, opening the popover that holds it
 *  first when needed; `delayMs` spaces the retries while its panel loads. */
export function findRevealControl(target: string, delayMs: number, done: RevealOutcome): void {
  const opener = closedOpenerFor(target);
  if (opener === null || usableControl(target) !== null) {
    done(bestControl(target));
    return;
  }
  opener.click();
  waitForUsableControl(target, delayMs, OPEN_RETRIES, done);
}

function waitForUsableControl(
  target: string,
  delayMs: number,
  retries: number,
  done: RevealOutcome,
): void {
  window.setTimeout(() => {
    if (usableControl(target) === null && retries > 0) {
      waitForUsableControl(target, delayMs, retries - 1, done);
      return;
    }
    done(bestControl(target));
  }, delayMs);
}

function controlsFor(target: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-search-target="${target}"]`)];
}

function visible(control: HTMLElement): boolean {
  return control.getClientRects().length > 0;
}

function usableControl(target: string): HTMLElement | null {
  return (
    controlsFor(target).find(
      (control) => visible(control) && !(control instanceof HTMLButtonElement && control.disabled),
    ) ?? null
  );
}

function bestControl(target: string): HTMLElement | null {
  const controls = controlsFor(target);
  return usableControl(target) ?? controls.find(visible) ?? controls[0] ?? null;
}

function closedOpenerFor(target: string): HTMLElement | null {
  if (target !== 'connect' || !linkConnectInMachineDetails()) return null;
  const opener = document.querySelector<HTMLElement>(
    `[data-search-opener="${MACHINE_DETAILS_OPENER}"]`,
  );
  return opener === null || opener.getAttribute('aria-expanded') === 'true' ? null : opener;
}

function linkConnectInMachineDetails(): boolean {
  const driver = selectControllerDriver(useStore.getState().project.device.controllerKind);
  return driver.usbLink !== undefined || driver.datagramNetwork !== undefined;
}
