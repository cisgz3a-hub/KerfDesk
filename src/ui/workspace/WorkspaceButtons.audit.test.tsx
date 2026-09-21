import {
  addRectangle,
  lineTriangle,
  loadCurve,
  currentCurve,
} from './workspace-buttons-audit-support';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REGISTRATION_LAYER_ID, isRegistrationBox } from '../../core/scene';
import { NumericEditsBar } from '../commands/NumericEditsBar';
import { useDesignStudioStore } from '../design-studio';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore, type ToolMode } from '../state/ui-store';
import { useTutorialStore } from '../tutorials/tutorial-store';
import { ZoomControls } from './overlays';
import { PreviewControlsPanel, PreviewRouteControls } from './preview-overlays';
import { RegistrationJigPanel } from './RegistrationJigPanel';
import { ToolStrip } from './ToolStrip';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resetStore();
  useUiStore.setState({
    modalDepth: 0,
    toolMode: { kind: 'select' },
    scrubberT: 1,
    previewPlaying: false,
    zoomFactor: 1,
    panX: 0,
    panY: 0,
    showPreviewTravel: true,
  });
  useTutorialStore.setState({ isOpen: false, tutorialId: null });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
  useUiStore.getState().closeRegistrationPanel();
  useDesignStudioStore.getState().closeStudio();
  useTutorialStore.setState({ isOpen: false, tutorialId: null });
  vi.unstubAllGlobals();
});
async function mount(node: ReactNode): Promise<void> {
  await act(async () => root.render(node));
}
function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
  );
  if (result === undefined) throw new Error(`Missing ${label}`);
  return result;
}
async function click(label: string): Promise<void> {
  await act(async () => button(label).click());
}

const DRAW_TOOLS: ReadonlyArray<readonly [string, ToolMode]> = [
  ['select', { kind: 'select' }],
  ['node', { kind: 'node' }],
  ['measure', { kind: 'measure' }],
  ['text', { kind: 'text' }],
  ['rect', { kind: 'draw', shape: 'rect' }],
  ['ellipse', { kind: 'draw', shape: 'ellipse' }],
  ['polygon', { kind: 'draw', shape: 'polygon' }],
  ['star', { kind: 'draw', shape: 'star' }],
  ['polyline', { kind: 'draw', shape: 'polyline' }],
  ['position-laser', { kind: 'position-laser' }],
];

