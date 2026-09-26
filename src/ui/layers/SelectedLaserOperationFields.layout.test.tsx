// ADR-430: the laser inspector shows the process, the three numbers, the one
// or two settings that process needs, and one-line switches. Everything it
// moved out stays in Cut Settings, which the More cut settings row names.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, type LayerMode } from '../../core/scene';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { SelectedOperationInspector } from './SelectedOperationInspector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ARTWORK_COLOR = '#ff0000';

beforeEach(() => resetStore());
afterEach(() => {
  resetStore();
  document.body.replaceChildren();
});

function loadArtwork(mode: LayerMode, artworkCount = 1): void {
  const layer = { ...createLayer({ id: 'op', color: ARTWORK_COLOR }), mode };
  const objects = Array.from({ length: artworkCount }, (_, index) => ({
    ...svgObj(`art-${index}`, [ARTWORK_COLOR]),
    operationIds: [layer.id],
  }));
  useStore.setState({
    project: { ...createProject(), scene: { layers: [layer], objects } },
    selectedObjectId: 'art-0',
    additionalSelectedIds: new Set(),
  });
}

// Inspects the first artwork only, as when one of several is selected.
function FirstArtwork(): JSX.Element {
  const first = useStore((state) => state.project.scene.objects[0]);
  return (
    <SelectedOperationInspector objects={first === undefined ? [] : [first]} selectionActive />
  );
}

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<FirstArtwork />));
  return { host, unmount: async () => act(async () => root.unmount()) };
}

function labels(host: HTMLElement): ReadonlyArray<string> {
  return [...host.querySelectorAll('[aria-label]')].map(
    (element) => element.getAttribute('aria-label') ?? '',
  );
}

function moreSummary(host: HTMLElement): string {
  const more = host.querySelector('button[aria-label="More cut settings"]');
  if (!(more instanceof HTMLButtonElement)) throw new Error('More cut settings missing');
  return more.textContent ?? '';
}

describe('laser artwork settings layout (ADR-430)', () => {
  it('offers the process as three labelled buttons with their descriptions as tooltips', async () => {
    loadArtwork('line');
    const view = await mount();
    try {
      const group = view.host.querySelector('[role="radiogroup"][aria-label^="Mode for"]');
      if (!(group instanceof HTMLElement)) throw new Error('process group missing');
      const options = [...group.querySelectorAll('label')];
      expect(options.map((option) => option.textContent)).toEqual(['Line', 'Fill', 'Image']);
      expect(options.every((option) => (option.title ?? '').length > 20)).toBe(true);
      expect(group.querySelector<HTMLInputElement>('input[value="line"]')?.checked).toBe(true);
      expect(view.host.querySelector('select[aria-label^="Mode for"]')).toBeNull();
      expect(view.host.textContent).not.toContain('About this process');
    } finally {
      await view.unmount();
    }
  });

  it('switches the process from its button', async () => {
    loadArtwork('line');
    const view = await mount();
    try {
      const fill = view.host.querySelector<HTMLInputElement>('input[type="radio"][value="fill"]');
      await act(async () => fill?.click());
      expect(useStore.getState().project.scene.layers[0]?.mode).toBe('fill');
    } finally {
      await view.unmount();
    }
  });

  it.each([
    ['line', [], ['Contour entry', 'Hatch spacing', 'Dither'], 'kerf'],
    ['fill', ['Hatch spacing', 'Hatch angle', 'Bidirectional fill'], ['Fill overscan'], 'overscan'],
    [
      'image',
      ['Dither', 'Line interval', 'Bidirectional image scan'],
      ['DPI', 'Dot width correction', 'Negative image', 'Pass-through image'],
      'DPI',
    ],
  ] as const)(
    'shows only what %s needs and names the rest in More cut settings',
    async (mode, shown, moved, summaryWord) => {
      loadArtwork(mode);
      const view = await mount();
      try {
        const present = labels(view.host);
        for (const name of ['Power', 'Speed', 'Passes', ...shown]) {
          expect(present.some((label) => label.startsWith(`${name} for`))).toBe(true);
        }
        for (const name of moved) {
          expect(present.some((label) => label.startsWith(`${name} for`))).toBe(false);
        }
        expect(present).toContain('Air assist for selected operation');
        expect(moreSummary(view.host)).toContain(summaryWord);
      } finally {
        await view.unmount();
      }
    },
  );

  it('leads with the operation and keeps the output toggles and Add operation at the end', async () => {
    loadArtwork('line');
    const view = await mount();
    try {
      const name = view.host.querySelector('input[aria-label="Operation name"]');
      const process = view.host.querySelector('[role="radiogroup"]');
      const output = view.host.querySelector('input[aria-label^="Output "]');
      if (name === null || process === null || output === null) throw new Error('layout missing');
      expect(name.compareDocumentPosition(process) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(
        process.compareDocumentPosition(output) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(view.host.textContent).not.toMatch(/Affects \d+ artwork/);
      expect(view.host.textContent).not.toContain('Shared by');
      expect(view.host.textContent).toContain('Add operation');
    } finally {
      await view.unmount();
    }
  });

  it('says once who an edit reaches when the operation is shared, with Make unique beside it', async () => {
    loadArtwork('line', 3);
    const view = await mount();
    try {
      const scope = view.host.querySelector('.lf-operation-scope');
      expect(scope?.textContent).toContain('Shared by 3 artworks. Edits apply to all of them.');
      expect(scope?.textContent).toContain('Make unique');
      expect(view.host.textContent?.match(/Shared by 3 artworks/g)).toHaveLength(1);
    } finally {
      await view.unmount();
    }
  });
});
