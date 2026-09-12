import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Toolpath, ToolpathStep } from '../../core/job';
import { createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { useUiStore } from '../state/ui-store';
import { PreviewControlsPanel, PreviewStatsPanel, PreviewStatusOverlays } from './preview-overlays';
import type { PreviewIssue } from './preview-status';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const steps: ReadonlyArray<ToolpathStep> = [
  {
    kind: 'cut',
    color: '#000000',
    polyline: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ],
    length: 20,
  },
  { kind: 'travel', from: { x: 20, y: 0 }, to: { x: 30, y: 0 }, length: 10 },
];
const estimate = {
  kind: 'estimated' as const,
  label: '47s',
  totalSeconds: 47,
  breakdown: { cutSeconds: 35, travelSeconds: 12 },
};
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let initialUi = useUiStore.getState();

beforeEach(() => {
  initialUi = useUiStore.getState();
  useUiStore.setState({ showPreviewTravel: true, scrubberT: 0, previewPlaying: false });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useUiStore.setState({
    showPreviewTravel: initialUi.showPreviewTravel,
    scrubberT: initialUi.scrubberT,
    previewPlaying: initialUi.previewPlaying,
  });
});

// Observe real route access, without replacing the summary algorithms or their output.
function observedRoute(routeSteps = steps, previewIssue?: PreviewIssue) {
  let reads = 0;
  const toolpath: Toolpath & { readonly previewIssue?: PreviewIssue } = {
    get steps() {
      reads++;
      return routeSteps;
    },
    totalLength: routeSteps.reduce((sum, step) => sum + step.length, 0),
    ...(previewIssue === undefined ? {} : { previewIssue }),
  };
  return { toolpath, reads: () => reads };
}

async function renderOverlay(element: ReactElement): Promise<HTMLDivElement> {
  if (host === null) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => root?.render(element));
  return host;
}

describe('Preview overlay derived-work reuse', () => {
  it('does not rescan unchanged routes on parent renders while resolution notices update', async () => {
    const project = createProject();
    const route = observedRoute();
    const view = await renderOverlay(
      <PreviewStatusOverlays project={project} toolpath={route.toolpath} />,
    );
    const initialReads = route.reads();
    expect(initialReads).toBeGreaterThan(0);
    expect(view.textContent).toBe('');
    for (let index = 0; index < 12; index++) {
      await renderOverlay(
        <PreviewStatusOverlays
          project={project}
          toolpath={route.toolpath}
          resolution={{
            requestedMmPerCell: 0.2,
            effectiveMmPerCell: index % 2 === 0 ? 0.5 : 0.6,
            reason: 'interactive-preview-cell-budget',
          }}
        />,
      );
    }
    expect(view.textContent).toContain('2D cut shading uses 0.6 mm cells');
    expect(route.reads()).toBe(initialReads);
  });

  it('refreshes warnings for a changed project and a changed toolpath', async () => {
    const project = createProject();
    const route = observedRoute();
    const view = await renderOverlay(
      <PreviewStatusOverlays project={project} toolpath={route.toolpath} />,
    );
    const initialReads = route.reads();
    await renderOverlay(
      <PreviewStatusOverlays project={outOfBoundsProject(project)} toolpath={route.toolpath} />,
    );
    expect(view.textContent).toContain('Some objects extend past the bed');
    expect(route.reads()).toBeGreaterThan(initialReads);
    await renderOverlay(<PreviewStatusOverlays project={project} toolpath={route.toolpath} />);
    expect(view.textContent).toBe('');
    const failed = observedRoute(steps, {
      kind: 'preparation-failed',
      messages: ['Changed route failed.'],
    });
    await renderOverlay(<PreviewStatusOverlays project={project} toolpath={failed.toolpath} />);
    expect(view.textContent).toContain('Changed route failed.');
    expect(view.textContent).not.toContain('Nothing to preview');
  });

  it('updates ETA and travel controls without rescanning, then refreshes changed distances', async () => {
    const route = observedRoute();
    const view = await renderOverlay(
      <PreviewStatsPanel toolpath={route.toolpath} estimate={estimate} />,
    );
    const initialReads = route.reads();
    expect(initialReads).toBeGreaterThan(0);
    expect(view.textContent).toContain('Cut20.0 mmTravel10.0 mmTotal30.0 mm');
    const updatedEstimate = { ...estimate, label: '88s', totalSeconds: 88 };
    await renderOverlay(
      <PreviewStatsPanel
        toolpath={route.toolpath}
        estimate={updatedEstimate}
        routeLabel="Selected output"
      />,
    );
    await act(async () => view.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    expect(useUiStore.getState().showPreviewTravel).toBe(false);
    expect(view.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    expect(view.textContent).toContain('Selected output');
    expect(view.textContent).toContain('88s');
    expect(route.reads()).toBe(initialReads);
    const changed = observedRoute([
      { kind: 'plunge', at: { x: 0, y: 0 }, fromZ: 0, toZ: -3, length: 3 },
    ]);
    await renderOverlay(
      <PreviewStatsPanel toolpath={changed.toolpath} estimate={updatedEstimate} />,
    );
    expect(view.textContent).toContain('Cut0.0 mmTravel0.0 mmPlunge3.0 mmTotal3.0 mm');
    expect(view.textContent).toContain('Cut + plunge time');
    expect(changed.reads()).toBeGreaterThan(0);
  });

  it('reuses pass boundaries across parent renders and updates pass jumps for a new route', async () => {
    const route = observedRoute();
    const panel = (toolpath: Toolpath) => (
      <PreviewControlsPanel
        toolpath={toolpath}
        estimate={estimate}
        routeLabel="Whole project"
        disabled={false}
      />
    );
    const view = await renderOverlay(panel(route.toolpath));
    const initialReads = route.reads();
    expect(view.querySelector('[aria-label="Jump to next pass"]')).toBeNull();
    for (let index = 0; index < 12; index++) await renderOverlay(panel(route.toolpath));
    expect(route.reads()).toBe(initialReads);
    const changed = observedRoute([
      { kind: 'travel', from: { x: 0, y: 0 }, to: { x: 5, y: 0 }, length: 5 },
      { kind: 'plunge', at: { x: 5, y: 0 }, fromZ: 0, toZ: -1, length: 1 },
      {
        kind: 'cut',
        color: '#000000',
        polyline: [
          { x: 5, y: 0 },
          { x: 9, y: 0 },
        ],
        length: 4,
      },
    ]);
    await renderOverlay(panel(changed.toolpath));
    const next = view.querySelector<HTMLButtonElement>('[aria-label="Jump to next pass"]');
    expect(next?.disabled).toBe(false);
    const changedReads = changed.reads();
    await act(async () => next?.click());
    expect(useUiStore.getState().scrubberT).toBe(0.5);
    expect(changed.reads()).toBe(changedReads);
  });
});

function outOfBoundsProject(project: Project): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: [
        {
          kind: 'raster-image',
          id: 'outside',
          source: 'outside.png',
          dataUrl: 'data:image/png;base64,AA==',
          pixelWidth: 1,
          pixelHeight: 1,
          bounds: { minX: -2, minY: 0, maxX: -1, maxY: 1 },
          transform: IDENTITY_TRANSFORM,
          color: '#808080',
          dither: 'threshold',
          linesPerMm: 1,
        },
      ],
    },
  };
}
