import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { fixtureState, renderFixture } from '../state/variable-array-test-fixture';
import { ArrayDialogHost } from './ArrayDialogHost';

const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('../text/render-variable-text', () => ({
  renderVariableText: (input: unknown) => mocks.render(input),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
const initial = useStore.getState();

beforeEach(() => {
  useStore.setState(fixtureState());
  mocks.render.mockReset().mockImplementation(renderFixture);
});
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  useStore.setState(initial, true);
});

async function mount(): Promise<ReturnType<typeof vi.fn>> {
  const close = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<ArrayDialogHost onClose={close} />));
  return close;
}
function button(text: string): HTMLButtonElement {
  const found = [...host!.querySelectorAll('button')].find((button) => button.textContent === text);
  if (found === undefined) throw new Error('Missing button ' + text);
  return found;
}
async function selectDistinct(): Promise<void> {
  const label = [...host!.querySelectorAll('label')].find((label) =>
    label.textContent?.includes('Advance variables per copy'),
  );
  const input = label?.querySelector('input');
  if (input === undefined || input === null) throw new Error('Missing per-copy variable option');
  expect(input.checked).toBe(false);
  await act(async () => {
    input.checked = true;
    Simulate.change(input);
  });
}
async function columns(value: string): Promise<void> {
  const label = [...host!.querySelectorAll('label')].find(
    (label) => label.textContent === 'Columns',
  );
  const input = label?.querySelector('input');
  if (input === undefined || input === null) throw new Error('Missing columns');
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}
async function submit(): Promise<void> {
  const form = host!.querySelector('form');
  if (form === null) throw new Error('Missing form');
  await act(async () => Simulate.submit(form));
}

describe('visible per-copy variable array workflow', () => {
  it.each(['Circular', 'Point Rotation'])(
    'creates distinct records through the %s dialog',
    async (mode) => {
      const close = await mount();
      await act(async () => Simulate.click(button(mode)));
      await selectDistinct();
      expect(host!.textContent).toContain('overlap');
      await submit();
      expect(close).toHaveBeenCalledOnce();
      const texts = useStore.getState().project.scene.objects;
      expect(texts).toHaveLength(18);
      expect(
        texts
          .filter((_, index) => index % 3 === 0)
          .map((object) => (object.kind === 'text' ? object.content.slice(-3) : '')),
      ).toEqual(['010', '011', '012', '013', '014', '015']);
      expect(useStore.getState().project.variables?.serialValue).toBe(10);
    },
  );
  it('creates six distinct badges from the actual Grid dialog', async () => {
    const close = await mount();
    expect(host!.textContent).toContain('Advance variables per copy');
    await selectDistinct();
    await columns('3');
    await submit();
    expect(close).toHaveBeenCalledOnce();
    const texts = useStore.getState().project.scene.objects;
    expect(texts).toHaveLength(18);
    expect(
      texts
        .filter((_, index) => index % 3 === 0)
        .map((object) => (object.kind === 'text' ? object.content.slice(-3) : '')),
    ).toEqual(['010', '011', '012', '013', '014', '015']);
    expect(useStore.getState().project.variables?.serialValue).toBe(10);
  });

  it.each(['Grid', 'Circular', 'Point Rotation'])(
    '%s keeps the dialog open on a CSV error and leaves the source untouched',
    async (mode) => {
      const before = fixtureState();
      const project = {
        ...before.project,
        variables: {
          ...before.project.variables!,
          csv: { sourceName: 'empty.csv', headers: ['name'], records: [] },
        },
      };
      useStore.setState({ project });
      const close = await mount();
      await act(async () => Simulate.click(button(mode)));
      await selectDistinct();
      await submit();
      expect(close).not.toHaveBeenCalled();
      expect(host!.querySelector('[role="alert"]')?.textContent).toContain(
        'Copy 1: CSV record 1 is missing',
      );
      expect(useStore.getState().project).toBe(project);
    },
  );

  it.each(['Grid', 'Circular', 'Point Rotation'])(
    '%s cancels a pending render without applying any copies',
    async (mode) => {
      let release = (): void => undefined;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      mocks.render.mockImplementation(async (input: Parameters<typeof renderFixture>[0]) => {
        await wait;
        return renderFixture(input);
      });
      const before = useStore.getState().project;
      const close = await mount();
      await act(async () => Simulate.click(button(mode)));
      await selectDistinct();
      await submit();
      expect(host!.querySelector('[role="status"]')?.textContent).toContain('Preparing');
      await act(async () => Simulate.click(button('Cancel')));
      await act(async () => release());
      expect(close).toHaveBeenCalledOnce();
      expect(useStore.getState().project).toBe(before);
    },
  );

  it.each(['Grid', 'Circular', 'Point Rotation'])(
    '%s discards a late result after the source project changes',
    async (mode) => {
      let release = (): void => undefined;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      mocks.render.mockImplementation(async (input: Parameters<typeof renderFixture>[0]) => {
        await wait;
        return renderFixture(input);
      });
      const close = await mount();
      await act(async () => Simulate.click(button(mode)));
      await selectDistinct();
      await submit();
      await act(async () => useStore.getState().setVariableSettings({ serialValue: 99 }));
      const changed = useStore.getState().project;
      await act(async () => release());
      expect(close).not.toHaveBeenCalled();
      expect(useStore.getState().project).toBe(changed);
      expect(host!.querySelector('[role="alert"]')?.textContent).toContain('design changed');
    },
  );
});