describe('drawing palette individual outcomes', () => {
  it.each(DRAW_TOOLS)(
    '%s selects exactly its tool mode without changing artwork',
    async (key, mode) => {
      const project = useStore.getState().project;
      await mount(<ToolStrip />);
      const target = host.querySelector<HTMLButtonElement>(`[data-help-id="tool:${key}"]`);
      if (target === null) throw new Error(`Missing tool ${key}`);
      await act(async () => target.click());
      expect(useUiStore.getState().toolMode).toEqual(mode);
      expect(target.getAttribute('aria-pressed')).toBe('true');
      expect(useStore.getState().project).toBe(project);
    },
  );

  it('Open Design Studio creates a resumable session', async () => {
    useDesignStudioStore.setState({ session: null, stash: null });
    await mount(<ToolStrip />);
    await click('Open Design Studio');
    expect(useDesignStudioStore.getState().session).not.toBeNull();
  });

  it.each(['Smooth', 'Corner'] as const)(
    '%s updates the selected handles with undoable geometry',
    async (label) => {
      loadCurve(
        {
          start: { x: 0, y: 0 },
          closed: true,
          segments: [
            {
              kind: 'cubic',
              control1: { x: 2, y: 3 },
              control2: { x: 8, y: 4 },
              to: { x: 10, y: 0 },
            },
            {
              kind: 'cubic',
              control1: { x: 12, y: 2 },
              control2: { x: 3, y: 9 },
              to: { x: 0, y: 0 },
            },
          ],
        },
        1,
      );
      const before = useStore.getState().project;
      await mount(<ToolStrip />);
      await click(label);
      const curve = currentCurve();
      const incoming = curve.segments[0];
      const outgoing = curve.segments[1];
      if (incoming?.kind !== 'cubic' || outgoing?.kind !== 'cubic')
        throw new Error('Lost cubic geometry');
      const ix = incoming.control2.x - 10;
      const iy = incoming.control2.y;
      const ox = outgoing.control1.x - 10;
      const oy = outgoing.control1.y;
      expect(ix * oy - iy * ox).toBeCloseTo(0);
      if (label === 'Smooth') expect(ix * ox + iy * oy).toBeLessThan(0);
      else {
        expect(iy).toBeCloseTo(0);
        expect(oy).toBeCloseTo(0);
      }
      expect(useStore.getState().project).not.toBe(before);
      expect(useStore.getState().undoStack).toHaveLength(1);
      act(() => useStore.getState().undo());
      expect(useStore.getState().project).toBe(before);
    },
  );

  it('Curve and Line convert the outgoing segment and explain their unavailable states', async () => {
    loadCurve(lineTriangle(), 1);
    await mount(<ToolStrip />);
    expect(button('Line').disabled).toBe(true);
    await click('Curve');
    expect(currentCurve().segments[1]?.kind).toBe('cubic');
    expect(useStore.getState().selectedPathNode).toBeNull();
    act(() =>
      useStore.getState().selectPathNode({
        objectId: 'curve',
        pathIndex: 0,
        polylineIndex: 0,
        pointIndex: 1,
        geometry: 'curve',
      }),
    );
    expect(button('Curve').disabled).toBe(true);
    await click('Line');
    expect(currentCurve().segments[1]).toEqual({ kind: 'line', to: { x: 10, y: 10 } });
    expect(useStore.getState().undoStack).toHaveLength(2);
  });

  it('Start reorders a closed path and Break opens it at the selected node', async () => {
    loadCurve(lineTriangle(), 1);
    await mount(<ToolStrip />);
    await click('Start');
    expect(currentCurve().start).toEqual({ x: 10, y: 0 });
    act(() =>
      useStore.getState().selectPathNode({
        objectId: 'curve',
        pathIndex: 0,
        polylineIndex: 0,
        pointIndex: 0,
        geometry: 'curve',
      }),
    );
    expect(button('Start').disabled).toBe(true);
    await click('Break');
    expect(currentCurve().closed).toBe(false);
    expect(useStore.getState().selectedPathNode).toBeNull();
    act(() =>
      useStore.getState().selectPathNode({
        objectId: 'curve',
        pathIndex: 0,
        polylineIndex: 0,
        pointIndex: 0,
        geometry: 'curve',
      }),
    );
    expect(button('Break').disabled).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(2);
  });
});

