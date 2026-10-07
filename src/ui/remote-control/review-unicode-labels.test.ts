import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { useStore } from '../state/store';
import { detectMinFeatureWarnings } from '../laser/job-review/min-feature-warnings';
import { reviewProjection } from './status-projections';
import type { RemoteControlOptions } from './types';

beforeEach(() => useStore.setState(useStore.getInitialState(), true));
describe('Unicode operation names in real minimum-feature warnings', () => {
  it.each(['é', '字', 'é字', 'e\u0301', 'mm', 'laser'])(
    'redacts "%s" without changing the warning consequence',
    async (name) => {
      const state = useStore.getState();
      const object = createRectangle({
        id: 'narrow',
        color: '#000000',
        spec: { widthMm: 0.1, heightMm: 10, cornerRadiusMm: 0 },
      });
      const layer = { ...createLayer({ id: 'op', color: '#000000', name }), kerfOffsetMm: 0.075 };
      useStore.setState({
        project: {
          ...state.project,
          scene: { ...state.project.scene, objects: [object], layers: [layer] },
        },
      });
      const warnings = detectMinFeatureWarnings(useStore.getState().project);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.join(' ')).toContain(`Layer "${name}"`);
      const options: RemoteControlOptions = {
        canWrite: () => false,
        getAppStatus: () => ({
          app: { name: 'KerfDesk', version: 'test', platform: 'desktop' },
          edition: { mode: 'free' },
          updates: { available: false },
        }),
        getReview: () => ({
          revision: 'r1',
          status: 'ready',
          mode: 'laser',
          warnings: warnings.map((message, i) => ({
            code: `job-review-${i + 1}`,
            severity: 'warning',
            message,
          })),
          frame: { required: true, complete: false },
        }),
      };
      const projected = await reviewProjection(options, 'r1', 'laser');
      const delivered = projected['warnings'] as { message: string }[];
      expect(delivered).toHaveLength(warnings.length);
      delivered.forEach((warning, i) => {
        const safeNative = warnings[i]!.normalize('NFC').replace(
          `Layer "${name.normalize('NFC')}"`,
          'Layer "artwork"',
        );
        // Coincidence with a unit or ordinary prose is ambiguous: keep its
        // factual body untouched or give the conservative PC-only fallback.
        const allowed =
          name === 'mm' || name === 'laser'
            ? [safeNative, 'Review this artwork-specific warning in KerfDesk on the PC.']
            : [safeNative];
        expect(allowed).toContain(warning.message);
        expect(warning.message).not.toContain(`Layer "${name.normalize('NFC')}"`);
      });
    },
  );
});
