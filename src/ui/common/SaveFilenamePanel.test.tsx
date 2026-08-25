import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requestSaveFilename, useSaveFilenameStore } from '../state/save-filename-store';
import { useUiStore } from '../state/ui-store';
import { SaveFilenamePanel } from './SaveFilenamePanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<SaveFilenamePanel />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useSaveFilenameStore.setState({ queue: [], nextSequence: 1 });
  useUiStore.setState({ modalDepth: 0 });
});

describe('SaveFilenamePanel', () => {
  it('keeps the filename editable without registering a blocking modal', async () => {
    let result: Promise<string | null>;
    await act(async () => {
      result = requestSaveFilename('project.gcode');
    });

    const panel = host.querySelector('[role="dialog"]');
    const input = host.querySelector<HTMLInputElement>('input[aria-label="G-code file name"]');
    expect(panel?.getAttribute('aria-modal')).toBeNull();
    expect(input?.value).toBe('project.gcode');
    expect(document.activeElement).toBe(input);
    expect(useUiStore.getState().modalDepth).toBe(0);

    await act(async () => {
      if (input === null) throw new Error('filename input missing');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'six-badges.nc');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      buttonByText('Save').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await expect(result!).resolves.toBe('six-badges.nc');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('queues overlapping save names instead of replacing either request', async () => {
    let first: Promise<string | null>;
    let second: Promise<string | null>;
    await act(async () => {
      first = requestSaveFilename('first.gcode');
      second = requestSaveFilename('second.gcode');
    });

    expect(filenameInput().value).toBe('first.gcode');
    await act(async () => {
      buttonByText('Save').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(first!).resolves.toBe('first.gcode');
    expect(filenameInput().value).toBe('second.gcode');

    await act(async () => {
      buttonByText('Cancel').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(second!).resolves.toBeNull();
  });
});

function filenameInput(): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="G-code file name"]');
  if (input === null) throw new Error('filename input missing');
  return input;
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button "${text}" missing`);
  return button;
}