describe('viewport and preview individual outcomes', () => {
  it('Zoom in/out and both fit-to-bed entry points change only the view', async () => {
    const project = useStore.getState().project;
    await mount(<ZoomControls />);
    await click('Zoom in');
    expect(useUiStore.getState().zoomFactor).toBe(1.25);
    await click('Zoom out');
    expect(useUiStore.getState().zoomFactor).toBe(1);
    act(() => useUiStore.setState({ zoomFactor: 3, panX: 12, panY: -4 }));
    const percent = host.querySelector<HTMLElement>('[role="button"]');
    if (percent === null) throw new Error('Missing percentage');
    await act(async () =>
      percent.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
    expect(useUiStore.getState()).toMatchObject({ zoomFactor: 1, panX: 0, panY: 0 });
    act(() => useUiStore.setState({ zoomFactor: 4, panX: 5 }));
    await click('Fit to bed');
    expect(useUiStore.getState()).toMatchObject({ zoomFactor: 1, panX: 0, panY: 0 });
    expect(useStore.getState().project).toBe(project);
  });

  it('Fit to selection zooms to actual selected artwork', async () => {
    addRectangle();
    await mount(<ZoomControls />);
    await click('Fit to selection');
    expect(useUiStore.getState().zoomFactor).toBeGreaterThan(1);
    expect(useUiStore.getState().panX).not.toBe(0);
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
  });

  it('aspect lock makes width edits scale height proportionally', async () => {
    addRectangle();
    await mount(<NumericEditsBar />);
    await click('Lock aspect ratio');
    expect(button('Lock aspect ratio').getAttribute('aria-pressed')).toBe('true');
    const width = host.querySelector<HTMLInputElement>('[aria-label="Selection width"]');
    if (width === null) throw new Error('Missing width');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(width, '40');
      width.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      width.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
    expect(useStore.getState().project.scene.objects[0]?.transform).toMatchObject({
      scaleX: 2,
      scaleY: 2,
    });
  });

  it('Play, Pause, Restart and both pass buttons change the scrubber as labelled', async () => {
    await mount(<PreviewRouteControls passBoundaries={[0.2, 0.5, 0.8]} />);
    await click('Play route preview');
    expect(useUiStore.getState()).toMatchObject({ scrubberT: 0, previewPlaying: true });
    await click('Pause route preview');
    expect(useUiStore.getState().previewPlaying).toBe(false);
    await click('Jump to next pass');
    expect(useUiStore.getState().scrubberT).toBe(0.2);
    await click('Jump to next pass');
    expect(useUiStore.getState().scrubberT).toBe(0.5);
    await click('Jump to previous pass');
    expect(useUiStore.getState().scrubberT).toBe(0.2);
    await click('Restart route preview');
    expect(useUiStore.getState()).toMatchObject({ scrubberT: 0, previewPlaying: false });
    expect(button('Jump to previous pass').disabled).toBe(true);
  });

  it('preview travel toggle, tutorial and 3D entry dispatch without changing the route', async () => {
    const toolpath = { totalLength: 0, steps: [] };
    const open3D = vi.fn();
    await mount(
      <PreviewControlsPanel
        toolpath={toolpath}
        estimate={{
          kind: 'estimated',
          label: '0s',
          totalSeconds: 0,
          breakdown: { cutSeconds: 0, travelSeconds: 0 },
        }}
        routeLabel="Whole project"
        disabled={false}
        onOpen3D={open3D}
      />,
    );
    const travel = host.querySelector<HTMLInputElement>(
      '[aria-label="Show traversal moves in Preview"]',
    );
    if (travel === null) throw new Error('Missing travel');
    await act(async () => travel.click());
    expect(useUiStore.getState().showPreviewTravel).toBe(false);
    expect(toolpath).toEqual({ totalLength: 0, steps: [] });
    await click('Open 3D cut preview');
    expect(open3D).toHaveBeenCalledOnce();
    await click('Tutorial: Preview');
    expect(useTutorialStore.getState().tutorialId).toBe('preview');
  });
});

describe('registration jig remaining actions', () => {
  it('air assist updates the outline operation and Advanced settings opens that operation', async () => {
    useStore.getState().addRegistrationBox(80, 40);
    useUiStore.getState().openRegistrationPanel();
    await mount(<RegistrationJigPanel />);
    const air = host.querySelector<HTMLInputElement>(
      '[aria-label="Air assist for registration jig outline"]',
    );
    if (air === null) throw new Error('Missing jig air');
    const before = air.checked;
    await act(async () => air.click());
    expect(
      useStore.getState().project.scene.layers.find((layer) => layer.id === REGISTRATION_LAYER_ID)
        ?.airAssist,
    ).toBe(!before);
    await click('Advanced outline settings');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Cut Settings');
  });

  it('Remove outline preserves artwork, tutorial opens the jig lesson, and Close only hides the panel', async () => {
    useStore.getState().addRegistrationBox(80, 40);
    addRectangle();
    useUiStore.getState().openRegistrationPanel();
    await mount(<RegistrationJigPanel />);
    await click('Tutorial: Registration jig');
    expect(useTutorialStore.getState().tutorialId).toBe('registration');
    await click('Remove outline');
    expect(useStore.getState().project.scene.objects.some(isRegistrationBox)).toBe(false);
    expect(useStore.getState().project.scene.objects.some((object) => object.id === 'art')).toBe(
      true,
    );
    const project = useStore.getState().project;
    await click('Close registration jig panel');
    expect(useUiStore.getState().registrationPanelOpen).toBe(false);
    expect(host.textContent).toBe('');
    expect(useStore.getState().project).toBe(project);
  });
});
