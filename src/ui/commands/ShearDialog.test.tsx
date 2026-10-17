import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetStore } from '../state/test-helpers';
import { openShearDialog, ShearDialogHost } from './ShearDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(async () => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<ShearDialogHost />);
  });
  await act(async () => openShearDialog());
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
});

function angleInput(label: string): HTMLInputElement {
  const input = document.body.querySelector(`input[aria-label="${label} shear angle in degrees"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  return input;
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const shearButton = (): HTMLButtonElement | undefined =>
  [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Shear');
const alertText = () => document.body.querySelector('[role="alert"]')?.textContent ?? null;

describe('Shear dialog', () => {
  it('refuses an empty angle with a message instead of reading it as 0', async () => {
    expect(shearButton()?.disabled).toBe(false);
    expect(alertText()).toBeNull();
    await type(angleInput('Vertical'), '');
    expect(shearButton()?.disabled).toBe(true);
    expect(alertText()).toMatch(/^Enter both angles in degrees/);
    await type(angleInput('Vertical'), '0');
    await type(angleInput('Horizontal'), '0');
    expect(shearButton()?.disabled).toBe(true);
    expect(alertText()).toBe('Enter a horizontal or vertical angle other than 0.');
  });
});
