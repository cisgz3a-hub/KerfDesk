import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRectangle } from '../../../core/shapes/primitives';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { JigArtworkSettings } from './JigArtworkSettings';
import { jigArtworkOperations } from './jig-artwork-settings';
import {
  changeJigDraft,
  createJigEditorSession,
  selectJigObjects,
  undoJigDraft,
  type JigEditorSession,
} from './jig-editor-session';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let session: JigEditorSession;

function render(): void {
  root.render(
    <JigArtworkSettings
      draft={session.draft}
      onChange={(draft) => {
        session = changeJigDraft(session, draft);
        render();
      }}
    />,
  );
}

beforeEach(() => {
  resetStore();
  useStore.setState({ registrationArtworkOutputSnapshot: null });
  useStore.getState().drawShape(
    createRectangle({
      id: 'art',
      color: '#0000ff',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    }),
  );
  session = selectJigObjects(createJigEditorSession(useStore.getState()), new Set(['art']));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(render);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetStore();
});

function chooseFill(): void {
  const mode = host.querySelector<HTMLSelectElement>('[aria-label="Jig artwork burn mode"]')!;
  act(() => {
    mode.value = 'fill';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function edit(label: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="Jig ${label}"]`)!;
  act(() => {
    input.value = value;
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

describe('jig artwork settings', () => {
  it('changes Line to Fill locally, exposes fill controls, and supports draft undo', () => {
    const main = useStore.getState().project;
    expect(host.querySelector('[aria-label="Jig Line interval (mm)"]')).toBeNull();
    chooseFill();
    edit('Line interval (mm)', '0.2');
    edit('Scan angle (degrees)', '45');
    expect(jigArtworkOperations(session.draft)[0]).toMatchObject({
      mode: 'fill',
      hatchSpacingMm: 0.2,
      hatchAngleDeg: 45,
    });
    expect(useStore.getState().project).toBe(main);
    act(() => {
      session = undoJigDraft(session);
      render();
    });
    expect(jigArtworkOperations(session.draft)[0]!.hatchAngleDeg).toBe(0);
  });

  it('commits power, speed and passes on blur and rejects invalid values', () => {
    edit('Power (%)', '22');
    edit('Speed (mm/min)', '800');
    edit('Passes', '2');
    expect(jigArtworkOperations(session.draft)[0]).toMatchObject({
      power: 22,
      speed: 800,
      passes: 2,
    });
    const draft = session.draft;
    edit('Power (%)', '101');
    edit('Speed (mm/min)', '0');
    edit('Passes', '1.5');
    expect(session.draft).toBe(draft);
    expect(host.querySelector<HTMLInputElement>('[aria-label="Jig Power (%)"]')!.value).toBe('22');
  });

  it('does not offer artwork burn controls for a jig outline selection', () => {
    const outline = session.draft.project.scene.objects.find((object) => object.id !== 'art')!;
    act(() => {
      session = selectJigObjects(session, new Set([outline.id]));
      render();
    });
    expect(host.textContent).toBe('');
  });
});
