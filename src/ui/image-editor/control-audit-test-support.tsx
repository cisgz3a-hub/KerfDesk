import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach } from 'vitest';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ unmount: () => void; host: HTMLElement }> = [];
afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.unmount());
    entry.host.remove();
  }
});

export async function mountControl(node: ReactNode): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ unmount: () => root.unmount(), host });
  await act(async () => root.render(node));
  return host;
}

export function control(host: ParentNode, name: string): HTMLButtonElement {
  const result = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) =>
      button.getAttribute('aria-label') === name ||
      button.title === name ||
      button.textContent?.trim() === name,
  );
  if (!result) throw new Error(`Control missing: ${name}`);
  return result;
}

export async function clickControl(host: ParentNode, name: string): Promise<void> {
  await act(async () => control(host, name).click());
}

export async function clickElement(element: HTMLElement | null): Promise<void> {
  if (!element) throw new Error('Audit target missing');
  await act(async () => element.click());
}
