// ADR-698: Simple view hides the advanced laser settings in the artwork
// inspector, never a value that changes the burn, and never anything outside
// the inspector: Job Review, Pause and Abort do not read it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, type LayerMode } from '../../core/scene';
import { useStore } from '../state';
import { SIMPLE_VIEW_KEY, readSimpleView, useSimpleViewStore } from '../state/simple-view';
import { resetStore, svgObj } from '../state/test-helpers';
import { SelectedOperationInspector } from './SelectedOperationInspector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  resetStore();
  useSimpleViewStore.setState({ enabled: true });
});
afterEach(() => {
  resetStore();
  useSimpleViewStore.setState({ enabled: false });
  document.body.replaceChildren();
});

function loadArtwork(mode: LayerMode, patch: Record<string, unknown> = {}): void {
  const layer = { ...createLayer({ id: 'op', color: '#ff0000' }), mode, ...patch };
  const object = { ...svgObj('art', ['#ff0000']), operationIds: [layer.id] };
  useStore.setState({
    project: { ...createProject(), scene: { layers: [layer], objects: [object] } },
    selectedObjectId: 'art',
    additionalSelectedIds: new Set(),
  });
}

function Inspector(): JSX.Element {
  const object = useStore((state) => state.project.scene.objects[0]);
  return (
    <SelectedOperationInspector objects={object === undefined ? [] : [object]} selectionActive />
  );
}

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Inspector />));
  return { host, unmount: async () => act(async () => root.unmount()) };
}

function control(host: HTMLElement, label: string): Element | null {
  return host.querySelector(`[aria-label^="${label}"]`);
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (found === undefined) throw new Error(`${text} missing`);
  return found;
}

describe('Simple view in the laser inspector', () => {
  it('keeps the process, power, speed and passes and hides the advanced settings', async () => {
    loadArtwork('fill');
    const view = await mount();
    try {
      expect(control(view.host, 'Mode for')).not.toBeNull();
      expect(control(view.host, 'Power for')).not.toBeNull();
      expect(control(view.host, 'Speed for')).not.toBeNull();
      expect(control(view.host, 'Passes for')).not.toBeNull();
      expect(control(view.host, 'Hatch spacing for')).toBeNull();
      expect(control(view.host, 'Bidirectional fill for')).toBeNull();
      expect(control(view.host, 'Air assist for')).toBeNull();
      expect(control(view.host, 'More cut settings')).toBeNull();
      expect(view.host.textContent).toContain('The other settings are at their usual values.');
    } finally {
      await view.unmount();
    }
  });

  it('shows every hidden value that changes this burn', async () => {
    loadArtwork('fill', { hatchSpacingMm: 0.05, airAssist: true, fillCrossHatch: true });
    const view = await mount();
    try {
      const list = control(view.host, 'Hidden settings in use');
      expect(list?.textContent).toContain('Line spacing: 0.05 mm');
      expect(list?.textContent).toContain('Air assist: on');
      expect(list?.textContent).toContain('Cross-hatch: on');
    } finally {
      await view.unmount();
    }
  });

  it('Show all settings turns Simple view off and brings every control back', async () => {
    loadArtwork('fill');
    const view = await mount();
    try {
      await act(async () => button(view.host, 'Show all settings').click());
      expect(useSimpleViewStore.getState().enabled).toBe(false);
      expect(control(view.host, 'Hatch spacing for')).not.toBeNull();
      expect(control(view.host, 'Air assist for')).not.toBeNull();
      expect(control(view.host, 'More cut settings')).not.toBeNull();
      expect(view.host.textContent).not.toContain('Show all settings');
    } finally {
      await view.unmount();
    }
  });

  it('changes no stored value when it hides or shows settings', async () => {
    loadArtwork('fill', { hatchSpacingMm: 0.05 });
    const before = useStore.getState().project;
    const view = await mount();
    try {
      await act(async () => useSimpleViewStore.getState().setEnabled(false));
      await act(async () => useSimpleViewStore.getState().setEnabled(true));
      expect(useStore.getState().project).toBe(before);
    } finally {
      await view.unmount();
    }
  });
});

describe('Simple view preference', () => {
  it('is off unless this computer saved it on, and survives a restart', () => {
    expect(readSimpleView(null)).toBe(false);
    const storage = new Map<string, string>();
    const fake = { getItem: (key: string) => storage.get(key) ?? null };
    expect(readSimpleView(fake)).toBe(false);
    storage.set(SIMPLE_VIEW_KEY, 'on');
    expect(readSimpleView(fake)).toBe(true);
  });

  it('writes the choice to this computer', () => {
    useSimpleViewStore.setState({ enabled: false });
    useSimpleViewStore.getState().setEnabled(true);
    expect(window.localStorage.getItem(SIMPLE_VIEW_KEY)).toBe('on');
    useSimpleViewStore.getState().toggle();
    expect(window.localStorage.getItem(SIMPLE_VIEW_KEY)).toBe('off');
  });
});

// The never-hide rule for everything outside the inspector: only these files
// may read Simple view, so Job Review, its warnings, Pause, Abort and the run
// controls cannot be hidden by it.
const SIMPLE_VIEW_READERS = [
  'src/ui/commands/AppMenuBar.control-audit.test.tsx',
  'src/ui/commands/use-app-commands.ts',
  'src/ui/commands/window-panel-commands.ts',
  'src/ui/layers/SelectedLaserOperationFields.tsx',
  'src/ui/layers/SelectedObjectProperties.tsx',
  'src/ui/layers/SimpleView.test.tsx',
  'src/ui/layers/SimpleViewSettingsNote.tsx',
  'src/ui/settings/SettingsGeneralSection.tsx',
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/u.test(name) ? [path] : [];
  });
}

describe('Simple view reaches only the operation settings', () => {
  it('is read by the inspector, the menu and Settings, and nothing else', () => {
    const root = process.cwd();
    const readers = sourceFiles(join(root, 'src', 'ui'))
      .filter((path) => /from '[./]+\/(state\/)?simple-view'/u.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path).replace(/\\/gu, '/'))
      .sort();
    expect(readers).toEqual(SIMPLE_VIEW_READERS);
  });
});
