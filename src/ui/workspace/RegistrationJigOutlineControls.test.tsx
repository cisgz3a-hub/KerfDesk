import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state/store';
import { RegistrationJigOutlineControls } from './RegistrationJigOutlineControls';
import { createRectangle } from '../../core/shapes/primitives';
import { isRegistrationBox } from '../../core/scene';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
afterEach(() => useStore.setState(initial, true));

function TestControls(): JSX.Element {
  const scene = useStore((state) => state.project.scene);
  return (
    <RegistrationJigOutlineControls
      key={JSON.stringify(scene.objects.filter(isRegistrationBox))}
      scene={scene}
      onReplace={useStore.getState().replaceRegistrationJigSet}
      onRemove={useStore.getState().removeRegistrationBox}
      onPendingChange={() => undefined}
    />
  );
}

describe('jig construction draft validation', () => {
  it('reports pending layout edits and uses scaled dimensions without changing the live scene', async () => {
    useStore.setState({ project: createProject(), undoStack: [] });
    useStore.getState().addRegistrationBox(80, 40);
    const live = useStore.getState().project;
    const scene = {
      ...live.scene,
      objects: live.scene.objects.map((object) =>
        isRegistrationBox(object)
          ? { ...object, transform: { ...object.transform, scaleX: 2, scaleY: 0.5 } }
          : object,
      ),
    };
    const onReplace = vi.fn();
    const onPendingChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <RegistrationJigOutlineControls
            scene={scene}
            onReplace={onReplace}
            onRemove={() => undefined}
            onPendingChange={onPendingChange}
          />,
        ),
      );
      expect(onPendingChange).toHaveBeenLastCalledWith(false);
      const width = host.querySelector<HTMLInputElement>('[aria-label="Registration box width"]')!;
      const height = host.querySelector<HTMLInputElement>(
        '[aria-label="Registration box height"]',
      )!;
      expect(width.value).toBe('160');
      expect(height.value).toBe('20');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          width,
          '170',
        );
        width.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(onPendingChange).toHaveBeenLastCalledWith(true);
      const apply = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Apply layout',
      )!;
      await act(async () => apply.click());
      expect(onReplace).toHaveBeenCalledWith(
        expect.objectContaining({
          outline: { kind: 'rectangle', widthMm: 170, heightMm: 20 },
        }),
      );
      expect(useStore.getState().project).toBe(live);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('previews removed artwork and defaults to keeping it, with explicit removal available', async () => {
    useStore.setState({ project: createProject(), undoStack: [] });
    useStore.getState().replaceRegistrationJigSet({
      outline: { kind: 'rectangle', widthMm: 40, heightMm: 30 },
      rows: 1,
      columns: 3,
      spacingX: 5,
      spacingY: 0,
    });
    useStore.getState().drawShape(
      createRectangle({
        id: 'art',
        color: '#0000ff',
        spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      }),
    );
    useStore.getState().centerSelectionInRegistrationBox();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<TestControls />));
      const columns = host.querySelector<HTMLInputElement>('[aria-label="Jig columns"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          columns,
          '2',
        );
        columns.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const policy = host.querySelector<HTMLSelectElement>(
        '[aria-label="Artwork in removed jig slots"]',
      )!;
      expect(policy.value).toBe('keep');
      expect(host.textContent).toContain('1 artwork object in removed slots');
      expect(host.textContent).toContain('can still output');
      await act(async () => {
        policy.value = 'remove';
        policy.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(host.textContent).toContain('Undo restores both');
      const replace = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Apply layout',
      )!;
      await act(async () => replace.click());
      expect(
        useStore.getState().project.scene.objects.filter((object) => !isRegistrationBox(object)),
      ).toHaveLength(2);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it.each(['', '0', '1.5', '10000'])(
    'keeps invalid or oversized grid %s out of the scene',
    async (rows) => {
      useStore.setState({ project: createProject(), undoStack: [] });
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      try {
        await act(async () => root.render(<TestControls />));
        const setField = async (label: string, value: string): Promise<void> => {
          const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
          if (input === null) throw new Error(`Missing ${label}`);
          await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
              input,
              value,
            );
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
        };
        await setField('Jig rows', rows);
        await setField('Jig columns', '10000');
        const create = [...host.querySelectorAll('button')].find(
          (button) => button.textContent === 'Apply layout',
        );
        expect(create?.disabled).toBe(true);
        expect(host.textContent).toContain(rows === '10000' ? 'at most 10000' : 'Rows must');
        const before = useStore.getState();
        await act(async () => create?.click());
        expect(useStore.getState()).toBe(before);
        expect(before.undoStack).toHaveLength(0);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );
});
