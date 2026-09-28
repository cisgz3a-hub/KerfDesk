import { act } from 'react';
import { expect } from 'vitest';
import type { FileHandle } from '../../platform/types';

export function chosenImageHandle(name = 'a.png'): FileHandle {
  return { name, blob: async () => new File([new Uint8Array([1])], name) } as unknown as FileHandle;
}

/** Choose images, then press Trace: each picker opens inside its own click. */
export async function chooseImagesAndTrace(): Promise<void> {
  const button = (text: string): HTMLButtonElement => {
    const found = [...document.querySelectorAll('button')].find((b) => b.textContent === text);
    if (found === undefined) throw new Error(`No ${text} button.`);
    return found;
  };
  act(() => button('Choose Images...').click());
  await settlePicker();
  expect(button('Trace...').disabled).toBe(false);
  act(() => button('Trace...').click());
}

/** Let a picker's promise chain resolve, then render its result. */
export async function settlePicker(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
