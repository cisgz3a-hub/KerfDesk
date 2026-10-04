import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, type TextObject } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { useStore } from '../state/store';
import { redactReviewProjection, reviewProjection } from './status-projections';
import type { RemoteControlOptions, SafeRemoteJobReview } from './types';

let sharing = false;
let current: SafeRemoteJobReview;
const provider = vi.fn(async () => current);
const options: RemoteControlOptions = {
  canWrite: () => false,
  canShareArtwork: () => sharing,
  getReview: provider,
  getAppStatus: () => ({
    app: { name: 'KerfDesk', version: 'test', platform: 'desktop' },
    edition: { mode: 'free' },
    updates: { available: false },
  }),
};
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  sharing = false;
  provider.mockClear();
  current = {
    revision: 'current',
    mode: 'laser',
    status: 'ready',
    warnings: [],
    frame: { required: true, complete: false },
  };
});
function names(name: string, content?: string): void {
  const state = useStore.getState();
  const converted = createRectangle({
    id: 'converted',
    color: '#000000',
    spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
  });
  const text = {
    ...converted,
    id: 'text',
    kind: 'text',
    content,
    fontKey: 'inter',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
  } as TextObject;
  useStore.setState({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: content === undefined ? [converted] : [converted, text],
        layers: [createLayer({ id: 'op', color: '#000000', name })],
      },
    },
  });
}
function warn(message: string): void {
  current = { ...current, warnings: [{ code: 'bounds', severity: 'warning', message }] };
}

describe('bounded review disclosure at the asynchronous return boundary', () => {
  it('redacts a long converted-text name before the output limit and retains the warning body', async () => {
    const name = 'Confidential converted title '.repeat(30).trim();
    names(name);
    warn(`Layer "${name}": extends outside the machine bed by 8 mm.`);
    expect(await reviewProjection(options, 'current', 'laser')).toMatchObject({
      warnings: [
        {
          code: 'bounds',
          severity: 'warning',
          message: 'Layer "artwork": extends outside the machine bed by 8 mm.',
        },
      ],
    });
  });
  it('uses PC disclosure for a separately reported line of private multiline text', async () => {
    names('Secret\n converted\toperation', 'First private line\nSecond private line');
    warn('Layer "Secret converted operation": Second private line extends outside the bed.');
    expect(await reviewProjection(options, 'current', 'laser')).toMatchObject({
      warnings: [{ message: 'Review this artwork-specific warning in KerfDesk on the PC.' }],
    });
  });
  it('re-redacts full original warnings after an opt-out without compiling or reading twice', async () => {
    const name = 'Private converted title '.repeat(30).trim();
    names(name);
    warn(`Layer "${name}": extends outside the machine bed by 8 mm.`);
    sharing = true;
    const earlier = await reviewProjection(options, 'current', 'laser');
    expect(JSON.stringify(earlier)).toContain('Private converted');
    sharing = false;
    expect(redactReviewProjection(earlier, options)).toMatchObject({
      warnings: [
        {
          code: 'bounds',
          severity: 'warning',
          message: 'Layer "artwork": extends outside the machine bed by 8 mm.',
        },
      ],
    });
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('uses the PC warning disclosure if an excessive label set cannot be safely matched', async () => {
    const state = useStore.getState();
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: Array.from({ length: 513 }, (_, i) =>
            createLayer({ id: `op-${i}`, name: `Private label ${i}`, color: '#000000' }),
          ),
        },
      },
    });
    warn('Private label 512 needs a material review.');
    const projected = await reviewProjection(options, 'current', 'laser');
    expect(projected).toMatchObject({
      warnings: [
        {
          code: 'bounds',
          severity: 'warning',
          message: 'Review this artwork-specific warning in KerfDesk on the PC.',
        },
      ],
    });
    expect(JSON.stringify(projected)).not.toContain('Private label');
  });
  it('does not rewrite engineering prose that coincides with an unquoted private label', async () => {
    names('laser');
    warn('The laser power does not match the current controller scale.');
    expect(await reviewProjection(options, 'current', 'laser')).toMatchObject({
      warnings: [
        {
          code: 'bounds',
          severity: 'warning',
          message: 'Review this artwork-specific warning in KerfDesk on the PC.',
        },
      ],
    });
  });
});
