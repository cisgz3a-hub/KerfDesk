import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject, findRegistrationLayer, updateLayer, type Scene } from '../../core/scene';
import { useStore } from '../state/store';
import { RegistrationJigOperationSettingsEditor } from './RegistrationJigOperationSettings';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
afterEach(() => useStore.setState(initial, true));

describe('registration outline draft settings', () => {
  it('keeps air assist and advanced laser edits in the draft until the editor is saved', async () => {
    useStore.setState({ project: createProject(), undoStack: [] });
    useStore.getState().addRegistrationBox(80, 40);
    const live = useStore.getState().project;
    let draftScene: Scene = live.scene;
    function Harness(): JSX.Element {
      const [scene, setScene] = useState(live.scene);
      return (
        <RegistrationJigOperationSettingsEditor
          scene={scene}
          onChange={(id, patch) => {
            setScene((current) => {
              draftScene = updateLayer(current, id, patch);
              return draftScene;
            });
          }}
        />
      );
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Harness />));
      expect(
        host.querySelector('[aria-label="Power for registration jig outline"]'),
      ).not.toBeNull();
      expect(
        host.querySelector('[aria-label="Speed for registration jig outline"]'),
      ).not.toBeNull();
      const air = host.querySelector<HTMLInputElement>(
        '[aria-label="Air assist for registration jig outline"]',
      )!;
      await act(async () => air.click());
      expect(findRegistrationLayer(draftScene)?.airAssist).toBe(true);
      const advanced = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Advanced outline settings',
      )!;
      await act(async () => advanced.click());
      const dialog = document.querySelector<HTMLFormElement>('[role="dialog"] form')!;
      expect(dialog).not.toBeNull();
      await setInput(dialog, 'power', '42');
      await setInput(dialog, 'speed', '1234');
      await setInput(dialog, 'passes', '2');
      await act(async () =>
        dialog.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
      expect(findRegistrationLayer(draftScene)).toMatchObject({
        power: 42,
        speed: 1234,
        passes: 2,
        airAssist: true,
      });
      expect(useStore.getState().project).toBe(live);
      expect(findRegistrationLayer(live.scene)?.power).not.toBe(42);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

async function setInput(dialog: HTMLElement, name: string, value: string): Promise<void> {
  const input = dialog.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (input === null) throw new Error(`Missing advanced field ${name}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
