import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';

/** Open the same native disclosure an operator uses before editing its controls. */
export async function openSetupDisclosure(host: HTMLElement, title: string): Promise<void> {
  const summary = [...host.querySelectorAll('summary')].find((candidate) =>
    candidate.textContent?.startsWith(title),
  );
  const details = summary?.parentElement;
  if (!(summary instanceof HTMLElement) || !(details instanceof HTMLDetailsElement)) {
    throw new Error(`Setup disclosure missing: ${title}`);
  }
  if (!details.open) await act(async () => summary.click());
}

export async function changeSetupSelect(
  host: HTMLElement,
  ariaLabel: string,
  value: string,
): Promise<void> {
  const field = setupSelect(host, ariaLabel);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}

export function setupSelect(host: HTMLElement, ariaLabel: string): HTMLSelectElement {
  const field = host.querySelector(`select[aria-label="${ariaLabel}"]`);
  if (!(field instanceof HTMLSelectElement)) throw new Error(`Select missing: ${ariaLabel}`);
  return field;
}

export async function changeSetupInput(
  host: HTMLElement,
  ariaLabel: string,
  value: string,
): Promise<void> {
  const field = setupInput(host, ariaLabel);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
}

export function setupInput(host: HTMLElement, ariaLabel: string): HTMLInputElement {
  const field = host.querySelector(`input[aria-label="${ariaLabel}"]`);
  if (!(field instanceof HTMLInputElement)) throw new Error(`Input missing: ${ariaLabel}`);
  return field;
}
