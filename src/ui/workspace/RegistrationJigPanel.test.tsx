import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { RegistrationJigPanel, RegistrationJigWorkspace } from './RegistrationJigPanel';

vi.mock('./registration-jig/RegistrationJigEditor', () => ({
  RegistrationJigEditor: () => (
    <div role="region" aria-label="Registration Jig">
      Jig page
    </div>
  ),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  useStore.getState().newProject();
  useUiStore.getState().closeRegistrationPanel();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useUiStore.getState().closeRegistrationPanel();
});
function render(): void {
  act(() => root.render(<RegistrationJigPanel />));
}
function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  );
  if (found === undefined) throw new Error(`Missing ${label}`);
  return found;
}
describe('Registration Jig main canvas bar', () => {
  it('does not cover an empty workspace with a panel', () => {
    render();
    expect(container.textContent).toBe('');
  });
  it('offers only Edit jig and says which run burns next', () => {
    useStore.getState().addRegistrationBox(80, 40);
    useStore.getState().setRegistrationOutput('box');
    render();
    expect([...container.querySelectorAll('button')].map((item) => item.textContent)).toEqual([
      'Edit jig',
    ]);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Next burn: outlines',
    );
    act(() => useStore.getState().setRegistrationOutput('artwork'));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Next burn: artwork');
  });
  it('opens jig mode through Edit jig', async () => {
    useStore.getState().addRegistrationBox(80, 40);
    render();
    await act(async () => {
      button('Edit jig').click();
    });
    expect(useUiStore.getState().registrationPanelOpen).toBe(true);
  });
  it('mounts the lazily loaded jig page', async () => {
    await act(async () => {
      root.render(<RegistrationJigWorkspace />);
    });
    expect(container.querySelector('[aria-label="Registration Jig"]')).not.toBeNull();
  });
  it('shows nothing for a captured board', () => {
    useStore.getState().addRegistrationBox(80, 40);
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          objects: project.scene.objects.map((object) =>
            object.kind === 'shape' ? { ...object, provenance: 'captured-board' as const } : object,
          ),
        },
      },
    });
    render();
    expect(container.querySelector('button')).toBeNull();
  });
});
