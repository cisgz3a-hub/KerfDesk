import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { CncLayerFields } from './CncLayerFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  useUiStore.getState().resetToolMode();
});

function install(pathColor = '#00aa00'): Layer {
  const layer = {
    ...createLayer({ id: 'profile', color: '#00aa00' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside' as const, tabsPerShape: 4 },
  };
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'part',
    source: 'part.svg',
    operationIds: [layer.id],
    bounds: { minX: 20, minY: 20, maxX: 60, maxY: 60 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: pathColor,
        polylines: [
          {
            closed: true,
            points: [
              { x: 20, y: 20 },
              { x: 60, y: 20 },
              { x: 60, y: 60 },
              { x: 20, y: 60 },
            ],
          },
        ],
      },
    ],
    cncTabAnchors: [0.05, 0.35, 0.65, 0.95].map((pathT) => ({
      layerColor: pathColor,
      pathIndex: 0,
      polylineIndex: 0,
      pathT,
    })),
  };
  useStore.setState({
    project: {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: { layers: [layer], objects: [object] },
    },
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  return layer;
}

function ConnectedFields({ id }: { readonly id: string }): JSX.Element {
  const layer = useStore((state) => state.project.scene.layers.find((entry) => entry.id === id));
  if (layer === undefined) throw new Error('operation missing');
  return <CncLayerFields layer={layer} />;
}

async function render(id: string): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ConnectedFields id={id} />));
  return { host, root };
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((entry) => entry.textContent === text);
  if (found === undefined) throw new Error(`button missing: ${text}`);
  return found;
}

async function changeCount(host: HTMLElement, color: string, value: string): Promise<void> {
  const input = host.querySelector<HTMLInputElement>(
    `input[aria-label="Tabs per shape for ${color}"]`,
  );
  if (input === null) throw new Error('tab count missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

describe('CNC tab settings and canvas editor', () => {
  it('disables the matching editor while preserving dragged positions across re-enable', async () => {
    const layer = install('#000000');
    const anchors = useStore.getState().project.scene.objects[0]?.cncTabAnchors;
    const { host, root } = await render(layer.id);
    try {
      await act(async () => button(host, 'Edit positions').click());
      expect(useUiStore.getState().toolMode.kind).toBe('cnc-tabs');
      const toggle = host.querySelector<HTMLInputElement>(
        `input[aria-label="Holding tabs for ${layer.color}"]`,
      );
      if (toggle === null) throw new Error('tabs toggle missing');
      await act(async () => toggle.click());
      expect(useStore.getState().project.scene.layers[0]?.cnc?.tabsEnabled).toBe(false);
      expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
      expect(useStore.getState().project.scene.objects[0]?.cncTabAnchors).toEqual(anchors);
      await act(async () => toggle.click());
      expect(useStore.getState().project.scene.layers[0]?.cnc?.tabsEnabled).toBe(true);
      expect(useStore.getState().project.scene.objects[0]?.cncTabAnchors).toEqual(anchors);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('publishes count and anchors together and restores both with one undo and redo', async () => {
    const layer = install();
    const before = useStore.getState().project;
    const observations: Array<[number | undefined, number | undefined]> = [];
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.project === previous.project) return;
      observations.push([
        state.project.scene.layers[0]?.cnc?.tabsPerShape,
        state.project.scene.objects[0]?.cncTabAnchors?.length,
      ]);
    });
    const { host, root } = await render(layer.id);
    try {
      await changeCount(host, layer.color, '6');
      expect(observations).toEqual([[6, 6]]);
      expect(useStore.getState().undoStack).toEqual([before]);
      const after = useStore.getState().project;
      await act(async () => useStore.getState().undo());
      expect(useStore.getState().project).toEqual(before);
      await act(async () => useStore.getState().redo());
      expect(useStore.getState().project).toEqual(after);
      expect(observations).toEqual([
        [6, 6],
        [4, 4],
        [6, 6],
      ]);
    } finally {
      unsubscribe();
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('does not disarm another operation editor even when its path color matches', async () => {
    const layer = install();
    const mode = { kind: 'cnc-tabs' as const, layerColor: layer.color, operationId: 'other' };
    useUiStore.getState().setToolMode(mode);
    const { host, root } = await render(layer.id);
    try {
      const toggle = host.querySelector<HTMLInputElement>(
        `input[aria-label="Holding tabs for ${layer.color}"]`,
      );
      if (toggle === null) throw new Error('tabs toggle missing');
      await act(async () => toggle.click());
      expect(useUiStore.getState().toolMode).toEqual(mode);
      expect(useStore.getState().project.scene.layers[0]?.cnc?.tabsEnabled).toBe(false);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('discloses that shared paths and locked artwork retain saved positions', async () => {
    const layer = install();
    const { host, root } = await render(layer.id);
    try {
      const input = host.querySelector<HTMLInputElement>(
        `input[aria-label="Tabs per shape for ${layer.color}"]`,
      );
      expect(input?.title).toContain('Shared paths and locked artwork keep their saved positions');
      expect(host.textContent?.replace(/\s+/g, ' ')).toContain(
        'Paths shared with another operation and locked artwork keep their saved positions.',
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
