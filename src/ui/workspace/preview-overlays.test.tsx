import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { Toolpath } from '../../core/job';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { useUiStore } from '../state/ui-store';
import {
  PreviewControlsPanel,
  PreviewRouteControls,
  PreviewStatsPanel,
  PreviewStatusOverlays,
} from './preview-overlays';
import type { PreviewIssue } from './preview-status';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const toolpath: Toolpath = {
  totalLength: 30,
  steps: [
    {
      kind: 'cut',
      color: '#000000',
      length: 20,
      polyline: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
    },
    {
      kind: 'travel',
      from: { x: 20, y: 0 },
      to: { x: 30, y: 0 },
      length: 10,
    },
  ],
};

const estimate = {
  kind: 'estimated' as const,
  label: '47s',
  totalSeconds: 47,
  breakdown: { cutSeconds: 35, travelSeconds: 12 },
};

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanup !== null) {
    await cleanup();
    cleanup = null;
  }
  useUiStore.getState().setPreviewPlaying(false);
  useUiStore.getState().setPreviewPlaybackSpeed('normal');
  useUiStore.getState().setScrubberT(1);
});

describe('PreviewStatsPanel', () => {
  it('shows the total estimated time when the live estimate is available', async () => {
    const host = await renderPanel(estimate);

    expect(host.textContent).toContain('Time');
    expect(host.textContent).toContain('47s');
    expect(host.textContent).toContain('Cut time');
    expect(host.textContent).toContain('35s');
    expect(host.textContent).toContain('Travel time');
    expect(host.textContent).toContain('12s');
  });

  it('shows a clear large-job state when live estimation is paused', async () => {
    const host = await renderPanel({ kind: 'too-large' });

    expect(host.textContent).toContain('Time');
    expect(host.textContent).toContain('ETA skipped');
  });

  it('labels whether route preview is for the whole project or selected output', async () => {
    const host = await renderPanel(estimate, 'Selected output');

    expect(host.textContent).toContain('Route');
    expect(host.textContent).toContain('Selected output');
  });
});

describe('PreviewStatusOverlays', () => {
  it('visibly discloses bounded 2D resolution without blocking preview', async () => {
    const host = await renderStatus(toolpath, {
      requestedMmPerCell: 0.2,
      effectiveMmPerCell: 0.5,
      reason: 'interactive-preview-cell-budget',
    });

    const notice = [...host.querySelectorAll('[role="status"]')].find((element) =>
      element.textContent?.includes('2D cut shading uses 0.5 mm cells'),
    );
    expect(notice?.textContent).toContain('interactive preview cell budget');
    expect(notice?.textContent).toContain('CAM and G-code are unchanged');
  });

  it('shows route-too-large status instead of the empty-project hint', async () => {
    const host = await renderStatus({
      steps: [],
      totalLength: 0,
      previewIssue: { kind: 'too-complex' },
    } as Toolpath & { readonly previewIssue: PreviewIssue });

    expect(host.textContent).toContain('Route preview is too large');
    expect(host.textContent).not.toContain('Nothing to preview');
  });

  it('shows the placement-failure reason instead of the empty-project hint (PRV-01)', async () => {
    const host = await renderStatus({
      steps: [],
      totalLength: 0,
      previewIssue: {
        kind: 'placement-unavailable',
        messages: ['Move to the work origin first.'],
      },
    } as Toolpath & { readonly previewIssue: PreviewIssue });

    expect(host.textContent).toContain('Preview unavailable');
    expect(host.textContent).toContain('Move to the work origin first.');
    expect(host.textContent).not.toContain('Nothing to preview');
  });

  it('shows the exact preparation failure instead of the empty-project hint', async () => {
    const host = await renderStatus({
      steps: [],
      totalLength: 0,
      previewIssue: {
        kind: 'preparation-failed',
        messages: ['Raster output requires 5,000,000 burn pixels.'],
      },
    } as Toolpath & { readonly previewIssue: PreviewIssue });

    expect(host.textContent).toContain('Preview unavailable');
    expect(host.textContent).toContain('Raster output requires 5,000,000 burn pixels.');
    expect(host.textContent).not.toContain('Nothing to preview');
  });

  it('discloses display-only raster downsampling after output compilation', async () => {
    const project = createProject();
    const largeRasterProject: Project = {
      ...project,
      scene: {
        layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
        objects: [
          {
            kind: 'raster-image',
            id: 'large-raster',
            source: 'large.png',
            dataUrl: 'data:image/png;base64,unused',
            pixelWidth: 1,
            pixelHeight: 1,
            bounds: { minX: 0, minY: 0, maxX: 300, maxY: 250 },
            transform: IDENTITY_TRANSFORM,
            color: '#808080',
            dither: 'threshold',
            linesPerMm: 10,
            lumaBase64: 'AA==',
          },
        ],
      },
    };
    const host = await renderStatus(toolpath, undefined, largeRasterProject);

    expect(host.textContent).toContain(
      'Raster display resolution reduced after output compilation',
    );
    expect(host.textContent).toContain('3,000 × 2,500');
    expect(host.textContent).toContain('Emitted S-values and G-code are unchanged');
  });

  it('states source and drawn counts when route display is decimated', async () => {
    const host = await renderStatus({
      ...toolpath,
      previewIssue: {
        kind: 'display-decimated',
        threshold: 120_000,
        sourceSteps: 300_000,
        drawnSteps: 100_001,
        sourceSegments: 300_000,
        drawnSegments: 100_001,
      },
    } as Toolpath & { readonly previewIssue: PreviewIssue });

    expect(host.textContent).toContain('Route display decimated');
    expect(host.textContent).toContain('100,001 of 300,000 steps');
    expect(host.textContent).toContain('100,001 of 300,000 XY segments');
    expect(host.textContent).not.toContain('all 300,000 parsed steps are shown');
  });
});

