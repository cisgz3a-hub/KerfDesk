// A running job publishes a recovery snapshot at every progress checkpoint.
// None of these always-mounted panels shows active-run progress, so none of
// them may re-render for one; only a real change to what they show counts.

import { act, Profiler, type ProfilerOnRenderCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { CheckpointResumeBanner } from './CheckpointResumeBanner';
import { ExecutionArchivePanel } from './ExecutionArchivePanel';
import { RunAgainControl } from './RunAgainControl';
import { SecondPassControl } from './second-pass/SecondPassControl';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = '2026-07-15T10:00:00.000Z';
const GCODE = Array.from({ length: 100 }, (_, index) => `G1 X${index} S100`).join('\n');
const renders = new Map<string, number>();
const countRender: ProfilerOnRenderCallback = (id) => {
  renders.set(id, (renders.get(id) ?? 0) + 1);
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
  usePrintCutSessionStore.getState().clear();
  renders.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useLaserStore.setState(initialLaserState());
});

describe('recovery panels during a running job', () => {
  it('do not re-render for progress checkpoints, only for what they show', async () => {
    const repository = new RecoveryRepository({
      backend: new MemoryRecoveryStorageBackend(),
      generationStore: new MemoryRecoveryGenerationStore(),
      legacyStorage: { read: () => null, clear: () => undefined },
      nowIso: () => NOW,
    });
    await repository.initialize();
    await repository.stageArtifact(
      await createCurrentTestExecutionArtifact({ runId: 'run-live', gcode: GCODE }),
    );
    await repository.activateFreshRun('run-live', NOW);
    await render(repository);
    renders.clear();

    await act(async () => {
      for (const ackedLines of [25, 50, 75]) {
        await repository.updateProgress('run-live', ackedLines, NOW);
      }
    });

    expect(repository.getSnapshot().activeRun?.ackedLines).toBe(75);
    expect(Object.fromEntries(renders)).toEqual({});

    await act(async () => {
      await repository.completeRun('run-live', NOW);
    });
    expect(renders.get('archive')).toBeGreaterThan(0);
    expect(renders.get('second-pass')).toBeGreaterThan(0);
  });
});

async function render(repository: RecoveryRepository): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <>
        <Profiler id="banner" onRender={countRender}>
          <CheckpointResumeBanner busy={false} repository={repository} />
        </Profiler>
        <Profiler id="archive" onRender={countRender}>
          <ExecutionArchivePanel repository={repository} />
        </Profiler>
        <Profiler id="run-again" onRender={countRender}>
          <RunAgainControl disabled={false} busy={false} repository={repository} />
        </Profiler>
        <Profiler id="second-pass" onRender={countRender}>
          <SecondPassControl busy={false} machineKind="laser" repository={repository} />
        </Profiler>
      </>,
    );
  });
}
