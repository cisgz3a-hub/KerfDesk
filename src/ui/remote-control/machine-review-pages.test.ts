import { afterEach, describe, expect, it } from 'vitest';
import { createLayer, bindSceneObjectToOperations } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useJobReviewStore } from '../laser/job-review/job-review-store';
import { machineReviewPresenter } from './machine-review-presenter';
import { machineOperationProjection } from './machine-projections';
import type { OwnedMachineOperation } from './machine-operation-state';
import type { JobReviewModel } from '../laser/job-review/job-review-model';
import { currentMachineReviewForApproval } from './machine-owned-operation';
import { mcpMachineOutputSchemas } from '../../../electron/mcp/machine-schemas';
import { structuredToolResult, toolResultBytes } from '../../../electron/mcp/tool-result';
import { MCP_MAX_RESULT_BYTES } from '../../../electron/mcp/input-schemas';
import { installFrameOnceProject } from '../laser/frame-once.test-support';
import { installReviewPendingFramedRunPermitForCurrentState } from '../laser/framed-run-testing';
import { buildJobReviewModel } from '../laser/job-review';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { currentOutputScope } from '../state';
import { machineReviewPage, MACHINE_REVIEW_PAGE_BYTES } from './machine-review-pages';

afterEach(() => {
  useJobReviewStore.getState().close();
  useStore.setState(useStore.getInitialState(), true);
  useLaserStore.setState(initialLaserState());
});

