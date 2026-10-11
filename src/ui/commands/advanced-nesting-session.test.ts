import { describe, expect, it } from 'vitest';
import { productionFixture } from '../../core/nesting/production-nest.test-fixture';
import { searchProductionNest } from '../../core/nesting/production-nest-plan';
import { advancedNestingSession } from './advanced-nesting-session';
import type { NestingWorkerResponse } from './nesting-worker-protocol';

describe('advanced nesting session', () => {
  it('publishes a baseline before launching the solver and retains it on invalid or empty results', () => {
    const input = productionFixture();
    const events: NestingWorkerResponse[] = [];
    const session = advancedNestingSession(
      { ...input, definition: { ...input.definition, method: 'outline' } },
      (e) => events.push(e),
    );
    expect(events[0]?.kind).toBe('production-progress');
    expect(events[1]?.kind).toBe('advanced-start');
    const first = events[0];
    if (first?.kind !== 'production-progress' || session === null)
      throw new Error('Missing baseline');
    const baseline = first.progress.best;
    expect(baseline?.produced).toBe(6);
    session.accept('not JSON');
    session.accept(JSON.stringify({ bins: [] }));
    session.finish();
    const last = events.at(-2);
    expect(last?.kind).toBe('production-progress');
    if (last?.kind !== 'production-progress') return;
    expect(last.progress.best).toBe(baseline);
    expect(last.progress.notice).toContain('failed geometry validation');
    expect(events.at(-1)?.kind).toBe('production-complete');
  });
  it('completes with an explanatory baseline for unsupported settings', () => {
    const events: NestingWorkerResponse[] = [];
    expect(advancedNestingSession(productionFixture(), (e) => events.push(e))).toBeNull();
    expect(events.some((e) => e.kind === 'advanced-start')).toBe(false);
    expect(events.at(-1)?.kind).toBe('production-complete');
  });
  it.each(['fast', 'outline'] as const)(
    'retains the selected 24-trial standard result when advanced %s is unavailable or fails',
    (method) => {
      const original = productionFixture();
      const input = { ...original, definition: { ...original.definition, method, optimise: true } };
      const expected = [...searchProductionNest(input)].at(-1)?.best;
      const events: NestingWorkerResponse[] = [];
      const session = advancedNestingSession(input, (event) => events.push(event));
      const standard = events.filter((event) => event.kind === 'production-progress').slice(0, 24);
      expect(standard).toHaveLength(24);
      expect(standard.map((event) => event.progress.attempted)).toEqual(
        Array.from({ length: 24 }, (_, index) => index + 1),
      );
      expect(standard.at(-1)?.progress.best).toEqual(expected);
      if (method === 'outline') {
        expect(events[24]?.kind).toBe('advanced-start');
        expect(session).not.toBeNull();
        session?.finish('Advanced engine failed.');
      } else expect(session).toBeNull();
      const final = events.at(-2);
      expect(final).toMatchObject({ kind: 'production-progress', progress: { best: expected } });
      expect(events.at(-1)?.kind).toBe('production-complete');
    },
  );
});
