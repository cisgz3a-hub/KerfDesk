// use-design-simulate — click-to-run bit simulation state (ADR-271
// Amendment 1 clause 4). The result remembers WHICH sketch it simulated, so
// the pane can mark it stale the moment the drawing moves on — an honest
// label instead of a silently outdated surface.

import { useCallback, useState } from 'react';
import type { Sketch } from '../../../core/design';
import type { RemovalGrid } from '../../../core/sim';
import { useStore } from '../../state';
import { useDesignStudioStore } from '../design-studio-store';
import type { DesignCarveSource } from './design-carve-source';
import { simulateDesignCarve } from './design-simulate';

export type DesignSimulate =
  | { readonly kind: 'idle' }
  | { readonly kind: 'ok'; readonly grid: RemovalGrid; readonly forSketch: Sketch }
  | { readonly kind: 'empty' | 'failed'; readonly reason: string; readonly forSketch: Sketch };

export type DesignSimulateHandle = {
  readonly simulate: DesignSimulate;
  readonly isStale: boolean;
  readonly run: () => void;
};

export function useDesignSimulate(source: DesignCarveSource | null): DesignSimulateHandle {
  const [simulate, setSimulate] = useState<DesignSimulate>({ kind: 'idle' });
  const sketch = useDesignStudioStore((state) =>
    state.session === null ? null : state.session.history.present,
  );

  const run = useCallback(() => {
    // Read at click time, not render time — the click wants the sketch as it
    // is NOW, and a stale closure here would simulate an old drawing.
    const current = useDesignStudioStore.getState().session?.history.present ?? null;
    const project = useStore.getState().project;
    if (current === null || source === null) return;
    const ids = current.entities.map(() => crypto.randomUUID());
    const outcome = simulateDesignCarve(project, current, ids, source);
    if (outcome.kind === 'ok') {
      setSimulate({ kind: 'ok', grid: outcome.grid, forSketch: current });
      return;
    }
    setSimulate({ kind: outcome.kind, reason: outcome.reason, forSketch: current });
  }, [source]);

  const isStale =
    simulate.kind !== 'idle' && sketch !== null && simulate.forSketch !== sketch;
  return { simulate, isStale, run };
}
