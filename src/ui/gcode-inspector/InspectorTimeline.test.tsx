import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectorTimeline } from './InspectorTimeline';
import type { PlaybackState } from './use-inspector-playback';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(element: JSX.Element): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(element));
}

function playbackState(): PlaybackState {
  return {
    routeMm: 3,
    playing: false,
    speed: 1,
    setRouteMm: vi.fn(),
    setSpeed: vi.fn(),
    togglePlay: vi.fn(),
    stepBy: vi.fn(),
    restart: vi.fn(),
  };
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('InspectorTimeline', () => {
  it('replaces simulation transports with reported progress when observing a live job', () => {
    const playback = playbackState();
    mount(<InspectorTimeline playback={playback} totalRouteMm={10} />);
    expect(host?.querySelector('input[type="range"]')).not.toBeNull();
    expect(host?.textContent).toContain('Playback estimate');

    act(() =>
      root?.render(
        <InspectorTimeline
          playback={playback}
          totalRouteMm={10}
          live={{ progress: 0.65, label: '13 / 20 acknowledged lines' }}
        />,
      ),
    );

    const progress = host?.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute('aria-valuenow')).toBe('65');
    expect(progress?.getAttribute('aria-valuetext')).toContain('13 / 20 acknowledged lines');
    expect(host?.textContent).toContain('Live reported progress');
    expect(host?.textContent).not.toContain('0:03');
    expect(host?.querySelector('input, select, button')).toBeNull();
    expect(playback.togglePlay).not.toHaveBeenCalled();
    expect(playback.setRouteMm).not.toHaveBeenCalled();
  });

  it('preserves preview transport actions and labels the clock as estimated', () => {
    const playback = playbackState();
    mount(<InspectorTimeline playback={playback} totalRouteMm={10} />);
    expect(host?.textContent).toContain('0:03 / 0:10');
    const play = Array.from(host?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === 'Play',
    );
    act(() => play?.click());
    act(() =>
      host?.querySelector<HTMLButtonElement>('[aria-label="Step forward 0.25 seconds"]')?.click(),
    );
    expect(playback.togglePlay).toHaveBeenCalledOnce();
    expect(playback.stepBy).toHaveBeenCalledWith(0.25);
    expect(host?.querySelector('input')?.getAttribute('aria-valuetext')).toBe(
      '0:03 of 0:10 estimated',
    );
  });

  it.each([
    [-0.1, '0'],
    [1.5, '100'],
  ])('bounds reported progress %s to %s percent', (reported, expected) => {
    mount(
      <InspectorTimeline
        playback={playbackState()}
        totalRouteMm={10}
        live={{ progress: reported, label: 'Reported lines' }}
      />,
    );
    expect(host?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      expected,
    );
  });

  it.each([null, Number.NaN])('leaves unavailable progress %s indeterminate', (progress) => {
    mount(
      <InspectorTimeline
        playback={playbackState()}
        totalRouteMm={10}
        live={{ progress, label: 'Waiting for confirmed progress' }}
      />,
    );
    const track = host?.querySelector('[role="progressbar"]');
    expect(track?.hasAttribute('aria-valuenow')).toBe(false);
    expect(track?.getAttribute('aria-valuetext')).toContain('Progress not confirmed');
    expect(track?.querySelector('span')).toBeNull();
    expect(host?.textContent).toContain('Waiting for confirmed progress');
    expect(host?.textContent).toContain('—');
    expect(host?.textContent).not.toContain('0%');
    expect(host?.querySelector('input, select, button')).toBeNull();
  });

  it('keeps a terminal run as a recorded observation without an active live indicator', () => {
    mount(
      <InspectorTimeline
        playback={playbackState()}
        totalRouteMm={10}
        live={{ progress: 0.65, label: 'Cancelled · 13 / 20 acknowledged lines', active: false }}
      />,
    );
    const track = host?.querySelector('[role="progressbar"]');
    expect(track?.getAttribute('aria-label')).toBe('Recorded run progress');
    expect(track?.getAttribute('aria-valuenow')).toBe('65');
    expect(host?.querySelector('.gcode-viewer-status-dot')?.getAttribute('data-live')).toBe(
      'false',
    );
    expect(host?.textContent).toContain('Recorded run progress');
    expect(host?.textContent).not.toContain('Live reported progress');
    expect(host?.querySelector('input, select, button')).toBeNull();
  });
});
