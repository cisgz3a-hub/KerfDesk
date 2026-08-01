import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addObject, createProject, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { CommandShell } from './CommandShell';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  useUiStore.getState().closeWorkspaceContextBar();
  vi.restoreAllMocks();
});

describe('CommandShell node-mode Delete', () => {
  it('Edit > Delete removes the selected path node without deleting its object', async () => {
    loadNodeSelection();

    const { host, root } = await renderShell(mockPlatform());
    try {
      await clickMenuCommand(host, 'Edit', 'Delete Delete');
      expectOnlyNodeDeleted();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('workspace-context Delete uses the same node-mode behavior', async () => {
    loadNodeSelection();

    const { host, root } = await renderShell(mockPlatform());
    try {
      await act(async () => {
        useUiStore
          .getState()
          .openWorkspaceContextBar({ x: 80, y: 90, context: 'workspace-selection' });
      });
      await clickButton(workspaceQuickActions(host), 'Delete');
      expectOnlyNodeDeleted();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('Edit > Delete retains ordinary whole-object deletion outside node mode', async () => {
    loadNodeSelection();
    useStore.getState().selectObject('pen');

    const { host, root } = await renderShell(mockPlatform());
    try {
      await clickMenuCommand(host, 'Edit', 'Delete Delete');
      const state = useStore.getState();
      expect(state.project.scene.objects).toHaveLength(0);
      expect(state.undoStack).toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

function loadNodeSelection(): void {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'pen',
    source: 'pen.svg',
    bounds: { minX: 2, minY: 3, maxX: 8, maxY: 7 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 2, y: 3 },
              { x: 8, y: 3 },
              { x: 8, y: 7 },
              { x: 2, y: 7 },
            ],
          },
        ],
      },
    ],
  };
  const project = createProject();
  useStore.setState({ project: { ...project, scene: addObject(project.scene, object) } });
  useStore.getState().selectPathNode({
    objectId: object.id,
    pathIndex: 0,
    polylineIndex: 0,
    pointIndex: 1,
  });
}

function expectOnlyNodeDeleted(): void {
  const state = useStore.getState();
  expect(state.project.scene.objects).toHaveLength(1);
  const remaining = state.project.scene.objects[0];
  if (remaining?.kind !== 'imported-svg') {
    throw new Error('expected the imported vector object to remain');
  }
  expect(remaining.paths[0]?.polylines[0]?.points).toEqual([
    { x: 2, y: 3 },
    { x: 8, y: 7 },
    { x: 2, y: 7 },
  ]);
  expect(state.undoStack).toHaveLength(1);
}

function mockPlatform(): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: vi.fn(async () => []),
    pickFileForSave: vi.fn(async () => null),
    serial: {
      isSupported: () => false,
      requestPort: vi.fn(async () => null),
    },
  };
}

async function renderShell(platform: PlatformAdapter): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <PlatformProvider adapter={platform}>
        <CommandShell />
      </PlatformProvider>,
    );
  });
  return { host, root };
}

async function clickButton(container: HTMLElement, accessibleName: string): Promise<void> {
  const matches = [...container.querySelectorAll('button[role="menuitem"]')].filter(
    (candidate) => exactAccessibleName(candidate) === accessibleName,
  );
  expect(matches, `exact "${accessibleName}" menu item`).toHaveLength(1);
  const button = matches[0];
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`${accessibleName} button missing`);
  }
  expect(button.disabled).toBe(false);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function clickMenuCommand(
  host: HTMLElement,
  family: string,
  commandAccessibleName: string,
): Promise<void> {
  const menuBar = host.querySelector<HTMLElement>(
    '[role="menubar"][aria-label="Application menu"]',
  );
  if (menuBar === null) throw new Error('application menu missing');
  const summaries = [...menuBar.querySelectorAll('summary[role="menuitem"]')].filter(
    (candidate) => exactAccessibleName(candidate) === family,
  );
  expect(summaries, `exact "${family}" menu`).toHaveLength(1);
  const summary = summaries[0];
  if (!(summary instanceof HTMLElement)) throw new Error(`${family} menu missing`);
  await act(async () => {
    summary.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });

  const familyMenu = summary
    .closest('details')
    ?.querySelector<HTMLElement>(':scope > [role="menu"]');
  if (familyMenu === null || familyMenu === undefined) {
    throw new Error(`${family} command container missing`);
  }
  await clickButton(familyMenu, commandAccessibleName);
}

function workspaceQuickActions(host: HTMLElement): HTMLElement {
  const matches = [...host.querySelectorAll<HTMLElement>('[role="menu"][aria-label]')].filter(
    (candidate) => exactAccessibleName(candidate) === 'Workspace quick actions',
  );
  expect(matches, 'exact workspace quick-actions menu').toHaveLength(1);
  const menu = matches[0];
  if (menu === undefined) throw new Error('workspace quick-actions menu missing');
  return menu;
}

function exactAccessibleName(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel !== null) return normalizeAccessibleName(ariaLabel);
  return normalizeAccessibleName(
    [...element.childNodes]
      .filter((node) => !(node instanceof Element) || node.getAttribute('aria-hidden') !== 'true')
      .map((node) =>
        node instanceof Element ? exactAccessibleName(node) : (node.textContent ?? ''),
      )
      .filter((text) => text.length > 0)
      .join(' '),
  );
}

function normalizeAccessibleName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}