describe('same-review complete bounded machine facts', () => {
  it('pages all compiler warnings and operations beyond 200 without changing the approvable native review', async () => {
    installFrameOnceProject();
    const layers = Array.from({ length: 201 }, (_, index) => ({
      ...createLayer({ id: `op-${index}`, color: '#000000', name: `Narrow cut ${index}` }),
      kerfOffsetMm: 0.075,
    }));
    const objects = layers.map((layer, index) =>
      bindSceneObjectToOperations(
        createRectangle({
          id: `rectangle-${index}`,
          color: '#000000',
          spec: { widthMm: 0.1, heightMm: 10, cornerRadiusMm: 0 },
        }),
        [layer.id],
      ),
    );
    useStore.setState((state) => ({
      project: { ...state.project, scene: { ...state.project.scene, objects, layers } },
    }));
    // A completed-Frame fixture, with no controller or hardware command.
    const permit = await installReviewPendingFramedRunPermitForCurrentState();
    const model = buildJobReviewModel({
      project: useStore.getState().project,
      prepared: permit.candidate.preparedStart,
      laserModeStartSnapshot: captureLaserModeStartSnapshot(useLaserStore.getState()),
      overrides: useLaserStore.getState().ovCache,
      outputScope: currentOutputScope(useStore.getState()),
    });
    expect(model.warnings.length).toBeGreaterThan(200);
    expect(model.effectiveOperations).toHaveLength(201);
    const operation: OwnedMachineOperation = {
      authority: {
        clientId: 'operator',
        sessionId: 'session',
        signal: new AbortController().signal,
        assertCurrent: () => undefined,
      },
      controller: new AbortController(),
      documentEpoch: useStore.getState().projectDocumentEpoch,
      controllerEpoch: useLaserStore.getState().controllerSessionEpoch,
      kind: 'job',
      state: 'preparing',
      committed: false,
      cleanup: () => undefined,
    };
    const options = {
      store: useStore,
      canWrite: () => false,
      canShareArtwork: () => true,
      getAppStatus: () => ({
        app: { name: 'KerfDesk', version: 'test', platform: 'desktop' as const },
        edition: { mode: 'free' as const },
        updates: { available: false },
      }),
    };
    const presentation = machineReviewPresenter(
      operation,
      () => 'revision-1',
      options,
    )(model, 'start');
    expect(presentation).not.toBeNull();
    try {
      let offset: number | null = 0;
      const warnings: string[] = [];
      const summaries = new Map<number, string[]>();
      const stats: unknown[] = [];
      let pages = 0;
      while (offset !== null) {
        expect(pages++).toBeLessThan(100);
        const raw = machineOperationProjection(
          '001e1d0c-fcb5-49bb-83bd-4b8d31b911d6',
          operation,
          'revision-1',
          options,
          { reviewId: operation.review!.id, offset },
        );
        const data = mcpMachineOutputSchemas.get_control_operation.parse({
          revision: 'revision-1',
          operation: raw,
        });
        const review = data.operation.review!;
        expect(review.pagination).toMatchObject({
          offset,
          totalWarnings: model.warnings.length,
          totalOperations: 201,
        });
        expect(review.frame.complete).toBe(true);
        expect(toolResultBytes(structuredToolResult(data))).toBeLessThan(MCP_MAX_RESULT_BYTES);
        warnings.push(...review.warnings.map((item) => item.message));
        stats.push(...review.stats);
        for (const item of review.operations) {
          const previous = summaries.get(item.index!) ?? [];
          expect(item.summaryOffset).toBe(previous.length);
          summaries.set(item.index!, [...previous, ...item.summaries]);
        }
        offset = review.pagination!.nextOffset;
      }
      expect(pages).toBeGreaterThan(1);
      expect(warnings).toEqual(model.warnings);
      expect(stats).toEqual(model.stats);
      expect([...summaries]).toEqual(
        model.effectiveOperations.map((item, index) => [index, item.summaries]),
      );
      expect(currentMachineReviewForApproval(operation, 'revision-1').model).toBe(model);
      expect(() =>
        machineOperationProjection(
          '001e1d0c-fcb5-49bb-83bd-4b8d31b911d6',
          operation,
          'revision-2',
          options,
          { reviewId: operation.review!.id, offset: 60 },
        ),
      ).toThrow(/changed/);
    } finally {
      presentation!.dispose();
    }
  }, 15_000);

  it('keeps long Unicode, all statistics, empty operations and summaries beyond 20 within the actual MCP envelope', () => {
    const label = '火\\"'.repeat(100);
    const model = {
      stats: Array.from({ length: 19 }, (_, index) => ({
        label: `stat-${index}`,
        value: label,
        detail: label,
      })),
      warnings: Array.from({ length: 210 }, (_, index) => `warning-${index} ${label}`),
      effectiveOperations: [
        { layerId: 'empty', summaries: [] },
        {
          layerId: 'long',
          summaries: Array.from({ length: 45 }, (_, index) => `summary-${index} ${label}`),
        },
      ],
    } as unknown as JobReviewModel;
    let offset: number | null = 0;
    const warnings: string[] = [],
      stats: unknown[] = [],
      summaries: string[] = [];
    let emptyOperations = 0;
    while (offset !== null) {
      const page = machineReviewPage(model, (value) => value, {
        reviewId: '001e1d0c-fcb5-49bb-83bd-4b8d31b911d6',
        offset,
      });
      expect(new TextEncoder().encode(JSON.stringify(page)).byteLength).toBeLessThanOrEqual(
        MACHINE_REVIEW_PAGE_BYTES,
      );
      expect(toolResultBytes(structuredToolResult(page))).toBeLessThan(MCP_MAX_RESULT_BYTES);
      expect(page.stats.length).toBeLessThanOrEqual(16);
      warnings.push(...page.warnings.map((item) => item.message));
      stats.push(...page.stats);
      for (const item of page.operations) {
        expect(item.summaries.length).toBeLessThanOrEqual(20);
        if (item.operationId === 'empty') emptyOperations++;
        else {
          expect(item.summaryOffset).toBe(summaries.length);
          summaries.push(...item.summaries);
        }
      }
      offset = page.pagination!.nextOffset;
    }
    expect(warnings).toEqual(model.warnings);
    expect(stats).toEqual(model.stats);
    expect(summaries).toEqual(model.effectiveOperations[1]!.summaries);
    expect(emptyOperations).toBe(1);
    expect(() =>
      machineReviewPage(model, (value) => value, {
        reviewId: '001e1d0c-fcb5-49bb-83bd-4b8d31b911d6',
        offset: 1_000_000,
      }),
    ).toThrow();
  });
});
