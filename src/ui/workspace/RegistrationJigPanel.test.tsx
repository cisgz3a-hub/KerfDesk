import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findRegistrationBoxes, registrationRunState } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { RegistrationJigPanel } from './RegistrationJigPanel';

vi.mock('./registration-jig/RegistrationJigEditor', () => ({
  RegistrationJigEditor: () => (
    <div role="dialog" aria-label="Registration Jig editor">
      Dedicated jig canvas
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
  it('shows the compact bar whenever a jig exists even with the editor closed', () => {
    useStore.getState().addRegistrationBox(80, 40);
    render();
    expect([...container.querySelectorAll('button')].map((item) => item.textContent)).toEqual([
      'Edit jig',
      'Outline only',
      'Artwork only',
    ]);
    expect(button('Artwork only').disabled).toBe(true);
  });
  it('switches complete-set output without changing outline geometry', () => {
    useStore.getState().replaceRegistrationJigSet({
      outline: { kind: 'circle', diameterMm: 40 },
      rows: 2,
      columns: 3,
      spacingX: 5,
      spacingY: 5,
    });
    useStore.getState().drawShape(
      createRectangle({
        id: 'art',
        color: '#0000ff',
        spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
      }),
    );
    const boxes = findRegistrationBoxes(useStore.getState().project.scene);
    render();
    act(() => button('Outline only').click());
    expect(registrationRunState(useStore.getState().project.scene)).toBe('box');
    act(() => button('Outline only').click());
    act(() => button('Artwork only').click());
    expect(registrationRunState(useStore.getState().project.scene)).toBe('artwork');
    expect(findRegistrationBoxes(useStore.getState().project.scene)).toEqual(boxes);
  });
  it('opens the dedicated editor through Edit jig', async () => {
    useStore.getState().addRegistrationBox(80, 40);
    render();
    await act(async () => {
      button('Edit jig').click();
    });
    expect(useUiStore.getState().registrationPanelOpen).toBe(true);
    expect(document.querySelector('[aria-label="Registration Jig editor"]')).not.toBeNull();
  });
  it('does not expose jig output switches for a captured board', () => {
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
