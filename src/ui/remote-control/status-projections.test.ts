import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, type TextObject } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { useStore } from '../state/store';
import { reviewProjection } from './status-projections';
import type { RemoteControlOptions, SafeRemoteJobReview } from './types';

const REVIEW: SafeRemoteJobReview = {
  revision: 'current',
  mode: 'laser',
  status: 'ready',
  summary: { artworkCount: 2, operationCount: 3, estimatedSeconds: 42 },
  warnings: [],
  frame: { required: true, complete: true },
};
const options = (
  getReview: NonNullable<RemoteControlOptions['getReview']>,
): RemoteControlOptions => ({
  getReview,
  canWrite: () => false,
  getAppStatus: () => ({
    app: { name: 'KerfDesk', version: 'test', platform: 'desktop' },
    edition: { mode: 'free' },
    updates: { available: false },
  }),
});
beforeEach(() => useStore.setState(useStore.getInitialState(), true));
function privateScene(): void {
  const state = useStore.getState();
  const rectangle = createRectangle({
    id: 'converted-text',
    color: '#000000',
    spec: { widthMm: 10, heightMm: 20, cornerRadiusMm: 0 },
  });
  const text = {
    ...rectangle,
    kind: 'text',
    content: 'Private message [draft]',
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
        objects: [text, { ...rectangle, id: 'converted' }],
        layers: [
          createLayer({ id: 'text-op', color: '#000000', name: 'Converted private wording' }),
        ],
      },
    },
  });
}

describe('safe current job review projection', () => {
  it('passes the current revision and cancellation signal to an asynchronous owner', async () => {
    const owner = vi.fn(async () => REVIEW);
    const controller = new AbortController();
    expect(
      await reviewProjection(options(owner), 'current', 'laser', controller.signal),
    ).toMatchObject({ status: 'ready', summary: { estimatedSeconds: 42 } });
    expect(owner).toHaveBeenCalledWith('current', controller.signal);
  });
  it('rejects a stale or other-mode owner without claiming Frame', async () => {
    for (const review of [
      { ...REVIEW, revision: 'prior' },
      { ...REVIEW, mode: 'cnc' as const },
    ]) {
      expect(
        await reviewProjection(
          options(() => review),
          'current',
          'laser',
        ),
      ).toEqual({
        status: 'unavailable',
        mode: 'laser',
        warnings: [],
        frame: { required: true, complete: false },
      });
    }
  });
  it('preserves independently validated spatial Frame while compilation is unavailable', async () => {
    const { summary: _summary, ...withoutSummary } = REVIEW;
    const review = { ...withoutSummary, status: 'unavailable' as const };
    expect(
      await reviewProjection(
        options(() => review),
        'current',
        'laser',
      ),
    ).toEqual({
      status: 'unavailable',
      mode: 'laser',
      warnings: [],
      frame: { required: true, complete: true },
    });
  });
  it('projects only the four finite bounds fields and omits malformed timing and bounds', async () => {
    const review = {
      ...REVIEW,
      summary: {
        artworkCount: 2,
        operationCount: 3,
        estimatedSeconds: Infinity,
        bounds: { xMm: 1, yMm: 2, widthMm: 3, heightMm: 4, sourcePath: 'C:/private/art.svg' },
      },
    };
    const projected = await reviewProjection(
      options(() => review),
      'current',
      'laser',
    );
    expect(projected['summary']).toEqual({
      artworkCount: 2,
      operationCount: 3,
      bounds: { xMm: 1, yMm: 2, widthMm: 3, heightMm: 4 },
    });
    expect(JSON.stringify(projected)).not.toContain('private');
    expect(
      await reviewProjection(
        options(() => ({
          ...review,
          summary: { ...review.summary, bounds: { ...review.summary.bounds, widthMm: -1 } },
        })),
        'current',
        'laser',
      ),
    ).toMatchObject({ summary: { artworkCount: 2, operationCount: 3 } });
  });
  it('uses PC disclosure when private text is inseparable from warning prose', async () => {
    privateScene();
    const review = {
      ...REVIEW,
      warnings: [
        {
          code: 'outside-bed',
          severity: 'error' as const,
          operationId: 'text-op',
          message:
            'Layer "Converted private wording": Private message [draft] extends outside the machine bed by 4 mm.',
        },
      ],
    };
    const projected = await reviewProjection(
      options(() => review),
      'current',
      'laser',
    );
    expect(projected['warnings']).toEqual([
      {
        code: 'outside-bed',
        severity: 'error',
        operationId: 'text-op',
        message: 'Review this artwork-specific warning in KerfDesk on the PC.',
      },
    ]);
  });
  it('shares artwork-specific wording only when explicitly enabled at result projection', async () => {
    privateScene();
    let share = true;
    let release!: (review: SafeRemoteJobReview) => void;
    const held = new Promise<SafeRemoteJobReview>((done) => {
      release = done;
    });
    const opt = { ...options(() => held), canShareArtwork: () => share };
    const pending = reviewProjection(opt, 'current', 'laser');
    share = false;
    release({ ...REVIEW, message: 'Private message [draft] exceeds the bed.' });
    expect(await pending).toMatchObject({ message: 'Review this job on the PC.' });
    share = true;
    expect(
      await reviewProjection(
        {
          ...options(() => ({ ...REVIEW, message: 'Private message [draft] exceeds the bed.' })),
          canShareArtwork: () => share,
        },
        'current',
        'laser',
      ),
    ).toMatchObject({ message: 'Private message [draft] exceeds the bed.' });
  });
});
