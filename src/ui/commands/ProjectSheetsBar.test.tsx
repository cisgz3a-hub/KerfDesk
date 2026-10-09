import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { ProjectSheetsBar } from './ProjectSheetsBar';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
});
function tabs(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}

describe('canvas project sheet tabs', () => {
  it('adds blank sheets directly and keeps their visible positions while keyboard navigation switches artwork', async () => {
    await act(async () => root.render(<ProjectSheetsBar />));
    const add = host.querySelector('[aria-label="Add blank project sheet"]') as HTMLButtonElement;
    await act(async () => add.click());
    await act(async () => add.click());
    expect(tabs().map((tab) => tab.textContent)).toEqual(['Sheet 1', 'Sheet 2', 'Sheet 3']);
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'true',
    ]);
    await act(async () => Simulate.keyDown(tabs()[2] as HTMLButtonElement, { key: 'ArrowLeft' }));
    expect(useStore.getState().project.sheetBook?.activeName).toBe('Sheet 2');
    expect(tabs().map((tab) => tab.textContent)).toEqual(['Sheet 1', 'Sheet 2', 'Sheet 3']);
    expect(document.activeElement).toBe(tabs()[1]);
  });
  it('renames the first sheet without creating another sheet and leaves unchanged names out of undo', async () => {
    await act(async () => root.render(<ProjectSheetsBar />));
    await act(async () =>
      (host.querySelector('[aria-label="Manage project sheets"]') as HTMLButtonElement).click(),
    );
    const name = host.querySelector('[aria-label="Active sheet name"]') as HTMLInputElement;
    await act(async () => {
      name.value = 'Front face';
      Simulate.blur(name);
    });
    expect(tabs().map((tab) => tab.textContent)).toEqual(['Front face']);
    expect(useStore.getState().project.sheetBook?.inactive).toHaveLength(0);
    expect(useStore.getState().undoStack).toHaveLength(1);
    await act(async () =>
      Simulate.blur(host.querySelector('[aria-label="Active sheet name"]') as HTMLInputElement),
    );
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});
