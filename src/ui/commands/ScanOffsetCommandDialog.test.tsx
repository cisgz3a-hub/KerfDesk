import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileJob } from '../../core/job';
import { grblStrategy } from '../../core/output/grbl-strategy';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { ScanOffsetCommandDialog } from './ScanOffsetCommandDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
});

describe('ScanOffsetCommandDialog', () => {
  it('saves and labels capped coupon speeds at the feed actually emitted', async () => {
    useStore.getState().updateDeviceProfile({ maxFeed: 1500.9 });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onClose = vi.fn();
    try {
      await act(async () => {
        root.render(<ScanOffsetCommandDialog onClose={onClose} />);
      });
      await act(async () => {
        for (const [label, value] of [
          ['Steps', '4'],
          ['Min speed (mm/min)', '1000.25'],
          ['Max speed (mm/min)', '3000.75'],
        ] as const) {
          const input = host.querySelector(`input[aria-label="${label}"]`);
          if (!(input instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
          input.value = value;
          Simulate.change(input);
        }
      });
      const form = host.querySelector('form');
      if (form === null) throw new Error('Scan-offset form missing');
      await act(async () => {
        Simulate.submit(form);
      });

      expect(onClose).toHaveBeenCalledOnce();
      const project = useStore.getState().project;
      const layers = project.scene.layers.filter((layer) => layer.mode === 'fill');
      expect(layers.map((layer) => layer.speed)).toEqual([1500, 1500, 1500, 1000]);
      expect(layers.map((layer) => layer.name)).toEqual([
        'Scan offset 1500 mm/min',
        'Scan offset 1500 mm/min',
        'Scan offset 1500 mm/min',
        'Scan offset 1000 mm/min',
      ]);
      const labels = project.scene.objects.filter(
        (object) =>
          object.kind === 'imported-svg' && object.source.startsWith('calibration-label:'),
      );
      expect(labels.map((object) => 'source' in object && object.source)).toEqual([
        'calibration-label:1500',
        'calibration-label:1500',
        'calibration-label:1500',
        'calibration-label:1000',
      ]);
      const groups = compileJob(project.scene, project.device).groups.filter(
        (group) => group.kind === 'fill',
      );
      groups.forEach((group, index) => {
        const gcode = grblStrategy.emit({ groups: [group] }, project.device);
        const poweredFeeds = poweredMoveFeeds(gcode);
        expect(poweredFeeds.length).toBeGreaterThan(0);
        expect(new Set(poweredFeeds)).toEqual(new Set([layers[index]?.speed]));
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

function poweredMoveFeeds(gcode: string): number[] {
  const feeds: number[] = [];
  let feed = 0;
  let power = 0;
  for (const raw of gcode.split('\n')) {
    const line = raw.split(';')[0] ?? '';
    const feedWord = /F([0-9.]+)/.exec(line);
    const powerWord = /S([0-9.]+)/.exec(line);
    if (feedWord !== null) feed = Number(feedWord[1]);
    if (powerWord !== null) power = Number(powerWord[1]);
    if (/^G1(?:\s|[XY])/.test(line) && /[XY][+-]?[0-9.]+/.test(line) && power > 0) {
      feeds.push(feed);
    }
  }
  return feeds;
}