describe('PreviewRouteControls', () => {
  it('renders playback controls and writes route preview state', async () => {
    const host = await renderControls();

    expect(host.textContent).toContain('Play');
    expect(host.textContent).toContain('Restart');
    expect(host.textContent).toContain('Speed');
    expect(
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Play route preview"]')
        ?.classList.contains('lf-btn'),
    ).toBe(true);
    expect(
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Play route preview"]')
        ?.classList.contains('lf-button'),
    ).toBe(false);
    expect(
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Restart route preview"]')
        ?.classList.contains('lf-btn'),
    ).toBe(true);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Play route preview"]')?.click();
    });
    expect(useUiStore.getState().previewPlaying).toBe(true);

    await act(async () => {
      const speed = host.querySelector<HTMLSelectElement>(
        'select[aria-label="Route preview speed"]',
      );
      if (speed === null) throw new Error('speed selector missing');
      speed.value = 'fast';
      speed.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useUiStore.getState().previewPlaybackSpeed).toBe('fast');
  });

  it('disables playback controls when no route can be played', async () => {
    const host = await renderControls({ disabled: true });

    const play = host.querySelector<HTMLButtonElement>('button[aria-label="Play route preview"]');
    expect(play?.disabled).toBe(true);
  });
});

describe('PreviewControlsPanel', () => {
  it('combines playback controls and stats in one bottom panel', async () => {
    const host = await renderCombinedPanel();

    expect(host.querySelectorAll('.lf-chip')).toHaveLength(1);
    expect(host.textContent).toContain('Play');
    expect(host.textContent).toContain('Route');
    expect(host.textContent).toContain('Cut');
  });
});

async function renderPanel(
  estimate: React.ComponentProps<typeof PreviewStatsPanel>['estimate'],
  routeLabel = 'Whole project',
): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PreviewStatsPanel toolpath={toolpath} estimate={estimate} routeLabel={routeLabel} />,
    );
  });
  cleanup = async () => {
    if (root !== null) await act(async () => root?.unmount());
    host.remove();
  };
  return host;
}

async function renderStatus(
  toolpathValue: Toolpath,
  resolution?: React.ComponentProps<typeof PreviewStatusOverlays>['resolution'],
  project: Project = createProject(),
): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PreviewStatusOverlays
        project={project}
        toolpath={toolpathValue}
        {...(resolution === undefined ? {} : { resolution })}
      />,
    );
  });
  cleanup = async () => {
    if (root !== null) await act(async () => root?.unmount());
    host.remove();
  };
  return host;
}

async function renderCombinedPanel(): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PreviewControlsPanel
        toolpath={toolpath}
        estimate={estimate}
        routeLabel="Whole project"
        disabled={false}
      />,
    );
  });
  cleanup = async () => {
    if (root !== null) await act(async () => root?.unmount());
    host.remove();
  };
  return host;
}

async function renderControls(
  options: { readonly disabled?: boolean } = {},
): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    const Controls = PreviewRouteControls as React.ComponentType<{ readonly disabled?: boolean }>;
    root.render(<Controls disabled={options.disabled === true} />);
  });
  cleanup = async () => {
    if (root !== null) await act(async () => root?.unmount());
    host.remove();
  };
  return host;
}
